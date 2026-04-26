// AddSkillPanel - add a skill from a local path or GitHub repo.
// For GitHub, discovers all skills in the repo tree and shows a multi-select picker.
// Local paths are session-only. GitHub installs go to ~/.claude/skills/ globally.

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import {
  parseInstallInput, validateInstallSource,
  loadFromPath, installFromGithub, listRepoSkills,
} from '../skills/installer.js'
import { scanSkill } from '../skills/scanner.js'
import type { LoadedSkill } from '../skills/loader.js'
import type { RepoSkillEntry } from '../skills/installer.js'

type InstallResult = { slug: string; ok: boolean; msg: string }

type Phase =
  | { name: 'input' }
  | { name: 'loading'; msg: string }
  | { name: 'repo-pick'; owner: string; repo: string; ref: string; entries: RepoSkillEntry[]; cursor: number; checked: Set<number> }
  | { name: 'scan-warn'; skill: LoadedSkill; categories: string[]; rawContent: string; installedPath?: string; sessionOnly: boolean }
  | { name: 'installing'; current: string; done: number; total: number }
  | { name: 'results'; results: InstallResult[] }
  | { name: 'error'; message: string }

type Props = {
  existingSlugs: Set<string>
  onAdded: (skill: LoadedSkill, sessionOnly: boolean) => void
  onCancel: () => void
}

