// SessionPicker - fuzzy picker for browsing and resuming named sessions.
// Opens when user runs /sessions. Esc closes, Enter resumes selected session.

import React, { useState, useEffect, useRef } from 'react'
import { Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import { listSessions, type SessionMeta } from '../context/session.js'
import { truncate } from '../utils/stringWidth.js'
import { SlashPicker } from './SlashPicker.js'

type SessionEntry = SessionMeta & { name: string }

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

function formatAge(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}t`
  return `${(n / 1000).toFixed(1)}k tokens`
}

export default function SessionPicker({ panelHeight, cols }: { panelHeight: number; cols: number }): React.ReactElement {
  const { state, setState } = useAppState()
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  // Ignore the Enter keypress that opened the picker (it bleeds into useInput on mount)
  const ignoreNextEnter = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => { ignoreNextEnter.current = false }, 150)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    listSessions().then(loaded => {
      // Always ensure the current session appears even if it has no meta file yet
      const hasCurrent = loaded.some(s => s.name === state.sessionName)
      if (!hasCurrent) {
        const synthetic: SessionEntry = {
          name: state.sessionName,
          sessionId: state.sessionId,
          sessionName: state.sessionName,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: state.messages.length,
          tokenCount: state.sessionTokens,
          inputTokens: state.sessionInputTokens,
          outputTokens: state.sessionOutputTokens,
        }
        setSessions([synthetic, ...loaded])
      } else {
        setSessions(loaded)
      }
    }).catch(() => setSessions([]))
  }, [])

  // Use the shared inputValue as the search query - bottom prompt acts as search bar
  const query = state.inputValue

  const filtered = sessions.filter(s =>
    fuzzyMatch(query, s.name) || fuzzyMatch(query, s.sessionName)
  )

  const clampedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

  const closeAndClear = (nextMode: 'agent' = 'agent') => {
    setState(prev => ({ ...prev, mode: nextMode, inputValue: '' }))
  }

  useInput((input, key) => {
    if (state.mode !== 'session') return

    if (key.escape || (key.ctrl && input === 'c')) {
      closeAndClear()
      return
    }

    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIdx(i => Math.min(filtered.length - 1, i + 1))
      return
    }

    if (key.return) {
      if (ignoreNextEnter.current) return
      const entry = filtered[clampedIdx]
      if (entry) {
        setState(prev => ({
          ...prev,
          mode: 'agent',
          inputValue: '',
          sessionName: entry.name,
          sessionId: entry.sessionId,
          messages: [],
        }))
        addSystemMessage(setState, 'success', `Switched to session "${entry.name}"`)
      }
      return
    }

    if (key.backspace || key.delete) {
      setState(prev => ({ ...prev, inputValue: prev.inputValue.slice(0, -1) }))
      setSelectedIdx(0)
      return
    }

    if (input && !key.ctrl && !key.meta) {
      setState(prev => ({ ...prev, inputValue: prev.inputValue + input }))
      setSelectedIdx(0)
    }
  })

  const showHints = cols >= 46

  // cursor(1) + gap(2) + name + gap(2) + meta - overhead for inline variant (paddingX=2, no box border)
  const nameCols = Math.max(8, (cols - 2) - 39)

  return (
    <SlashPicker
      items={filtered}
      selected={clampedIdx}
      getKey={s => s.name}
      height={panelHeight}
      cols={cols}
      accentColor={theme.modeSession}
      emptyText={`No sessions${query ? ` for "${query}"` : ''}`}
      hintText={showHints ? '↑↓ navigate · Enter resume · Esc close' : undefined}
      variant="inline"
      title="Sessions"
      titleRight={
        <Text color={theme.subtle}>{filtered.length} session{filtered.length !== 1 ? 's' : ''}</Text>
      }
      renderRow={(s, isActive) => (
        <>
          <Text color={isActive ? theme.text : theme.inactive} bold={isActive} wrap="truncate">
            {truncate(s.name, nameCols)}
          </Text>
          <Text color={theme.subtle} wrap="truncate">
            {formatAge(s.updatedAt)} · {s.messageCount} msgs · {formatTokens(s.tokenCount)}
          </Text>
        </>
      )}
    />
  )
}
