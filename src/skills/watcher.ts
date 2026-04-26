// Skill watcher - hot-reloads SKILL.md skills from ~/.claude/skills/ and ~/.agents/skills/
// Exposes all skills via a single `invoke_skill` tool the model calls on demand.
// Security scanning happens at invocation time, not load time.

import chokidar from 'chokidar'
import { SKILL_DIRS, loadSkillFile, loadAllSkills, type LoadedSkill } from './loader.js'
import { scanSkill } from './scanner.js'
import type { Tool } from '../agent/QueryEngine.js'
import type { QueryEngine } from '../agent/QueryEngine.js'
import { defaultRegistry } from '../commands/index.js'
import { addSystemMessage } from '../app/AppState.js'

const TOOL_NAME = 'invoke_skill'

// Skill listing budget: 1% of 200k context × 4 chars/token
const MAX_SKILL_LISTING_CHARS = 8_000
// Per-skill description cap - listing is for discovery only
const MAX_SKILL_DESC_CHARS = 250

/** Format skill listing within a character budget. Falls back to names-only if over budget. */
function formatSkillListing(skillList: LoadedSkill[]): string {
  if (skillList.length === 0) return 'No skills loaded.'

  const entries = skillList.map(s => {
    const desc = s.description.length > MAX_SKILL_DESC_CHARS
      ? s.description.slice(0, MAX_SKILL_DESC_CHARS - 1) + '…'
      : s.description
    return `- ${s.slug}: ${desc}`
  })

  const full = entries.join('\n')
  if (full.length <= MAX_SKILL_LISTING_CHARS) return full

  // Over budget: names only
  return skillList.map(s => `- ${s.slug}`).join('\n')
}

type SkillEvent =
  | { type: 'ready'; count: number }
  | { type: 'loaded'; skill: LoadedSkill }
  | { type: 'reloaded'; skill: LoadedSkill }
  | { type: 'removed'; slug: string; path: string }
  | { type: 'error'; path: string; message: string }
  | { type: 'warning'; skill: LoadedSkill; categories: string[] }

type SkillEventHandler = (event: SkillEvent) => void

/** Build the invoke_skill tool definition from the current skill set. */
function buildInvokeSkillTool(skills: Map<string, LoadedSkill>, engine: QueryEngine, emit: (e: SkillEvent) => void): Tool {
  const skillList = [...skills.values()]
  const listing = formatSkillListing(skillList)
  const slugList = skillList.map(s => s.slug).join(', ')

  return {
    name: TOOL_NAME,
    description: `Invoke a skill by name to load its instructions into your context. Available skills:\n${listing}`,
    input_schema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: `Skill slug to invoke. One of: ${slugList || 'none'}`,
        },
      },
      required: ['skill'],
    },
    execute: async (args: Record<string, unknown>) => {
      const slug = String(args['skill'] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const skill = skills.get(slug)
      if (!skill) {
        const available = [...skills.keys()].join(', ')
        return `Unknown skill "${slug}". Available: ${available || 'none'}`
      }

      // Security scan at invocation time - cached by content hash
      const scanResult = await scanSkill(skill.content)
      if (!scanResult.allPassed) {
        const failed = scanResult.checks.filter(c => !c.passed).map(c => c.category)
        emit({ type: 'warning', skill, categories: failed })
      }

      // Store skill content out-of-band in the engine's system prompt section
      // rather than returning it as a tool_result (which would bloat the transcript).
      engine.registerSkillContent(skill.slug, skill.name, skill.content)
      return `✓ skill "${skill.name}" loaded - instructions are now active in your system context.`
    },
  }
}

