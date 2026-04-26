#!/usr/bin/env bun
// Hello, world! This is the audit-wizard CLI entry point.
import { spawnSync } from 'child_process'
import React from 'react'
import { render } from 'ink'
import { openSync, writeSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { ReadStream } from 'tty'
import { agentsDir } from './config/agentsDir.js'
import App from './app/App.js'
import { RELOAD_EXIT_CODE } from './reload/reload.js'

// ─── Fast paths ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

const cliName     = 'audit-wizard'
const cliSubtitle = 'AI Auditing Agent'
const cliGenome   = ['nuc', 'div', 'mem', 'rna']

// Slash commands gated by genome
const GENOME_COMMANDS: { genomes: string[]; line: string }[] = [
  { genomes: ['mem'], line: '  /sessions                       Browse and resume past sessions' },
  { genomes: ['mem'], line: '  /model                          Switch AI model' },
  { genomes: ['mem'], line: '  /api-key                        Set API key' },
  { genomes: ['rna'], line: '  /skills                         List loaded skills' },
  { genomes: ['div'], line: '  /buddy                          Change companion' },
]

if (args.includes('--version') || args.includes('-v')) {
  console.log(`${cliName} 0.1.0`)
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  const visibleCmds = GENOME_COMMANDS
    .filter(c => c.genomes.some(g => cliGenome.includes(g)))
    .map(c => c.line)
  console.log(`
${cliName} - ${cliSubtitle}

Usage:
  ${cliName}                          Start a new session
  ${cliName} --session <name>         Start or resume a named session
  ${cliName} --resume                 Resume last session
  ${cliName} --version                Print version

Commands (inside TUI):
${visibleCmds.join('\n')}
  Ctrl+Q                          Quit
`.trim())
  process.exit(0)
}

// ─── Launcher loop ────────────────────────────────────────────────────────────
// The launcher is a thin outer loop. On each iteration it runs the inner TUI
// process with spawnSync (blocking, stdio: 'inherit'). When the inner process
// exits with RELOAD_EXIT_CODE (42), the launcher restarts it. Any other exit
// code breaks the loop and the launcher exits.
//
// This keeps the TTY firmly in the foreground the whole time - no process-group
// handoff needed. The launcher never touches the TTY itself.

const LAST_SESSION_PATH = agentsDir('last-session')
const LAST_SESSION_PATH_LEGACY = `${process.env['HOME'] ?? '.'}/.audit-wizard/last-session`

if (!process.env['AGENT_INNER']) {
  const execPath = process.execPath
  const scriptPath = process.argv[1]!
  const scriptArgs = process.argv.slice(2)

  // Ignore SIGINT - inner process handles Ctrl+C itself
  process.on('SIGINT', () => {})

  while (true) {
    const result = spawnSync(execPath, [scriptPath, ...scriptArgs], {
      stdio: 'inherit',
      env: { ...process.env, AGENT_INNER: '1' },
    })
    if (result.status !== RELOAD_EXIT_CODE) break
  }

  // Print resume hint using session name written by inner process
  try {
    let lastSession = ''
    try { lastSession = readFileSync(LAST_SESSION_PATH, 'utf8').trim() } catch { /* new path */ }
    if (!lastSession) { try { lastSession = readFileSync(LAST_SESSION_PATH_LEGACY, 'utf8').trim() } catch { /* no legacy */ } }
    if (lastSession) writeSync(1, `\r\nresume: ${cliName} --session ${lastSession}\r\n`)
  } catch { /* no session file yet */ }

  process.exit(0)
}

// ─── Inner TUI process ────────────────────────────────────────────────────────
// Everything below runs only in the inner process (AGENT_INNER=1).

// ─── Parse flags ──────────────────────────────────────────────────────────────

let sessionName = `session-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(/:/g, '')}`
let justReloaded = false
let reloadedPatchInfo: string | undefined
let genomeFilter: string[] | null = null

const sessionIdx = args.indexOf('--session')
if (sessionIdx !== -1 && args[sessionIdx + 1]) {
  sessionName = args[sessionIdx + 1] as string
}

const genomeIdx = args.indexOf('--genome')
if (genomeIdx !== -1 && args[genomeIdx + 1]) {
  genomeFilter = (args[genomeIdx + 1] as string).split('_').map(s => s.trim()).filter(Boolean)
}

// Detect reload handoff from previous process (Phase 5 writes this file)
const reloadStatePath = agentsDir('reload-state.json')
try {
  const raw = await Bun.file(reloadStatePath).text()
  const reloadState = JSON.parse(raw) as { sessionId?: string; sessionName?: string; patchInfo?: string }
  sessionName = reloadState.sessionName ?? sessionName
  reloadedPatchInfo = reloadState.patchInfo
  justReloaded = true
  // Clean up the handoff file so it's not picked up on next normal start
  await Bun.file(reloadStatePath).exists() && await Bun.write(reloadStatePath, '')
  const { unlinkSync } = await import('fs')
  try { unlinkSync(reloadStatePath) } catch { /* already gone */ }
} catch {
  // No reload state - normal startup
}

// ─── Ensure ~/.agents dirs exist ─────────────────────────────────────────────

const home = process.env['HOME'] ?? '.'
await Bun.write(agentsDir('.gitkeep'), '')
await Bun.write(agentsDir('sessions', '.gitkeep'), '')
await Bun.write(agentsDir('skills', '.gitkeep'), '')
await Bun.write(agentsDir('worktrees', '.gitkeep'), '')

// Write session name so outer launcher can print resume hint after exit
await Bun.write(LAST_SESSION_PATH, sessionName)
// ─── stdin: ensure we always have a real TTY ─────────────────────────────────

let ttyStdin: ReadStream | undefined
if (!process.stdin.isTTY && process.platform !== 'win32') {
  try {
    const fd = openSync('/dev/tty', 'r')
    const stream = new ReadStream(fd)
    stream.isTTY = true
    ttyStdin = stream
  } catch { /* fall back to default stdin */ }
}

// ─── Alternate screen + mouse tracking ───────────────────────────────────────

const ENTER_ALT = '\x1b[?1049h'
const EXIT_ALT  = '\x1b[?1049l'
const CLEAR     = '\x1b[2J\x1b[H'

import { ENABLE_MOUSE, DISABLE_MOUSE } from './utils/mouse.js'
import { screenBuffer } from './utils/ScreenBuffer.js'
import { scheduleOverlay, initOverlay } from './utils/selectionOverlay.js'

const useAltScreen = process.stdout.isTTY && !process.env['CI']

if (useAltScreen) {
  process.stdout.write(ENTER_ALT + CLEAR + ENABLE_MOUSE)
}

function restoreScreen() {
  if (useAltScreen) process.stdout.write(DISABLE_MOUSE + EXIT_ALT)
}
process.on('exit', restoreScreen)
process.on('SIGTERM', () => { restoreScreen(); process.exit(0) })

// Clean up pane registration file on exit
process.on('exit', () => {
  const paneId = process.env['TMUX_PANE']
  if (!paneId) return
  const home = process.env['HOME'] ?? '.'
  // Find and remove the pane file for this instance
  try {
    const { readdirSync, readFileSync, unlinkSync } = require('fs') as typeof import('fs')
    const dir = agentsDir('panes')
    for (const f of readdirSync(dir)) {
      try {
        if (readFileSync(`${dir}/${f}`, 'utf8').trim() === paneId) unlinkSync(`${dir}/${f}`)
      } catch { /* skip */ }
    }
  } catch { /* panes dir may not exist */ }
})


// ─── Filter mouse sequences from Ink's stdin ─────────────────────────────────
// SGR mouse events (wheel/click) arrive as raw escape sequences. Ink doesn't
// recognize them and leaks the bytes into the input box as garbage characters.
// We intercept stdin, strip mouse sequences, and pass clean data to Ink.
// The useMouseWheel hook reads from the original raw stream independently.

import { PassThrough } from 'stream'

const MOUSE_STRIP_RE = /\x1b\[<\d+;\d+;\d+[Mm]/g

const rawStdin: ReadStream = ttyStdin ?? (process.stdin as unknown as ReadStream)

const inkStdin = new PassThrough() as unknown as ReadStream
inkStdin.isTTY = rawStdin.isTTY ?? false
inkStdin.setRawMode = (mode: boolean) => {
  rawStdin.setRawMode?.(mode)
  return inkStdin
}
// Ink calls ref/unref to manage the event loop lifetime
;(inkStdin as unknown as { ref: () => void; unref: () => void }).ref   = () => rawStdin.ref?.()
;(inkStdin as unknown as { ref: () => void; unref: () => void }).unref = () => rawStdin.unref?.()

rawStdin.on('data', (chunk: Buffer) => {
  const cleaned = chunk.toString('binary').replace(MOUSE_STRIP_RE, '')
  if (cleaned.length > 0) inkStdin.push(Buffer.from(cleaned, 'binary'))
})
rawStdin.on('end', () => inkStdin.push(null))

// ─── Intercept stdout for screen buffer ──────────────────────────────────────
// Capture all rendered output so mouse drag-to-copy can extract screen text.

const _origStdoutWrite = process.stdout.write.bind(process.stdout)
initOverlay(_origStdoutWrite)
;(process.stdout as NodeJS.WriteStream).write = function (
  chunk: Uint8Array | string,
  encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void
): boolean {
  try { screenBuffer.process(chunk as string | Buffer) } catch { /* never break stdout */ }
  if (typeof encodingOrCb === 'function') {
    const result = _origStdoutWrite(chunk as string, encodingOrCb)
    scheduleOverlay(_origStdoutWrite)
    return result
  }
  const result = _origStdoutWrite(chunk as string, encodingOrCb as BufferEncoding, cb)
  scheduleOverlay(_origStdoutWrite)
  return result
}

screenBuffer.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24)
process.stdout.on('resize', () => {
  screenBuffer.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24)
})

// ─── Launch TUI ───────────────────────────────────────────────────────────────

const renderOpts: Parameters<typeof render>[1] = { exitOnCtrlC: false }
renderOpts.stdin = inkStdin

const { waitUntilExit } = render(
  React.createElement(App, {
    sessionName,
    justReloaded,
    reloadedPatchInfo,
    genomeFilter,
  }),
  renderOpts,
)

await waitUntilExit()
restoreScreen()

