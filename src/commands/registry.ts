// CommandRegistry - holds all registered SlashCommandModules and dispatches to them.
// The defaultRegistry singleton is populated at module load time by importing command modules.

import type { SlashCommandModule, CommandContext } from './types.js'

export class CommandRegistry {
  private modules: SlashCommandModule[] = []

  register(module: SlashCommandModule): void {
    this.modules.push(module)
  }

  registerAll(modules: SlashCommandModule[]): void {
    for (const m of modules) this.modules.push(m)
  }

  /** Remove a slash command by its cmd string. Used to unregister skill commands. */
  unregister(cmd: string): void {
    this.modules = this.modules.filter(m => m.cmd !== cmd)
  }

  getAll(): SlashCommandModule[] {
    return [...this.modules]
  }

  // Return only modules whose genome array intersects with the given tags.
  getForGenome(genomes: string[]): SlashCommandModule[] {
    return this.modules.filter(m => m.genome.some(g => genomes.includes(g)))
  }

  // Dispatch a submitted value to the matching handler.
  // Returns true if a command matched and was handled, false if it fell through.
  // If genomeFilter is provided, only commands in those genomes are considered.
  dispatch(value: string, ctx: CommandContext, genomeFilter?: string[] | null): boolean {
    const trimmed = value.trim()
    const cmdPart = trimmed.split(/\s+/)[0] ?? ''
    const args = trimmed.slice(cmdPart.length).trimStart()

    const candidates = genomeFilter ? this.getForGenome(genomeFilter) : this.modules
    const mod = candidates.find(m =>
      trimmed === m.cmd ||
      trimmed.startsWith(m.cmd + ' ')
    )
    if (!mod) return false

    void mod.handler(args, ctx)
    return true
  }
}

// Singleton used by the full default audit-wizard instance.
// Import side-effectful command module files to populate it.
export const defaultRegistry = new CommandRegistry()
