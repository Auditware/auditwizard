// Skills command module.
// genome: ['rna']

import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule } from './types.js'

export const skillsCommands: SlashCommandModule[] = [
  {
    cmd: '/skills',
    desc: 'manage loaded skills',
    shortcut: 'Ctrl+K',
    genome: ['rna'],
    handler: (_args, ctx) => {
      ctx.panels.open('skills')
      ctx.setState(prev => ({ ...prev, mode: 'skill-picker' as const }))
    },
  },
]
