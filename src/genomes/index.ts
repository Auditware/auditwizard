// Genome registry - pruned at strain init to include only active genomes.
// Inactive genome folders were deleted - zero traces of removed genomes.

import { defaultRegistry } from '../commands/registry.js'
import { RnaGenome } from './rna/index.js'
import { MemGenome } from './mem/index.js'

export const ALL_GENOMES = [RnaGenome, MemGenome]

for (const genome of ALL_GENOMES) {
  defaultRegistry.registerAll(genome.commands)
}
