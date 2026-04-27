// AppState - single source of truth for all UI state.
// Uses a Redux-like immutable update pattern via React context.

import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'

// ─── Message types ────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool_result' | 'system'

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  progress?: string
  status: 'pending' | 'running' | 'done' | 'error'
  startedAt: number
  completedAt?: number
}

export type Message = {
  id: string
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  timestamp: number
  notifType?: NotificationType  // for system messages - controls icon + color
}

// ─── Notification types ───────────────────────────────────────────────────────

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'progress' | 'list' | 'kv' | 'kv-spaced'

// ─── App modes ────────────────────────────────────────────────────────────────

export type AppMode =
  | 'agent'        // normal conversation
  | 'session'      // session picker open
  | 'ctx'          // context window breakdown panel
  | 'every'        // interval task scheduler panel
  | 'message-picker'     // agent message panel
  | 'skill-picker'       // interactive skill enable/disable picker
  | 'model-picker'       // model selection (mem genome)
  | 'api-key-input'      // API key entry (mem genome)
  | 'warden'       // DailyWarden contest browser

// Modes that render a bottom panel (suppresses companion, locks prompt, sizes panel).
// Add new bottom-panel slash commands here - the rest of App.tsx derives automatically.
export const BOTTOM_PANEL_MODES = ['session', 'ctx', 'every', 'tasks', 'message-picker', 'skill-picker', 'model-picker', 'api-key-input', 'warden'] as const
export type BottomPanelMode = typeof BOTTOM_PANEL_MODES[number]
export const isBottomPanelMode = (mode: AppMode): mode is BottomPanelMode =>
  (BOTTOM_PANEL_MODES as readonly string[]).includes(mode)

// ─── Root state ───────────────────────────────────────────────────────────────

export type AppState = {
  // Conversation
  messages: Message[]
  isStreaming: boolean
  sessionId: string
  sessionName: string

  // UI
  mode: AppMode
  inputValue: string
  slashMenuIdx: number     // selected index in slash command menu
  scrollOffset: number     // message scroll - 0 = bottom, positive = scrolled up

  // API status
  model: string
  rateLimit: number    // 0–1 fill ratio for status bar
  cwd: string
  isCompacting: boolean        // compact API call in flight
  lastInputTokens: number      // tokens sent in last API call
  contextPressure: 'none' | 'warn' | 'critical'  // live token pressure level
  sessionTokens: number        // cumulative tokens this session
  sessionInputTokens: number   // cumulative input tokens (for cost)
  sessionOutputTokens: number  // cumulative output tokens (for cost)

  // Whether a reload just happened (shows ↺ banner briefly)
  justReloaded: boolean
  reloadedPatchInfo?: string

  // tmux pane ID of this agent instance (e.g. "%3"), used to target split-window
  paneId: string
  // Active genome filter for this instance (null = all commands available)
  genome: string[] | null
  // Stable human-readable instance identifier: <branch>-<8hex>
  instanceName: string
  // div genome: companion pet animation active
  isPetting: boolean
}

export function makeInitialState(overrides?: Partial<AppState>): AppState {
  return {
    messages: [],
    isStreaming: false,
    sessionId: crypto.randomUUID(),
    sessionName: 'default',
    mode: 'agent',
    inputValue: '',
    slashMenuIdx: 0,
    scrollOffset: 0,
    model: 'claude-sonnet-4-6',
    rateLimit: 0,
    cwd: process.cwd(),
    isCompacting: false,
    lastInputTokens: 0,
    contextPressure: 'none',
    sessionTokens: 0,
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    justReloaded: false,
    paneId: '',
    genome: null,
    instanceName: '',
    isPetting: false,
    ...overrides,
  }
}

// Derive a stable 8-char hex suffix from a string via a simple djb2-style hash.
export function instanceSuffix(seed: string): string {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i)
  return (h >>> 0).toString(16).padStart(8, '0')
}



type AppStateContextValue = {
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
}

export const AppStateContext = createContext<AppStateContextValue | null>(null)

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>')
  return ctx
}

// ─── Message helpers ──────────────────────────────────────────────────────────

export function appendMessage(
  setState: Dispatch<SetStateAction<AppState>>,
  msg: Omit<Message, 'id' | 'timestamp'>
): string {
  const id = crypto.randomUUID()
  setState(prev => ({
    ...prev,
    messages: [...prev.messages, { ...msg, id, timestamp: Date.now() }],
  }))
  return id
}

export function addSystemMessage(
  setState: Dispatch<SetStateAction<AppState>>,
  notifType: NotificationType,
  message: string
): void {
  appendMessage(setState, { role: 'system', content: message, notifType })
}

export function updateMessage(
  setState: Dispatch<SetStateAction<AppState>>,
  id: string,
  patch: Partial<Message>
): void {
  setState(prev => ({
    ...prev,
    messages: prev.messages.map(m => (m.id === id ? { ...m, ...patch } : m)),
  }))
}