export default function AddSkillPanel({ existingSlugs, onAdded, onCancel }: Props): React.ReactElement {
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'input' })
  const readyRef = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => { readyRef.current = true }, 100)
    return () => clearTimeout(t)
  }, [])

  const installEntry = useCallback(async (
    owner: string, repo: string, ref: string, entry: RepoSkillEntry, sessionOnly: boolean,
  ): Promise<InstallResult> => {
    try {
      const { skill, rawContent, installedPath } = await installFromGithub(owner, repo, entry.subpath, ref)
      if (existingSlugs.has(skill.slug)) {
        return { slug: entry.slug, ok: false, msg: 'already installed' }
      }
      const scan = await scanSkill(rawContent)
      if (!scan.allPassed) {
        const cats = scan.checks.filter(c => !c.passed).map(c => c.category)
        // For batch install, auto-block on guardrail failure (warn shown in results)
        return { slug: skill.slug, ok: false, msg: `blocked: ${cats.join(', ')}` }
      }
      onAdded(skill, sessionOnly)
      return { slug: skill.slug, ok: true, msg: 'installed globally' }
    } catch (e) {
      return { slug: entry.slug, ok: false, msg: e instanceof Error ? e.message : String(e) }
    }
  }, [existingSlugs, onAdded])

  const submitInput = useCallback(async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return
    setPhase({ name: 'loading', msg: 'fetching...' })

    try {
      const src = parseInstallInput(trimmed)
      const validErr = validateInstallSource(src)
      if (validErr) { setPhase({ name: 'error', message: validErr }); return }

      if (src.kind === 'path') {
        const skill = await loadFromPath(src.resolvedPath)
        if (existingSlugs.has(skill.slug)) {
          setPhase({ name: 'error', message: `skill "${skill.slug}" already loaded` }); return
        }
        const scan = await scanSkill(skill.content)
        if (!scan.allPassed) {
          const cats = scan.checks.filter(c => !c.passed).map(c => c.category)
          setPhase({ name: 'scan-warn', skill, categories: cats, rawContent: skill.content, sessionOnly: true }); return
        }
        onAdded(skill, true)
        setPhase({ name: 'results', results: [{ slug: skill.slug, ok: true, msg: 'session only' }] })
        return
      }

      // GitHub: if explicit subpath provided, install directly; else discover repo
      if (src.subpath) {
        const { skill, rawContent, installedPath } = await installFromGithub(src.owner, src.repo, src.subpath, src.ref)
        if (existingSlugs.has(skill.slug)) {
          setPhase({ name: 'error', message: `skill "${skill.slug}" already installed` }); return
        }
        const scan = await scanSkill(rawContent)
        if (!scan.allPassed) {
          const cats = scan.checks.filter(c => !c.passed).map(c => c.category)
          setPhase({ name: 'scan-warn', skill, categories: cats, rawContent, installedPath, sessionOnly: false }); return
        }
        onAdded(skill, false)
        setPhase({ name: 'results', results: [{ slug: skill.slug, ok: true, msg: 'installed globally' }] })
        return
      }

      // No subpath: discover all skills in the repo
      setPhase({ name: 'loading', msg: `scanning ${src.owner}/${src.repo}...` })
      const entries = await listRepoSkills(src.owner, src.repo, src.ref)
      if (entries.length === 0) {
        setPhase({ name: 'error', message: `no SKILL.md files found in ${src.owner}/${src.repo}@${src.ref}` }); return
      }
      if (entries.length === 1) {
        // Single skill - install immediately
        setPhase({ name: 'installing', current: entries[0]!.slug, done: 0, total: 1 })
        const result = await installEntry(src.owner, src.repo, src.ref, entries[0]!, false)
        setPhase({ name: 'results', results: [result] })
        return
      }
      setPhase({ name: 'repo-pick', owner: src.owner, repo: src.repo, ref: src.ref, entries, cursor: 0, checked: new Set() })
    } catch (err) {
      setPhase({ name: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [existingSlugs, onAdded, installEntry])

  const installChecked = useCallback(async (owner: string, repo: string, ref: string, entries: RepoSkillEntry[], checked: Set<number>) => {
    const toInstall = checked.size > 0 ? [...checked].map(i => entries[i]!) : []
    if (toInstall.length === 0) return
    const results: InstallResult[] = []
    for (let i = 0; i < toInstall.length; i++) {
      setPhase({ name: 'installing', current: toInstall[i]!.slug, done: i, total: toInstall.length })
      results.push(await installEntry(owner, repo, ref, toInstall[i]!, false))
    }
    setPhase({ name: 'results', results })
  }, [installEntry])

  useInput(useCallback((input, key) => {
    if (!readyRef.current) return
    if (phase.name === 'loading' || phase.name === 'installing') return

    if (phase.name === 'scan-warn') {
      if (input === 'y' || input === 'Y') {
        const { skill, installedPath, sessionOnly } = phase
        const label = sessionOnly ? '(session only, guardrails warned)' : '(installed globally, guardrails warned)'
        onAdded(skill, sessionOnly)
        setPhase({ name: 'results', results: [{ slug: skill.slug, ok: true, msg: label }] })
      } else if (input === 'n' || input === 'N' || key.escape) {
        setPhase({ name: 'input' })
      }
      return
    }

    if (phase.name === 'results') {
      if (key.escape || key.return || input === 'q') onCancel()
      return
    }

    if (phase.name === 'error') {
      setPhase({ name: 'input' }); return
    }

    if (phase.name === 'repo-pick') {
      const { entries, cursor, checked, owner, repo, ref } = phase
      if (key.escape) { setPhase({ name: 'input' }); return }
      if (key.upArrow) {
        setPhase({ ...phase, cursor: Math.max(0, cursor - 1) }); return
      }
      if (key.downArrow) {
        setPhase({ ...phase, cursor: Math.min(entries.length - 1, cursor + 1) }); return
      }
      if (input === ' ') {
        const next = new Set(checked)
        if (next.has(cursor)) next.delete(cursor)
        else next.add(cursor)
        setPhase({ ...phase, checked: next }); return
      }
      if (input === 'a' || input === 'A') {
        // Toggle all
        const next = checked.size === entries.length ? new Set<number>() : new Set(entries.map((_, i) => i))
        setPhase({ ...phase, checked: next }); return
      }
      if (key.return && checked.size > 0) {
        void installChecked(owner, repo, ref, entries, checked)
        return
      }
      return
    }

    // input phase
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return }
    if (key.return) { void submitInput(value); return }
    if (key.backspace || key.delete) { setValue(v => v.slice(0, -1)); return }
    if (key.ctrl || key.meta) return
    setValue(v => v + input)
  }, [phase, value, submitInput, onAdded, onCancel, installChecked]))

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Text color={theme.brand} bold>Add Skill</Text>

      {phase.name === 'input' && (
        <>
          <Box gap={1}>
            <Text color={theme.inactive}>{'> '}</Text>
            <Text color={theme.text}>{value || ' '}</Text>
            <Text color={theme.brand}>_</Text>
          </Box>
          <Text color={theme.inactive}>local: /path/to/skill  or  gh: owner/repo[@sha]</Text>
          <Text color={theme.inactive}>local paths are session-only  ·  github installs globally</Text>
          <Box gap={2} marginTop={1}>
            <Text color={theme.inactive}><Text color={theme.brand} bold>Enter</Text> search</Text>
            <Text color={theme.inactive}>Esc cancel</Text>
          </Box>
        </>
      )}

      {phase.name === 'loading' && (
        <Text color={theme.warning}>{phase.msg}</Text>
      )}

      {phase.name === 'repo-pick' && (
        <RepoPicker phase={phase} />
      )}

      {phase.name === 'scan-warn' && (
        <>
          <Text color={theme.warning} bold>⚠ guardrail violations: {phase.categories.join(', ')}</Text>
          <Text color={theme.inactive}>skill: <Text color={theme.text}>{phase.skill.name}</Text></Text>
          <Box gap={2} marginTop={1}>
            <Text color={theme.inactive}><Text color={theme.success} bold>y</Text> install anyway</Text>
            <Text color={theme.inactive}><Text color={theme.error} bold>n</Text> cancel</Text>
          </Box>
        </>
      )}

      {phase.name === 'installing' && (
        <Text color={theme.warning}>installing {phase.current}... ({phase.done + 1}/{phase.total})</Text>
      )}

      {phase.name === 'results' && (
        <>
          {phase.results.map(r => (
            <Text key={r.slug} color={r.ok ? theme.success : theme.error}>
              {r.ok ? '✓' : '✗'} {r.slug} {r.msg}
            </Text>
          ))}
          <Text color={theme.inactive} dimColor>Enter/Esc close</Text>
        </>
      )}

      {phase.name === 'error' && (
        <>
          <Text color={theme.error}>✗ {phase.message}</Text>
          <Text color={theme.inactive}>press any key to try again</Text>
        </>
      )}
    </Box>
  )
}

