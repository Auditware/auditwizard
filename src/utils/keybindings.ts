// Central keybinding registry.
// All actions use dot-namespaced names: "confirm:yes", "nav:up", "fix:trigger".
// Checked for conflicts at startup - surfaces warnings as system messages, never throws.

export type KeyCombo = {
  key: string
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
}

export type KeyAction =
  | 'confirm:yes'
  | 'confirm:no'
  | 'nav:up'
  | 'nav:down'
  | 'nav:left'
  | 'nav:right'
  | 'nav:select'
  | 'nav:pageUp'
  | 'nav:pageDown'
  | 'modal:close'
  | 'input:submit'
  | 'input:newline'
  | 'input:historyPrev'
  | 'input:historyNext'
  | 'input:clear'
  | 'fix:trigger'
  | 'session:open'
  | 'skills:open'
  | 'help:open'
  | 'app:quit'

export type KeybindingMap = Record<KeyAction, KeyCombo>

// Contextual note: some actions share keys intentionally (e.g. Enter for confirm
// in a dialog vs submit in the prompt). Components own their own context - the
// registry only tracks global shortcuts that should never conflict.
export const DEFAULT_BINDINGS: KeybindingMap = {
  // Dialog / modal (only active when a dialog has focus)
  'confirm:yes':        { key: 'return' },
  'confirm:no':         { key: 'escape' },
  // Navigation (only active in list/picker views)
  'nav:up':             { key: 'up' },
  'nav:down':           { key: 'down' },
  'nav:left':           { key: 'left' },
  'nav:right':          { key: 'right' },
  'nav:select':         { key: 'return' },
  'nav:pageUp':         { key: 'u', ctrl: true },
  'nav:pageDown':       { key: 'd', ctrl: true },
  // Modal close (same key as confirm:no - context differentiates them)
  'modal:close':        { key: 'escape' },
  // Prompt input (handled directly in PromptInput; registered for conflict docs)
  'input:submit':       { key: 'return' },
  'input:newline':      { key: 'return', shift: true },
  'input:historyPrev':  { key: 'up' },
  'input:historyNext':  { key: 'down' },
  'input:clear':        { key: 'c', ctrl: true },
  // Global shortcuts (always active)
  'fix:trigger':        { key: 'p', ctrl: true },
  'session:open':       { key: 's', ctrl: true },
  'skills:open':        { key: 'k', ctrl: true },
  'help:open':          { key: '/', shift: false },
  'app:quit':           { key: 'q', ctrl: true },
}

export type ConflictWarning = {
  actions: [KeyAction, KeyAction]
  combo: string
}

function comboKey(c: KeyCombo): string {
  const parts: string[] = []
  if (c.ctrl)  parts.push('ctrl')
  if (c.shift) parts.push('shift')
  if (c.meta)  parts.push('meta')
  parts.push(c.key)
  return parts.join('+')
}

// Actions that intentionally share keys across contexts - not reported as conflicts.
const CONTEXTUAL_GROUPS: KeyAction[][] = [
  ['confirm:yes', 'nav:select', 'input:submit'],  // all Enter, different contexts
  ['confirm:no', 'modal:close'],                   // all Escape, different contexts
  ['nav:up', 'input:historyPrev'],                 // up arrow, different contexts
  ['nav:down', 'input:historyNext'],               // down arrow, different contexts
]

function isContextualOverlap(a: KeyAction, b: KeyAction): boolean {
  return CONTEXTUAL_GROUPS.some(group => group.includes(a) && group.includes(b))
}

// Returns a list of conflicts to surface as startup warnings.
export function detectConflicts(bindings: KeybindingMap): ConflictWarning[] {
  const seen = new Map<string, KeyAction>()
  const conflicts: ConflictWarning[] = []

  for (const [action, combo] of Object.entries(bindings) as [KeyAction, KeyCombo][]) {
    const k = comboKey(combo)
    const existing = seen.get(k)
    if (existing && !isContextualOverlap(existing, action)) {
      conflicts.push({ actions: [existing, action], combo: k })
    } else if (!existing) {
      seen.set(k, action)
    }
  }
  return conflicts
}

// Singleton registry - loaded once at startup, referenced everywhere.
let _bindings: KeybindingMap = { ...DEFAULT_BINDINGS }

export function getBindings(): KeybindingMap {
  return _bindings
}

export function setBindings(overrides: Partial<KeybindingMap>): void {
  _bindings = { ..._bindings, ...overrides }
}

export function matchesBinding(
  action: KeyAction,
  input: { key: string; shift?: boolean; ctrl?: boolean; meta?: boolean }
): boolean {
  const b = _bindings[action]
  return (
    b.key === input.key &&
    !!b.shift === !!input.shift &&
    !!b.ctrl === !!input.ctrl &&
    !!b.meta === !!input.meta
  )
}
