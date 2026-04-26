// reload.ts - graceful re-exec that keeps the user connected to their session.
// Flushes session state, writes a handoff file, then uses a launcher loop
// to restart the process without TTY ownership issues.

import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { AppState } from '../app/AppState.js'
import { writeMessages } from '../context/session.js'
import { agentsDir, ensureAgentsDir } from '../config/agentsDir.js'

const RELOAD_STATE_PATH = agentsDir('reload-state.json')

// Exit code that the launcher loop (cli.tsx) listens for to restart
export const RELOAD_EXIT_CODE = 42

type ReloadState = {
  sessionId: string
  sessionName: string
  patchInfo?: string
}

// Perform a graceful reload:
// 1. Flush current messages to JSONL session file
// 2. Write reload-state.json handoff
// 3. Exit with RELOAD_EXIT_CODE - the cli.tsx launcher loop restarts the app
export async function gracefulReload(
  state: AppState,
  patchInfo?: string
): Promise<never> {
  // Flush any messages not yet persisted (best-effort)
  // Only persist conversation messages - system notifications are ephemeral
  // Overwrite (not append) to prevent duplicates across multiple reloads
  try {
    const conversationMsgs = state.messages.filter(m => m.role !== 'system')
    await writeMessages(state.sessionName, conversationMsgs)
  } catch { /* best effort */ }

  // Write handoff state
  const reloadState: ReloadState = {
    sessionId: state.sessionId,
    sessionName: state.sessionName,
    patchInfo,
  }

  try {
    ensureAgentsDir()
    writeFileSync(RELOAD_STATE_PATH, JSON.stringify(reloadState, null, 2), 'utf8')
  } catch (err) {
    throw new Error(`Could not write reload-state.json: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Give the TUI a moment to render the "reloading…" state before we exit
  await new Promise(r => setTimeout(r, 200))

  // Exit with RELOAD_EXIT_CODE - the outer launcher loop in cli.tsx will restart
  process.exit(RELOAD_EXIT_CODE)
}
