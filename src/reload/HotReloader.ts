// HotReloader - watches src/ for file changes and triggers gracefulReload.
// Debounces rapid successive saves (e.g. formatters, multi-file patches)
// into a single reload 500ms after the last change.
//
// Fork-chain guard: a freshly reloaded process must not react to the file
// change that triggered its own reload. We enforce a STARTUP_GRACE_MS window
// during which all change events are silently ignored.

import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { join } from 'path'
import type { AppState } from '../app/AppState.js'
import type { Dispatch, SetStateAction } from 'react'
import { addSystemMessage } from '../app/AppState.js'
import { gracefulReload } from './reload.js'

const SRC_DIR = join(import.meta.dir, '..')  // audit-wizard/src/
const DEBOUNCE_MS = 500
const STARTUP_GRACE_MS = 3_000  // ignore changes for 3s after start

export class HotReloader {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private setState: Dispatch<SetStateAction<AppState>> | null = null
  private getState: (() => AppState) | null = null
  private reloading = false
  private startedAt = 0

  start(
    getState: () => AppState,
    setState: Dispatch<SetStateAction<AppState>>,
  ) {
    if (this.watcher) return  // already watching
    this.getState = getState
    this.setState = setState
    this.startedAt = Date.now()

    this.watcher = chokidar.watch(SRC_DIR, {
      persistent: true,
      ignoreInitial: true,           // don't fire on startup scan
      ignored: /(node_modules|\.git)/, // skip deps
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    })

    this.watcher.on('change', (path: string) => this.onFileChanged(path))
    this.watcher.on('add',    (path: string) => this.onFileChanged(path))
    this.watcher.on('unlink', (path: string) => this.onFileChanged(path))
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.watcher?.close().catch(() => {})
    this.watcher = null
  }

  private onFileChanged(filePath: string) {
    if (!this.setState) return
    if (Date.now() - this.startedAt < STARTUP_GRACE_MS) return
    if (this.reloading) return

    const rel = filePath.replace(SRC_DIR + '/', '')

    // Debounce: wait for write storm to settle before reloading
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const state = this.getState?.()
      if (!state || !this.setState) return
      // Only notify + reload once per debounce window
      addSystemMessage(this.setState, 'info', `↺ ${rel} changed - reloading…`)
      this.reloading = true
      // Safety: if the process doesn't exit within 8s, unlock so future reloads work
      const safetyTimer = setTimeout(() => { this.reloading = false }, 8_000)
      gracefulReload(state, rel).catch((err: unknown) => {
        clearTimeout(safetyTimer)
        this.reloading = false
        addSystemMessage(this.setState!, 'error', `reload failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, DEBOUNCE_MS)
  }
}
