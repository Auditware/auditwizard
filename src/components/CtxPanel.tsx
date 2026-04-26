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
    if (key.escape || key.return || input === 'q') {
      onClose()
    }
  })

  const { systemBase, compactionSummary, tools, history, totalActual, modelLimit } = breakdown
  const totalEst = systemBase + compactionSummary + tools + history
  const displayTotal = totalActual > 0 ? totalActual : totalEst
  const pct = modelLimit > 0 ? Math.min(99, Math.round((displayTotal / modelLimit) * 100)) : 0
  const isEst = totalActual === 0

  const COLS = Math.min(44, Math.max(26, cols - 8))
  const ROWS = 4
  const totalDots = COLS * ROWS
  const OUTPUT_RESERVED = 8_096

  // Per-segment colors - used in both dot map and legend
  const segColors = {
    sys:      theme.brand,       // violet
    tools:    theme.warning,     // amber
    history:  theme.suggestion,  // sky blue
    reserved: theme.error,       // red
    free:     theme.inactive,    // gray
  }

  const seg = (n: number, ch: string) => {
    if (n <= 0) return ''
    return ch.repeat(Math.max(1, Math.round((n / (modelLimit || 1)) * totalDots)))
  }
  const sysDots  = seg(systemBase + compactionSummary, '█')
  const toolDots = seg(tools, '▓')
  const histDots = seg(history, '▒')
  const outDots  = seg(OUTPUT_RESERVED, '░')
  const used     = sysDots.length + toolDots.length + histDots.length + outDots.length
  const freeDots = '·'.repeat(Math.max(0, totalDots - used))
  const dots     = (sysDots + toolDots + histDots + outDots + freeDots).slice(0, totalDots)

  // Segment boundaries for colored dot map rendering
  const dotSegs = [
    { end: sysDots.length,                                                               color: segColors.sys },
    { end: sysDots.length + toolDots.length,                                             color: segColors.tools },
    { end: sysDots.length + toolDots.length + histDots.length,                           color: segColors.history },
    { end: sysDots.length + toolDots.length + histDots.length + outDots.length,          color: segColors.reserved },
    { end: totalDots,                                                                     color: segColors.free },
  ]

  const getRowSpans = (r: number) => {
    const rowStart = r * COLS
    const rowEnd   = (r + 1) * COLS
    let prev = 0
    return dotSegs.flatMap(({ end, color }) => {
      const s = Math.max(prev, rowStart)
      const e = Math.min(end, rowEnd)
      prev = end
      return s < e ? [{ text: dots.slice(s, e), color }] : []
    })
  }

  const fmt  = (n: number) => n.toLocaleString()
  const pctOf = (n: number) => {
    if (modelLimit <= 0) return '  0%'
    const p = Math.round((n / modelLimit) * 100)
    if (p === 0 && n > 0) return ' <1%'
    return `${p}%`.padStart(4)
  }

  const reserved = OUTPUT_RESERVED
  const free = Math.max(0, modelLimit - displayTotal - OUTPUT_RESERVED)

  const rows: Array<{ glyph: string; label: string; value: number; color: string }> = [
    { glyph: '█', label: 'sys',      value: systemBase + compactionSummary, color: segColors.sys },
    { glyph: '▓', label: 'tools',    value: tools,                          color: segColors.tools },
    { glyph: '▒', label: 'history',  value: history,                        color: segColors.history },
    { glyph: '░', label: 'reserved', value: reserved,                       color: segColors.reserved },
    { glyph: '·', label: 'free',     value: free,                           color: segColors.free },
  ]

  const totalLabel = `${isEst ? '~' : ''}${fmt(displayTotal)} / ${fmt(modelLimit)} (${pct}%${isEst ? ' est' : ''})`

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header: total usage only */}
      <Box gap={2}>
        <Text color={theme.brand} bold>context</Text>
        <Text color={pct > 80 ? theme.error : pct > 50 ? theme.warning : theme.success}>
          {totalLabel}
        </Text>
      </Box>

      {/* Dot map - each segment colored */}
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {Array.from({ length: ROWS }, (_, r) => (
          <Text key={r}>
            {justReset
              ? <Text color={theme.success}>{dots.slice(r * COLS, (r + 1) * COLS)}</Text>
              : getRowSpans(r).map((span, i) => (
                  <Text key={i} color={span.color}>{span.text}</Text>
                ))
            }
          </Text>
        ))}
      </Box>

      {/* Stats table - each row is exactly COLS chars wide to match the dot map */}
      <Box flexDirection="column">
        {rows.map(({ glyph, label, value, color }) => {
          // glyph(1) + ' '(1) + label.padEnd(9)(9) + value.padStart(X) + ' '(1) + pct(4) = COLS
          // X = COLS - 16
          const valWidth = Math.max(9, COLS - 16)
          return (
            <Text key={label}>
              <Text color={color}>{glyph}</Text>
              <Text color={theme.inactive}> {label.padEnd(9)}</Text>
              <Text color={theme.text}>{fmt(value).padStart(valWidth)}</Text>
              <Text color={theme.inactive}> {pctOf(value)}</Text>
              {label === 'sys' && compactionSummary > 0
                ? <Text color={theme.inactive}> (compacted)</Text>
                : null}
            </Text>
          )
        })}
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        {justReset
          ? <Text color={theme.success} bold>  context cleared</Text>
          : <Text color={theme.inactive}>  <Text color={theme.brand} bold>r</Text> reset  <Text color={theme.inactive}>Enter/Esc</Text> close</Text>
        }
      </Box>
    </Box>
  )
}
