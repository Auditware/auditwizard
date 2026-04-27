// /ctx - context window breakdown by segment. genome: ['nuc']
// Subcommands:
//   /ctx c     - compact context now (manual trigger)
//   /ctx reset - reset AI conversation context (clears transcript + compaction cache)

import { addSystemMessage } from '../app/AppState.js'
import type { SlashCommandModule, CommandContext } from './types.js'

function handleCtxReset(ctx: CommandContext): void {
  const { setState, engineRef } = ctx
  
  engineRef.current.resetTranscript()
  engineRef.current.resetCompactCache()
  
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
    contextPressure: 'none',
  }))
}

function handleCtx(args: string, ctx: CommandContext): void {
  const subcommand = args.trim().toLowerCase()
  
  if (subcommand === 'reset') {
    handleCtxReset(ctx)
    return
  }

  if (subcommand === 'c') {
    void ctx.engineRef.current.compactNow(ctx.state, ctx.setState)
    return
  }
  
  if (!subcommand) {
    ctx.setState(prev => ({ ...prev, mode: 'ctx' as const }))
    return
  }

  addSystemMessage(ctx.setState, 'error', `unknown subcommand: ${subcommand}`)
  addSystemMessage(ctx.setState, 'info', 'usage: /ctx [c|reset]')
}

export const ctxCommand: SlashCommandModule = {
  cmd: '/ctx',
  desc: 'context window breakdown by segment',
  usage: '/ctx [c|reset]',
  genome: ['nuc'],
  handler: handleCtx,
}
