// /every command - schedule a recurring prompt on an interval.
// genome: ['nuc']
//
// Usage:
//   /every 5m check the deploy
//   /every 2h run the smoke tests
//   /every list
//   /every cancel <id>
//
// Intervals: Nm (minutes), Nh (hours), Nd (days). Minimum 1 minute.
// Fires immediately on creation, then repeats every interval from that point.

import { addSystemMessage } from '../app/AppState.js'
import {
  addIntervalTask,
  listIntervalTasks,
  removeIntervalTask,
  formatInterval,
  parseInterval,
} from '../utils/intervalTasks.js'
import type { SlashCommandModule } from './types.js'

const USAGE = 'Usage: /every <interval> <prompt>  (e.g. /every 5m check the deploy)\n       /every list\n       /every cancel <id>'

export const everyCommand: SlashCommandModule = {
  cmd: '/every',
  desc: 'schedule a recurring prompt',
  usage: '/every <interval> <prompt>',
  genome: ['nuc'],
  async handler(args, ctx) {
    const trimmed = args.trim()

    // /every list
    if (trimmed === 'list') {
      const all = listIntervalTasks()
      if (all.length === 0) {
        addSystemMessage(ctx.setState, 'info', 'No scheduled tasks.')
        return
      }
      for (const t of all) {
        const secsUntil = Math.max(0, Math.round((t.nextFireAt - Date.now()) / 1000))
        const nextLabel = secsUntil < 60 ? `${secsUntil}s` : `${Math.round(secsUntil / 60)}m`
        addSystemMessage(ctx.setState, 'info',
          `[${t.id}] every ${formatInterval(t.intervalMs)} · next in ${nextLabel} · ${t.prompt}`
        )
      }
      return
    }

    // /every cancel <id>
    const cancelMatch = trimmed.match(/^cancel\s+(\S+)$/)
    if (cancelMatch) {
      const id = cancelMatch[1]!
      const ok = removeIntervalTask(id)
      addSystemMessage(ctx.setState, ok ? 'info' : 'error', ok ? `Cancelled ${id}.` : `No task with id '${id}'.`)
      return
    }

    // /every [interval] <prompt> or /every <prompt> every [interval]
    if (!trimmed) {
      ctx.setState(prev => ({ ...prev, mode: 'every' }))
      return
    }

    let intervalMs: number | null = null
    let prompt: string

    // Rule 1: leading interval token
    const parts = trimmed.split(/\s+/)
    const leadInterval = parseInterval(parts[0]!)
    if (leadInterval !== null && parts.length >= 2) {
      intervalMs = leadInterval
      prompt = parts.slice(1).join(' ')
    } else {
      // Rule 2: trailing "every N<unit>" clause
      const trailingMatch = trimmed.match(/^(.+?)\s+every\s+(\d+(?:\.\d+)?[mhd])\s*$/i)
      if (trailingMatch) {
        const parsed = parseInterval(trailingMatch[2]!)
        if (parsed !== null) {
          intervalMs = parsed
          prompt = trailingMatch[1]!.trim()
        } else {
          prompt = trimmed
        }
      } else {
        prompt = trimmed
      }
    }

    if (!prompt) {
      addSystemMessage(ctx.setState, 'info', USAGE)
      return
    }

    if (intervalMs === null) {
      addSystemMessage(ctx.setState, 'error', `Invalid interval. Use: 1m, 30m, 2h, 1d (minimum 1 minute)\n${USAGE}`)
      return
    }

    const id = addIntervalTask(intervalMs, prompt)
    addSystemMessage(ctx.setState, 'info',
      `Scheduled [${id}] every ${formatInterval(intervalMs)} · "${prompt}" · cancel: /every cancel ${id}`
    )

    // Fire immediately
    await ctx.submitToEngine?.(prompt)
  },
}
