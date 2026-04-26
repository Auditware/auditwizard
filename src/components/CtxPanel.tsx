// CtxPanel - interactive context window breakdown panel.
// Rendered as a bottom drawer when mode === 'ctx'.
// Press r to reset AI transcript + compaction cache live.
// Press Esc or q to close.

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import type { QueryEngine } from '../agent/QueryEngine.js'

type Breakdown = {
  systemBase: number
  compactionSummary: number
  tools: number
  history: number
  totalActual: number
  modelLimit: number
}

type Props = {
  panelHeight: number
  cols: number
  engineRef: React.MutableRefObject<QueryEngine>
  onClose: () => void
  onReset: () => void
}

export default function CtxPanel({ panelHeight, cols, engineRef, onClose, onReset }: Props): React.ReactElement {
  const { state, setState } = useAppState()
  const [breakdown, setBreakdown] = useState<Breakdown>(() =>
    engineRef.current.getContextBreakdown(state)
  )
  const [justReset, setJustReset] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refresh breakdown every 500ms so it stays live
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setBreakdown(engineRef.current.getContextBreakdown(state))
    }, 500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [state])

  useInput((input, key) => {
    if (input === 'r' || input === 'R') {
      engineRef.current.resetTranscript()
      engineRef.current.resetCompactCache()
      setState(prev => ({ ...prev, lastInputTokens: 0 }))
      setBreakdown(engineRef.current.getContextBreakdown({ ...state, lastInputTokens: 0 }))
      setJustReset(true)
      addSystemMessage(setState, 'success', 'context reset - AI conversation cleared')
      setTimeout(() => setJustReset(false), 2000)
      onReset()
      return
    }
    if (key.escape || input === 'q') {
      onClose()
    }
  })

  const { systemBase, compactionSummary, tools, history, totalActual, modelLimit } = breakdown
  const totalEst = systemBase + compactionSummary + tools + history
  const displayTotal = totalActual > 0 ? totalActual : totalEst
  const pct = modelLimit > 0 ? Math.min(99, Math.round((displayTotal / modelLimit) * 100)) : 0
  const isEst = totalActual === 0

  const COLS = Math.min(52, Math.max(30, cols - 6))
  const ROWS = 3
  const totalDots = COLS * ROWS
  const OUTPUT_RESERVED = 8_096

  const seg = (n: number, ch: string) =>
    ch.repeat(Math.max(0, Math.round((n / (modelLimit || 1)) * totalDots)))
  const sysDots  = seg(systemBase + compactionSummary, '█')
  const toolDots = seg(tools, '▓')
  const histDots = seg(history, '▒')
  const outDots  = seg(OUTPUT_RESERVED, '░')
  const used     = sysDots.length + toolDots.length + histDots.length + outDots.length
  const freeDots = '·'.repeat(Math.max(0, totalDots - used))
  const dots     = (sysDots + toolDots + histDots + outDots + freeDots).slice(0, totalDots)

  const fmt  = (n: number) => n.toLocaleString()
  const pctS = (n: number) =>
    displayTotal > 0 ? `${Math.round((n / displayTotal) * 100)}%`.padStart(4) : '  0%'

  const totalLabel = `${isEst ? '~' : ''}${fmt(displayTotal)} / ${fmt(modelLimit)} (${pct}%${isEst ? ' est' : ''})`

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={theme.brand} bold>context  </Text>
        <Text color={pct > 80 ? theme.error : pct > 50 ? theme.warning : theme.success}>
          {totalLabel}
        </Text>
        <Text color={theme.inactive}>  █sys ▓tools ▒history ░reserved · free</Text>
      </Box>

      {/* Dot map - live */}
      {Array.from({ length: ROWS }, (_, r) => (
        <Text key={r} color={justReset ? theme.success : theme.inactive}>
          {dots.slice(r * COLS, (r + 1) * COLS)}
        </Text>
      ))}

      {/* Stats row */}
      <Box gap={2} marginTop={0}>
        <Text color={theme.inactive}>
          {'sys '}
          <Text color={theme.text}>{fmt(systemBase + compactionSummary).padStart(7)}</Text>
          {' ' + pctS(systemBase + compactionSummary)}
          {compactionSummary > 0 ? <Text color={theme.inactive}> (compacted)</Text> : null}
        </Text>
        <Text color={theme.inactive}>
          {'tools '}
          <Text color={theme.text}>{fmt(tools).padStart(7)}</Text>
          {' ' + pctS(tools)}
        </Text>
      </Box>
      <Box gap={2}>
        <Text color={theme.inactive}>
          {'hist '}
          <Text color={history > 0 ? theme.warning : theme.text}>{fmt(history).padStart(7)}</Text>
          {' ' + pctS(history)}
        </Text>
        <Text color={theme.inactive}>
          {'free '}
          <Text color={theme.success}>{fmt(Math.max(0, modelLimit - displayTotal - OUTPUT_RESERVED)).padStart(7)}</Text>
        </Text>
      </Box>

      {/* Hint bar */}
      <Box marginTop={0}>
        {justReset
          ? <Text color={theme.success} bold>  context cleared</Text>
          : <Text color={theme.inactive}>  <Text color={theme.brand} bold>r</Text> reset context  <Text color={theme.inactive}>q/Esc</Text> close</Text>
        }
      </Box>
    </Box>
  )
}
