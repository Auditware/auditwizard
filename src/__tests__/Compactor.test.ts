import { describe, test, expect } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import {
  estimateTokens,
  estimateMessagesTokens,
  microcompactMessages,
  findCleanSplitPointBefore,
  buildContextWindow,
  COMPACT_THRESHOLD_TOKENS,
  MICROCOMPACT_THRESHOLD_TOKENS,
  KEEP_RECENT_TOKENS,
  CLEARED_PLACEHOLDER,
  type CompactCache,
} from '../context/Compactor.js'

function makeMockClient(summary = 'mock summary'): Anthropic {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: summary }] }),
    },
  } as unknown as Anthropic
}

function fatUserMsg(targetTokens: number): Anthropic.Messages.MessageParam {
  return { role: 'user', content: 'a'.repeat(Math.ceil(targetTokens * 3.5)) }
}

function makeMessages(count: number): Anthropic.Messages.MessageParam[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i + 1}`,
  })) as Anthropic.Messages.MessageParam[]
}

function makeToolRound(resultText: string): Anthropic.Messages.MessageParam[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } }],
    } as Anthropic.Messages.MessageParam,
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: resultText }],
    } as Anthropic.Messages.MessageParam,
  ]
}

// ---------------------------------------------------------------------------
describe('estimateTokens', () => {
  test('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
  test('non-empty string produces positive number', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0)
  })
  test('longer string has more tokens', () => {
    expect(estimateTokens('a'.repeat(1000))).toBeGreaterThan(estimateTokens('a'.repeat(100)))
  })
})

describe('estimateMessagesTokens', () => {
  test('empty array → 0', () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })
  test('string content messages', () => {
    const msgs = makeMessages(4)
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0)
  })
  test('tool_result content is counted', () => {
    const msgs = makeToolRound('x'.repeat(1000))
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(200)
  })
})

// ---------------------------------------------------------------------------
describe('microcompactMessages', () => {
  test('returns same array when no tool rounds present', () => {
    const msgs = makeMessages(6)
    const { messages: out, tokensFreed } = microcompactMessages(msgs)
    expect(out).toBe(msgs)
    expect(tokensFreed).toBe(0)
  })

  test('does not clear recent tool rounds', () => {
    const msgs = [
      ...makeToolRound('x'.repeat(1000)),
      ...makeToolRound('y'.repeat(1000)),
      ...makeToolRound('z'.repeat(1000)),
    ]
    const { messages: out, tokensFreed } = microcompactMessages(msgs)
    expect(tokensFreed).toBe(0)
    expect(out).toBe(msgs)
  })

  test('clears older rounds beyond KEEP_RECENT_TOOL_ROUNDS', () => {
    const msgs = [
      ...makeToolRound('a'.repeat(1000)),
      ...makeToolRound('b'.repeat(1000)),
      ...makeToolRound('c'.repeat(1000)),
      ...makeToolRound('d'.repeat(1000)),
    ]
    const { messages: out, tokensFreed } = microcompactMessages(msgs)
    expect(tokensFreed).toBeGreaterThan(0)
    const firstToolResult = out[1] as Anthropic.Messages.MessageParam
    const content = firstToolResult.content as Array<{ type: string; content?: string }>
    expect(content[0]?.content).toBe(CLEARED_PLACEHOLDER)
  })

  test('never mutates input messages', () => {
    const msgs = [
      ...makeToolRound('a'.repeat(1000)),
      ...makeToolRound('b'.repeat(1000)),
      ...makeToolRound('c'.repeat(1000)),
      ...makeToolRound('d'.repeat(1000)),
    ]
    const copy = JSON.stringify(msgs)
    microcompactMessages(msgs)
    expect(JSON.stringify(msgs)).toBe(copy)
  })

  test('skips results <= MICROCOMPACT_MIN_RESULT_CHARS', () => {
    const msgs = [
      ...makeToolRound('short'),
      ...makeToolRound('b'.repeat(1000)),
      ...makeToolRound('c'.repeat(1000)),
      ...makeToolRound('d'.repeat(1000)),
    ]
    const { messages: out } = microcompactMessages(msgs)
    const firstToolResult = out[1] as Anthropic.Messages.MessageParam
    const content = firstToolResult.content as Array<{ type: string; content?: string }>
    expect(content[0]?.content).toBe('short')
  })
})

// ---------------------------------------------------------------------------
describe('findCleanSplitPointBefore', () => {
  test('returns the target index when it is a clean user message', () => {
    const msgs = makeMessages(6)
    expect(findCleanSplitPointBefore(msgs, 4)).toBe(4)
  })

  test('walks back past tool_result-only turns', () => {
    const msgs: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      ...makeToolRound('result'),
    ]
    expect(findCleanSplitPointBefore(msgs, 3)).toBe(0)
  })

  test('returns 0 when no clean split found', () => {
    const msgs = makeToolRound('r')
    expect(findCleanSplitPointBefore(msgs, 1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('buildContextWindow - below all thresholds', () => {
  test('passes live messages through unchanged', async () => {
    const msgs = makeMessages(4)
    const result = await buildContextWindow(msgs, null, makeMockClient(), 'model', 1000)
    expect(result.messages).toEqual(msgs)
    expect(result.didCompact).toBe(false)
    expect(result.didMicrocompact).toBe(false)
    expect(result.systemAddition).toBe('')
    expect(result.cache).toBeNull()
  })

  test('with existing cache: slices from coveredCount', async () => {
    const msgs = makeMessages(10)
    const cache: CompactCache = { coveredCount: 4, summary: 'prior' }
    const result = await buildContextWindow(msgs, cache, makeMockClient(), 'model', 1000)
    expect(result.messages).toEqual(msgs.slice(4))
    expect(result.systemAddition).toContain('prior')
    expect(result.systemAddition).toContain('4')
  })
})

describe('buildContextWindow - above COMPACT_THRESHOLD_TOKENS', () => {
  function makeCompactableMessages(): Anthropic.Messages.MessageParam[] {
    return [
      { role: 'user', content: 'initial question' },
      { role: 'assistant', content: 'initial reply' },
      fatUserMsg(KEEP_RECENT_TOKENS + 1000),
      { role: 'assistant', content: 'old reply' },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ]
  }

  test('calls API and returns didCompact=true', async () => {
    const msgs = makeCompactableMessages()
    const result = await buildContextWindow(msgs, null, makeMockClient('summary!'), 'model', COMPACT_THRESHOLD_TOKENS + 1)
    expect(result.didCompact).toBe(true)
    expect(result.cache?.summary).toBe('summary!')
  })

  test('forceCompact=true triggers compact when split point exists', async () => {
    const msgs = makeCompactableMessages()
    const result = await buildContextWindow(msgs, null, makeMockClient('forced'), 'model', 0, true)
    expect(result.didCompact).toBe(true)
    expect(result.cache?.summary).toBe('forced')
  })

  test('systemAddition contains summary after compact', async () => {
    const msgs = makeCompactableMessages()
    const result = await buildContextWindow(msgs, null, makeMockClient('the summary'), 'model', COMPACT_THRESHOLD_TOKENS + 1)
    expect(result.systemAddition).toContain('the summary')
  })
})

describe('buildContextWindow - microcompact only', () => {
  test('didMicrocompact=true when above MICROCOMPACT but below COMPACT threshold', async () => {
    const toolMsgs = [
      ...makeToolRound('a'.repeat(1000)),
      ...makeToolRound('b'.repeat(1000)),
      ...makeToolRound('c'.repeat(1000)),
      ...makeToolRound('d'.repeat(1000)),
      { role: 'user' as const, content: 'last question' },
    ]
    const liveEst = MICROCOMPACT_THRESHOLD_TOKENS + 100
    const result = await buildContextWindow(toolMsgs, null, makeMockClient(), 'model', liveEst)
    expect(result.didCompact).toBe(false)
    expect(result.didMicrocompact).toBe(true)
  })
})
