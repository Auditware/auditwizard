// poc.ts - PoC utility module for auditwizard.
// Self-contained: runs PoCs via Docker (EVM/Foundry) or native (Rust/Cargo).
// Owned by the /warden command (not a slash command itself).
//
// Storage: ~/.agents/auditwizard/contests/<slug>/pocs/<pocId>/
//   meta.json    - metadata (title, chain, command, writeup, status, lastExit, createdAt)
//   test.*       - test file content
//   output.txt   - last run output

import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { spawnSync, spawn } from 'child_process'
import type { Tool } from '../agent/QueryEngine.js'
import { ensureContestDir, slugify, contestDir } from './contestStore.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PocMeta = {
  id: string
  title: string
  chain: string      // evm | solana | rust | starknet | move | go
  command: string    // e.g. "forge test -vv --match-test testExploit"
  testFileName: string
  contestSlug?: string
  bugId?: string     // linked Bug.id (set by agent when creating poc for a finding)
  triage: 'triage' | 'in_progress' | 'submitted' | 'rewarded' | 'rejected' | 'false_positive' | 'expired'
  scope: 'unverified' | 'in_scope' | 'out_of_scope' | 'partial_scope'
  duplicate: 'unverified' | 'original' | 'duplicate' | 'variation'
  lastExitCode?: number
  lastRunAt?: number
  createdAt: number
  writeup?: {
    summary?: string
    root_cause?: string
    impact?: string
    attacker_flow?: string
    poc_steps?: string
    code_refs?: string
    mitigation?: string
    tools_used?: string
  }
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function pocsRoot(slug: string): string {
  return join(contestDir(slug), 'pocs')
}

export function pocDir(slug: string, id: string): string {
  return join(pocsRoot(slug), id)
}

export function ensurePocDir(slug: string, id: string): string {
  const p = pocDir(slug, id)
  mkdirSync(p, { recursive: true })
  return p
}

function newPocId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

// ─── Store ────────────────────────────────────────────────────────────────────

