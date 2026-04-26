// Children command modules - /children and /spawn with genome-aware spawning.
// genome: ['div']

import { spawnSync } from 'child_process'
import { addSystemMessage } from '../app/AppState.js'
import type { AppState, SpawnedChild } from '../app/AppState.js'
import { spawnChild, writeSeedPrompt } from '../children/ChildManager.js'
import type { SlashCommandModule } from './types.js'

// Build the tmux command string for launching a child agent process.
function resolveBun(): string {
  // When running under bun, process.execPath is already bun.
  // Fallback: resolve from PATH for test/node environments.
  if (process.execPath.includes('bun')) return process.execPath
  const r = spawnSync('which', ['bun'], { encoding: 'utf8' })
  return r.stdout.trim() || 'bun'
}

export function buildAgentCmd(worktreePath: string, sessionArg: string, parentSession: string, parentName: string, genome: string[]): string {
  const execPath = resolveBun()
  const cliScript = new URL('../../src/cli.tsx', import.meta.url).pathname
  const genomeArg = genome.length > 0 ? ['--genome', genome.join('_')] : []
  // API key is injected via tmux set-environment before this pane opens - not in the command string.
  const childSlug = sessionArg.replace('child-', '')
  const parts = [
    'env',
    'AGENT_IS_CHILD=1',
    `AGENT_INSTANCE_NAME=child-${childSlug}`,
    `AGENT_PARENT_SESSION=${parentSession}`,
    `AGENT_PARENT_NAME=${parentName}`,
    `AGENT_CHILD_SLUG=${childSlug}`,
    execPath,
    cliScript,
    '--session', sessionArg,
    ...genomeArg,
  ]
  return parts.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')
}

// Query tmux for pane dimensions by pane ID. Returns null on failure.
function getPaneDimensions(paneId: string): { width: number; height: number } | null {
  const res = spawnSync('tmux', ['display-message', '-t', paneId, '-p', '#{pane_width}x#{pane_height}'], { encoding: 'utf8' })
  if (res.status !== 0) return null
  const [w, h] = res.stdout.trim().split('x').map(Number)
  if (!w || !h) return null
  return { width: w, height: h }
}

// Choose split orientation: '-h' (side-by-side) or '-v' (stacked) based on available space.
// Minimum usable tether pane: 40 cols wide, 15 rows tall.
export function chooseSplitFlag(paneId: string | null): '-h' | '-v' {
  if (!paneId) return '-h'
  const dim = getPaneDimensions(paneId)
  if (!dim) return '-h'
  const halfWidth = Math.floor(dim.width / 2)
  const halfHeight = Math.floor(dim.height / 2)
  if (halfWidth >= 40) return '-h'
  if (halfHeight >= 15) return '-v'
  return '-h' // always split even if cramped - new-window is more disorienting
}

// Execute the actual spawn: create worktree, write seed, open tmux pane.
export function executeSpawn(
  intent: string,
  genome: string[],
  state: AppState,
  setState: Parameters<SlashCommandModule['handler']>[1]['setState'],
  apiKey?: string,
): void {
  addSystemMessage(setState, 'info', `Spawning child: "${intent}"...`)
  // When spawning from within a child, branch from current branch so the grandchild
  // (test-mirror) inherits all of this child's commits - not just main's state.
  const isChild = process.env['AGENT_IS_CHILD'] === '1'
  const baseBranch = isChild
    ? spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', cwd: process.cwd() }).stdout.trim() || 'main'
    : 'main'
  const isTestMirror = intent.toLowerCase().includes('run tests') || intent.toLowerCase().includes('test mirror')
  const { slug, worktreePath, error } = spawnChild(intent, baseBranch)
  if (error) {
    addSystemMessage(setState, 'error', `Spawn failed: ${error}`)
    return
  }
  const resolvedKey = apiKey ?? process.env['ANTHROPIC_API_KEY']
  writeSeedPrompt(slug, intent, isTestMirror)

  const sessionArg = `child-${slug}`
  const agentCmd = buildAgentCmd(worktreePath, sessionArg, state.sessionName, state.instanceName, genome)

  const splitFlag = chooseSplitFlag(state.paneId)
  const splitTarget = state.paneId ? ['-t', state.paneId] : []
  const envFlag: string[] = resolvedKey ? ['-e', `ANTHROPIC_API_KEY=${resolvedKey}`] : []
  const tmuxPane = spawnSync('tmux', [
    'split-window', splitFlag, '-P', '-F', '#{pane_id}', ...envFlag, ...splitTarget, '-c', worktreePath, agentCmd,
  ], { encoding: 'utf8' })
  let paneId = tmuxPane.stdout.trim()
  if (tmuxPane.status !== 0 || !paneId) {
    const fallback = spawnSync('tmux', [
      'new-window', '-P', '-F', '#{pane_id}', ...envFlag, '-c', worktreePath, '-n', `child:${slug.slice(0, 12)}`, agentCmd,
    ], { encoding: 'utf8' })
    paneId = fallback.stdout.trim()
  }

  const newChild: SpawnedChild = { slug, paneId, sessionName: sessionArg, spawnedAt: Date.now(), genome }
  setState(prev => ({
    ...prev,
    childCount: prev.childCount + 1,
    spawnedChildren: [...prev.spawnedChildren, newChild],
  }))
  addSystemMessage(setState, 'success', `child/${slug} spawned  genome: ${genome.join(',')}`)
}

export const childrenCommands: SlashCommandModule[] = [
  {
    cmd: '/spawn',
    desc: 'spawn an autonomous child agent branch',
    usage: '/spawn <intent>',
    genome: ['div'],
    handler: (args, ctx) => {
      const intent = args.trim()
      if (intent) {
        // Intent provided: spawn immediately, new pane opens right away
        const defaultGenome = ctx.genomeFilter ?? ['nuc', 'mem', 'rna', 'div']
        executeSpawn(intent, defaultGenome, ctx.state, ctx.setState, ctx.engineRef.current?.getApiKey())
      } else {
        // Bare /spawn: open config panel so user can set intent + genome
        const defaultGenome = ctx.genomeFilter ?? ['nuc', 'mem', 'rna', 'div']
        ctx.panels.open('spawn', { intent: '', selectedGenomes: defaultGenome })
        ctx.setState(prev => ({ ...prev, mode: 'spawn-config' as const }))
      }
    },
  },
]
