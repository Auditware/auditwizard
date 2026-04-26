import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, type Message, type ToolCall } from '../app/AppState.js'

const AGENT_BANNER = `  audit-wizard`
const AGENT_SUB    = `  AI Auditing Agent`

// ─── Welcome banner (first virtual scroll item) ───────────────────────────────

// Nuc-tier welcome height: title(1) + subtitle(1) + spacer(1) + optional hint(1).
// When div genome is active, the caller supplies the full height via the welcomeHeight prop.
function nucWelcomeHeight(hasMessages: boolean): number {
  return 3 + (hasMessages ? 0 : 1)
}

function WelcomeBanner({
  companionRender,
  topClip,
}: {
  companionRender?: (topClip: number) => React.ReactNode
  topClip: number
}): React.ReactElement {
  const { state } = useAppState()
  const showHint = state.messages.length === 0
  const spriteTopClip = Math.max(0, topClip - 3)

  return (
    <Box flexDirection="column" width="100%">
      {/* Row 0: title */}
      {topClip <= 0 && <Box paddingX={1}><Text color={theme.brand} bold wrap="truncate">{AGENT_BANNER}</Text></Box>}
      {/* Row 1: subtitle */}
      {topClip <= 1 && <Box paddingX={1}><Text color={theme.inactive} wrap="truncate">{AGENT_SUB}</Text></Box>}
      {/* Row 2: top spacer */}
      {topClip <= 2 && <Box height={1} />}
      {/* Rows 3+: companion sprite (div genome only) + bottom spacer */}
      {companionRender && (
        <>
          <Box justifyContent="center" width="100%">
            {companionRender(spriteTopClip)}
          </Box>
          <Box height={1} />
        </>
      )}
      {/* Hint: last row (suppressed when messages exist) */}
      {showHint && (
        <Box paddingX={1} justifyContent="center">
          <Text dimColor>Type a message · /help for commands</Text>
        </Box>
      )}
    </Box>
  )
}

// ─── Tool call row ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '◆',
  done:    '✓',
  error:   '✗',
}
const STATUS_COLOR: Record<string, string> = {
  pending: theme.inactive,
  running: theme.brand,
  done:    theme.success,
  error:   theme.error,
}
const COLLAPSE_THRESHOLD = 6

