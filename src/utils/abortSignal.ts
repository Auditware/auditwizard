// Global abort signal - fires when the user presses Ctrl+C during an in-flight request.
// Wired in cli.tsx at the raw stdin level so it fires immediately, bypassing Ink's
// render cycle and any useInput priority ordering.

import { EventEmitter } from 'events'

export const globalAbortEmitter = new EventEmitter()

/** Reflects current streaming state - updated by App.tsx via setGlobalStreaming(). */
export let isGlobalStreaming = false
export function setGlobalStreaming(v: boolean): void { isGlobalStreaming = v }

/** Call this from cli.tsx when raw \x03 byte is received while streaming. */
export function emitGlobalAbort(): void {
  globalAbortEmitter.emit('abort')
}

/** Register a handler to be called on Ctrl+C abort. Returns a cleanup fn. */
export function onGlobalAbort(handler: () => void): () => void {
  globalAbortEmitter.on('abort', handler)
  return () => globalAbortEmitter.off('abort', handler)
}
