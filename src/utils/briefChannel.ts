// briefChannel - EventEmitter bridge for brief tool → App.tsx notification display.
// Brief events are ephemeral UI notifications; they are NOT persisted to session storage.

import { EventEmitter } from 'events'

export type BriefEvent = {
  message: string
  status: 'normal' | 'proactive'
  timestamp: string
}

const emitter = new EventEmitter()

export const briefChannel = {
  send(message: string, status: 'normal' | 'proactive' = 'normal'): void {
    const event: BriefEvent = {
      message,
      status,
      timestamp: new Date().toISOString(),
    }
    emitter.emit('brief', event)
  },

  onBrief(handler: (event: BriefEvent) => void): () => void {
    emitter.on('brief', handler)
    return () => emitter.off('brief', handler)
  },
}
