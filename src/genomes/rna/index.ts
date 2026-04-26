// RnaGenome - skills management.
// Owns: /skills command, SkillPickerPanel, SkillWatcher lifecycle.

import type { GenomeModule } from '../types.js'
import { skillsCommands } from '../../commands/skills.js'
import { RnaPanel } from './RnaPanel.js'

export const RnaGenome: GenomeModule = {
  id: 'rna',
  commands: skillsCommands,
  PanelComponent: RnaPanel,
  srcDirs: ['src/skills'],
  commandFiles: ['skills.ts'],
}
