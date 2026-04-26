// AgentConfig - two-tier config:
//   Global  (~/.agents/config.json)            - shared across all instances: apiKey
//   Instance (~/.agents/<instanceName>/config.json) - per-instance: model, verbose
//
// Instance name is derived from AGENT_INSTANCE_NAME env or falls back to "main".
//
// Migration: on first run for "main", if ~/.agents/main/config.json doesn't exist but
// the legacy flat config has instance-level fields, they are moved to the instance tier.

import { agentsDir, ensureAgentsDir } from './agentsDir.js'
import { existsSync } from 'fs'

export type GlobalConfig = {
  apiKey?: string
}

export type InstanceConfig = {
  model?: string
  verbose?: boolean
}

export type AgentConfig = GlobalConfig & InstanceConfig

export function instanceName(): string {
  return process.env['AGENT_INSTANCE_NAME'] ?? 'main'
}

function globalConfigPath(): string {
  return agentsDir('config.json')
}

function instanceConfigPath(): string {
  return agentsDir(instanceName(), 'config.json')
}

async function readJson<T>(path: string): Promise<Partial<T>> {
  try {
    const raw = await Bun.file(path).text()
    return JSON.parse(raw) as Partial<T>
  } catch {
    return {}
  }
}

// On first run, if the instance config doesn't exist yet, migrate any instance-level
// fields from the legacy flat global config into the instance tier.
async function maybeMigrate(): Promise<void> {
  if (existsSync(instanceConfigPath())) return
  const flat = await readJson<AgentConfig>(globalConfigPath())
  const { apiKey, ...instanceFields } = flat as AgentConfig
  if (Object.keys(instanceFields).length === 0) return
  ensureAgentsDir(instanceName())
  await Bun.write(instanceConfigPath(), JSON.stringify(instanceFields, null, 2))
  // Strip migrated fields from global config, keep only apiKey
  await Bun.write(globalConfigPath(), JSON.stringify(apiKey !== undefined ? { apiKey } : {}, null, 2))
}

// Merges global (apiKey) + instance (model, verbose) into one object.
export async function loadConfig(): Promise<AgentConfig> {
  await maybeMigrate()
  const [global_, instance] = await Promise.all([
    readJson<GlobalConfig>(globalConfigPath()),
    readJson<InstanceConfig>(instanceConfigPath()),
  ])
  return { ...global_, ...instance }
}

// Routes each key to the correct tier.
export async function saveConfig(patch: Partial<AgentConfig>): Promise<void> {
  const globalKeys: (keyof GlobalConfig)[] = ['apiKey']
  const instanceKeys: (keyof InstanceConfig)[] = ['model', 'verbose']

  const globalPatch: Partial<GlobalConfig> = {}
  const instancePatch: Partial<InstanceConfig> = {}

  for (const k of globalKeys) {
    if (k in patch) (globalPatch as Record<string, unknown>)[k] = patch[k]
  }
  for (const k of instanceKeys) {
    if (k in patch) (instancePatch as Record<string, unknown>)[k] = patch[k]
  }

  const saves: Promise<void>[] = []

  if (Object.keys(globalPatch).length > 0) {
    saves.push((async () => {
      const current = await readJson<GlobalConfig>(globalConfigPath())
      await Bun.write(globalConfigPath(), JSON.stringify({ ...current, ...globalPatch }, null, 2))
    })())
  }

  if (Object.keys(instancePatch).length > 0) {
    saves.push((async () => {
      ensureAgentsDir(instanceName())
      const current = await readJson<InstanceConfig>(instanceConfigPath())
      await Bun.write(instanceConfigPath(), JSON.stringify({ ...current, ...instancePatch }, null, 2))
    })())
  }

  await Promise.all(saves)
}
