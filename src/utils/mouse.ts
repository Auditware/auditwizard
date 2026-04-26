/**
 * SGR mouse tracking helpers.
 *
 * Enables button-event + SGR format mouse reporting so the terminal sends
 * wheel events as escape sequences instead of key presses. This works inside
 * tmux because tmux forwards mouse protocol events to the focused pane -
 * unlike keyboard keys (e.g. PgUp) which tmux intercepts itself.
 *
 * Sequences:
 *   ?1002h  - button-event tracking (click, drag, wheel)
 *   ?1006h  - SGR extension (coordinates as decimal, not raw bytes)
 *
 * Wheel events arrive as:  ESC [ < 64 ; col ; row M  (up)
 *                           ESC [ < 65 ; col ; row M  (down)
 */

export const ENABLE_MOUSE  = '\x1b[?1002h\x1b[?1006h'
export const DISABLE_MOUSE = '\x1b[?1002l\x1b[?1006l'

/** Parsed SGR mouse event - wheel only. */
export type WheelEvent = { direction: 'up' | 'down' }

/** SGR mouse click/release event. */
export type MouseClickEvent = {
  type: 'press' | 'drag' | 'release'
  button: number
  row: number  // 1-indexed
  col: number  // 1-indexed
}

export type ParsedMouseEvent = WheelEvent | MouseClickEvent

// SGR mouse: ESC [ < btn ; col ; row M (press) or m (release)
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g

/**
 * Parse a raw stdin chunk for all SGR mouse events including drag/motion.
 */
export function parseMouseEvents(data: Buffer | string): ParsedMouseEvent[] {
  const s = typeof data === 'string' ? data : data.toString('binary')
  const events: ParsedMouseEvent[] = []
  SGR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SGR_RE.exec(s)) !== null) {
    const btn = parseInt(m[1]!, 10)
    const col = parseInt(m[2]!, 10)
    const row = parseInt(m[3]!, 10)
    const isPress = m[4] === 'M'
    // bit 6 (0x40) = wheel
    if ((btn & 0x40) !== 0) {
      if (isPress) events.push({ direction: (btn & 0x01) === 0 ? 'up' : 'down' })
      continue
    }
    const button = btn & 0x03
    // bit 5 (0x20) = drag/motion with button held
    const type = !isPress ? 'release' : (btn & 0x20) !== 0 ? 'drag' : 'press'
    events.push({ type, button, row, col })
  }
  return events
}

/**
 * Parse a raw stdin chunk for SGR wheel events only (backward compat).
 */
export function parseWheelEvents(data: Buffer | string): WheelEvent[] {
  return parseMouseEvents(data).filter((e): e is WheelEvent => 'direction' in e)
}
