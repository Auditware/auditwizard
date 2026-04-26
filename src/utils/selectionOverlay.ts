/**
 * Selection overlay - writes reverse-video highlighting over selected characters
 * directly to the terminal, bypassing Ink's render cycle entirely for instant response.
 *
 * Two firing paths:
 *   1. setSelection() → immediate paint (drag feels instant)
 *   2. scheduleOverlay() → post-render repaint (restores highlight after Ink overwrites it)
 *
 * During streaming, scheduleOverlay is suppressed (prevents stale screenBuffer content
 * from corrupting fresh Ink renders). setSelection still works so drag-to-copy is
 * responsive even while the agent is writing.
 */

import { screenBuffer } from './ScreenBuffer.js'

export type Selection = {
  startRow: number; startCol: number
  endRow: number;   endCol: number
}

let activeSelection: Selection | null = null
let pendingOverlay = false
let _rawWrite: ((s: string) => boolean) | null = null
let _streaming = false

/** Call once from cli.tsx with the original process.stdout.write. */
export function initOverlay(rawWrite: (s: string) => boolean): void {
  _rawWrite = rawWrite
}

/**
 * Set streaming mode. Only used to gate stale-overlay repaints externally if needed.
 * Selection is no longer forcibly cleared on stream start - users can copy during streaming.
 */
export function setOverlayPaused(streaming: boolean): void {
  _streaming = streaming
}

export function setSelection(sel: Selection | null): void {
  // Always allow user-driven selection changes - even during streaming.
  activeSelection = sel
  if (_rawWrite) applySelectionOverlay(_rawWrite)
}

export function getSelection(): Selection | null {
  return activeSelection
}

/**
 * Apply character-precise selection overlay.
 * - Single row: invert [startCol, endCol]
 * - First row:  invert [startCol, eol]
 * - Middle rows: invert full row
 * - Last row:   invert [1, endCol]
 */
export function applySelectionOverlay(rawWrite: (s: string) => boolean): void {
  const sel = activeSelection
  if (!sel) return

  const { startRow, startCol, endRow, endCol } = sel
  let out = '\x1b7'  // save cursor

  for (let r = startRow; r <= endRow; r++) {
    const line = screenBuffer.getLine(r)

    let hiStart: number
    let hiEnd: number

    if (startRow === endRow) {
      hiStart = Math.min(startCol, endCol)
      hiEnd   = Math.max(startCol, endCol)
    } else if (r === startRow) {
      hiStart = startCol
      hiEnd   = line.length
    } else if (r === endRow) {
      hiStart = 1
      hiEnd   = endCol
    } else {
      hiStart = 1
      hiEnd   = line.length
    }

    const s = Math.max(0, hiStart - 1)
    const e = Math.min(line.length, hiEnd)

    const before   = line.slice(0, s)
    const selected = line.slice(s, e)
    const after    = line.slice(e)

    out += `\x1b[${r};1H${before}\x1b[7m${selected}\x1b[0m${after}`
  }

  out += '\x1b8'  // restore cursor
  rawWrite(out)
}

/**
 * Schedule one overlay repaint after the current Ink render frame.
 * Keeps the highlight alive when Ink rewrites content under it.
 */
export function scheduleOverlay(rawWrite: (s: string) => boolean): void {
  if (pendingOverlay || !activeSelection) return
  pendingOverlay = true
  queueMicrotask(() => {
    pendingOverlay = false
    applySelectionOverlay(rawWrite)
  })
}
