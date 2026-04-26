// Session/model/API-key command modules.
// genome: ['mem']

import type { SlashCommandModule } from './types.js'

export const sessionCommands: SlashCommandModule[] = [
  {
    cmd: '/sessions',
    desc: 'browse & switch sessions',
    shortcut: 'Ctrl+S',
    genome: ['mem'],
    handler: (_args, ctx) => {
      ctx.setState(prev => ({ ...prev, mode: 'session', inputValue: '' }))
    },
  },
  {
    cmd: '/model',
    desc: 'switch model',
    genome: ['mem'],
    handler: (_args, ctx) => {
      ctx.setState(prev => ({ ...prev, mode: 'model-picker' as const }))
    },
  },
  {
    cmd: '/api-key',
    desc: 'set API key',
    genome: ['mem'],
    handler: (_args, ctx) => {
      ctx.setState(prev => ({ ...prev, mode: 'api-key-input' as const }))
    },
  },
]
