// Command module index - assembles defaultRegistry from nuc (core) commands.
// Genome-specific commands (rna, mem, div) are declared in their genome modules
// and loaded into activeCommands via ALL_GENOMES in App.tsx.

import { defaultRegistry } from './registry.js'
import { clearCommand } from './clear.js'
import { idCommand } from './id.js'
import { ctxCommand } from './ctx.js'
import { exitCommand } from './exit.js'
import { buildHelpCommand } from './help.js'
import { everyCommand } from './every.js'
import { messageCommands } from './message.js'
import { tasksCommands } from './tasks.js'
import { wardenCommands } from './warden.js'

defaultRegistry.register(clearCommand)
defaultRegistry.register(idCommand)
defaultRegistry.register(ctxCommand)
defaultRegistry.register(exitCommand)
defaultRegistry.register(everyCommand)
messageCommands.forEach(c => defaultRegistry.register(c))
defaultRegistry.registerAll(tasksCommands)
defaultRegistry.registerAll(wardenCommands)

// /help needs the full list - register last
defaultRegistry.register(buildHelpCommand(() => defaultRegistry.getAll()))

export { defaultRegistry } from './registry.js'
export type { SlashCommandModule, CommandContext, GenomeGroup } from './types.js'
export { GENOME_GROUPS } from './types.js'
