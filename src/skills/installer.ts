// Skill installer - loads skills from local paths or GitHub (pinned commits).
// Local path imports are session-only (not persisted globally).
// GitHub installs write to the provided installDir (or ~/.claude/skills/ by default).

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { loadSkillFile } from './loader.js'
import type { LoadedSkill } from './loader.js'

const GLOBAL_INSTALL_DIR = join(process.env['HOME'] ?? '.', '.claude', 'skills')

export type InstallSource =
  | { kind: 'path'; resolvedPath: string }
  | { kind: 'github'; owner: string; repo: string; subpath: string; ref: string }

/** Parse user input into an install source descriptor. */
export function parseInstallInput(input: string): InstallSource {
  const trimmed = input.trim()
  // Local path: starts with /, ~, ./, or ../
  if (trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    const expanded = trimmed.startsWith('~')
      ? join(process.env['HOME'] ?? '.', trimmed.slice(1))
      : resolve(trimmed)
    return { kind: 'path', resolvedPath: expanded }
  }
  // GitHub: owner/repo[/subpath][@ref]
  const [specPart, ref = 'main'] = trimmed.split('@') as [string, string?]
  const parts = (specPart ?? '').split('/')
  const owner = parts[0] ?? ''
  const repo = parts[1] ?? ''
  const subpath = parts.slice(2).join('/')
  return { kind: 'github', owner, repo, subpath, ref }
}

/** Validate a parsed install source (basic sanity checks). */
export function validateInstallSource(src: InstallSource): string | null {
  if (src.kind === 'path') {
    if (!existsSync(src.resolvedPath)) return `path not found: ${src.resolvedPath}`
    const skillMd = join(src.resolvedPath, 'SKILL.md')
    if (!existsSync(skillMd)) return `no SKILL.md found in ${src.resolvedPath}`
    return null
  }
  if (!src.owner || !src.repo) return 'invalid GitHub spec - expected owner/repo[@sha]'
  return null
}

/** Load a skill from a local path (session-only, not installed globally). */
export async function loadFromPath(resolvedPath: string): Promise<LoadedSkill> {
  const skillMd = join(resolvedPath, 'SKILL.md')
  const skill = await loadSkillFile(skillMd)
  if (!skill) throw new Error(`Failed to parse SKILL.md at ${skillMd}`)
  // If no .meta.json was found, mark as local
  if (!skill.source) skill.source = 'local'
  return skill
}

/** A skill discovered in a GitHub repo tree. */
export type RepoSkillEntry = { subpath: string; slug: string }

/**
 * Discover all skills in a GitHub repo by scanning its tree for SKILL.md files.
 * Uses the GitHub API: GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1
 */
export async function listRepoSkills(owner: string, repo: string, ref: string): Promise<RepoSkillEntry[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (res.status === 404) throw new Error(`repo ${owner}/${repo}@${ref} not found`)
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit - try again later')
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`)
  const data = await res.json() as { tree: Array<{ path: string; type: string }>; truncated?: boolean }
  const entries: RepoSkillEntry[] = []
  for (const item of data.tree) {
    if (item.type !== 'blob') continue
    // Match paths like SKILL.md or subdir/SKILL.md or nested/path/SKILL.md
    if (!item.path.endsWith('/SKILL.md') && item.path !== 'SKILL.md') continue
    const subpath = item.path === 'SKILL.md' ? '' : item.path.slice(0, -'/SKILL.md'.length)
    // slug = last path segment of subpath (or repo name if root)
    const slug = subpath ? (subpath.split('/').pop() ?? subpath) : repo
    entries.push({ subpath, slug })
  }
  return entries
}

/** Fetch all file paths under a subpath in a GitHub repo tree. Returns relative paths from subpath root. */
async function fetchSkillFileTree(owner: string, repo: string, subpath: string, ref: string): Promise<string[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!res.ok) return [] // fall back to SKILL.md only on tree API failure
  const data = await res.json() as { tree: Array<{ path: string; type: string }> }
  const prefix = subpath ? `${subpath}/` : ''
  return data.tree
    .filter(item => item.type === 'blob' && (prefix ? item.path.startsWith(prefix) : true))
    .map(item => prefix ? item.path.slice(prefix.length) : item.path)
}

/** Fetch a single raw file from GitHub. */
async function fetchGithubRaw(owner: string, repo: string, filePath: string, ref: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`
  const res = await fetch(url)
  if (res.status === 404) throw new Error(`file not found: ${url}`)
  if (res.status === 403) throw new Error(`GitHub rate limit or private repo - try again later`)
  if (!res.ok) throw new Error(`GitHub fetch failed: HTTP ${res.status}`)
  return res.text()
}

