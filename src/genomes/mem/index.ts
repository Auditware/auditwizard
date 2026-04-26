// MemGenome - session, model, and API key management.
// Owns: /sessions, /model, /api-key commands, SessionPicker, ModelPicker, ApiKeyInput panels.
// Session I/O primitives live in src/context/session.ts (nuc-owned, always survives).
// src/sessions/ is now just a re-export shim - not pruned.

import type { GenomeModule } from '../types.js'
import { sessionCommands } from '../../commands/sessions.js'
import { MemPanel } from './MemPanel.js'

export const MemGenome: GenomeModule = {
  id: 'mem',
  commands: sessionCommands,
  PanelComponent: MemPanel,
  commandFiles: ['sessions.ts'],
  testFiles: ['SessionStore.test.ts'],
}
