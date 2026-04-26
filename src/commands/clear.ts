// /clear - clear chat history. genome: ['nuc']

import type { SlashCommandModule, CommandContext } from './types.js'

function handleClear(_args: string, ctx: CommandContext): void {
  ctx.setState(prev => ({
    ...prev,
    messages: [{
      id: crypto.randomUUID(),
      role: 'system' as const,
      content: 'chat cleared',
      notifType: 'info' as const,
      timestamp: Date.now(),
    }],
  }))
}

export const clearCommand: SlashCommandModule = {
  cmd: '/clear',
  desc: 'clear chat history',
  genome: ['nuc'],
  handler: handleClear,
}