function RepoPicker({ phase }: { phase: Extract<Phase, { name: 'repo-pick' }> }): React.ReactElement {
  const { entries, cursor, checked, owner, repo, ref } = phase
  const VISIBLE = 6
  const half = Math.floor(VISIBLE / 2)
  const start = Math.max(0, Math.min(cursor - half, entries.length - VISIBLE))
  const visible = entries.slice(start, start + VISIBLE)

  return (
    <>
      <Text color={theme.inactive}>{owner}/{repo}@{ref} - {entries.length} skill{entries.length !== 1 ? 's' : ''} found</Text>
      {start > 0 && <Text color={theme.inactive}> ^ {start} above</Text>}
      {visible.map((entry, i) => {
        const idx = start + i
        const isCursor = idx === cursor
        const isChecked = checked.has(idx)
        return (
          <Box key={entry.subpath || entry.slug} gap={1}>
            <Text color={isCursor ? theme.brand : theme.inactive}>{isCursor ? '❯' : ' '}</Text>
            <Text color={isChecked ? theme.success : theme.inactive}>[{isChecked ? 'x' : ' '}]</Text>
            <Text color={isCursor ? theme.text : theme.inactive} wrap="truncate">{entry.slug}</Text>
            {entry.subpath ? <Text color={theme.inactive} dimColor wrap="truncate">  {entry.subpath}</Text> : null}
          </Box>
        )
      })}
      {start + VISIBLE < entries.length && <Text color={theme.inactive}> v {entries.length - start - VISIBLE} more</Text>}
      <Box gap={2} marginTop={1}>
        <Text color={theme.inactive}><Text color={theme.brand} bold>Space</Text> toggle</Text>
        <Text color={theme.inactive}><Text color={theme.brand} bold>a</Text> all</Text>
        <Text color={theme.inactive}><Text color={checked.size > 0 ? theme.brand : theme.inactive} bold>Enter</Text>{checked.size > 0 ? ` install ${checked.size}` : ' (select first)'}</Text>
        <Text color={theme.inactive}>Esc back</Text>
      </Box>
    </>
  )
}
