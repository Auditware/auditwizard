// Compactor - token-aware context management with four-layer compaction.
// Layer 0 (tool summarizer): condense large tool results via API before they enter transcript.
// Layer 1 (microcompact): clear large tool results in a copy of the live window - no API call.
//   Fires at MICROCOMPACT_THRESHOLD_TOKENS. Canonical transcript is never mutated.
// Layer 2 (full compact): summarise old turns via Claude API - fires at COMPACT_THRESHOLD_TOKENS.
// The full history is preserved on disk and in the UI.

import Anthropic from '@anthropic-ai/sdk'

// --- Tool result summarization (Layer 0) ---
// Fires before a result enters the transcript. Prevents single-turn token spikes.
export const TOOL_RESULT_SUMMARIZE_CHARS = 8_000
const TOOL_RESULT_SUMMARIZE_SLICE = 20_000
const TOOL_RESULT_SUMMARIZE_MAX_TOKENS = 800

export async function summarizeLargeToolResult(
  content: string,
  client: Anthropic,
  model: string,
): Promise<string> {
  if (content.length <= TOOL_RESULT_SUMMARIZE_CHARS) return content

  const half = TOOL_RESULT_SUMMARIZE_SLICE
  const excerpt = content.length > half * 2
    ? `${content.slice(0, half)}\n\n[…${content.length - half * 2} chars omitted…]\n\n${content.slice(-half)}`
    : content.slice(0, half * 2)

  try {
    const response = await client.messages.create({
      model,
      max_tokens: TOOL_RESULT_SUMMARIZE_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: `Condense this tool output to the key facts an AI agent needs. Keep all file paths, values, errors, exit codes, and structure. Remove redundant lines and noise. Max 300 words:\n\n${excerpt}`,
      }],
    })
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim()
    if (text.length > 20) return `[summarized] ${text}`
  } catch {
    // Fall through to bounded raw fallback
  }

  const cap = TOOL_RESULT_SUMMARIZE_CHARS
  const half2 = Math.floor(cap / 2)
  return content.length > cap
    ? `${content.slice(0, half2)}\n[…truncated…]\n${content.slice(-half2)}`
    : content
}

// --- Token thresholds ---
export const MODEL_CONTEXT_WINDOW = 200_000
// Full compact fires 16k before limit.
export const COMPACT_BUFFER_TOKENS = 16_000
export const COMPACT_THRESHOLD_TOKENS = MODEL_CONTEXT_WINDOW - COMPACT_BUFFER_TOKENS  // 184_000
// Microcompact fires 35k before limit - clears large tool results without a summary API call.
export const MICROCOMPACT_BUFFER_TOKENS = 35_000
export const MICROCOMPACT_THRESHOLD_TOKENS = MODEL_CONTEXT_WINDOW - MICROCOMPACT_BUFFER_TOKENS  // 165_000
// After full compact: keep approximately this many tokens of recent live turns.
export const KEEP_RECENT_TOKENS = 40_000
// Summary generation
export const COMPACT_MAX_SUMMARY_TOKENS = 4096

// Microcompact: only clear tool results larger than this character count.
const MICROCOMPACT_MIN_RESULT_CHARS = 400
export const CLEARED_PLACEHOLDER = '[cleared - call the tool again if needed]'
// How many recent tool-result rounds to preserve untouched during microcompact.
const KEEP_RECENT_TOOL_ROUNDS = 3

export type CompactCache = {
  coveredCount: number  // how many messages from transcript start were summarised
  summary: string
}

// Rough token estimation: ~3.5 chars per token.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// Estimate total tokens for a message array.
export function estimateMessagesTokens(messages: Anthropic.Messages.MessageParam[]): number {
  let total = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content)
      continue
    }
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        total += estimateTokens(b.text)
      } else if (b.type === 'tool_result') {
        const c = b.content
        if (typeof c === 'string') total += estimateTokens(c)
        else if (Array.isArray(c)) {
          for (const item of c) {
            if (typeof item === 'object' && item !== null)
              total += estimateTokens(String((item as Record<string, unknown>).text ?? ''))
          }
        }
      } else if (b.type === 'tool_use') {
        total += estimateTokens(JSON.stringify(b.input ?? {}))
      }
    }
  }
  return total
}

// Microcompact: return a new array with large tool results cleared in older rounds.
// Preserves the most recent KEEP_RECENT_TOOL_ROUNDS tool-result turns intact.
// Never mutates the input array or its message objects.
export function microcompactMessages(messages: Anthropic.Messages.MessageParam[]): {
  messages: Anthropic.Messages.MessageParam[]
  tokensFreed: number
} {
  // Identify indices of user turns that are purely tool_results
  const toolRoundIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    const allToolResults =
      msg.content.length > 0 &&
      msg.content.every(
        b => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_result',
      )
    if (allToolResults) toolRoundIndices.push(i)
  }

  const clearCount = Math.max(0, toolRoundIndices.length - KEEP_RECENT_TOOL_ROUNDS)
  const toClear = new Set(toolRoundIndices.slice(0, clearCount))
  if (toClear.size === 0) return { messages, tokensFreed: 0 }

  let tokensFreed = 0
  const out = messages.map((msg, idx) => {
    if (!toClear.has(idx)) return msg
    if (!Array.isArray(msg.content)) return msg
    const newContent = msg.content.map(block => {
      if (typeof block !== 'object' || block === null) return block
      const b = block as Record<string, unknown>
      if (b.type !== 'tool_result') return block
      const content = b.content
      if (
        typeof content === 'string' &&
        content.length > MICROCOMPACT_MIN_RESULT_CHARS &&
        content !== CLEARED_PLACEHOLDER
      ) {
        tokensFreed += estimateTokens(content) - estimateTokens(CLEARED_PLACEHOLDER)
        return { ...b, content: CLEARED_PLACEHOLDER }
      }
      return block
    })
    return { ...msg, content: newContent }
  })

  return { messages: out, tokensFreed }
}

