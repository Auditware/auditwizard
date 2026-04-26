import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { formatPath } from '../utils/stringWidth.js'
import { useAppState } from '../app/AppState.js'
import { theme } from '../app/theme.js'
import { tokenCostUSD } from '../config/pricing.js'

// Max context window by model (tokens)
const MODEL_CONTEXT: Record<string, number> = {
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
}
const DEFAULT_CTX = 200_000

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}t`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

export default function StatusLine(): React.ReactElement {
  const { state } = useAppState()
  const { stdout } = useStdout()
  const cols = (stdout?.columns ?? 80) - 4

  const model = state.model
  const ctxMax = MODEL_CONTEXT[model] ?? DEFAULT_CTX
  const ctxPct = Math.min(99, Math.round((state.lastInputTokens / ctxMax) * 100))

  const cost = tokenCostUSD(state.sessionInputTokens, state.sessionOutputTokens, model)
  const costStr = fmtCost(cost)

  const ctxColor = ctxPct === 0 ? theme.subtle
    : ctxPct > 80 ? theme.error
    : ctxPct > 50 ? theme.warning
    : theme.subtle

  // Build right segment
  const right: string[] = []
  if (state.isCompacting) right.push('⟳ compacting')
  right.push(`ctx ${ctxPct}%`)
  right.push(fmtTokens(state.sessionTokens))
  right.push(costStr)
  right.push(model)
  const rightStr = right.join('  ·  ')

  const pathBudget = Math.max(4, cols - rightStr.length - 2)
  const path = formatPath(state.cwd, pathBudget)

  return (
    <Box paddingX={1} width={cols + 2}>
      <Box flexGrow={1} gap={1}>
        <Text dimColor wrap="truncate">{path}</Text>
      </Box>
      <Text dimColor>{'  '}</Text>
      {state.isCompacting && (
        <Text color={theme.brand}>{'⟳ compacting  ·  '}</Text>
      )}
      <Text color={ctxColor}>{`ctx ${ctxPct}%`}<Text dimColor>{'  ·  '}</Text></Text>
      <Text dimColor>{fmtTokens(state.sessionTokens)}<Text dimColor>{'  ·  '}</Text></Text>
      <Text dimColor>{costStr}<Text dimColor>{'  ·  '}</Text></Text>
      <Text dimColor>{model}</Text>
    </Box>
  )
}
 