export class SkillWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private allSkills = new Map<string, LoadedSkill>()       // slug -> skill (all discovered)
  private loadedSkills = new Map<string, LoadedSkill>()    // slug -> skill (active/enabled)
  private pathToSlug = new Map<string, string>()           // path -> slug
  private handlers: SkillEventHandler[] = []
  private engine: QueryEngine
  // null = all enabled (default), Set = explicit selection
  private enabledSlugs: Set<string> | null = null

  constructor(engine: QueryEngine) {
    this.engine = engine
  }

  onEvent(handler: SkillEventHandler): void {
    this.handlers.push(handler)
  }

  private emit(event: SkillEvent): void {
    for (const h of this.handlers) h(event)
  }

  private refreshTool(): void {
    this.engine.unregisterTool(TOOL_NAME)
    if (this.loadedSkills.size > 0) {
      this.engine.registerTool(buildInvokeSkillTool(this.loadedSkills, this.engine, this.emit.bind(this)))
    }
  }

  /** Register a skill's declared slash command with the command registry. */
  private registerSkillSlashCmd(skill: LoadedSkill): void {
    if (!skill.slashCommand) return
    const cmd = skill.slashCommand.startsWith('/') ? skill.slashCommand : `/${skill.slashCommand}`
    const genomeTag = `skill-${skill.slug}`
    defaultRegistry.register({
      cmd,
      desc: skill.slashDesc ?? `Invoke skill: ${skill.name}`,
      genome: [genomeTag],
      handler: async (args, ctx) => {
        const message = args
          ? `Please use the ${skill.slug} skill to help with: ${args}`
          : `Please invoke the ${skill.slug} skill.`
        if (ctx.submitToEngine) {
          await ctx.submitToEngine(message)
        } else {
          addSystemMessage(ctx.setState, 'info', `Skill invoked: ${skill.name}. Type your request and it will use this skill.`)
        }
      },
    })
  }

  /** Unregister a skill's slash command from the registry. */
  private unregisterSkillSlashCmd(skill: LoadedSkill): void {
    if (!skill.slashCommand) return
    const cmd = skill.slashCommand.startsWith('/') ? skill.slashCommand : `/${skill.slashCommand}`
    defaultRegistry.unregister(cmd)
  }

  async start(enabledSlugs?: Set<string>): Promise<void> {
    if (enabledSlugs !== undefined) this.enabledSlugs = enabledSlugs
    // Load all existing skills
    const initial = await loadAllSkills()
    for (const skill of initial) {
      this.allSkills.set(skill.slug, skill)
      this.pathToSlug.set(skill.path, skill.slug)
      // Only activate if in enabled set (or all if no filter)
      if (this.enabledSlugs === null || this.enabledSlugs.has(skill.slug)) {
        this.loadedSkills.set(skill.slug, skill)
        this.registerSkillSlashCmd(skill)
      }
    }
    this.refreshTool()
    this.emit({ type: 'ready', count: this.loadedSkills.size })

    // Watch all skill dirs for SKILL.md add/change/remove
    const patterns = SKILL_DIRS.map(d => `${d}/**/SKILL.md`)
    this.watcher = chokidar.watch(patterns, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })

    this.watcher.on('add', async (path: string) => {
      const skill = await loadSkillFile(path)
      if (!skill) { this.emit({ type: 'error', path, message: 'Failed to load skill' }); return }
      this.allSkills.set(skill.slug, skill)
      this.pathToSlug.set(path, skill.slug)
      if (this.enabledSlugs === null || this.enabledSlugs.has(skill.slug)) {
        this.loadedSkills.set(skill.slug, skill)
        this.refreshTool()
        this.registerSkillSlashCmd(skill)
        this.emit({ type: 'loaded', skill })
      }
    })

    this.watcher.on('change', async (path: string) => {
      const skill = await loadSkillFile(path)
      if (!skill) { this.emit({ type: 'error', path, message: 'Failed to reload skill' }); return }
      this.allSkills.set(skill.slug, skill)
      this.pathToSlug.set(path, skill.slug)
      if (this.enabledSlugs === null || this.enabledSlugs.has(skill.slug)) {
        const old = this.loadedSkills.get(skill.slug)
        if (old) this.unregisterSkillSlashCmd(old)
        this.loadedSkills.set(skill.slug, skill)
        // Update active content if this skill was already invoked
        this.engine.unregisterSkillContent(skill.slug)
        this.refreshTool()
        this.registerSkillSlashCmd(skill)
        this.emit({ type: 'reloaded', skill })
      }
    })

    this.watcher.on('unlink', (path: string) => {
      const slug = this.pathToSlug.get(path)
      if (slug) {
        this.allSkills.delete(slug)
        const skill = this.loadedSkills.get(slug)
        if (skill) this.unregisterSkillSlashCmd(skill)
        this.loadedSkills.delete(slug)
        this.pathToSlug.delete(path)
        this.engine.unregisterSkillContent(slug)
        this.refreshTool()
        this.emit({ type: 'removed', slug, path })
      }
    })
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }

  getLoadedSkills(): LoadedSkill[] {
    return [...this.loadedSkills.values()]
  }

  getAvailableSkills(): LoadedSkill[] {
    return [...this.allSkills.values()]
  }

  getEnabledSlugs(): Set<string> | null {
    return this.enabledSlugs
  }

  /** Apply a new enabled set - loads/unloads skills accordingly. */
  setEnabled(slugs: Set<string>): void {
    this.enabledSlugs = slugs
    // Unload skills not in new set
    for (const [slug, skill] of this.loadedSkills) {
      if (!slugs.has(slug)) {
        this.unregisterSkillSlashCmd(skill)
        this.engine.unregisterSkillContent(slug)
        this.loadedSkills.delete(slug)
      }
    }
    // Load skills newly enabled
    for (const slug of slugs) {
      if (!this.loadedSkills.has(slug)) {
        const skill = this.allSkills.get(slug)
        if (skill) {
          this.loadedSkills.set(slug, skill)
          this.registerSkillSlashCmd(skill)
        }
      }
    }
    this.refreshTool()
  }
}
