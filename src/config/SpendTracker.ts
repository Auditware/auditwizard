// SpendTracker - persists daily token usage to ~/.agents/spend.json
// Keyed by API key fingerprint (last 8 chars) so multiple keys are tracked independently.
// Tokens are stored per-model per-day so cost can be calculated at the correct rate.

import { readFileSync, writeFileSync } from 'fs'
import { agentsDir, ensureAgentsDir } from './agentsDir.js'
import { tokenCostUSD } from './pricing.js'

type DayEntry = { inputTokens: number; outputTokens: number }
// spend.json shape: { "<key-fingerprint>": { "YYYY-MM-DD": { "<model>": DayEntry } } }
// Older entries used { "YYYY-MM-DD": DayEntry } directly - migrated transparently on read.
type DayBucket = Record<string, DayEntry>      // model -> tokens
type SpendLog  = Record<string, Record<string, DayBucket>>

const SPEND_PATH = agentsDir('spend.json')

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function keyFingerprint(apiKey: string): string {
  return `...${apiKey.slice(-8)}`
}

// Transparently migrate old flat DayEntry to per-model bucket.
function toDayBucket(raw: unknown): DayBucket {
  if (raw && typeof raw === 'object' && 'inputTokens' in raw) {
    // Old format: { inputTokens, outputTokens } stored directly under date key.
    return { '': raw as DayEntry }
  }
  return (raw ?? {}) as DayBucket
}

function loadLog(): SpendLog {
  try {
    return JSON.parse(readFileSync(SPEND_PATH, 'utf8')) as SpendLog
  } catch {
    return {}
  }
}

function saveLog(log: SpendLog): void {
  ensureAgentsDir()
  writeFileSync(SPEND_PATH, JSON.stringify(log, null, 2))
}

export function recordTokens(inputTokens: number, outputTokens: number, apiKey?: string, model = ''): void {
  if ((inputTokens <= 0 && outputTokens <= 0) || !apiKey) return
  const log    = loadLog()
  const fp     = keyFingerprint(apiKey)
  const day    = today()
  const days   = log[fp] ?? {}
  const bucket = toDayBucket(days[day])
  const entry  = bucket[model] ?? { inputTokens: 0, outputTokens: 0 }
  bucket[model] = {
    inputTokens:  entry.inputTokens  + inputTokens,
    outputTokens: entry.outputTokens + outputTokens,
  }
  days[day] = bucket
  log[fp]   = days
  saveLog(log)
}

export function getSpendSummary(apiKey?: string): { today: number; month: number; currency: 'USD' } {
  if (!apiKey) return { today: 0, month: 0, currency: 'USD' }
  const log  = loadLog()
  const days = log[keyFingerprint(apiKey)] ?? {}
  const day  = today()
  const ym   = day.slice(0, 7)

  let todayUSD = 0
  let monthUSD = 0

  for (const [dateKey, rawBucket] of Object.entries(days)) {
    const bucket = toDayBucket(rawBucket)
    let dayCost = 0
    for (const [model, entry] of Object.entries(bucket)) {
      dayCost += tokenCostUSD(entry.inputTokens, entry.outputTokens, model)
    }
    if (dateKey === day)         todayUSD += dayCost
    if (dateKey.startsWith(ym))  monthUSD += dayCost
  }

  return { today: todayUSD, month: monthUSD, currency: 'USD' }
}
