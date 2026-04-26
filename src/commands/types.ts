// Command module types - composable slash command architecture.
// Each SlashCommandModule is a self-contained unit: metadata + handler + genome tags.

import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { AppState } from '../app/AppState.js'
import type { QueryEngine } from '../agent/QueryEngine.js'
import type { GenomePanelRegistry } from './GenomePanelRegistry.js'

// Context passed to every command handler at dispatch time.
export type CommandContext = {
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
  engineRef: MutableRefObject<QueryEngine>
  // Panel opener registry - genome modules register their panels here.
  // Commands open panels by semantic name; absent genomes are no-ops.
  panels: GenomePanelRegistry
  // Submit a message to the agent engine (handles full UI flow)
  submitToEngine?: (text: string) => Promise<void>
  // Active genome filter (null = all commands available)
  genomeFilter: string[] | null
}

// A composable slash command unit.
export type SlashCommandModule = {
  cmd: string       // e.g. '/sessions'
  desc: string
  usage?: string    // shown in /help, e.g. '/help'
  shortcut?: string // keyboard shortcut label, e.g. 'Ctrl+S'
  genome: string[]  // genome group tags this command belongs to
  handler: (args: string, ctx: CommandContext) => void | Promise<void>
}

// Known genome groups - any custom genome tags are also valid strings.
export const GENOME_GROUPS = ['nuc', 'mem', 'rna', 'div'] as const
export type GenomeGroup = typeof GENOME_GROUPS[number]
