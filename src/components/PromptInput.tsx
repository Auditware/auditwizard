import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import { useDoublePress } from '../hooks/useDoublePress.js'
import { hasClipboardImage, getClipboardImage, tryReadImagePath, type ImageAttachment } from '../utils/imagePaste.js'
import { useScrollWindow } from '../utils/useScrollWindow.js'
import { matchesBinding } from '../utils/keybindings.js'
import { sessionsDir } from '../context/session.js'

const PROMPT_CHAR = '>'
// Pastes longer than this (chars) or with newlines get collapsed to a token
const PASTE_THRESHOLD = 200

// Build the display token for a large paste
function pasteToken(input: string): string {
  const lineCount = input.split('\n').length
  return lineCount > 1
    ? `[${lineCount} lines pasted]`
    : `[${input.length} chars pasted]`
}

export type SlashCommand = {
  cmd: string
  desc: string
  usage?: string     // full usage string shown in /help
  shortcut?: string  // keyboard shortcut label (e.g. 'Ctrl+S')
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/id',       desc: 'show session identity' },
  { cmd: '/sessions', desc: 'browse & switch sessions',                    shortcut: 'Ctrl+S' },
  { cmd: '/skills',   desc: 'list loaded skills',                          shortcut: 'Ctrl+K' },
  { cmd: '/model',    desc: 'switch model' },
  { cmd: '/api-key',  desc: 'set API key' },
  { cmd: '/pet',      desc: 'pet your buddy' },
  { cmd: '/help',     desc: 'show all commands' },
]

// Render the input value, highlighting paste and image tokens
function renderInputParts(value: string, textColor: string): React.ReactNode {
  const parts = value.split(/(\[\d+ (?:lines|chars) pasted\]|\[image: [^\]]+\])/g)
  return parts.map((part, i) => {
    if (/^\[\d+ (?:lines|chars) pasted\]$/.test(part)) {
      return <Text key={i} color={theme.brand} bold>{part}</Text>
    }
    if (/^\[image: [^\]]+\]$/.test(part)) {
      return <Text key={i} color={theme.success} bold>{part}</Text>
    }
    return <Text key={i} color={textColor}>{part}</Text>
  })
}

type Props = {
  onSubmit: (value: string, attachments?: ImageAttachment[]) => void
  onAbort?: () => void
  overlayOpen?: boolean
  slashMenuMaxRows?: number
  commands?: { cmd: string; desc: string; usage?: string; shortcut?: string }[]
}

