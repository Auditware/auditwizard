// Unified agent discovery - wraps listOnline() with a consistent ReachableAgent type.
// audit-wizard has no strains or children, so only online (heartbeating) agents are returned.

import { listOnline } from './mailbox.js'

export type ReachableAgent = {
  session: string
  status: 'idle' | 'busy' | 'offline'
  updatedAt: number
  rootDir?: string
  kind: 'online' | 'strain' | 'child'
}

export function listReachableAgents(excludeSelf?: string): ReachableAgent[] {
  return listOnline(excludeSelf).map(a => ({ ...a, kind: 'online' as const }))
}
