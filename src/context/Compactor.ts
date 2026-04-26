// Compactor - summarises old conversation turns to keep the API context window lean.
// Only the summary + last KEEP_RECENT messages are sent to the API.
// The full history is preserved on disk and in the UI.

import Anthropic from '@anthropic-ai/sdk'

export const COMPACT_THRESHOLD = 20  // api messages before triggering compaction
export const KEEP_RECENT = 5         // live turns to keep after compaction
export const COMPACT_TRIGGER_NEW = 8 // new messages after last compact before re-compacting

export type CompactCache = {
  coveredCount: number  // how many messages were summarised
  summary: string
}

export async function compactMessages(
  messages: Anthropic.Messages.MessageParam[],
  client: Anthropic,
  model: string,
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [
      ...messages,
      {
        role: 'user',
        content: [
          'Summarise this conversation concisely for a future AI reading it as prior context.',
          'Cover: what the user asked for, decisions made, files/code changed, current state.',
          'Be specific. Max 250 words.',
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

// Find the first index >= fromIdx where the transcript can be cleanly split.
// A clean split point is a user message whose content is NOT purely tool_result blocks.
// Splitting here guarantees the live window starts with a regular human turn,
// and never with orphaned tool_results whose tool_use was compacted away.
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
        b => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result',
      )
    if (!isOnlyToolResults) return i
  }
  // No clean point found - keep all messages as live (compact nothing)
  return messages.length
}

// Given a full apiMessages array and an existing cache, decide what to send.
// Returns { messages, systemAddition, didCompact }
export async function buildContextWindow(
  apiMessages: Anthropic.Messages.MessageParam[],
  cache: CompactCache | null,
  client: Anthropic,
  model: string,
): Promise<{ messages: Anthropic.Messages.MessageParam[]; systemAddition: string; cache: CompactCache | null; didCompact: boolean }> {
  const needsFirstCompact = !cache && apiMessages.length > COMPACT_THRESHOLD
  const needsReCompact = cache != null &&
    (apiMessages.length - cache.coveredCount) >= COMPACT_TRIGGER_NEW &&
    apiMessages.length > COMPACT_THRESHOLD

  let newCache = cache
  let didCompact = false

  if (needsFirstCompact || needsReCompact) {
    // Find a clean split point so we never straddle a tool_use/tool_result pair
    const rawSplit = apiMessages.length - KEEP_RECENT
    const splitPoint = findCleanSplitPoint(apiMessages, rawSplit)
    if (splitPoint < apiMessages.length) {
      const oldMessages = apiMessages.slice(0, splitPoint)
      const summary = await compactMessages(oldMessages, client, model)
      newCache = { coveredCount: splitPoint, summary }
      didCompact = true
    }
  }

  const messages = newCache
    ? apiMessages.slice(newCache.coveredCount)
    : apiMessages

  const systemAddition = newCache
    ? `\n\n## Prior conversation summary (turns 1-${newCache.coveredCount})\n${newCache.summary}`
    : ''

  return { messages, systemAddition, cache: newCache, didCompact }
}
