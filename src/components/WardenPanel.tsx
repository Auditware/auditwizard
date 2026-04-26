// WardenPanel - interactive contest browser for dailywarden.com.
// ↑↓ navigate  Enter open in browser  u toggle upcoming  Esc close

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { spawnSync } from 'child_process'
import { theme } from '../app/theme.js'
import { SlashPicker } from './SlashPicker.js'
import { fetchDailyWardenContests, type Contest } from '../utils/wardenData.js'

type Props = {
  height: number
  cols: number
  onClose: () => void
}

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawnSync(cmd, [url])
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysLeftColor(ms: number, isUpcoming: boolean): string {
  if (isUpcoming) return '#a78bfa'  // purple - not started
  const d = Math.ceil((ms - Date.now()) / 86_400_000)
  if (d <= 1) return '#f87171'      // red
  if (d <= 3) return '#fb923c'      // orange
  return '#4ade80'                  // green
}

export default function WardenPanel({ height, cols, onClose }: Props): React.ReactElement {
  const [active, setActive] = useState<Contest[]>([])
  const [upcoming, setUpcoming] = useState<Contest[]>([])
  const [showUpcoming, setShowUpcoming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    fetchDailyWardenContests()
      .then(({ active: a, upcoming: u, fetchedAt: ts }) => {
        setActive(a)
        setUpcoming(u)
        setFetchedAt(ts)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  const items = showUpcoming ? [...active, ...upcoming] : active

  useInput(useCallback((input: string, key: import('ink').Key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onClose(); return }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(items.length - 1, c + 1)); return }
    if (input === 'u' || input === 'U') { setShowUpcoming(v => !v); setCursor(0); return }
    if (key.return) {
      const contest = items[cursor]
      if (contest?.['url']) openUrl(contest['url'] as string)
      return
    }
  }, [items, cursor, onClose]))

  if (loading) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={theme.inactive}>Fetching contests from dailywarden.com...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column" gap={1}>
        <Text color={theme.error}>Failed to fetch contests: {error}</Text>
        <Text color={theme.inactive}>Esc close</Text>
      </Box>
    )
  }

  const titleRight = fetchedAt ? (
    <Text color={theme.inactive}>
      {active.length} active{showUpcoming ? `  ${upcoming.length} upcoming` : ''}
      {'  '}{new Date(fetchedAt).toLocaleTimeString()}
    </Text>
  ) : undefined

  return (
    <SlashPicker
      items={items}
      selected={cursor}
      getKey={c => String(c['url'] ?? c['name'])}
      height={height}
      cols={cols}
      accentColor={theme.brand}
      emptyText={showUpcoming ? 'No contests found' : 'No active contests  (u to show upcoming)'}
      hintText={`↑↓ navigate  Enter open  u ${showUpcoming ? 'hide' : 'show'} upcoming  Esc close`}
      variant="inline"
      title="Warden"
      titleRight={titleRight}
      renderRow={(contest, isActive, innerCols) => {
        const platform = `[${contest['platform'] ?? '?'}]`

        const prize = contest['potSize'] ? String(contest['potSize']) : ''
        const PRIZE_W = 20
        const prizeTrunc = prize.length > PRIZE_W ? prize.slice(0, PRIZE_W - 2) + '..' : prize

        const isUpcoming = active.indexOf(contest) === -1
        const DATE_W = 11
        const dateTs = typeof contest['endDate'] === 'number'
          ? contest['endDate'] as number
          : typeof contest['startDate'] === 'number'
            ? contest['startDate'] as number
            : null

        const d = dateTs !== null ? Math.ceil((dateTs - Date.now()) / 86_400_000) : null
        const dateLabel = dateTs !== null
          ? isUpcoming
            ? `starts ${formatDate(dateTs)}`
            : d !== null && d <= 0 ? 'ends today' : `${d}d left`
          : ''
        const dateColor = dateTs !== null ? daysLeftColor(dateTs, isUpcoming) : '#6b7280'

        // name takes remaining space; -3 for cursor+gap SlashPicker adds outside innerCols; -3 for gap={1} between 4 cols
        const nameAvail = Math.max(8, innerCols - 10 - 20 - 11 - 6 - 3)
        const name = String(contest['name'] ?? '')
        const nameTrunc = name.length > nameAvail ? name.slice(0, nameAvail - 2) + '..' : name

        const nameColor = isActive ? theme.text : theme.inactive

        return (
          <Box flexDirection="row" gap={1}>
            <Box width={10}><Text color={theme.subtle} dimColor wrap="truncate">{platform}</Text></Box>
            <Box width={nameAvail}><Text color={nameColor} bold={isActive && !isUpcoming} wrap="truncate">{nameTrunc}</Text></Box>
            <Box width={PRIZE_W}><Text color={isActive ? theme.brand : theme.subtle} wrap="truncate">{prizeTrunc}</Text></Box>
            <Box width={DATE_W}><Text color={dateColor} wrap="truncate">{dateLabel}</Text></Box>
          </Box>
        )
      }}
    />
  )
}
