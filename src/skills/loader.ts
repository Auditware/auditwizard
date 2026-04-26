// Skill loader - loads SKILL.md files from ~/.claude/skills/ and ~/.agents/skills/
// Each skill is a directory containing a SKILL.md with YAML frontmatter.
// Format follows the agent skills spec:
// https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

import { existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { hashContent } from './scanner.js'
import { agentsDir } from '../config/agentsDir.js'

// Skill directories searched in order (later overrides earlier on name collision)
export const SKILL_DIRS = [
  agentsDir('skills'),
  join(process.env['HOME'] ?? '.', '.claude', 'skills'),
].filter(Boolean)

export interface SkillMeta {
  name: string
  description: string
  whenToUse?: string
  slashCommand?: string  // e.g. '/audit' - registers a slash command shortcut
  slashDesc?: string     // description shown in /help for the slash command
}

export interface LoadedSkill {
  // Canonical slug used as tool name (e.g. "git_commit")
  slug: string
  // Human name from frontmatter or directory name
  name: string
  description: string
  // Full SKILL.md content (frontmatter stripped) for injection on invocation
  content: string
  // Absolute path to the SKILL.md file
  path: string
  // Hash of raw SKILL.md content for change detection and scan caching
  hash: string
  loadedAt: number
  // Optional slash command this skill exposes
  slashCommand?: string
  slashDesc?: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Parse simple key: value YAML frontmatter (no nested objects needed). */
function parseFrontmatter(raw: string): { meta: Partial<SkillMeta>; content: string } {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { meta: {}, content: raw }

  const yamlBlock = match[1] ?? ''
  const content = raw.slice(match[0].length).trimStart()

  const meta: Partial<SkillMeta> = {}
  const lines = yamlBlock.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')

    // Handle YAML block scalars (> folded, | literal) - collect indented continuation lines
    if (value === '>' || value === '|') {
      const parts: string[] = []
      i++
      while (i < lines.length && (lines[i]!.startsWith(' ') || lines[i]!.startsWith('\t'))) {
        parts.push(lines[i]!.trim())
        i++
      }
      value = parts.join(' ').trim()
    } else {
      i++
    }

    if (key === 'name') meta.name = value
    else if (key === 'description') meta.description = value
    else if (key === 'when_to_use' || key === 'whenToUse') meta.whenToUse = value
    else if (key === 'slash_command' || key === 'slashCommand') meta.slashCommand = value
    else if (key === 'slash_desc' || key === 'slashDesc') meta.slashDesc = value
  }
  return { meta, content }
}

/** Convert a directory name to a safe tool name slug (lowercase, underscores). */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Load a single skill from its SKILL.md path. Returns null on error. */
export async function loadSkillFile(skillMdPath: string): Promise<LoadedSkill | null> {
  try {
    const raw = await Bun.file(skillMdPath).text()
    const { meta, content } = parseFrontmatter(raw)

    const dirName = basename(skillMdPath.replace(/[/\\]SKILL\.md$/i, ''))
    const name = meta.name || dirName
    const description = meta.description || `Skill: ${name}`
    const slug = toSlug(name)
    const hash = hashContent(raw)

    return { slug, name, description, content, path: skillMdPath, hash, loadedAt: Date.now(),
      slashCommand: meta.slashCommand, slashDesc: meta.slashDesc }
  } catch (err) {
    console.error(`[skills] Failed to load ${skillMdPath}:`, err)
    return null
  }
}

/** Find all SKILL.md files inside a skills directory (one level of subdirs). */
export function findSkillMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry)
      if (statSync(entryPath).isDirectory()) {
        const skillMd = join(entryPath, 'SKILL.md')
        if (existsSync(skillMd)) results.push(skillMd)
      }
    }
  } catch { /* ignore */ }
  return results
}

/** Load all skills from all known skill directories. Later dirs win on slug collision. */
export async function loadAllSkills(): Promise<LoadedSkill[]> {
  const bySlug = new Map<string, LoadedSkill>()
  for (const dir of SKILL_DIRS) {
    for (const path of findSkillMdFiles(dir)) {
      const skill = await loadSkillFile(path)
      if (skill) bySlug.set(skill.slug, skill)
    }
  }
  return [...bySlug.values()]
}
