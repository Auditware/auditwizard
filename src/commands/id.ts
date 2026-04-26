// /id - show session identity. genome: ['nuc']

import { addSystemMessage, appendMessage } from '../app/AppState.js'
import type { SlashCommandModule, CommandContext } from './types.js'
import { GENOME_GROUPS } from './types.js'

function handleId(_args: string, ctx: CommandContext): void {
  const { state, setState } = ctx
  addSystemMessage(setState, 'progress', 'identity')
  appendMessage(setState, { role: 'system', content: `name\t${state.instanceName}`, notifType: 'kv' })
  appendMessage(setState, { role: 'system', content: `cwd\t${state.cwd}`, notifType: 'kv' })
  const genome = ctx.genomeFilter ?? state.genome
  const genomeStr = genome ? genome.join('_') : GENOME_GROUPS.join('_')
  appendMessage(setState, { role: 'system', content: `genome\t${genomeStr}`, notifType: 'kv' })
}

export const idCommand: SlashCommandModule = {
  cmd: '/id',
  desc: 'show session identity',
  genome: ['nuc'],
  handler: handleId,
}
