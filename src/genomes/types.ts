// Genome module system - each genome is a self-contained feature module.
// App.tsx mounts only active genomes; inactive genome folders are deleted on graduation.

import type React from 'react'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { AppState } from '../app/AppState.js'
import type { QueryEngine } from '../agent/QueryEngine.js'
import type { GenomePanelRegistry } from '../commands/GenomePanelRegistry.js'
import type { SlashCommandModule } from '../commands/types.js'

// Props passed to the welcomeContent render callback provided by a genome.
export type WelcomeContentProps = {
  isPetting: boolean
  onPetEnd: () => void
  identityName: string
  topClip: number
}

// Props passed to every genome's PanelComponent.
// The component owns its genome-specific state (useState internally) and
// registers its panel openers into the shared registry each render.
export type GenomePanelProps = {
  registry: GenomePanelRegistry
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
  // Ref to state snapshot - use when you need the current state at callback time
  // (avoids stale closure captures in async event handlers).
  stateRef: MutableRefObject<AppState>
  engineRef: MutableRefObject<QueryEngine>
  termCols: number
  activeCommands: SlashCommandModule[]
  // All registered genome modules - passed for operations that need the full list (e.g. pruning).
  allGenomes: GenomeModule[]
  // Returns the pixel height for a panel given whether it is currently active.
  panelSize: (active: boolean, minH?: number) => number
}

// Context passed to a genome's onMount lifecycle hook.
export type GenomeMountContext = {
  engineRef: MutableRefObject<QueryEngine>
  setState: Dispatch<SetStateAction<AppState>>
}

// A self-contained genome feature module.
// Each genome folder exports one value implementing this interface.
export type GenomeModule = {
  // Genome identifier - must match the genome tag used in SlashCommandModule.genome[].
  readonly id: string
  // All slash commands provided by this genome.
  readonly commands: SlashCommandModule[]
  // React component that renders all panels for this genome.
  // Only mounted when the genome is active. Owns all genome-specific state.
  readonly PanelComponent?: React.ComponentType<GenomePanelProps>
  // Optional setup hook called once on App mount.
  // Return a cleanup function (called on unmount).
  readonly onMount?: (ctx: GenomeMountContext) => () => void
  // Source directories owned by this genome (relative to repo root).
  // Deleted when genome is pruned at strain init.
  readonly srcDirs?: string[]
  // Command files owned by this genome (relative to src/commands/).
  // Deleted when genome is pruned at strain init.
  readonly commandFiles?: string[]
  // Test files owned by this genome (relative to src/__tests__/).
  // Deleted when genome is pruned at strain init.
  readonly testFiles?: string[]
  // Source files owned by this genome (relative to src/).
  // Deleted when genome is pruned at strain init.
  readonly srcFiles?: string[]
  // Root-level files owned by this genome (relative to repo root).
  // Deleted when genome is pruned at strain init.
  readonly rootFiles?: string[]
  // Optional startup notification message.
  // Called once on App mount; return value shown as an 'info' system message.
  // Returning null suppresses the notification.
  readonly startupMessage?: (ctx: { strainName?: string; strainSpeech?: string[] }) => string | null
  // Optional welcome-banner content rendered in MessageHistory.
  // Called with current companion state + topClip offset; returns a ReactNode.
  readonly welcomeContent?: (props: WelcomeContentProps) => import('react').ReactNode
  // Total row height of the welcome banner for virtual-scroll math.
  // Must stay in sync with what welcomeContent + the nuc banner rows actually render.
  readonly welcomeHeight?: (hasMessages: boolean) => number
  // Returns initial child entries for AppState hydration at startup.
  // Only divGenome provides a real implementation; others return [].
  readonly getInitialChildren?: () => Array<{ slug: string; spawnedAt: number }>
}