// Full compact: summarise old turns via Claude API.
export async function compactMessages(
  messages: Anthropic.Messages.MessageParam[],
  client: Anthropic,
  model: string,
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: COMPACT_MAX_SUMMARY_TOKENS,
    messages: [
      ...messages,
      {
        role: 'user',
        content: [
          'Summarise this conversation for a future AI instance reading it as prior context.',
          'Cover ALL of: original goal, key decisions and reasoning, exact files and code read or modified',
          '(paths, function names, values), current state, what still needs doing, important constraints.',
          'Be specific and dense. Max 800 words.',
        ].join(' '),
      },
    ],
  })

  return response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim()
}

// Find the latest index <= fromIdx that is a clean split point.
// Clean = user message NOT purely tool_results (avoids orphaned tool_use/tool_result pairs).
// Walks backward so we never keep MORE than the target amount of live context.
export function findCleanSplitPointBefore(
  messages: Anthropic.Messages.MessageParam[],
  fromIdx: number,
): number {
  for (let i = Math.min(fromIdx, messages.length - 1); i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'user') continue
    const content = Array.isArray(msg.content) ? msg.content : []
    const isOnlyToolResults =
      content.length > 0 &&
      content.every(
        b => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_result',
      )
    if (!isOnlyToolResults) return i
  }
  return 0
}

// Find the first index >= fromIdx that is a clean split point (kept for compatibility).
export function findCleanSplitPoint(
  messages: Anthropic.Messages.MessageParam[],
  fromIdx: number,
): number {
  for (let i = fromIdx; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || msg.role !== 'user') continue
    const content = Array.isArray(msg.content) ? msg.content : []
    const isOnlyToolResults =
      content.length > 0 &&
      content.every(
        b => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_result',
      )
    if (!isOnlyToolResults) return i
  }
  return messages.length
}

// Find the split point that keeps ~KEEP_RECENT_TOKENS of live context.
// Walks backward summing tokens; returns the clean boundary AT OR BEFORE the target.
function findTokenAwareSplitPoint(messages: Anthropic.Messages.MessageParam[]): number {
  let tokensSoFar = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessagesTokens([messages[i]!])
    if (tokensSoFar + msgTokens > KEEP_RECENT_TOKENS) {
      return findCleanSplitPointBefore(messages, i + 1)
    }
    tokensSoFar += msgTokens
  }
  return 0
}

// Build the context window for an API call.
//
// liveTokenEstimate: pre-computed estimate of tokens in the live window
//   (transcript.slice(coveredCount)). Pass 0 to compute internally.
// forceCompact: bypass token thresholds and always compact if there is history to summarise.
//
// Layer order: full compact runs first (shrinks live window), then microcompact on result.
// Canonical transcript is never mutated - microcompact operates on a copy.
export async function buildContextWindow(
  apiMessages: Anthropic.Messages.MessageParam[],
  cache: CompactCache | null,
  client: Anthropic,
  model: string,
  liveTokenEstimate: number = 0,
  forceCompact: boolean = false,
): Promise<{
  messages: Anthropic.Messages.MessageParam[]
  systemAddition: string
  cache: CompactCache | null
  didMicrocompact: boolean
  didCompact: boolean
}> {
  const liveStart = cache?.coveredCount ?? 0
  const liveMessages = apiMessages.slice(liveStart)
  const liveTokens = liveTokenEstimate > 0 ? liveTokenEstimate : estimateMessagesTokens(liveMessages)

  let newCache = cache
  let didCompact = false

  // Layer 2: full compact - summarise old turns via API
  const needsFullCompact = forceCompact || liveTokens >= COMPACT_THRESHOLD_TOKENS
  if (needsFullCompact && apiMessages.length > 0) {
    const splitPoint = findTokenAwareSplitPoint(apiMessages)
    if (splitPoint > 0 && splitPoint < apiMessages.length) {
      const oldMessages = apiMessages.slice(0, splitPoint)
      const summary = await compactMessages(oldMessages, client, model)
      newCache = { coveredCount: splitPoint, summary }
      didCompact = true
    }
  }

  // Compute final live window (may have shrunk after full compact)
  const finalLiveStart = newCache?.coveredCount ?? 0
  const finalLiveMessages = apiMessages.slice(finalLiveStart)
  const finalLiveTokens = didCompact
    ? estimateMessagesTokens(finalLiveMessages)
    : liveTokens

  // Layer 1: microcompact - clear large old tool results in a copy of the live window
  const needsMicrocompact = forceCompact || finalLiveTokens >= MICROCOMPACT_THRESHOLD_TOKENS
  let outMessages = finalLiveMessages
  let didMicrocompact = false
  if (needsMicrocompact) {
    const { messages: compacted, tokensFreed } = microcompactMessages(finalLiveMessages)
    if (tokensFreed > 0) {
      outMessages = compacted
      didMicrocompact = true
    }
  }

  const systemAddition = newCache
    ? `\n\n## Prior conversation summary (turns 1–${newCache.coveredCount})\n${newCache.summary}`
    : ''

  return { messages: outMessages, systemAddition, cache: newCache, didMicrocompact, didCompact }
}
