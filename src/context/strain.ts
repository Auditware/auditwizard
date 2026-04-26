// Nuc-owned strain config primitives.
// Reading the local .strain.json is nuc-level infrastructure - strains
// need to know their own identity without loading additional genomes.
// Strain management (init, graduate, discard, list) stays in src/strains/StrainManager.ts.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type StrainConfig = {
  name: string
  banner: string
  subtitle: string
  speech?: string[]
  genome: string[]
  systemPrompt: string
  graduatedUrl?: string
  // Skills to pre-install and load on startup (but not auto-invoked into context).
  // Same format as the 'a' add-skill input: owner/repo[@sha], owner/repo/subpath[@sha], or /local/path
  defaultSkills?: string[]
}

const STRAIN_CONFIG_FILE = '.strain.json'
const STRAIN_CONFIG_FILE_LEGACY = '.audit-wizard-strain.json'

export function readStrainConfig(worktreePath: string): StrainConfig | null {
  try {
    const p = join(worktreePath, STRAIN_CONFIG_FILE)
    const legacyP = join(worktreePath, STRAIN_CONFIG_FILE_LEGACY)
    const target = existsSync(p) ? p : existsSync(legacyP) ? legacyP : null
    if (!target) return null
    return JSON.parse(readFileSync(target, 'utf8')) as StrainConfig
  } catch { return null }
}