/** Install a skill from GitHub into a target directory (defaults to ~/.claude/skills/{slug}/).
 *  Downloads the full skill directory including references and supporting files. */
export async function installFromGithub(
  owner: string, repo: string, subpath: string, ref: string,
  options?: { isBuiltIn?: boolean; installDir?: string },
): Promise<{ skill: LoadedSkill; rawContent: string; installedPath: string }> {
  // Fetch full file tree for the skill subpath
  const relFiles = await fetchSkillFileTree(owner, repo, subpath, ref)
  // Always ensure SKILL.md is included (fallback if tree API returned nothing)
  if (!relFiles.includes('SKILL.md')) relFiles.unshift('SKILL.md')

  // Fetch SKILL.md first so we can determine the slug for the install dir
  const skillMdFullPath = subpath ? `${subpath}/SKILL.md` : 'SKILL.md'
  const rawContent = await fetchGithubRaw(owner, repo, skillMdFullPath, ref)

  // Write to temp path to parse and extract slug
  const tmpPath = join(process.env['TMPDIR'] ?? '/tmp', `agent-skill-${Date.now()}`)
  mkdirSync(tmpPath, { recursive: true })
  writeFileSync(join(tmpPath, 'SKILL.md'), rawContent, 'utf-8')
  const tmpSkill = await loadSkillFile(join(tmpPath, 'SKILL.md'))
  if (!tmpSkill) throw new Error('Failed to parse SKILL.md from GitHub')

  // Install to provided dir, or fall back to global dir
  const baseDir = options?.installDir ?? GLOBAL_INSTALL_DIR
  const installDir = join(baseDir, tmpSkill.slug)
  mkdirSync(installDir, { recursive: true })

  // Write SKILL.md first (already fetched)
  writeFileSync(join(installDir, 'SKILL.md'), rawContent, 'utf-8')

  // Fetch and write all other files in the skill directory
  const otherFiles = relFiles.filter(f => f !== 'SKILL.md')
  await Promise.all(otherFiles.map(async (relFile) => {
    try {
      const fullPath = subpath ? `${subpath}/${relFile}` : relFile
      const content = await fetchGithubRaw(owner, repo, fullPath, ref)
      const destPath = join(installDir, relFile)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, content, 'utf-8')
    } catch { /* non-critical: skip files that fail */ }
  }))

  // Write source metadata
  const repoUrl = `https://github.com/${owner}/${repo}${subpath ? `/tree/${ref}/${subpath}` : ''}`
  writeFileSync(
    join(installDir, '.meta.json'),
    JSON.stringify({ source: 'github', sha: ref, isBuiltIn: options?.isBuiltIn ?? false, repoUrl }, null, 2),
    'utf-8',
  )

  // Clean up temp dir
  try { require('fs').rmSync(tmpPath, { recursive: true, force: true }) } catch { /* ignore */ }

  // Reload from final path so path and .meta.json are correct
  const skill = await loadSkillFile(join(installDir, 'SKILL.md'))
  if (!skill) throw new Error('Failed to read installed skill')

  return { skill, rawContent, installedPath: join(installDir, 'SKILL.md') }
}
