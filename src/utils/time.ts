// Time formatting utilities - no imports needed.

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: formatDuration(150000) => '2m 30s', formatDuration(5000) => '5s'
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    const parts = [`${hours}h`, `${minutes}m`]
    if (seconds > 0) parts.push(`${seconds}s`)
    return parts.join(' ')
  }
  if (minutes > 0) {
    const parts = [`${minutes}m`]
    if (seconds > 0) parts.push(`${seconds}s`)
    return parts.join(' ')
  }
  return `${seconds}s`
}

/**
 * Format a Unix timestamp (ms) to a relative "ago" string.
 * Examples: formatAgo(Date.now() - 180000) => '3m ago', formatAgo(Date.now() - 90000) => '1m ago'
 */
export function formatAgo(ts: number): string {
  const diffMs = Date.now() - ts
  if (diffMs < 0) return 'just now'

  const totalSeconds = Math.floor(diffMs / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  if (totalSeconds < 60) return `${totalSeconds}s ago`
  if (totalMinutes < 60) return `${totalMinutes}m ago`
  if (totalHours < 24) return `${totalHours}h ago`
  return `${totalDays}d ago`
}
