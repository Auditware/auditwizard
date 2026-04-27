// QueryEngine - multi-turn Claude API conversation loop with streaming.
// Maintains a structured transcript separate from the display messages so that
// tool_use / tool_result blocks are fed back to the API correctly.

import Anthropic from '@anthropic-ai/sdk'
import type { AppState, Message, ToolCall } from '../app/AppState.js'
import type { Dispatch, SetStateAction } from 'react'
import { appendMessage as persistMessage, writeMeta, readMeta } from '../context/session.js'
import { appendMessage, updateMessage, addSystemMessage } from '../app/AppState.js'
import { buildContextWindow, type CompactCache, estimateMessagesTokens, COMPACT_THRESHOLD_TOKENS, MICROCOMPACT_THRESHOLD_TOKENS, summarizeLargeToolResult, TOOL_RESULT_SUMMARIZE_CHARS } from '../context/Compactor.js'
import type { ImageAttachment } from '../utils/imagePaste.js'
import { userInputChannel } from '../utils/userInputChannel.js'
import { recordTokens } from '../config/SpendTracker.js'
import { setGlobalStreaming } from '../utils/abortSignal.js'

export type Tool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  execute: (input: Record<string, unknown>, onProgress?: (text: string) => void) => Promise<string>
}

// Rate limit estimation: track tokens used in last minute
type UsageWindow = { tokens: number; at: number }

const MAX_TOOL_ITERATIONS = 20

// Maximum total chars for all active skill content in the system prompt (~50k chars)
const MAX_ACTIVE_SKILL_CHARS = 50_000

