// Session-scoped interval task store.
// Tasks live in memory only - they die when the process exits.
// No cron expressions: tasks store intervalMs + nextFireAt for true
// "every N minutes from now" semantics (not wall-clock alignment).

import { randomUUID } from 'crypto'

export type IntervalTask = {
  id: string
  intervalMs: number
  prompt: string
  createdAt: number
  nextFireAt: number
  fireCount: number
  lastFiredAt?: number
}

const tasks = new Map<string, IntervalTask>()

export function addIntervalTask(intervalMs: number, prompt: string): string {
  const id = randomUUID().slice(0, 8)
  const now = Date.now()
  tasks.set(id, { id, intervalMs, prompt, createdAt: now, nextFireAt: now + intervalMs, fireCount: 0 })
  return id
}

export function listIntervalTasks(): IntervalTask[] {
  return Array.from(tasks.values())
}

export function removeIntervalTask(id: string): boolean {
  return tasks.delete(id)
}

// After a task fires, advance next-fire time and record stats.
export function advanceIntervalTask(id: string): void {
  const task = tasks.get(id)
  if (!task) return
  task.lastFiredAt = Date.now()
  task.fireCount += 1
  task.nextFireAt = Date.now() + task.intervalMs
}

// Update interval or prompt for an existing task.
export function updateIntervalTask(id: string, patch: Partial<Pick<IntervalTask, 'intervalMs' | 'prompt'>>): boolean {
  const task = tasks.get(id)
  if (!task) return false
  if (patch.intervalMs !== undefined) {
    task.intervalMs = patch.intervalMs
    task.nextFireAt = Date.now() + patch.intervalMs
  }
  if (patch.prompt !== undefined) task.prompt = patch.prompt
  return true
}

export function getDueTasks(now = Date.now()): IntervalTask[] {
  return Array.from(tasks.values()).filter(t => now >= t.nextFireAt)
}

export function formatInterval(ms: number): string {
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  return `${Math.round(ms / 60_000)}m`
}

// Parse "5m", "2h", "1d" -> ms. Returns null for invalid or zero values.
export function parseInterval(token: string): number | null {
  const match = token.match(/^(\d+(?:\.\d+)?)(m|h|d)$/)
  if (!match) return null
  const n = parseFloat(match[1]!)
  if (n <= 0) return null
  const multiplier = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd']!
  return Math.round(n * multiplier)
}

export function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
