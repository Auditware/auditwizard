import { describe, test, expect } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import {
  buildContextWindow,
  findCleanSplitPoint,
  COMPACT_THRESHOLD,
  COMPACT_TRIGGER_NEW,
  KEEP_RECENT,
  type CompactCache,
} from '../context/Compactor.js'

// Minimal mock Anthropic client - only used when compaction is triggered
function makeMockClient(summary = 'mock summary'): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: summary }],
      }),
    },
  } as unknown as Anthropic
}

function makeMessages(count: number): Anthropic.Messages.MessageParam[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i + 1}`,
  })) as Anthropic.Messages.MessageParam[]
}

describe('buildContextWindow - below threshold (no API call)', () => {
  test('passes messages through unchanged when below COMPACT_THRESHOLD', async () => {
    const msgs = makeMessages(COMPACT_THRESHOLD - 1)
    const result = await buildContextWindow(msgs, null, makeMockClient(), 'test-model')
    expect(result.messages).toEqual(msgs)
    expect(result.systemAddition).toBe('')
    expect(result.cache).toBeNull()
    expect(result.didCompact).toBe(false)
  })

  test('returns empty systemAddition when no cache', async () => {
    const msgs = makeMessages(3)
    const result = await buildContextWindow(msgs, null, makeMockClient(), 'test-model')
    expect(result.systemAddition).toBe('')
  })

  test('with existing cache: slices from coveredCount', async () => {
    const msgs = makeMessages(10)
    const cache: CompactCache = { coveredCount: 4, summary: 'prior summary' }
    const result = await buildContextWindow(msgs, cache, makeMockClient(), 'test-model')
    expect(result.messages).toEqual(msgs.slice(4))
    expect(result.didCompact).toBe(false)
  })

  test('with cache: systemAddition includes summary and coveredCount', async () => {
    const msgs = makeMessages(8)
    const cache: CompactCache = { coveredCount: 3, summary: 'things happened' }
    const result = await buildContextWindow(msgs, cache, makeMockClient(), 'test-model')
    expect(result.systemAddition).toContain('things happened')
    expect(result.systemAddition).toContain('3')
  })

  test('cache not re-triggered if new messages below COMPACT_TRIGGER_NEW', async () => {
    const covered = COMPACT_THRESHOLD
    const extras = COMPACT_TRIGGER_NEW - 1
    const msgs = makeMessages(covered + extras)
    const cache: CompactCache = { coveredCount: covered, summary: 'existing' }
    const result = await buildContextWindow(msgs, cache, makeMockClient(), 'test-model')
    expect(result.didCompact).toBe(false)
    expect(result.cache?.coveredCount).toBe(covered)
  })
})

describe('buildContextWindow - above threshold (uses mock API)', () => {
  test('compacts when above COMPACT_THRESHOLD with no cache', async () => {
    const msgs = makeMessages(COMPACT_THRESHOLD + 1)
    const result = await buildContextWindow(msgs, null, makeMockClient('my summary'), 'test-model')
    expect(result.didCompact).toBe(true)
    expect(result.cache?.summary).toBe('my summary')
    expect(result.cache?.coveredCount).toBe(msgs.length - KEEP_RECENT)
  })

  test('keeps KEEP_RECENT messages live after compaction', async () => {
    const msgs = makeMessages(COMPACT_THRESHOLD + 1)
    const result = await buildContextWindow(msgs, null, makeMockClient(), 'test-model')
    expect(result.messages).toHaveLength(KEEP_RECENT)
    expect(result.messages).toEqual(msgs.slice(-KEEP_RECENT))
  })

  test('re-compacts when cache exists and new messages exceed COMPACT_TRIGGER_NEW', async () => {
    const covered = COMPACT_THRESHOLD
    const extras = COMPACT_TRIGGER_NEW + 1
    const msgs = makeMessages(covered + extras)
    const cache: CompactCache = { coveredCount: covered, summary: 'old' }
    const result = await buildContextWindow(msgs, cache, makeMockClient('fresh'), 'test-model')
    expect(result.didCompact).toBe(true)
    expect(result.cache?.summary).toBe('fresh')
  })

  test('systemAddition references covered count after compaction', async () => {
    const msgs = makeMessages(COMPACT_THRESHOLD + 2)
    const result = await buildContextWindow(msgs, null, makeMockClient('summary text'), 'test-model')
    expect(result.systemAddition).toContain('summary text')
    // covered count is the actual split point (may advance past rawSplit to a clean user turn)
    const expectedCovered = findCleanSplitPoint(msgs, msgs.length - KEEP_RECENT)
    expect(result.systemAddition).toContain(`${expectedCovered}`)
  })
})
