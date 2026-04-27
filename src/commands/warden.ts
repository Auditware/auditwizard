// Warden command module - /warden opens the contest browser panel.
// Owns: dailyWardenTool (contest fetch) + pocTool (PoC execution)
// genome: ['rna'] - audit-wizard strain only.

import type { Tool } from '../agent/QueryEngine.js'
import type { SlashCommandModule } from './types.js'
import { fetchDailyWardenContests } from '../utils/wardenData.js'
import { pocTool } from '../utils/poc.js'

// ─── daily_warden agent tool ──────────────────────────────────────────────────

export const dailyWardenTool: Tool = {
  name: 'daily_warden',
  description: 'Fetch active and upcoming audit contests from dailywarden.com. Returns contest names, platforms, prizes, and dates.',
  input_schema: {
    type: 'object',
    properties: {
      include_upcoming: {
        type: 'boolean',
        description: 'Include upcoming contests that have not started yet (default: false)',
      },
    },
    required: [],
  },
  async execute(input) {
    try {
      const { active, upcoming, fetchedAt } = await fetchDailyWardenContests()
      const includeUpcoming = input['include_upcoming'] === true
      const lines: string[] = [`Fetched at: ${new Date(fetchedAt).toISOString()}`]

      lines.push(`\nActive contests (${active.length}):`)
      for (const c of active.length > 0 ? active : []) {
        const prize = c['potSize'] ? `  prize: ${c['potSize']}` : ''
        const end = typeof c['endDate'] === 'number' ? `  ends: ${new Date(c['endDate']).toLocaleDateString()}` : ''
        lines.push(`  [${c['platform'] ?? 'unknown'}] ${c['name']}${prize}${end}${c['url'] ? `  ${c['url']}` : ''}`)
      }
      if (active.length === 0) lines.push('  (none)')

      if (includeUpcoming) {
        lines.push(`\nUpcoming contests (${upcoming.length}):`)
        for (const c of upcoming.length > 0 ? upcoming : []) {
          const prize = c['potSize'] ? `  prize: ${c['potSize']}` : ''
          const start = typeof c['startDate'] === 'number' ? `  starts: ${new Date(c['startDate']).toLocaleDateString()}` : ''
          lines.push(`  [${c['platform'] ?? 'unknown'}] ${c['name']}${prize}${start}${c['url'] ? `  ${c['url']}` : ''}`)
        }
        if (upcoming.length === 0) lines.push('  (none)')
      }

      return lines.join('\n')
    } catch (err) {
      return `Error fetching DailyWarden data: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── /warden command ──────────────────────────────────────────────────────────

export const wardenCommands: SlashCommandModule[] = [
  {
    cmd: '/warden',
    desc: 'browse active audit contests from dailywarden.com',
    usage: '/warden',
    genome: ['rna'],
    tools: [dailyWardenTool, pocTool],
    handler(_args, ctx) {
      ctx.setState(prev => ({ ...prev, mode: 'warden' as import('../app/AppState.js').AppMode }))
    },
  },
]