export default function PromptInput({ onSubmit, onAbort, overlayOpen = false, slashMenuMaxRows, commands }: Props): React.ReactElement {
  const { state, setState } = useAppState()
  const { stdout } = useStdout()
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [savedDraft, setSavedDraft] = useState('')

  // Load persisted history from ~/.audit-wizard/sessions/<sessionName>.history on mount
  useEffect(() => {
    const sessionName = state.sessionName
    if (!sessionName) return
    const path = `${sessionsDir()}/${sessionName}.history`
    Bun.file(path).text().then(text => {
      const lines = text.split('\n').filter(Boolean).reverse()
      if (lines.length > 0) setHistory(lines)
    }).catch(() => { /* no history file yet */ })
  }, [state.sessionName])
  // Map of paste token -> actual content, expanded on submit
  const pasteSlots = useRef<Map<string, string>>(new Map())
  // Image attachments keyed by token (e.g. "[image: foo.png]")
  const imageSlots = useRef<Map<string, ImageAttachment>>(new Map())

  const cols = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24

  const handleCtrlC = useDoublePress(
    pending => {
      if (pending) {
        addSystemMessage(setState, 'info', 'Press Ctrl+C again to quit')
      }
    },
    () => process.exit(0),
  )

  const isDisabled = overlayOpen || state.isStreaming
  const promptColor = isDisabled ? theme.inactive : (
    state.mode === 'session' ? theme.modeSession :
    theme.brand
  )

  const showMenu = !isDisabled && state.inputValue.startsWith('/') && historyIdx === -1
  const menuFilter = state.inputValue.toLowerCase()
  const activeCommands = commands ?? SLASH_COMMANDS
  const menuItems = activeCommands.filter(c => c.cmd.startsWith(menuFilter))
  const menuIdx = state.slashMenuIdx
  // Clamp visible window: use parent-computed budget or fallback to rows - 8
  const maxMenuVisible = slashMenuMaxRows ?? Math.max(3, rows - 8)
  const clampedIdx = Math.min(menuIdx, menuItems.length - 1)
  const { visibleItems: visibleMenuItems, windowStart: menuWindowStart, windowEnd: menuWindowEnd, scrolledAbove: menuScrolledAbove, scrolledBelow: menuScrolledBelow, globalIdx: menuGlobalIdx } = useScrollWindow(menuItems, clampedIdx, maxMenuVisible)

  const setMenuIdx = (updater: number | ((i: number) => number)) => {
    setState(prev => ({
      ...prev,
      slashMenuIdx: typeof updater === 'function' ? updater(prev.slashMenuIdx) : updater,
    }))
  }

  const submit = useCallback((val: string) => {
    // Expand paste tokens back to real content before sending
    let expanded = val
    for (const [token, content] of pasteSlots.current) {
      expanded = expanded.replace(token, content)
    }
    // Collect image attachments
    const attachments: ImageAttachment[] = []
    for (const [token, attachment] of imageSlots.current) {
      // Strip image tokens from the text (images go as content blocks)
      expanded = expanded.replace(token, '').trim()
      attachments.push(attachment)
    }
    const trimmed = expanded.trim()
    if (!trimmed && attachments.length === 0) return
    pasteSlots.current.clear()
    imageSlots.current.clear()
    setHistory(prev => [val, ...prev.slice(0, 99)])
    setHistoryIdx(-1)
    setSavedDraft('')
    // Persist to ~/.audit-wizard/sessions/<sessionName>.history
    const sessionName = state.sessionName
    if (sessionName) {
      const path = `${sessionsDir()}/${sessionName}.history`
      Bun.file(path).text().catch(() => '').then(existing => {
        Bun.write(path, `${existing}${val}\n`).catch(() => {})
      })
    }
    setState(prev => ({ ...prev, inputValue: '', slashMenuIdx: 0 }))
    onSubmit(trimmed || '(image)', attachments.length > 0 ? attachments : undefined)
  }, [onSubmit, setState])

  useInput((input, key) => {
    const combo = { key: input, ctrl: key.ctrl, shift: key.shift, meta: key.meta }

    // Ctrl+Q: quit (works even when overlay is open)
    if (matchesBinding('app:quit', combo)) { handleCtrlC(); return }

    // Esc or Ctrl+C while streaming: abort the in-flight request
    if (state.isStreaming && (key.escape || (key.ctrl && input === 'c'))) { onAbort?.(); return }

    if (isDisabled) return

    // Global shortcuts: open pickers via submit so the full command flow runs
    if (matchesBinding('session:open', combo)) { submit('/sessions'); return }
    if (matchesBinding('skills:open',  combo)) { submit('/skills');   return }

    // While slash menu is open, up/down/enter navigate it
    if (showMenu && menuItems.length > 0) {
      if (key.upArrow) {
        setMenuIdx(i => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setMenuIdx(i => Math.min(menuItems.length - 1, i + 1))
        return
      }
      if (key.tab || key.return) {
        const chosen = menuItems[Math.min(menuIdx, menuItems.length - 1)]
        if (chosen) {
          if (key.return) {
            submit(chosen.cmd)
          } else {
            setState(prev => ({ ...prev, inputValue: chosen.cmd + ' ', slashMenuIdx: 0 }))
          }
          setMenuIdx(0)
        }
        return
      }
    }

    if (key.return && !key.shift) {
      setState(prev => ({ ...prev, scrollOffset: 0 }))
      submit(state.inputValue)
      setMenuIdx(0)
      return
    }

    if (key.return && key.shift) {
      setState(prev => ({ ...prev, inputValue: prev.inputValue + '\n' }))
      return
    }

    if (key.ctrl && input === 'c') {
      // First Ctrl+C clears input if non-empty; second triggers quit flow
      if (state.inputValue.length > 0) {
        pasteSlots.current.clear()
        imageSlots.current.clear()
        setState(prev => ({ ...prev, inputValue: '', slashMenuIdx: 0 }))
      } else {
        handleCtrlC()
      }
      return
    }

    // Ctrl+V: attach clipboard image if available
    if (key.ctrl && input === 'v') {
      if (hasClipboardImage()) {
        getClipboardImage().then(img => {
          if (!img) return
          const token = `[image: ${img.label}]`
          imageSlots.current.set(token, img)
          setState(prev => ({ ...prev, inputValue: prev.inputValue + token }))
        }).catch(() => { /* ignore */ })
      }
      return
    }

    if (key.meta && key.upArrow) {
      setState(prev => ({ ...prev, scrollOffset: prev.scrollOffset + 5 }))
      return
    }

    if (key.meta && key.downArrow) {
      setState(prev => ({ ...prev, scrollOffset: Math.max(0, prev.scrollOffset - 5) }))
      return
    }

    if (key.upArrow) {
      if (history.length === 0) return
      const newIdx = Math.min(historyIdx + 1, history.length - 1)
      if (historyIdx === -1) setSavedDraft(state.inputValue)
      setHistoryIdx(newIdx)
      setState(prev => ({ ...prev, inputValue: history[newIdx] ?? '' }))
      return
    }

    if (key.downArrow) {
      if (historyIdx === -1) return
      const newIdx = historyIdx - 1
      setHistoryIdx(newIdx)
      setState(prev => ({
        ...prev,
        inputValue: newIdx === -1 ? savedDraft : (history[newIdx] ?? ''),
      }))
      return
    }

    if (key.backspace || key.delete) {
      setMenuIdx(0)
      setState(prev => {
        const val = prev.inputValue
        // If removing the last char of a paste token, remove the whole token
        const tokenMatch = val.match(/\[\d+ (?:lines|chars) pasted\]$/)
        if (tokenMatch) {
          const token = tokenMatch[0]
          pasteSlots.current.delete(token)
          return { ...prev, inputValue: val.slice(0, -token.length) }
        }
        // If removing the last char of an image token, remove the whole token
        const imgMatch = val.match(/\[image: [^\]]+\]$/)
        if (imgMatch) {
          const token = imgMatch[0]
          imageSlots.current.delete(token)
          return { ...prev, inputValue: val.slice(0, -token.length) }
        }
        return { ...prev, inputValue: val.slice(0, -1) }
      })
      return
    }

    if (input && !key.ctrl && !key.meta) {
      // Large paste detection: chunk has newlines or exceeds threshold
      const isLargePaste = input.includes('\n') || input.length > PASTE_THRESHOLD
      if (isLargePaste) {
        // Check if it's an image file path first
        const imgAttachment = tryReadImagePath(input)
        if (imgAttachment) {
          const token = `[image: ${imgAttachment.label}]`
          imageSlots.current.set(token, imgAttachment)
          setMenuIdx(0)
          setState(prev => ({ ...prev, inputValue: prev.inputValue + token }))
          return
        }
        const token = pasteToken(input)
        pasteSlots.current.set(token, input)
        setMenuIdx(0)
        setState(prev => ({ ...prev, inputValue: prev.inputValue + token }))
        return
      }
      setMenuIdx(0)
      setState(prev => ({ ...prev, inputValue: prev.inputValue + input }))
    }
  })

  const textColor = isDisabled ? theme.inactive : theme.text

  // Scrollable input: wrap text into lines, handle explicit newlines (Shift+Enter),
  // then hard-wrap long lines. Show last MAX_INPUT_LINES only.
  const MAX_INPUT_LINES = 5
  const inputWidth = Math.max(1, cols - 7)  // accounts for padding + "> " prefix
  const raw = state.inputValue
  const wrappedLines: string[] = []
  for (const naturalLine of (raw || '').split('\n')) {
    if (naturalLine.length === 0) {
      wrappedLines.push('')
    } else {
      for (let pos = 0; pos < naturalLine.length; pos += inputWidth) {
        wrappedLines.push(naturalLine.slice(pos, pos + inputWidth))
      }
    }
  }
  if (wrappedLines.length === 0) wrappedLines.push('')
  const hiddenLineCount = Math.max(0, wrappedLines.length - MAX_INPUT_LINES)
  const visibleLines = wrappedLines.slice(hiddenLineCount)

  return (
    <Box flexDirection="column" width={cols - 2}>
      {/* Slash command menu */}
      {showMenu && menuItems.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.subtle}
          marginX={1}
          paddingX={1}
        >
          {menuScrolledAbove && (
            <Text color={theme.inactive} dimColor>  ↑ {menuWindowStart} more</Text>
          )}
          {visibleMenuItems.map((item, i) => {
            const globalIdx = menuGlobalIdx(i)
            const active = globalIdx === clampedIdx
            return (
              <Box key={item.cmd} flexDirection="row" gap={1}>
                <Text color={active ? theme.brand : theme.inactive} bold={active}>
                  {active ? '›' : ' '}
                </Text>
                <Text color={active ? theme.text : theme.inactive} bold={active}>
                  {item.cmd}
                </Text>
                <Text dimColor>{item.desc}</Text>
              </Box>
            )
          })}
          {menuScrolledBelow && (
            <Text color={theme.inactive} dimColor>  ↓ {menuItems.length - menuWindowEnd} more</Text>
          )}
        </Box>
      )}

      {/* Scroll indicator when input is taller than viewport */}
      {hiddenLineCount > 0 && (
        <Box paddingX={4}>
          <Text color={theme.inactive} dimColor>+{hiddenLineCount} line{hiddenLineCount > 1 ? 's' : ''} ↑</Text>
        </Box>
      )}

      {/* Prompt input row - renders only the visible viewport */}
      <Box flexDirection="row" gap={1} paddingX={1} paddingTop={1}>
        <Text color={promptColor} bold>{PROMPT_CHAR}</Text>
        <Box flexShrink={1} flexGrow={1} flexDirection="column">
          {visibleLines.map((line, i) => {
            const isLast = i === visibleLines.length - 1
            return (
              <Text key={i} color={textColor}>
                {renderInputParts(line, textColor)}
                {isLast && !isDisabled && <Text color={theme.brand}>█</Text>}
              </Text>
            )
          })}
        </Box>
        {isDisabled && state.isStreaming && (
          <Text color={theme.inactive} dimColor>Thinking… <Text color={theme.suggestion}>Esc/^C cancel</Text></Text>
        )}
      </Box>
    </Box>
  )
}
