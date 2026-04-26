// Central resolver for the ~/.agents base directory.
// Override with AGENTS_HOME env var if needed.

import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'

export function agentsDir(...parts: string[]): string {
  const base = process.env['AGENTS_HOME'] ?? join(homedir(), '.agents')
  return parts.length ? join(base, ...parts) : base
}

export function ensureAgentsDir(...parts: string[]): string {
  const p = agentsDir(...parts)
  mkdirSync(p, { recursive: true })
  return p
}
