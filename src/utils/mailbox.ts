// Mailbox - file-based agent-to-agent messaging.
// Messages are appended to ~/.agents/mailboxes/{session}.json.
// Each agent polls its inbox and injects unread entries into its stream.
// Presence is tracked via ~/.agents/presence/{session}.json heartbeats.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { agentsDir, ensureAgentsDir } from '../config/agentsDir.js'

export type MailboxEntry = {
  id: string
  from: string
  to: string
  content: string
  timestamp: number
  read: boolean
}

export type PresenceEntry = {
  session: string
  status: 'idle' | 'busy'
  updatedAt: number
  rootDir?: string
}

const PRESENCE_TTL_MS = 8000  // agent considered gone if no heartbeat within 8s

function mailboxPath(session: string): string {
  return agentsDir('mailboxes', `${session}.json`)
}

function presencePath(session: string): string {
  return agentsDir('presence', `${session}.json`)
}

export function sendMessage(to: string, from: string, content: string): void {
  ensureAgentsDir('mailboxes')
  const path = mailboxPath(to)
  const entry: MailboxEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from,
    to,
    content,
    timestamp: Date.now(),
    read: false,
  }
  let entries: MailboxEntry[] = []
  if (existsSync(path)) {
    try { entries = JSON.parse(readFileSync(path, 'utf8')) } catch { entries = [] }
  }
  entries.push(entry)
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf8')
}

export function readUnread(session: string): MailboxEntry[] {
  const path = mailboxPath(session)
  if (!existsSync(path)) return []
  try {
    const entries: MailboxEntry[] = JSON.parse(readFileSync(path, 'utf8'))
    return entries.filter(e => !e.read)
  } catch { return [] }
}

export function markRead(session: string, ids: string[]): void {
  const path = mailboxPath(session)
  if (!existsSync(path)) return
  try {
    const entries: MailboxEntry[] = JSON.parse(readFileSync(path, 'utf8'))
    const updated = entries.map(e => ids.includes(e.id) ? { ...e, read: true } : e)
    writeFileSync(path, JSON.stringify(updated, null, 2), 'utf8')
  } catch { /* non-fatal */ }
}

export function heartbeat(session: string, status: 'idle' | 'busy', rootDir?: string): void {
  try {
    ensureAgentsDir('presence')
    const entry: PresenceEntry = { session, status, updatedAt: Date.now(), ...(rootDir ? { rootDir } : {}) }
    writeFileSync(presencePath(session), JSON.stringify(entry), 'utf8')
  } catch { /* non-fatal */ }
}

export function listOnline(excludeSelf?: string): PresenceEntry[] {
  const dir = agentsDir('presence')
  if (!existsSync(dir)) return []
  try {
    const cutoff = Date.now() - PRESENCE_TTL_MS
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(agentsDir('presence', f), 'utf8')) as PresenceEntry }
        catch { return null }
      })
      .filter((e): e is PresenceEntry => !!e && e.updatedAt > cutoff && e.session !== excludeSelf)
  } catch { return [] }
}
