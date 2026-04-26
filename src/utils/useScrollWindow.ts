// useScrollWindow - shared scroll window calculation for all list pickers.
// Keeps the selected item centered in view; identical behavior across all TUI panes.

export type ScrollWindow<T> = {
  visibleItems: T[]
  windowStart: number
  windowEnd: number
  scrolledAbove: boolean
  scrolledBelow: boolean
  /** Convert a visible-slice index back to the global list index */
  globalIdx: (sliceIndex: number) => number
}

export function useScrollWindow<T>(
  items: T[],
  selectedIdx: number,
  maxVisible: number,
): ScrollWindow<T> {
  const clamped = Math.min(selectedIdx, Math.max(0, items.length - 1))
  const safeMax = Math.max(1, maxVisible)

  // Center the selected item; clamp to valid range
  const windowStart = Math.max(
    0,
    Math.min(clamped - Math.floor(safeMax / 2), items.length - safeMax),
  )
  const windowEnd = Math.min(items.length, windowStart + safeMax)

  return {
    visibleItems: items.slice(windowStart, windowEnd),
    windowStart,
    windowEnd,
    scrolledAbove: windowStart > 0,
    scrolledBelow: windowEnd < items.length,
    globalIdx: (i: number) => windowStart + i,
  }
}
