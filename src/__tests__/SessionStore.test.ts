import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendMessage, loadMessages, writeMeta, readMeta } from '../context/session.js'
import type { Message } from '../app/AppState.js'

describe('SessionStore', () => {
  let tmpDir: string
  let sessionName: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-sess-'))
    // Patch the store's session path by using a unique session name
    // that maps to our temp directory via env override
    sessionName = `test-session-${Date.now()}`
    process.env['AGENT_SESSIONS_DIR'] = join(tmpDir, 'sessions')
  })

  afterEach(() => {
    delete process.env['AGENT_SESSIONS_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const makeMsg = (overrides?: Partial<Message>): Omit<Message, 'id' | 'timestamp'> => ({
    role: 'user',
    content: 'hello',
    ...overrides,
  })

  test('appendMessage + loadMessages round-trips a user message', async () => {
    const msg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: 'hello world',
      timestamp: Date.now(),
    }
    await appendMessage(sessionName, msg)
    const loaded = await loadMessages(sessionName)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.content).toBe('hello world')
    expect(loaded[0]?.role).toBe('user')
    expect(loaded[0]?.id).toBe(msg.id)
  })

  test('appendMessage accumulates multiple messages', async () => {
    for (let i = 0; i < 3; i++) {
      await appendMessage(sessionName, {
        id: crypto.randomUUID(),
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: Date.now() + i,
      })
    }
    const loaded = await loadMessages(sessionName)
    expect(loaded).toHaveLength(3)
    expect(loaded[2]?.content).toBe('message 2')
  })

  test('loadMessages returns empty array for missing session', async () => {
    const loaded = await loadMessages('nonexistent-session-xyz')
    expect(loaded).toEqual([])
  })

  test('writeMeta + readMeta round-trips session metadata', async () => {
    const meta = {
      sessionId: crypto.randomUUID(),
      sessionName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 5,
      tokenCount: 1000,
      inputTokens: 600,
      outputTokens: 400,
    }
    await writeMeta(sessionName, meta)
    const loaded = await readMeta(sessionName)
    expect(loaded?.sessionId).toBe(meta.sessionId)
    expect(loaded?.messageCount).toBe(5)
    expect(loaded?.tokenCount).toBe(1000)
    expect(loaded?.inputTokens).toBe(600)
    expect(loaded?.outputTokens).toBe(400)
  })

  test('readMeta returns null for missing session', async () => {
    const result = await readMeta('nonexistent-xyz')
    expect(result).toBeNull()
  })
})
