// /ctx - context window breakdown by segment. genome: ['nuc']
// Subcommands:
//   /ctx reset - reset AI conversation context (clears transcript + compaction cache)

import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule, CommandContext } from './types.js'

function handleCtxReset(ctx: CommandContext): void {
  const { setState, engineRef } = ctx
  
  // Reset the AI transcript (conversation history sent to the API)
  engineRef.current.resetTranscript()
  
  // Also reset the compaction cache since we're starting fresh
  engineRef.current.resetCompactCache()
  
  // Clear display messages and show confirmation
  setState(prev => ({
    ...prev,
    messages: [{
      id: crypto.randomUUID(),
      role: 'system' as const,
      content: 'context reset - AI conversation cleared',
      notifType: 'success' as const,
      timestamp: Date.now(),
    }],
    lastInputTokens: 0,
  }))
}

function handleCtx(args: string, ctx: CommandContext): void {
  const subcommand = args.trim().toLowerCase()
  
  if (subcommand === 'reset') {
    handleCtxReset(ctx)
    return
  }
  
  // No subcommand - open interactive panel
  if (!subcommand) {
    ctx.setState(prev => ({ ...prev, mode: 'ctx' as const }))
    return
  }

  addSystemMessage(ctx.setState, 'error', `unknown subcommand: ${subcommand}`)
  addSystemMessage(ctx.setState, 'info', 'usage: /ctx [reset]')
}

export const ctxCommand: SlashCommandModule = {
  cmd: '/ctx',
  desc: 'context window breakdown by segment',
  usage: '/ctx [reset]',
  genome: ['nuc'],
  handler: handleCtx,
}