function ToolCallBlock({ tc }: { tc: ToolCall }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const icon = STATUS_ICON[tc.status] ?? '○'
  const color = STATUS_COLOR[tc.status] ?? theme.inactive

  const resultLines = tc.result?.split('\n') ?? []
  const truncated = !expanded && resultLines.length > COLLAPSE_THRESHOLD
  const visibleLines = truncated ? resultLines.slice(0, COLLAPSE_THRESHOLD) : resultLines

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={0}>
      <Box flexDirection="row" gap={1}>
        <Text color={color}>{icon}</Text>
        <Text color={theme.inactive}>{tc.name}</Text>
        {tc.status === 'running' && <Text color={theme.brand}>...</Text>}
      </Box>
      {tc.result && (
        <Box flexDirection="column" paddingLeft={2}>
          {visibleLines.map((line, i) => (
            <Text key={i} color={theme.inactive} dimColor>{line}</Text>
          ))}
          {truncated && (
            <Box marginTop={0}>
              <Text color={theme.suggestion} dimColor>  ↕ {resultLines.length - COLLAPSE_THRESHOLD} more lines</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// ─── System message group ─────────────────────────────────────────────────────
// Consecutive system messages are rendered as a tight block with a single
// top margin - they belong to the same event (e.g. /help lines, tool output).

const NOTIF_ICONS: Record<string, string> = {
  info:     'ℹ',
  success:  '✓',
  warning:  '⚠',
  error:    '✗',
  progress: '◆',
}
const NOTIF_COLORS: Record<string, string> = {
  info:     theme.suggestion,
  success:  theme.success,
  warning:  theme.warning,
  error:    theme.error,
  progress: theme.brand,
}

function SystemMessageRow({ msg }: { msg: Message }): React.ReactElement {
  const type = msg.notifType ?? 'info'

  // List items: indented bullet row, no icon; empty content = blank spacer line
  if (type === 'list') {
    if (!msg.content) return <Box paddingLeft={2}><Text> </Text></Box>
    return (
      <Box flexDirection="row" paddingLeft={2}>
        <Text color={theme.inactive}>· </Text>
        <Text color={theme.inactive} wrap="wrap">{msg.content}</Text>
      </Box>
    )
  }

  // Key-value rows: "key\tvalue" - key truncated+padded, value normal
  if (type === 'kv' || type === 'kv-spaced') {
    const tab = msg.content.indexOf('\t')
    const key = tab >= 0 ? msg.content.slice(0, tab) : msg.content
    const val = tab >= 0 ? msg.content.slice(tab + 1) : ''
    const pad = 24
    const keyTrunc = key.length > pad ? key.slice(0, pad - 2) + '..' : key
    const keyPadded = keyTrunc + ' '.repeat(Math.max(1, pad - keyTrunc.length))
    return (
      <Box flexDirection="row" paddingLeft={2} marginBottom={type === 'kv-spaced' ? 1 : 0}>
        <Text color={theme.inactive}>{keyPadded}</Text>
        <Text color={theme.text}>{val}</Text>
      </Box>
    )
  }

  const icon = NOTIF_ICONS[type] ?? 'ℹ'
  const color = NOTIF_COLORS[type] ?? theme.inactive

  return (
    <Box flexDirection="row" gap={1} paddingX={1}>
      <Text color={color}>{icon}</Text>
      <Text color={color} dimColor>{msg.content}</Text>
    </Box>
  )
}

// A block of one or more consecutive system messages
function SystemGroup({ messages, topClip = 0 }: { messages: Message[]; topClip?: number }): React.ReactElement {
  // topClip: skip this many physical rows from the top.
  // Row 0 is marginTop(1). Rows 1+ are system message rows.
  const skipMargin = topClip > 0
  const skipMessages = Math.max(0, topClip - 1)
  const visibleMessages = skipMessages > 0 ? messages.slice(skipMessages) : messages
  return (
    <Box flexDirection="column" marginTop={skipMargin ? 0 : 1} marginBottom={0}>
      {visibleMessages.map(msg => (
        <SystemMessageRow key={msg.id} msg={msg} />
      ))}
    </Box>
  )
}

// ─── Chat turn (user + assistant) ────────────────────────────────────────────

// Skip the first `skipLines` physical lines from wrapped content.
// Returns a string starting from the logical line that contains physical line `skipLines`.
function skipWrappedContent(content: string, skipLines: number, width: number): string {
  if (skipLines <= 0) return content
  const paragraphs = content.split('\n')
  let remaining = skipLines
  for (let i = 0; i < paragraphs.length; i++) {
    const lineRows = Math.max(1, Math.ceil((paragraphs[i]!.length || 1) / width))
    if (remaining < lineRows) return paragraphs.slice(i).join('\n')
    remaining -= lineRows
    if (remaining <= 0) return paragraphs.slice(i + 1).join('\n')
  }
  return ''
}

function ChatTurn({ msg, topClip = 0, contentWidth = 80 }: { msg: Message; topClip?: number; contentWidth?: number }): React.ReactElement {
  const { state } = useAppState()
  const agentName = state.instanceName
  const isUser = msg.role === 'user'
  const isToolResult = msg.role === 'tool_result'
  const [expanded, setExpanded] = useState(false)

  if (isToolResult) {
    const lines = msg.content?.split('\n') ?? []
    const truncated = !expanded && lines.length > COLLAPSE_THRESHOLD
    const visibleLines = truncated ? lines.slice(0, COLLAPSE_THRESHOLD) : lines
    // topClip row 0 = marginTop, row 1 = "[tool result]" header, rows 2+ = content lines
    const skipMargin = topClip > 0
    const skipHeader = topClip > 1
    const skipContentLines = Math.max(0, topClip - 2)
    const clippedLines = skipContentLines > 0 ? visibleLines.slice(skipContentLines) : visibleLines
    return (
      <Box flexDirection="column" marginTop={skipMargin ? 0 : 1} paddingLeft={2}>
        {!skipHeader && <Text color={theme.inactive} dimColor>[tool result]</Text>}
        {clippedLines.map((line, i) => (
          <Text key={i} color={theme.inactive} dimColor>{line}</Text>
        ))}
        {truncated && (
          <Box marginTop={0}>
            <Text color={theme.suggestion} dimColor>  ↕ {lines.length - COLLAPSE_THRESHOLD} more lines</Text>
          </Box>
        )}
      </Box>
    )
  }

  // topClip row layout for assistant messages:
  //   Row 0: marginTop(1) - blank
  //   Row 1: "✻ agentName" header
  //   Row 2: paddingTop(1) - blank
  //   Row 3+: content lines (wrap-counted)
  // For user messages:
  //   Row 0: marginTop(1) - blank
  //   Row 1+: content lines
  const skipMarginAssistant = topClip > 0
  const showHeader = !isUser && topClip < 2
  const contentPaddingTop = !isUser && topClip < 3 ? Math.max(0, 1 - Math.max(0, topClip - 2)) : 0
  const contentSkipRows = isUser ? Math.max(0, topClip - 1) : Math.max(0, topClip - 3)
  const clippedContent = msg.content ? skipWrappedContent(msg.content, contentSkipRows, contentWidth) : ''

  return (
    <Box flexDirection="column" marginTop={skipMarginAssistant ? 0 : 1}>
      {isUser ? (
        <Box flexDirection="row" gap={1}>
          <Text color={theme.brand} bold>❯</Text>
          <Text color={theme.text} wrap="wrap">{contentSkipRows > 0 ? clippedContent : (msg.content ?? '')}</Text>
        </Box>
      ) : (
        <>
          {showHeader && (
            <Box flexDirection="row" gap={1}>
              <Text color={theme.success} bold>✻</Text>
              <Text color={theme.success} bold>{agentName}</Text>
            </Box>
          )}
          <Box paddingLeft={2} paddingTop={contentPaddingTop} flexDirection="column">
            {(contentSkipRows > 0 ? clippedContent : msg.content) ? (
              <Text color={theme.text} wrap="wrap">{contentSkipRows > 0 ? clippedContent : msg.content}</Text>
            ) : null}
            {msg.toolCalls?.map(tc => (
              <ToolCallBlock key={tc.id} tc={tc} />
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}

// ─── Message grouping ────────────────────────────────────────────────────────
// Groups consecutive system messages into blocks, keeps chat turns as singles.

type MessageGroup =
  | { kind: 'system'; messages: Message[] }
  | { kind: 'chat';   message: Message }

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const msg of messages) {
    if (msg.role === 'system') {
      const last = groups[groups.length - 1]
      if (last?.kind === 'system') {
        last.messages.push(msg)
      } else {
        groups.push({ kind: 'system', messages: [msg] })
      }
    } else {
      groups.push({ kind: 'chat', message: msg })
    }
  }
  return groups
}

// ─── Message history ──────────────────────────────────────────────────────────

// Estimate terminal rows consumed by a message group (approximate, not pixel-perfect)
function estimateGroupLines(group: MessageGroup, contentWidth: number): number {
  if (group.kind === 'system') {
    // 1 marginTop + rows per notification (accounting for content wrapping)
    const msgLines = group.messages.reduce((sum, m) => {
      if (m.notifType === 'kv' || m.notifType === 'kv-spaced') {
        // key (max 24) + value; whole row may wrap
        const tab = m.content.indexOf('\t')
        const val = tab >= 0 ? m.content.slice(tab + 1) : ''
        const rowLen = 24 + val.length + 2  // paddingLeft(2)
        const extra = m.notifType === 'kv-spaced' ? 1 : 0
        return sum + Math.max(1, Math.ceil(rowLen / contentWidth)) + extra
      }
      if (m.notifType === 'list') {
        if (!m.content) return sum + 1
        const rowLen = m.content.length + 4  // paddingLeft(2) + bullet(2)
        return sum + Math.max(1, Math.ceil(rowLen / contentWidth))
      }
      // info/success/warning/error/progress: icon + content, usually short
      const rowLen = m.content ? m.content.length + 4 : 0
      return sum + Math.max(1, Math.ceil(rowLen / contentWidth))
    }, 0)
    return 1 + msgLines
  }
  const msg = group.message
  // marginTop(1) + header(1) + paddingTop(1) - no marginBottom in actual render
  let lines = 3
  if (msg.role === 'tool_result') {
    if (!msg.content) return 2
    const rl = msg.content.split('\n').reduce(
      (sum, ln) => sum + Math.max(1, Math.ceil((ln.length || 1) / contentWidth)), 0
    )
    return 2 + Math.min(rl, COLLAPSE_THRESHOLD + 1)  // header + capped lines
  }
  if (msg.content) {
    // Count each physical line (split on newlines) then add wrap rows per line
    const physicalLines = msg.content.split('\n')
    lines += physicalLines.reduce((sum, ln) => sum + Math.max(1, Math.ceil((ln.length || 1) / contentWidth)), 0)
  }
  for (const tc of msg.toolCalls ?? []) {
    lines += 2  // tool name row + blank
    if (tc.result) {
      const tcLines = tc.result.split('\n')
      const wrappedCount = tcLines.reduce((sum, ln) => sum + Math.max(1, Math.ceil((ln.length || 1) / contentWidth)), 0)
      lines += Math.min(wrappedCount, COLLAPSE_THRESHOLD + 1)
    }
  }
  return lines
}

export default function MessageHistory({
  msgAreaHeight,
  cols,
  companionRender,
  welcomeHeight,
}: {
  msgAreaHeight: number
  cols: number
  companionRender?: (topClip: number) => React.ReactNode
  welcomeHeight?: number
}): React.ReactElement {
  const { state, setState } = useAppState()

  const allGroups = groupMessages(state.messages)
  const contentWidth = Math.max(1, cols - 8)
  const groupLines = allGroups.map(g => estimateGroupLines(g, contentWidth))

  // Welcome banner height: supplied by the active genome (div) or computed from nuc default.
  const WELCOME_HEIGHT = welcomeHeight ?? nucWelcomeHeight(state.messages.length > 0)
  const totalContentLines = groupLines.reduce((a, b) => a + b, 0)
  const totalLines = WELCOME_HEIGHT + totalContentLines

  // scrollOffset=0: show newest content at bottom.
  // scrollOffset=N: scroll N lines back into history.
  const maxScroll = Math.max(0, totalLines - msgAreaHeight)
  const scrollOff = Math.min(state.scrollOffset, maxScroll)
  if (scrollOff !== state.scrollOffset) {
    setTimeout(() => setState(prev => ({ ...prev, scrollOffset: scrollOff })), 0)
  }

  // Compute viewport: [viewTop, viewBottom) in cumulative line space
  const viewBottom = totalLines - scrollOff
  const viewTop = Math.max(0, viewBottom - msgAreaHeight)

  // Is the welcome banner visible? It occupies [0, WELCOME_HEIGHT)
  const showWelcome = viewTop < WELCOME_HEIGHT

  // Select message groups whose line range overlaps [viewTop, viewBottom)
  // Message groups start at offset WELCOME_HEIGHT in the cumulative space.
  // When the banner is visible it consumes physical rows, leaving less room for messages.
  // Compute how many message lines actually fit below the banner in the viewport.
  const bannerRowsInView = showWelcome ? Math.max(0, WELCOME_HEIGHT - viewTop) : 0

  // Collect all groups within the virtual viewport [viewTop, viewBottom)
  // Also track each group's cumulative start line so we can compute topClip.
  let cum = WELCOME_HEIGHT
  let hiddenAbove = 0
  const inViewGroups: MessageGroup[] = []
  const inViewLines: number[] = []
  const inViewStarts: number[] = []
  let hiddenBelow = 0
  for (let i = 0; i < allGroups.length; i++) {
    const gl = groupLines[i]!
    const gStart = cum
    const gEnd = cum + gl
    if (gEnd <= viewTop) {
      hiddenAbove++
    } else if (gStart >= viewBottom) {
      hiddenBelow++
    } else {
      inViewGroups.push(allGroups[i]!)
      inViewLines.push(gl)
      inViewStarts.push(gStart)
    }
    cum += gl
  }

  // Messages get priority over banner: if content exceeds available rows,
  // let the banner yield rows rather than evicting message groups entirely.
  void Math.max(inViewLines.reduce((a, b) => a + b, 0), msgAreaHeight - bannerRowsInView)

  return (
    <Box flexDirection="column" paddingX={1}>
      {showWelcome && (
        // Clip top of banner: WelcomeBanner skips first topClip rows internally,
        // so the outer height constraint clips any bottom overflow cleanly.
        <Box height={bannerRowsInView} width="100%" overflow="hidden">
          <WelcomeBanner companionRender={companionRender} topClip={viewTop} />
        </Box>
      )}
      {hiddenAbove > 0 && (
        <Box paddingX={1}>
          <Text color={theme.inactive} dimColor>↑ {hiddenAbove} earlier message{hiddenAbove > 1 ? 's' : ''}</Text>
        </Box>
      )}
      {inViewGroups.map((group, idx) => {
        // The first in-view group may start above the viewport - clip its top rows.
        const groupTopClip = idx === 0 ? Math.max(0, viewTop - inViewStarts[0]!) : 0
        if (group.kind === 'system') {
          return <SystemGroup key={group.messages[0]!.id} messages={group.messages} topClip={groupTopClip} />
        }
        return <ChatTurn key={group.message.id} msg={group.message} topClip={groupTopClip} contentWidth={contentWidth} />
      })}
      {state.isStreaming && (
        <Box flexDirection="row" gap={1} paddingLeft={2} marginTop={1}>
          <Text color={theme.brand}>◆</Text>
          <Text color={theme.inactive}>thinking...</Text>
        </Box>
      )}
      {hiddenBelow > 0 && (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.inactive} dimColor>↓ {hiddenBelow} newer message{hiddenBelow > 1 ? 's' : ''}</Text>
        </Box>
      )}
    </Box>
  )
}