export class QueryEngine {
  private client: Anthropic
  private apiKey: string | undefined
  private tools: Tool[]
  private usageWindow: UsageWindow[] = []
  private compactCache: CompactCache | null = null
  private abortController: AbortController | null = null
  private pendingSteer: { text: string; attachments?: ImageAttachment[]; setState: Dispatch<SetStateAction<AppState>>; getState: () => AppState } | null = null
  // Structured API transcript - drives API calls (display messages are UI-only)
  private transcript: Anthropic.Messages.MessageParam[] = []
  // Active skill content stored out-of-band - injected into system prompt each turn
  // instead of living in the message transcript permanently.
  private activeSkillContent: Map<string, string> = new Map()

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env['ANTHROPIC_API_KEY']
    this.client = new Anthropic({ apiKey: this.apiKey })
    this.tools = []
  }

  registerSkillContent(slug: string, name: string, content: string): void {
    this.activeSkillContent.set(slug, `# Skill: ${name} (${slug})\n\n${content}`)
  }

  unregisterSkillContent(slug: string): void {
    this.activeSkillContent.delete(slug)
  }

  clearActiveSkills(): void {
    this.activeSkillContent.clear()
  }

  private buildActiveSkillSection(): string {
    if (this.activeSkillContent.size === 0) return ''
    let combined = [...this.activeSkillContent.values()].join('\n\n---\n\n')
    if (combined.length > MAX_ACTIVE_SKILL_CHARS) {
      combined = combined.slice(0, MAX_ACTIVE_SKILL_CHARS) + '\n\n[skill content truncated]'
    }
    return `\n\n## Active Skills\n\n${combined}`
  }

  private buildSystemPromptBase(state: AppState): string {
    return [
      state.strainConfig?.systemPrompt
        ? state.strainConfig.systemPrompt
        : `You are ${state.instanceName}, an AI agent harness running in a terminal TUI.\nYou help the user with tasks directly in their terminal.`,
      `Current working directory: ${state.cwd}`,
      `Session: ${state.sessionName}`,
      state.strainConfig ? `You are running as a strain. Only modify files within: ${state.cwd}` : null,
      'When the user pastes a URL, always use the fetch_url tool to retrieve its content before answering.',
      'Use web_search for questions about current events or information you might not have.',
      'Use ask_user to pause and ask a clarifying question when the task is ambiguous.',
    ].filter(Boolean).join('\n')
  }

  getApiKey(): string | undefined { return this.apiKey }

  resetCompactCache(): void {
    this.compactCache = null
    this.activeSkillContent.clear()
  }

  // Rebuild transcript from display messages when switching sessions.
  // Lossy (loses tool_use/tool_result block structure) but preserves conversation flow.
  resetTranscript(displayMessages?: Message[]): void {
    this.transcript = []
    this.activeSkillContent.clear()
    if (!displayMessages || displayMessages.length === 0) return
    for (const m of displayMessages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue
      this.transcript.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
  }

  abort(): void {
    this.abortController?.abort('user-cancel')
    this.abortController = null
    userInputChannel.cancelAll()
  }

  isStreaming(): boolean {
    return this.abortController !== null
  }

  setApiKey(key: string): void {
    this.apiKey = key
    this.client = new Anthropic({ apiKey: key })
  }

  registerTool(tool: Tool): void {
    this.tools.push(tool)
  }

  unregisterTool(name: string): void {
    this.tools = this.tools.filter(t => t.name !== name)
  }

  getTools(): Tool[] { return this.tools }

  // Returns a clean transcript snapshot suitable for fork sub-agents.
  // Strips trailing unresolved assistant tool_use turns (the in-progress turn)
  // and caps at 40 messages to avoid blowing sub-agent context.
  getTranscriptForFork(): Anthropic.Messages.MessageParam[] {
    let snap = [...this.transcript]
    // Strip trailing assistant turn if it has unresolved tool_use blocks
    const last = snap[snap.length - 1]
    if (last?.role === 'assistant') {
      const content = Array.isArray(last.content) ? last.content : []
      const hasToolUse = content.some((b: unknown) => (b as Record<string, unknown>)['type'] === 'tool_use')
      if (hasToolUse) snap = snap.slice(0, -1)
    }
    // Cap at last 40 messages to avoid huge context, but always start at a clean boundary
    if (snap.length > 40) {
      const splitPoint = findCleanSplitPoint(snap, snap.length - 40)
      snap = snap.slice(splitPoint)
    }
    return snap
  }

  getContextBreakdown(state: AppState): {
    systemBase: number
    compactionSummary: number
    activeSkills: number
    tools: number
    history: number
    totalActual: number
    modelLimit: number
  } {
    const est = (s: string) => Math.ceil(s.length / 4)

    const systemBase = est(this.buildSystemPromptBase(state))
    const compactionSummary = this.compactCache ? est(this.compactCache.summary) : 0
    const activeSkills = est(this.buildActiveSkillSection())

    const toolsJson = JSON.stringify(this.tools.map(t => ({
      name: t.name, description: t.description, input_schema: t.input_schema,
    })))
    const tools = est(toolsJson)

    const historyText = this.transcript.map(m =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('\n')
    const history = est(historyText)

    const modelLimit = 200_000

    return {
      systemBase,
      compactionSummary,
      activeSkills,
      tools,
      history,
      totalActual: state.lastInputTokens,
      modelLimit,
    }
  }

  private getRateLimitRatio(): number {
    const now = Date.now()
    const window = 60_000
    this.usageWindow = this.usageWindow.filter(w => now - w.at < window)
    const used = this.usageWindow.reduce((s, w) => s + w.tokens, 0)
    return Math.min(1, used / 100_000)
  }

  async submit(
    userText: string,
    state: AppState,
    setState: Dispatch<SetStateAction<AppState>>,
    attachments?: ImageAttachment[],
  ): Promise<void> {
    // Build user message content - include image blocks if any
    const userContent: Anthropic.Messages.MessageParam['content'] =
      attachments && attachments.length > 0
        ? [
            ...attachments.map(a => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: a.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: a.base64,
              },
            })),
            { type: 'text' as const, text: userText },
          ]
        : userText

    // Record transcript size so we can roll back cleanly on error
    const transcriptSizeBeforeSubmit = this.transcript.length

    // Defensive: repair any tool_use/tool_result pairing issues before sending.
    // This is a no-op on a clean transcript but catches corruption from edge cases.
    this.repairTranscript()

    // Push user message to transcript
    this.transcript.push({ role: 'user', content: userContent })

    const abortController = new AbortController()
    this.abortController = abortController
    setGlobalStreaming(true)  // synchronous - immediately visible to raw stdin handler

    const systemPromptBase = this.buildSystemPromptBase(state)

    // Create the first assistant message placeholder for streaming display
    const firstAssistantMsgId = appendMessage(setState, { role: 'assistant', content: '' })

    let totalInputTokens = 0
    let totalOutputTokens = 0
    // Track all assistant messages from all iterations for persistence
    const persistQueue: Array<{ id: string; content: string; toolCalls?: ToolCall[] }> = []

    let currentMsgId = firstAssistantMsgId
    let isFirstIteration = true

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (abortController.signal.aborted) break

        // Create new assistant message for iterations after the first
        if (!isFirstIteration) {
          currentMsgId = appendMessage(setState, { role: 'assistant', content: '' })
        }
        isFirstIteration = false

        // Token-based compaction check - runs every iteration so multi-tool loops
        // can't silently overfill the context window.
        const liveWindowStart = this.compactCache?.coveredCount ?? 0
        const liveTokenEstimate = estimateMessagesTokens(this.transcript.slice(liveWindowStart))
        const pressure = liveTokenEstimate >= MICROCOMPACT_THRESHOLD_TOKENS ? 'critical'
          : liveTokenEstimate >= 145_000 ? 'warn'
          : 'none'
        setState(prev => ({ ...prev, contextPressure: pressure }))
        const willCompact = liveTokenEstimate >= COMPACT_THRESHOLD_TOKENS

        if (willCompact) setState(prev => ({ ...prev, isCompacting: true }))
        const { messages: contextMessages, systemAddition, cache, didCompact, didMicrocompact } =
          await buildContextWindow(this.transcript, this.compactCache, this.client, state.model, liveTokenEstimate)
        if (willCompact) setState(prev => ({ ...prev, isCompacting: false }))
        this.compactCache = cache
        if (didCompact || didMicrocompact) {
          const newLive = estimateMessagesTokens(this.transcript.slice(cache?.coveredCount ?? 0))
          const newPressure = newLive >= MICROCOMPACT_THRESHOLD_TOKENS ? 'critical'
            : newLive >= 145_000 ? 'warn'
            : 'none'
          setState(prev => ({ ...prev, contextPressure: newPressure }))
        }
        if (didCompact) {
          addSystemMessage(setState, 'info', `context compacted - ${contextMessages.length} live turns`)
        } else if (didMicrocompact) {
          addSystemMessage(setState, 'info', 'microcompact applied - large tool results cleared')
        }

        const systemPrompt = [systemPromptBase, systemAddition, this.buildActiveSkillSection()].filter(Boolean).join('\n')

        let iterContent = ''
        const stream = this.client.messages.stream({
          model: state.model,
          max_tokens: 8096,
          system: systemPrompt,
          messages: contextMessages,
          tools: this.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
          })),
        }, { signal: abortController.signal })

        stream.on('text', (text) => {
          iterContent += text
          updateMessage(setState, currentMsgId, { content: iterContent })
        })

        const finalMsg = await stream.finalMessage()
        totalInputTokens += finalMsg.usage.input_tokens
        totalOutputTokens += finalMsg.usage.output_tokens

        // Update cost display after each iteration so UI reflects live spend
        setState(prev => ({
          ...prev,
          lastInputTokens: totalInputTokens,
          sessionTokens: prev.sessionTokens + finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
          sessionInputTokens: prev.sessionInputTokens + finalMsg.usage.input_tokens,
          sessionOutputTokens: prev.sessionOutputTokens + finalMsg.usage.output_tokens,
        }))

        // Push verbatim structured content back to transcript
        this.transcript.push({ role: 'assistant', content: finalMsg.content })

        // Stop if not requesting tool use
        if (finalMsg.stop_reason !== 'tool_use') {
          persistQueue.push({ id: currentMsgId, content: iterContent })
          break
        }

        // --- Tool execution ---
        const currentToolCalls: ToolCall[] = []
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

        for (const block of finalMsg.content) {
          if (block.type !== 'tool_use') continue
          if (abortController.signal.aborted) break

          const tool = this.tools.find(t => t.name === block.name)
          const toolCallId = crypto.randomUUID()
          const toolCall: ToolCall = {
            id: toolCallId,
            name: block.name,
            input: block.input as Record<string, unknown>,
            status: 'running',
            startedAt: Date.now(),
          }
          currentToolCalls.push(toolCall)
          updateMessage(setState, currentMsgId, { toolCalls: [...currentToolCalls] })

          let result = ''
          if (tool) {
            const onProgress = (text: string) => {
              const idx = currentToolCalls.findIndex(tc => tc.id === toolCallId)
              if (idx >= 0) currentToolCalls[idx] = { ...currentToolCalls[idx]!, progress: text }
              updateMessage(setState, currentMsgId, { toolCalls: [...currentToolCalls] })
            }
            try {
              result = await tool.execute(block.input as Record<string, unknown>, onProgress)
              const idx = currentToolCalls.findIndex(tc => tc.id === toolCallId)
              if (idx >= 0) currentToolCalls[idx] = { ...currentToolCalls[idx]!, status: 'done', result, completedAt: Date.now() }
              updateMessage(setState, currentMsgId, { toolCalls: [...currentToolCalls] })
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`
              const idx = currentToolCalls.findIndex(tc => tc.id === toolCallId)
              if (idx >= 0) currentToolCalls[idx] = { ...currentToolCalls[idx]!, status: 'error', result, completedAt: Date.now() }
              updateMessage(setState, currentMsgId, { toolCalls: [...currentToolCalls] })
            }
          } else {
            result = `Unknown tool: ${block.name}`
            const idx = currentToolCalls.findIndex(tc => tc.id === toolCallId)
            if (idx >= 0) currentToolCalls[idx] = { ...currentToolCalls[idx]!, status: 'error', result, completedAt: Date.now() }
            updateMessage(setState, currentMsgId, { toolCalls: [...currentToolCalls] })
          }

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.length > TOOL_RESULT_SUMMARIZE_CHARS
            ? await summarizeLargeToolResult(result, this.client, state.model)
            : result })
        }

        persistQueue.push({ id: currentMsgId, content: iterContent, toolCalls: currentToolCalls })

        if (abortController.signal.aborted) break

        // Push tool results back to transcript as a user turn
        this.transcript.push({ role: 'user', content: toolResults })
      }

    } catch (err) {
      const isAbort = abortController.signal.aborted
      if (isAbort) {
        addSystemMessage(setState, 'info', 'cancelled')
      } else {
        // Full rollback - restore transcript to pre-submit state so next send is clean
        this.transcript.splice(transcriptSizeBeforeSubmit)
        const errMsg = err instanceof Error ? err.message : String(err)
        updateMessage(setState, currentMsgId, { content: `Error: ${errMsg}` })
        addSystemMessage(setState, 'error', `API error: ${errMsg}`)
      }
    } finally {
      setGlobalStreaming(false)  // synchronous - before React setState
      // Always clean up dangling tool_use/tool_result turns regardless of how we exited.
      // The non-abort error path already did transcript.splice(), making these no-ops.
      // The abort path needs them. Any other unexpected exit also benefits.
      // Order matters: remove partial tool_result user turn first, then the orphaned
      // assistant tool_use turn. If we trim tool_use first, the user turn check
      // (role !== 'user') skips it, leaving an orphaned assistant turn in transcript.
      this.trimDanglingToolResultTurn()
      this.trimDanglingToolUseTurn()
      this.abortController = null
      this.usageWindow.push({ tokens: totalInputTokens + totalOutputTokens, at: Date.now() })
      recordTokens(totalInputTokens, totalOutputTokens, this.apiKey, state.model)
      // Only update streaming flag and rate limit here - token counts are updated live per-iteration above
      setState(prev => ({
        ...prev,
        isStreaming: false,
        rateLimit: this.getRateLimitRatio(),
      }))

      // Persist user message then all assistant iterations
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userText,
        timestamp: Date.now() - 1,
      }
      await persistMessage(state.sessionName, userMsg).catch(() => {})

      for (const entry of persistQueue) {
        await persistMessage(state.sessionName, {
          id: entry.id,
          role: 'assistant',
          content: entry.content,
          toolCalls: entry.toolCalls,
          timestamp: Date.now(),
        }).catch(() => {})
      }

      // Update session metadata
      const existingMeta = await readMeta(state.sessionName).catch(() => null)
      const newInput = (existingMeta?.inputTokens ?? 0) + totalInputTokens
      const newOutput = (existingMeta?.outputTokens ?? 0) + totalOutputTokens
      await writeMeta(state.sessionName, {
        sessionId: state.sessionId,
        sessionName: state.sessionName,
        createdAt: existingMeta?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        messageCount: (existingMeta?.messageCount ?? 0) + 1 + persistQueue.length,
        tokenCount: newInput + newOutput,
        inputTokens: newInput,
        outputTokens: newOutput,
      })

      // Drain any pending steer LAST - after all persistence is complete
      if (this.pendingSteer) this.drainPendingSteer()
    }
  }

  // Remove trailing assistant turn that has tool_use blocks but no matching tool_results.
  // This happens when we abort mid-tool-execution after the assistant turn was pushed.
  // Manually trigger compaction. No-op if a submit is already in progress.
  async compactNow(state: AppState, setState: Dispatch<SetStateAction<AppState>>): Promise<void> {
    if (this.abortController !== null) {
      addSystemMessage(setState, 'error', 'cannot compact while a request is active')
      return
    }
    if (this.transcript.length === 0) {
      addSystemMessage(setState, 'info', 'nothing to compact')
      return
    }
    setState(prev => ({ ...prev, isCompacting: true }))
    try {
      const { cache, didCompact, didMicrocompact } = await buildContextWindow(
        this.transcript, this.compactCache, this.client, state.model, 0, true,
      )
      this.compactCache = cache
      const live = this.transcript.length - (cache?.coveredCount ?? 0)
      const newLive = estimateMessagesTokens(this.transcript.slice(cache?.coveredCount ?? 0))
      const newPressure = newLive >= MICROCOMPACT_THRESHOLD_TOKENS ? 'critical'
        : newLive >= 145_000 ? 'warn'
        : 'none'
      setState(prev => ({ ...prev, contextPressure: newPressure }))
      if (didCompact) {
        addSystemMessage(setState, 'success', `compacted - ${live} live turns`)
      } else if (didMicrocompact) {
        addSystemMessage(setState, 'info', 'microcompact applied - large tool results cleared')
      } else {
        addSystemMessage(setState, 'info', 'context already compact')
      }
    } catch (err) {
      addSystemMessage(setState, 'error', `compact failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setState(prev => ({ ...prev, isCompacting: false }))
    }
  }

  private trimDanglingToolUseTurn(): void {
    const last = this.transcript.at(-1)
    if (!last || last.role !== 'assistant') return
    const content = Array.isArray(last.content) ? last.content : []
    const hasToolUse = content.some(
      (b): boolean => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_use'
    )
    if (hasToolUse) this.transcript.pop()
  }

  // Remove trailing user turn that only contains tool_result blocks (partial batch on abort).
  private trimDanglingToolResultTurn(): void {
    const last = this.transcript.at(-1)
    if (!last || last.role !== 'user') return
    const content = Array.isArray(last.content) ? last.content : []
    if (content.length === 0) return
    const allToolResults = content.every(
      (b): boolean => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
    )
    if (allToolResults) this.transcript.pop()
  }

  // Scan the full transcript and remove any turn where an assistant tool_use is not
  // immediately followed by a user turn containing all matching tool_results.
  // This catches corruption that escaped the tail-only trim (e.g. from mid-transcript
  // partial writes during unexpected exits).
  private repairTranscript(): void {
    let i = 0
    while (i < this.transcript.length) {
      const turn = this.transcript[i]!
      if (turn.role !== 'assistant') { i++; continue }
      const content = Array.isArray(turn.content) ? turn.content : []
      const toolUseIds = content
        .filter((b): boolean => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_use')
        .map((b) => (b as { id?: string }).id)
        .filter((id): id is string => typeof id === 'string')
      if (toolUseIds.length === 0) { i++; continue }

      // Check next turn has matching tool_results for every tool_use id
      const next = this.transcript[i + 1]
      const nextContent = next && Array.isArray(next.content) ? next.content : []
      const resultIds = new Set(
        nextContent
          .filter((b): boolean => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result')
          .map((b) => (b as { tool_use_id?: string }).tool_use_id)
          .filter((id): id is string => typeof id === 'string')
      )
      const allCovered = toolUseIds.every(id => resultIds.has(id))
      if (!allCovered) {
        // Remove the dangling assistant turn (and the partial tool_result turn after it if present)
        const toRemove = (next && nextContent.length > 0 && nextContent.every(
          (b): boolean => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
        )) ? 2 : 1
        this.transcript.splice(i, toRemove)
        // Don't advance i - re-check same position after splice
      } else {
        i++
      }
    }
  }

  // Called by App when user submits while streaming - aborts current run and resubmits.
  steer(
    text: string,
    setState: Dispatch<SetStateAction<AppState>>,
    getState: () => AppState,
    attachments?: ImageAttachment[],
  ): void {
    this.pendingSteer = { text, attachments, setState, getState }
    if (this.abortController !== null) {
      addSystemMessage(setState, 'info', '↩ steering…')
      this.abortController.abort('user-steer')
    } else {
      this.drainPendingSteer()
    }
  }

  private drainPendingSteer(): void {
    const steer = this.pendingSteer
    if (!steer) return
    this.pendingSteer = null
    const snapshot = steer.getState()
    const userMsgId = crypto.randomUUID()
    steer.setState(prev => ({
      ...prev,
      isStreaming: true,
      messages: [...prev.messages, { id: userMsgId, role: 'user' as const, content: steer.text }],
    }))
    void this.submit(steer.text, { ...snapshot, isStreaming: true }, steer.setState, steer.attachments)
  }
}
