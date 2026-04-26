import React, { useState, useRef, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { getSpendSummary } from '../config/SpendTracker.js'

type Props = {
  currentKey?: string   // masked hint if already set
  onSave: (key: string) => void
  onCancel: () => void
}

function fmtUSD(usd: number): string {
  if (usd < 0.001) return '$0.00'
  if (usd < 0.01)  return `$${usd.toFixed(3)}`
  if (usd < 1)     return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

export default function ApiKeyInput({ currentKey, onSave, onCancel }: Props): React.ReactElement {
  const [value, setValue] = useState('')
  const readyRef = useRef(false)

  const spend = getSpendSummary(currentKey)

  useEffect(() => {
    const t = setTimeout(() => { readyRef.current = true }, 100)
    return () => clearTimeout(t)
  }, [])

  const hint = currentKey
    ? `current: ••••••••${currentKey.slice(-4)}`
    : 'not set'

  useInput((input, key) => {
    if (!readyRef.current) return
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return }
    if (key.return) {
      if (value.trim()) onSave(value.trim())
      return
    }
    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta) return
    setValue(v => v + input)
  })

  const masked = '•'.repeat(value.length)
  const monthLabel = new Date().toLocaleString('default', { month: 'long' })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.brand}
      paddingX={2}
      paddingY={1}
      marginX={1}
      gap={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={theme.brand} bold>API Key</Text>
        <Text color={theme.inactive}>({hint})</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color={theme.inactive}>❯</Text>
        <Text color={theme.text}>{masked || ' '}</Text>
        <Text color={theme.brand}>█</Text>
      </Box>
      <Text color={theme.subtle} dimColor>Enter to save · Esc to cancel</Text>
      <Box flexDirection="row" gap={3} marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={theme.inactive} dimColor>today</Text>
          <Text color={theme.text}>{fmtUSD(spend.today)}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={theme.inactive} dimColor>{monthLabel}</Text>
          <Text color={theme.text}>{fmtUSD(spend.month)}</Text>
        </Box>
      </Box>
    </Box>
  )
}
