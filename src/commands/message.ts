// /message command - open the agent message panel or send directly.
// Bare /message opens the picker panel (agent list → compose).
// /message <session> <text> sends immediately without opening the panel.

import { sendMessage } from '../utils/mailbox.js'
import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule } from './types.js'

export const messageCommands: SlashCommandModule[] = [
  {
    cmd: '/message',
    desc: 'send a message to another agent session',
    usage: '/message [<session> <text>]',
    genome: ['nuc'],
    handler: (args, ctx) => {
      const { state, setState } = ctx
      const trimmed = args.trim()

      // Bare /message - open the panel picker
      if (!trimmed) {
        setState(prev => ({ ...prev, mode: 'message-picker' as const }))
        return
      }

      // /message <session> <text> - send directly
      const spaceIdx = trimmed.indexOf(' ')
      if (spaceIdx === -1 || !trimmed.slice(spaceIdx + 1).trim()) {
        addSystemMessage(setState, 'error', 'usage: /message <session> <text>')
        return
      }
      const target = trimmed.slice(0, spaceIdx).trim()
      const content = trimmed.slice(spaceIdx + 1).trim()
      sendMessage(target, state.sessionName, content)
      addSystemMessage(setState, 'info', `→ ${target}: ${content}`)
    },
  },
]