export function loadPocMeta(slug: string, id: string): PocMeta | null {
  const p = join(pocDir(slug, id), 'meta.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as PocMeta } catch { return null }
}

export function savePocMeta(slug: string, meta: PocMeta): void {
  ensurePocDir(slug, meta.id)
  writeFileSync(join(pocDir(slug, meta.id), 'meta.json'), JSON.stringify(meta, null, 2))
}

export function listPocMetas(slug: string): PocMeta[] {
  const root = pocsRoot(slug)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .flatMap(e => loadPocMeta(slug, e.name) ?? [])
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function loadPocOutput(slug: string, id: string): string | null {
  const p = join(pocDir(slug, id), 'output.txt')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

// ─── Execution ────────────────────────────────────────────────────────────────

export function isEvm(chain: string): boolean {
  return !['solana', 'anchor', 'stellar', 'soroban', 'rust', 'cosmwasm', 'near', 'aptos', 'sui', 'move', 'go'].includes(chain.toLowerCase())
}

export function testFileExt(chain: string): string {
  if (isEvm(chain)) return '.t.sol'
  if (['go'].includes(chain.toLowerCase())) return '_test.go'
  return '.rs'
}

function buildRunArgs(slug: string, meta: PocMeta): { cmd: string; args: string[]; cwd: string } {
  const dir = pocDir(slug, meta.id)
  const codeDir = join(contestDir(slug), 'code')
  const hasCodeDir = existsSync(codeDir)

  if (isEvm(meta.chain)) {
    const workDir = hasCodeDir ? codeDir : dir
    if (hasCodeDir) {
      mkdirSync(join(codeDir, 'test'), { recursive: true })
      const src = join(dir, meta.testFileName)
      if (existsSync(src)) writeFileSync(join(codeDir, 'test', meta.testFileName), readFileSync(src))
    }
    return {
      cmd: 'docker',
      args: [
        'run', '--rm', '--memory', '1g', '--cpus', '0.8',
        '-v', `${workDir}:/workspace`, '-w', '/workspace',
        'ghcr.io/foundry-rs/foundry:latest', 'sh', '-c', meta.command,
      ],
      cwd: workDir,
    }
  }

  return {
    cmd: 'sh',
    args: ['-c', meta.command],
    cwd: hasCodeDir ? codeDir : dir,
  }
}

// Synchronous - blocks the process (use from agent tool execute or CLI handler)
export function runPoc(slug: string, meta: PocMeta): { exitCode: number; output: string } {
  const { cmd, args, cwd } = buildRunArgs(slug, meta)
  const result = spawnSync(cmd, args, { cwd, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' })
  const output = [String(result.stdout ?? ''), String(result.stderr ?? '')].filter(Boolean).join('\n').trim()
  writeFileSync(join(pocDir(slug, meta.id), 'output.txt'), output)
  return { exitCode: result.status ?? 1, output }
}

// Async - non-blocking (use from UI / React components)
export function runPocAsync(slug: string, meta: PocMeta): Promise<{ exitCode: number; output: string }> {
  return new Promise(resolve => {
    const { cmd, args, cwd } = buildRunArgs(slug, meta)
    const proc = spawn(cmd, args, { cwd })
    const chunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => chunks.push(d))

    let settled = false
    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      const output = Buffer.concat(chunks).toString('utf8').trim()
      writeFileSync(join(pocDir(slug, meta.id), 'output.txt'), output)
      resolve({ exitCode, output })
    }

    proc.on('close', finish)
    setTimeout(() => {
      if (!settled) { proc.kill(); finish(124) }
    }, 180_000)
  })
}

// ─── Context from env (set by audit spawn) ───────────────────────────────────

export function contestContextFromEnv(): { name: string; slug: string } | null {
  const name = process.env['WARDEN_CONTEST_NAME']
  if (!name) return null
  return { name, slug: slugify(undefined, name) }
}

// ─── Submission export ────────────────────────────────────────────────────────

export function exportSubmission(meta: PocMeta, platform: string): string {
  const w = meta.writeup ?? {}
  const severity = 'High'

  if (meta.scope !== 'in_scope') return `⚠ Cannot export: scope is "${meta.scope}". Set scope to in_scope first.`
  if (meta.duplicate === 'duplicate') return `⚠ Cannot export: marked as duplicate.`

  const sections: string[] = []

  if (platform === 'code4rena') {
    sections.push(`# ${meta.title}`)
    sections.push(`## Summary\n${w.summary ?? '_TODO_'}`)
    sections.push(`## Vulnerability Detail\n${w.root_cause ?? '_TODO_'}`)
    sections.push(`## Impact\n${w.impact ?? '_TODO_'}`)
    sections.push(`## Code References\n${w.code_refs ?? '_TODO_'}`)
    sections.push(`## Proof of Concept\n${w.poc_steps ?? '_TODO_'}`)
    sections.push(`## Mitigation\n${w.mitigation ?? '_TODO_'}`)
  } else if (platform === 'sherlock') {
    sections.push(`# ${meta.title}`)
    sections.push(`## Summary\n${w.summary ?? '_TODO_'}`)
    sections.push(`## Root Cause\n${w.root_cause ?? '_TODO_'}`)
    sections.push(`## Internal Pre-conditions\n_TODO_`)
    sections.push(`## External Pre-conditions\n_TODO_`)
    sections.push(`## Attack Path\n${w.attacker_flow ?? '_TODO_'}`)
    sections.push(`## Impact\n${w.impact ?? '_TODO_'}`)
    sections.push(`## PoC\n${w.poc_steps ?? '_TODO_'}`)
    sections.push(`## Mitigation\n${w.mitigation ?? '_TODO_'}`)
  } else if (platform === 'immunefi') {
    sections.push(`# ${meta.title}`)
    sections.push(`**Severity**: ${severity}`)
    sections.push(`## Description\n${w.summary ?? '_TODO_'}`)
    sections.push(`## Root Cause\n${w.root_cause ?? '_TODO_'}`)
    sections.push(`## Impact\n${w.impact ?? '_TODO_'}`)
    sections.push(`## Attack Scenario\n${w.attacker_flow ?? '_TODO_'}`)
    sections.push(`## Proof of Concept\n${w.poc_steps ?? '_TODO_'}`)
    sections.push(`## Recommended Fix\n${w.mitigation ?? '_TODO_'}`)
  } else {
    // generic / cantina
    sections.push(`# ${meta.title}`)
    sections.push(`## Summary\n${w.summary ?? '_TODO_'}`)
    sections.push(`## Root Cause\n${w.root_cause ?? '_TODO_'}`)
    sections.push(`## Impact\n${w.impact ?? '_TODO_'}`)
    sections.push(`## Proof of Concept\n${w.poc_steps ?? '_TODO_'}`)
    sections.push(`## Code References\n${w.code_refs ?? '_TODO_'}`)
    sections.push(`## Mitigation\n${w.mitigation ?? '_TODO_'}`)
  }

  sections.push(`\n---\n*Tools: ${w.tools_used ?? 'Foundry, auditwizard'}*`)
  return sections.join('\n\n')
}

// ─── Agent tool ───────────────────────────────────────────────────────────────

export const pocTool: Tool = {
  name: 'poc',
  description: [
    'Create, run, and manage smart contract Proofs of Concept. Owned by /warden.',
    'EVM PoCs run inside Docker (ghcr.io/foundry-rs/foundry). Rust/Solana run natively.',
    'Storage: ~/.agents/auditwizard/contests/<slug>/pocs/<id>/',
    '',
    'When creating a PoC for a finding, pass bug_id to link it to a bug in the warden bugs view.',
    'The bug\'s pocId will be set so the user can re-run and view output from the warden panel.',
    '',
    'Actions:',
    '  create         - write test file to disk, register PoC metadata',
    '  run            - execute the PoC (Docker for EVM, native for Rust)',
    '  list           - list all PoCs for the current contest',
    '  get            - get metadata + last output for a PoC',
    '  update         - update triage/scope/duplicate status or writeup fields',
    '  export         - render platform-ready submission markdown',
    '',
    'Requires: docker installed for EVM PoCs.',
    'If WARDEN_CONTEST_NAME env is set, that contest is used automatically.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      action:        { type: 'string', enum: ['create', 'run', 'list', 'get', 'update', 'export'] },
      poc_id:        { type: 'string', description: 'PoC ID (for run/get/update/export)' },
      contest_slug:  { type: 'string', description: 'Contest slug (defaults to WARDEN_CONTEST_NAME env)' },
      bug_id:        { type: 'string', description: 'Bug ID to link this PoC to (for create)' },
      title:         { type: 'string', description: 'Human-readable PoC title (for create)' },
      test_file:     { type: 'string', description: 'Full test file content (for create)' },
      chain:         { type: 'string', description: 'evm (default) | solana | rust | starknet | move | go' },
      command:       { type: 'string', description: 'Run command, e.g. "forge test -vv --match-test testExploit"' },
      platform:      { type: 'string', description: 'For export: code4rena | sherlock | cantina | immunefi' },
      update_fields: { type: 'object', description: 'Fields to update: triage, scope, duplicate, writeup' },
    },
    required: ['action'],
  },

  async execute(input) {
    const action = input['action'] as string
    const envCtx = contestContextFromEnv()
    const slug = (input['contest_slug'] as string | undefined) ?? envCtx?.slug

    if (!slug && action !== 'list') {
      return 'Error: no contest context. Set WARDEN_CONTEST_NAME or pass contest_slug.'
    }

    try {
      if (action === 'list') {
        if (!slug) return 'Error: contest_slug required for list.'
        const pocs = listPocMetas(slug)
        if (pocs.length === 0) return 'No PoCs found for this contest.'
        return pocs.map(p =>
          `[${p.id}] ${p.title}  ${p.chain}  triage:${p.triage}  scope:${p.scope}  exit:${p.lastExitCode ?? '-'}`
        ).join('\n')
      }

      if (action === 'create') {
        const title = input['title'] as string
        const testFile = input['test_file'] as string
        const chain = (input['chain'] as string | undefined) ?? 'evm'
        const command = (input['command'] as string | undefined) ?? (isEvm(chain) ? 'forge test -vv' : 'cargo test')
        const bugId = input['bug_id'] as string | undefined
        if (!title || !testFile) return 'Error: title and test_file are required.'

        const id = newPocId()
        const ext = testFileExt(chain)
        const testFileName = id + ext
        ensureContestDir(slug!)
        ensurePocDir(slug!, id)
        writeFileSync(join(pocDir(slug!, id), testFileName), testFile)

        const meta: PocMeta = {
          id, title, chain, command, testFileName,
          contestSlug: slug,
          bugId,
          triage: 'triage', scope: 'unverified', duplicate: 'unverified',
          createdAt: Date.now(),
        }
        savePocMeta(slug!, meta)

        // If linked to a bug, write pocId back to the bug record
        if (bugId) {
          const { loadBugs, saveBug } = await import('./contestStore.js')
          const bugs = loadBugs(slug!)
          const bug = bugs.find(b => b.id === bugId)
          if (bug) {
            bug.pocId = id
            saveBug(slug!, bug)
          }
        }

        return `PoC created: id=${id}  file=${testFileName}${bugId ? `  linked to bug=${bugId}` : ''}\nRun with: poc action=run poc_id=${id}`
      }

      if (action === 'run') {
        const id = input['poc_id'] as string
        if (!id) return 'Error: poc_id required.'
        const meta = loadPocMeta(slug!, id)
        if (!meta) return `PoC ${id} not found.`

        const { exitCode, output } = runPoc(slug!, meta)
        meta.lastExitCode = exitCode
        meta.lastRunAt = Date.now()
        if (exitCode === 0) meta.triage = 'in_progress'
        savePocMeta(slug!, meta)

        return `${exitCode === 0 ? '✓ PASSED' : `✗ FAILED (exit ${exitCode})`}\n\n${output.slice(0, 3000)}`
      }

      if (action === 'get') {
        const id = input['poc_id'] as string
        if (!id) return 'Error: poc_id required.'
        const meta = loadPocMeta(slug!, id)
        if (!meta) return `PoC ${id} not found.`
        const output = loadPocOutput(slug!, id) ?? '(not run yet)'
        return [
          `id: ${meta.id}`,
          `title: ${meta.title}`,
          `chain: ${meta.chain}  command: ${meta.command}`,
          `triage: ${meta.triage}  scope: ${meta.scope}  duplicate: ${meta.duplicate}`,
          `last exit: ${meta.lastExitCode ?? '-'}  run at: ${meta.lastRunAt ? new Date(meta.lastRunAt).toLocaleString() : '-'}`,
          `\nLast output:\n${output.slice(0, 2000)}`,
        ].join('\n')
      }

      if (action === 'update') {
        const id = input['poc_id'] as string
        const fields = input['update_fields'] as Record<string, unknown>
        if (!id || !fields) return 'Error: poc_id and update_fields required.'
        const meta = loadPocMeta(slug!, id)
        if (!meta) return `PoC ${id} not found.`
        if (fields['triage'])    meta.triage    = fields['triage'] as PocMeta['triage']
        if (fields['scope'])     meta.scope     = fields['scope'] as PocMeta['scope']
        if (fields['duplicate']) meta.duplicate = fields['duplicate'] as PocMeta['duplicate']
        if (fields['writeup'])   meta.writeup   = { ...meta.writeup, ...(fields['writeup'] as object) }
        savePocMeta(slug!, meta)
        return `PoC ${id} updated.`
      }

      if (action === 'export') {
        const id = input['poc_id'] as string
        const platform = (input['platform'] as string | undefined) ?? 'code4rena'
        if (!id) return 'Error: poc_id required.'
        const meta = loadPocMeta(slug!, id)
        if (!meta) return `PoC ${id} not found.`
        const md = exportSubmission(meta, platform)
        const fname = join(pocDir(slug!, id), `submission_${platform}.md`)
        writeFileSync(fname, md)
        return `Submission saved to: ${fname}\n\n${md.slice(0, 2000)}`
      }

      return `Unknown action: ${action}`
    } catch (err) {
      return `PoC error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}
