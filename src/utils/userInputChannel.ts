// userInputChannel - lets the ask_user tool pause mid-turn and wait for human input.
// Uses a request-ID map so concurrent sub-agents never cross-wire answers.

import { EventEmitter } from 'events'

export type PendingQuestion = {
  requestId: string
  question: string
  options?: string[]
}

class UserInputChannel extends EventEmitter {
  private pending = new Map<string, {
    question: string
    options?: string[]
    resolve: (answer: string) => void
    reject: (err: Error) => void
  }>()

  ask(question: string, options?: string[]): Promise<string> {
    const requestId = crypto.randomUUID()
    return new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, { question, options, resolve, reject })
      this.emit('question', { requestId, question, options } as PendingQuestion)
    })
  }

  getFirst(): PendingQuestion | null {
    const iter = this.pending.entries().next()
    if (iter.done) return null
    const [requestId, { question, options }] = iter.value
    return { requestId, question, options }
  }

  answer(requestId: string, answer: string): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    this.pending.delete(requestId)
    entry.resolve(answer)
    this.emit('answered', requestId)
    return true
  }

  cancel(requestId: string): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    entry.reject(new Error('Cancelled'))
    this.emit('cancelled', requestId)
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.cancel(id)
    }
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }
}

export const userInputChannel = new UserInputChannel()
