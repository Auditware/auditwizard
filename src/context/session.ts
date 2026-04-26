// Nuc-owned session persistence primitives.
// These are always available regardless of which genomes are active.
// Higher-level session management (listing, switching) lives here too since
// it is used by nuc-tier components (SessionPicker, PromptInput).

import type { Message } from '../app/AppState.js'
import { agentsDir } from '../config/agentsDir.js'

export function sessionsDir(): string {
  return process.env['AGENT_SESSIONS_DIR'] ?? agentsDir('sessions')
}

export type SessionMeta = {
  sessionId: string
  sessionName: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tokenCount: number
  inputTokens: number
  outputTokens: number
}

type SessionLine = Message | { type: 'meta'; data: SessionMeta }

function sessionPath(name: string): string {
  return `${sessionsDir()}/${name}.jsonl`
}

function metaPath(name: string): string {
  return `${sessionsDir()}/${name}.meta.json`
}

// Per-session write queue - chains all writes so reads never race with writes.
const writeQueues = new Map<string, Promise<void>>()
function enqueue(sessionName: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(sessionName) ?? Promise.resolve()
  const next = prev.then(fn).catch(() => {})
  writeQueues.set(sessionName, next)
  return next
}

export function appendMessage(sessionName: string, msg: Message): Promise<void> {
  return enqueue(sessionName, async () => {
    const path = sessionPath(sessionName)
    const line = JSON.stringify(msg) + '\n'
    const existing = await Bun.file(path).exists() ? await Bun.file(path).text() : ''
    await Bun.write(path, existing + line)
  })
}

export function writeMessages(sessionName: string, messages: Message[]): Promise<void> {
  return enqueue(sessionName, async () => {
    const path = sessionPath(sessionName)
    const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
    await Bun.write(path, content)
  })
}

export async function loadMessages(sessionName: string): Promise<Message[]> {
  const path = sessionPath(sessionName)
  if (!(await Bun.file(path).exists())) return []
  const text = await Bun.file(path).text()
  const messages: Message[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as SessionLine
      if ('role' in obj) messages.push(obj)
    } catch { /* skip malformed lines */ }
  }
  return messages
}

export async function writeMeta(name: string, meta: SessionMeta): Promise<void> {
  await Bun.write(metaPath(name), JSON.stringify(meta, null, 2))
}

export async function readMeta(name: string): Promise<SessionMeta | null> {
  const path = metaPath(name)
  if (!(await Bun.file(path).exists())) return null
  try {
    return JSON.parse(await Bun.file(path).text()) as SessionMeta
  } catch { return null }
}

export async function listSessions(): Promise<Array<SessionMeta & { name: string }>> {
  const { readdir } = await import('fs/promises')
  let files: string[]
  try {
    files = await readdir(sessionsDir())
  } catch { return [] }

  const results: Array<SessionMeta & { name: string }> = []
  for (const file of files) {
    if (!file.endsWith('.meta.json')) continue
    const name = file.replace('.meta.json', '')
    const meta = await readMeta(name)
    if (meta) results.push({ ...meta, name })
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt)
}
