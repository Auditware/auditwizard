// /help - show all active commands. genome: ['nuc']

import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule, CommandContext } from './types.js'

export function buildHelpCommand(allCommands: () => SlashCommandModule[]): SlashCommandModule {
  return {
    cmd: '/help',
    desc: 'show all commands',
    genome: ['nuc'],
    handler: (_args: string, ctx: CommandContext) => {
      const { setState } = ctx
      const cmds = allCommands()
      const cmdWidth = Math.max(...cmds.map(c => (c.usage ?? c.cmd).length)) + 2
      addSystemMessage(setState, 'info', '-- Commands ------------------------------------------')
      for (const c of cmds) {
        const label = (c.usage ?? c.cmd).padEnd(cmdWidth)
        const suffix = c.shortcut ? `  [${c.shortcut}]` : ''
        addSystemMessage(setState, 'list', `${label}${c.desc}${suffix}`)
      }
      const shortcuts = cmds
        .filter(c => c.shortcut)
        .map(c => `${c.shortcut} ${c.cmd.slice(1)}`)
        .join('   ')
      addSystemMessage(setState, 'info', '-- Shortcuts -----------------------------------------')
      addSystemMessage(setState, 'list', `Ctrl+Q quit${shortcuts ? '   ' + shortcuts : ''}`)
    },
  }
}
