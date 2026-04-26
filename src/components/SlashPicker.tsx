// SlashPicker - generic composable picker used by all slash commands.
// Owns: scroll window, ↑/↓ indicators, ❯ cursor, empty state, hints row, border.
// Callers provide: items, renderRow, colors, text.

import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../app/theme.js'
import { useScrollWindow } from '../utils/useScrollWindow.js'

export type SlashPickerProps<T> = {
  items: T[]
  selected: number
  getKey: (item: T) => string
  renderRow: (item: T, isActive: boolean, innerCols: number) => React.ReactElement  // innerCols = usable width inside gutter
  height: number        // available rows for this picker (used to compute maxVisible)
  cols: number          // terminal width
  accentColor: string   // cursor + border color
  emptyText: string
  hintText?: string     // omit to hide hint row
  hintColor?: string    // override hint text color (default: theme.subtle)
  // 'overlay' = round border full-width box (sessions, model picker)
  // 'inline'  = no border, renders list directly
  variant?: 'overlay' | 'inline'
  title?: string        // optional header label (inline variant)
  titleRight?: React.ReactElement // optional right side of title row
}

export function SlashPicker<T>({
  items,
  selected,
  getKey,
  renderRow,
  height,
  cols,
  accentColor,
  emptyText,
  hintText,
  hintColor,
  variant = 'overlay',
  title,
  titleRight,
}: SlashPickerProps<T>): React.ReactElement {
  const hasHints = Boolean(hintText)
  const hasTitle = Boolean(title)

  // chrome = border/padding(4 for overlay, 2 for inline) + title(2 if present) + hints(2 if present)
  const baseChromeRows = variant === 'overlay' ? 4 : 2
  const CHROME_ROWS = baseChromeRows + (hasTitle ? 2 : 0) + (hasHints ? 2 : 0)
  const maxVisible = Math.max(2, height - CHROME_ROWS)

  const { visibleItems, windowStart, windowEnd, scrolledAbove, scrolledBelow, globalIdx } =
    useScrollWindow(items, selected, maxVisible)

  // inner content width after box chrome: marginX(2)+border(2)+padding(2) for overlay, paddingX(2) for inline
  const innerCols = variant === 'overlay' ? cols - 6 : cols - 2

  const list = (
    <Box flexDirection="column">
      {(title || titleRight) && (
        <Box gap={2} marginBottom={1}>
          {title && <Text color={accentColor} bold>{title}</Text>}
          {titleRight}
        </Box>
      )}

      {scrolledAbove && (
        <Box paddingX={1}>
          <Text color={theme.inactive} dimColor wrap="truncate">↑ {windowStart} more</Text>
        </Box>
      )}

      {items.length === 0
        ? (
          <Box paddingX={1}>
            <Text color={theme.inactive}>{emptyText}</Text>
          </Box>
        )
        : visibleItems.map((item, i) => {
          const gIdx = globalIdx(i)
          const isActive = gIdx === selected
          return (
            <Box key={getKey(item)} flexDirection="row" gap={2} paddingX={1}>
              <Text color={isActive ? accentColor : theme.inactive}>{isActive ? '❯' : ' '}</Text>
              {renderRow(item, isActive, innerCols)}
            </Box>
          )
        })
      }

      {scrolledBelow && (
        <Box paddingX={1}>
          <Text color={theme.inactive} dimColor wrap="truncate">↓ {items.length - windowEnd} more</Text>
        </Box>
      )}

      {hasHints && (
        <Box marginTop={1} paddingX={1}>
          <Text color={hintColor ?? theme.subtle}>{hintText}</Text>
        </Box>
      )}
    </Box>
  )

  if (variant === 'inline') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {list}
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={accentColor}
      marginX={1}
      padding={1}
      width={cols - 2}
    >
      {list}
    </Box>
  )
}
