// /exit - close this pane. genome: ['nuc']

import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule, CommandContext } from './types.js'

function handleExit(_args: string, ctx: CommandContext): void {
  const { setState } = ctx
  addSystemMessage(setState, 'info', 'exiting...')
  setTimeout(() => process.exit(0), 300)
}

export const exitCommand: SlashCommandModule = {
  cmd: '/exit',
  desc: 'close this pane',
  genome: ['nuc'],
  handler: handleExit,
}
