// WardenPanel - interactive contest browser for dailywarden.com.
// ↑↓ navigate  Enter open in browser  a spawn audit  b bookmark  g view bugs  Esc close

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, chmodSync } from 'fs'
import { theme } from '../app/theme.js'
import { SlashPicker } from './SlashPicker.js'
import { fetchDailyWardenContests, type Contest } from '../utils/wardenData.js'
import {
  slugify, contestDir, saveContestMeta, ensureContestDir,
  loadBookmarks, toggleBookmark, isBookmarked,
  loadBugs, saveBug, newBugId, type Bug, type BookmarkedContest,
} from '../utils/contestStore.js'
import { loadPocMeta, loadPocOutput, runPocAsync, savePocMeta, type PocMeta } from '../utils/poc.js'

type View = 'list' | 'bugs' | 'bug-form' | 'poc-output'
type BugField = 'title' | 'submissionUrl' | 'markdownPath' | 'notes'

const BUG_FIELDS: { key: BugField; label: string }[] = [
  { key: 'title',         label: 'Title' },
  { key: 'submissionUrl', label: 'Submission URL' },
  { key: 'markdownPath',  label: 'Markdown path' },
  { key: 'notes',         label: 'Notes' },
]

type Props = {
  height: number
  cols: number
  onClose: () => void
}

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawnSync(cmd, [url])
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysLeftColor(ms: number, isUpcoming: boolean): string {
  if (isUpcoming) return '#a78bfa'
  const d = Math.ceil((ms - Date.now()) / 86_400_000)
  if (d <= 1) return '#f87171'
  if (d <= 3) return '#fb923c'
  return '#4ade80'
}

function spawnAuditPane(contest: Contest): string | null {
  if (!process.env['TMUX']) return 'Not in a tmux session.'
  const slug = saveContestMeta(contest)
  const dir = contestDir(slug)
  const url = contest['url'] ? String(contest['url']) : ''
  const name = String(contest['name'] ?? slug)
  const platform = String(contest['platform'] ?? 'unknown')

  const seedPrompt = [
    `You are auditing "${name}" (${platform}).`,
    `Contest dir: ${dir}${url ? `  URL: ${url}` : ''}`,
    'Goal: find critical and high severity vulnerabilities.',
    'For each finding: (1) call poc action=create with the exploit test + bug_id to link it,',
    '(2) call poc action=run to verify it passes, (3) fill in writeup fields via poc action=update.',
    'Focus areas: reentrancy, access control, flash loan / price manipulation, logic errors, integer overflow.',
    'Store all findings so they appear in the warden bugs view.',
  ].join(' ')

  const bunBin = process.execPath
  const cliPath = join(import.meta.dir, '..', 'cli.tsx')
  const logFile = `/tmp/aw-pane-${slug}.log`

  // Launcher script - only shows log dump on unexpected (non-zero, non-130) exit codes
  const scriptFile = `/tmp/aw-launch-${slug}.sh`
  writeFileSync(scriptFile, [
    '#!/bin/bash',
    `${bunBin} ${cliPath} 2>"${logFile}"`,
    `RC=$?`,
    `echo "[$(date)] exited: $RC" >> "${logFile}"`,
    // RC=0: clean /exit. RC=130: Ctrl+C. Both are intentional - no noise.
    `if [ $RC -ne 0 ] && [ $RC -ne 130 ]; then`,
    `  echo "=== pane crashed (code $RC) - log: ${logFile} ==="`,
    `  cat "${logFile}"`,
    `  read -p "press enter to close"`,
    `fi`,
  ].join('\n'))
  chmodSync(scriptFile, 0o755)
  const cmd = scriptFile

  const result = spawnSync('tmux', [
    'split-window', '-h',
    '-c', dir,  // start the pane in the contest directory
    '-e', `WARDEN_AUDIT_PANE=1`,
    '-e', `WARDEN_CONTEST_URL=${url}`,
    '-e', `WARDEN_CONTEST_NAME=${name}`,
    '-e', `WARDEN_CONTEST_DIR=${dir}`,
    '-e', `WARDEN_SEED_PROMPT=${seedPrompt}`,
    cmd,
  ])
  if (result.status !== 0) return `tmux error: ${result.stderr?.toString().trim()}`
  return null
}

export default function WardenPanel({ height, cols, onClose }: Props): React.ReactElement {
  const [active, setActive] = useState<Contest[]>([])
  const [upcoming, setUpcoming] = useState<Contest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const [bookmarkSlugs, setBookmarkSlugs] = useState<Set<string>>(new Set())
  const [bookmarkedContests, setBookmarkedContests] = useState<Contest[]>([])
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Bug sub-view
  const [view, setView] = useState<View>('list')
  const [bugContest, setBugContest] = useState<Contest | null>(null)
  const [bugs, setBugs] = useState<Bug[]>([])
  const [bugCursor, setBugCursor] = useState(0)
  const [editingBug, setEditingBug] = useState<Partial<Bug>>({})
  const [bugFieldIdx, setBugFieldIdx] = useState(0)
  const [bugFieldInput, setBugFieldInput] = useState('')

  // PoC state
  const [pocMetas, setPocMetas] = useState<Record<string, PocMeta | null>>({})
  const [runningBugId, setRunningBugId] = useState<string | null>(null)
  const [pocOutputText, setPocOutputText] = useState<string>('')
  const [pocOutputTitle, setPocOutputTitle] = useState<string>('')

  // Load data on mount
  useEffect(() => {
    const bms = loadBookmarks()
    setBookmarkSlugs(new Set(bms.map(b => b.slug)))
    setBookmarkedContests(bms.map(b => b.contest))

    fetchDailyWardenContests()
      .then(({ active: a, upcoming: u, fetchedAt: ts }) => {
        setActive(a)
        setUpcoming(u)
        setFetchedAt(ts)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  // Merge: live active + live upcoming + bookmarked-only (ended/not-live)
  const liveKeys = new Set([...active, ...upcoming].map(c => String(c['url'] ?? c['name'])))
  const bookmarkOnlyContests = bookmarkedContests.filter(
    c => !liveKeys.has(String(c['url'] ?? c['name']))
  )
  const items: Contest[] = [...active, ...upcoming, ...bookmarkOnlyContests]

  const isUpcomingContest = (c: Contest) => active.indexOf(c) === -1 && upcoming.indexOf(c) >= 0
  const isEnded = (c: Contest) => bookmarkOnlyContests.indexOf(c) >= 0

  function refreshBookmarks() {
    const bms = loadBookmarks()
    setBookmarkSlugs(new Set(bms.map(b => b.slug)))
    setBookmarkedContests(bms.map(b => b.contest))
  }

  function flashStatus(msg: string) {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(null), 2500)
  }

  function openBugsView(contest: Contest) {
    const slug = slugify(contest['platform'] as string | undefined, contest['name'])
    setBugContest(contest)
    const loadedBugs = loadBugs(slug)
    setBugs(loadedBugs)
    setBugCursor(0)
    const metas: Record<string, PocMeta | null> = {}
    for (const b of loadedBugs) {
      if (b.pocId) metas[b.id] = loadPocMeta(slug, b.pocId)
    }
    setPocMetas(metas)
    setView('bugs')
  }

  function refreshPocMetas(slug: string, loadedBugs: Bug[]) {
    const metas: Record<string, PocMeta | null> = {}
    for (const b of loadedBugs) {
      if (b.pocId) metas[b.id] = loadPocMeta(slug, b.pocId)
    }
    setPocMetas(metas)
  }

  function openBugForm(bug?: Bug) {
    setEditingBug(bug ? { ...bug } : {})
    setBugFieldIdx(0)
    setBugFieldInput(bug ? String((bug as Record<string,unknown>)[BUG_FIELDS[0]!.key] ?? '') : '')
    setView('bug-form')
  }

  function saveBugForm() {
    if (!bugContest || !editingBug.title?.trim()) return
    const slug = slugify(bugContest['platform'] as string | undefined, bugContest['name'])
    ensureContestDir(slug)
    const bug: Bug = {
      id: editingBug.id ?? newBugId(),
      title: editingBug.title.trim(),
      pocId: editingBug.pocId,
      submissionUrl: editingBug.submissionUrl?.trim() || undefined,
      markdownPath: editingBug.markdownPath?.trim() || undefined,
      notes: editingBug.notes?.trim() || undefined,
      createdAt: editingBug.createdAt ?? Date.now(),
    }
    saveBug(slug, bug)
    const updated = loadBugs(slug)
    setBugs(updated)
    refreshPocMetas(slug, updated)
    setView('bugs')
  }

  // ─── Input handling ─────────────────────────────────────────────────────────

  useInput(useCallback((input: string, key: import('ink').Key) => {

    // PoC output view
    if (view === 'poc-output') {
      if (key.escape) { setView('bugs'); return }
      return
    }

    // Bug form mode
    if (view === 'bug-form') {
      if (key.escape) { setView('bugs'); return }
      if (key.return) {
        // save current field value
        const field = BUG_FIELDS[bugFieldIdx]
        if (!field) return
        const updated = { ...editingBug, [field.key]: bugFieldInput }
        if (bugFieldIdx < BUG_FIELDS.length - 1) {
          setEditingBug(updated)
          const next = bugFieldIdx + 1
          setBugFieldIdx(next)
          setBugFieldInput(String((updated as Record<string,unknown>)[BUG_FIELDS[next]!.key] ?? ''))
        } else {
          setEditingBug(updated)
          if (!bugContest || !updated.title?.trim()) { setView('bugs'); return }
          const slug = slugify(bugContest['platform'] as string | undefined, bugContest['name'])
          ensureContestDir(slug)
          const bug: Bug = {
            id: updated.id ?? newBugId(),
            title: updated.title.trim(),
            pocId: updated.pocId,
            submissionUrl: updated.submissionUrl?.trim() || undefined,
            markdownPath: updated.markdownPath?.trim() || undefined,
            notes: updated.notes?.trim() || undefined,
            createdAt: updated.createdAt ?? Date.now(),
          }
          saveBug(slug, bug)
          const refreshed = loadBugs(slug)
          setBugs(refreshed)
          refreshPocMetas(slug, refreshed)
          setView('bugs')
        }
        return
      }
      if (key.backspace || key.delete) { setBugFieldInput(v => v.slice(0, -1)); return }
      if (!key.ctrl && !key.meta && input.length === 1) { setBugFieldInput(v => v + input); return }
      return
    }

    // Bug list mode
    if (view === 'bugs') {
      if (key.escape) { setView('list'); return }
      if (key.upArrow) { setBugCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setBugCursor(c => Math.min(bugs.length - 1, c + 1)); return }
      if (input === 'n') { openBugForm(); return }
      if (input === 'e' && bugs[bugCursor]) { openBugForm(bugs[bugCursor]); return }
      if (input === 'r') {
        const bug = bugs[bugCursor]
        if (!bug?.pocId || !bugContest || runningBugId) return
        const slug = slugify(bugContest['platform'] as string | undefined, bugContest['name'])
        const meta = loadPocMeta(slug, bug.pocId)
        if (!meta) { flashStatus('PoC meta not found'); return }
        setRunningBugId(bug.id)
        runPocAsync(slug, meta).then(({ exitCode }) => {
          meta.lastExitCode = exitCode
          meta.lastRunAt = Date.now()
          if (exitCode === 0) meta.triage = 'in_progress'
          savePocMeta(slug, meta)
          setPocMetas(prev => ({ ...prev, [bug.id]: { ...meta, lastExitCode: exitCode, lastRunAt: Date.now() } }))
          setRunningBugId(null)
          flashStatus(`PoC ${exitCode === 0 ? '✓ passed' : `✗ failed (${exitCode})`}: ${meta.title}`)
        }).catch(err => {
          setRunningBugId(null)
          flashStatus(`PoC error: ${err instanceof Error ? err.message : String(err)}`)
        })
        return
      }
      if (input === 'o') {
        const bug = bugs[bugCursor]
        if (!bug?.pocId || !bugContest) return
        const slug = slugify(bugContest['platform'] as string | undefined, bugContest['name'])
        const out = loadPocOutput(slug, bug.pocId) ?? '(not run yet)'
        const meta = pocMetas[bug.id]
        setPocOutputTitle(`${meta?.title ?? bug.title}  exit:${meta?.lastExitCode ?? '-'}`)
        setPocOutputText(out)
        setView('poc-output')
        return
      }
      return
    }

    // Contest list mode
    if (key.escape || (key.ctrl && input === 'c')) { onClose(); return }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(items.length - 1, c + 1)); return }
    if (key.return) {
      const contest = items[cursor]
      if (contest?.['url']) openUrl(contest['url'] as string)
      return
    }
    if (input === 'b') {
      const contest = items[cursor]
      if (!contest) return
      const added = toggleBookmark(contest)
      refreshBookmarks()
      flashStatus(added ? `★ Bookmarked: ${contest['name']}` : `Removed bookmark: ${contest['name']}`)
      return
    }
    if (input === 'a') {
      const contest = items[cursor]
      if (!contest) return
      const err = spawnAuditPane(contest)
      flashStatus(err ?? `Spawned audit: ${contest['name']}`)
      return
    }
    if (input === 'g') {
      const contest = items[cursor]
      if (contest) openBugsView(contest)
      return
    }
  }, [view, items, cursor, bugs, bugCursor, bugFieldIdx, bugFieldInput, editingBug, bugContest, pocMetas, runningBugId, onClose]))

  // ─── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={theme.inactive}>Fetching contests from dailywarden.com...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column" gap={1}>
        <Text color={theme.error}>Failed to fetch contests: {error}</Text>
        <Text color={theme.inactive}>Esc close</Text>
      </Box>
    )
  }

  // ─── PoC output view ─────────────────────────────────────────────────────────

  if (view === 'poc-output') {
    const lines = pocOutputText.split('\n')
    const maxLines = height - 5
    const shown = lines.slice(-maxLines)
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Box gap={2}>
          <Text color={theme.brand} bold>PoC Output</Text>
          <Text color={theme.inactive}>{pocOutputTitle}</Text>
        </Box>
        <Box flexDirection="column">
          {shown.map((line, i) => (
            <Text key={i} color={theme.text} wrap="truncate">{line || ' '}</Text>
          ))}
        </Box>
        <Text color={theme.inactive}>Esc back</Text>
      </Box>
    )
  }



  if (view === 'bug-form') {
    const field = BUG_FIELDS[bugFieldIdx]
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Text color={theme.brand} bold>{editingBug.id ? 'Edit Bug' : 'New Bug'}  <Text color={theme.inactive} bold={false}>{bugContest?.['name']}</Text></Text>
        {BUG_FIELDS.map((f, i) => (
          <Box key={f.key} flexDirection="row" gap={1}>
            <Text color={i === bugFieldIdx ? theme.brand : theme.inactive}>{i === bugFieldIdx ? '›' : ' '}</Text>
            <Text color={theme.subtle} dimColor>{f.label.padEnd(16)}</Text>
            <Text color={i === bugFieldIdx ? theme.text : theme.inactive}>
              {i === bugFieldIdx ? bugFieldInput + '▋' : String((editingBug as Record<string,unknown>)[f.key] ?? '')}
            </Text>
          </Box>
        ))}
        <Text color={theme.inactive}>Enter next field  Esc cancel</Text>
      </Box>
    )
  }

  // ─── Bug list view ───────────────────────────────────────────────────────────

  if (view === 'bugs') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Box gap={2}>
          <Text color={theme.brand} bold>Bugs</Text>
          <Text color={theme.inactive}>{bugContest?.['name']}</Text>
          <Text color={theme.inactive}>{bugs.length} reported</Text>
          {runningBugId && <Text color={theme.brand}>↻ running...</Text>}
        </Box>
        {bugs.length === 0 && <Text color={theme.inactive}>No bugs yet  -  n to add one</Text>}
        {bugs.map((bug, i) => {
          const meta = pocMetas[bug.id]
          const isRunning = runningBugId === bug.id
          const pocBadge = isRunning ? '↻'
            : !bug.pocId ? '○'
            : meta?.lastExitCode === undefined ? '○'
            : meta.lastExitCode === 0 ? '✓'
            : '✗'
          const pocColor = isRunning ? theme.brand
            : !bug.pocId ? theme.inactive
            : meta?.lastExitCode === 0 ? '#4ade80'
            : meta?.lastExitCode !== undefined ? '#f87171'
            : theme.inactive
          return (
            <Box key={bug.id} flexDirection="row" gap={1}>
              <Text color={i === bugCursor ? theme.brand : theme.inactive}>{i === bugCursor ? '❯' : ' '}</Text>
              <Text color={pocColor}>{pocBadge}</Text>
              <Text color={i === bugCursor ? theme.text : theme.inactive} bold={i === bugCursor}>{bug.title}</Text>
              {bug.submissionUrl && <Text color={theme.subtle} dimColor> {bug.submissionUrl.slice(0, 40)}</Text>}
            </Box>
          )
        })}
        {bugs[bugCursor] && (
          <Box flexDirection="column" marginTop={1} gap={0}>
            {bugs[bugCursor].markdownPath && <Text color={theme.subtle}>md: {bugs[bugCursor].markdownPath}</Text>}
            {bugs[bugCursor].pocId && (
              <Text color={theme.subtle}>poc: {pocMetas[bugs[bugCursor].id]?.title ?? bugs[bugCursor].pocId}</Text>
            )}
            {bugs[bugCursor].notes && <Text color={theme.inactive}>{bugs[bugCursor].notes}</Text>}
          </Box>
        )}
        <Text color={theme.inactive}>↑↓ navigate  n new  e edit  r run poc  o poc output  Esc back</Text>
      </Box>
    )
  }

  // ─── Contest list view ───────────────────────────────────────────────────────

  const titleRight = (
    <Text color={theme.inactive}>
      {active.length} active  {upcoming.length} upcoming
      {fetchedAt ? `  ${new Date(fetchedAt).toLocaleTimeString()}` : ''}
    </Text>
  )

  return (
    <Box flexDirection="column">
      {statusMsg && (
        <Box paddingX={2}>
          <Text color={theme.brand}>{statusMsg}</Text>
        </Box>
      )}
      <SlashPicker
        items={items}
        selected={cursor}
        getKey={c => String(c['url'] ?? c['name'])}
        height={statusMsg ? height - 1 : height}
        cols={cols}
        accentColor={theme.brand}
        emptyText="No contests found"
        hintText="↑↓ nav  Enter open  a audit  b bookmark  g bugs  Esc close"
        variant="inline"
        title="Warden"
        titleRight={titleRight}
        renderRow={(contest, isActive, innerCols) => {
          const platform = `[${contest['platform'] ?? '?'}]`
          const prize = contest['potSize'] ? String(contest['potSize']) : ''
          const PRIZE_W = 20
          const prizeTrunc = prize.length > PRIZE_W ? prize.slice(0, PRIZE_W - 2) + '..' : prize

          const isUpcoming_ = isUpcomingContest(contest)
          const isEnded_ = isEnded(contest)
          const slug = slugify(contest['platform'] as string | undefined, contest['name'])
          const bookmarked = bookmarkSlugs.has(slug)
          const bugCount = isActive ? loadBugs(slug).length : 0

          const DATE_W = 11
          const dateTs = typeof contest['endDate'] === 'number'
            ? contest['endDate'] as number
            : typeof contest['startDate'] === 'number'
              ? contest['startDate'] as number
              : null
          const d = dateTs !== null ? Math.ceil((dateTs - Date.now()) / 86_400_000) : null
          const dateLabel = dateTs !== null
            ? isUpcoming_ ? `starts ${formatDate(dateTs)}`
              : d !== null && d <= 0 ? 'ends today' : `${d}d left`
            : isEnded_ ? 'ended' : ''
          const dateColor = dateTs !== null ? daysLeftColor(dateTs, isUpcoming_)
            : isEnded_ ? theme.inactive : '#6b7280'

          const BADGE_W = 2  // ★ or space
          const nameAvail = Math.max(8, innerCols - 10 - 20 - 11 - BADGE_W - 6 - 3)
          const name = String(contest['name'] ?? '')
          const nameTrunc = name.length > nameAvail ? name.slice(0, nameAvail - 2) + '..' : name
          const nameColor = (isUpcoming_ || isEnded_) ? theme.subtle : (isActive ? theme.text : theme.inactive)

          return (
            <Box flexDirection="row" gap={1}>
              <Box width={BADGE_W}><Text color="#f59e0b" wrap="truncate">{bookmarked ? '★' : ' '}</Text></Box>
              <Box width={10}><Text color={theme.subtle} dimColor wrap="truncate">{platform}</Text></Box>
              <Box width={nameAvail}><Text color={nameColor} bold={isActive && !isUpcoming_ && !isEnded_} dimColor={isUpcoming_ || isEnded_} wrap="truncate">{nameTrunc}</Text></Box>
              <Box width={PRIZE_W}><Text color={isActive ? theme.brand : theme.subtle} dimColor={isUpcoming_ || isEnded_} wrap="truncate">{prizeTrunc}</Text></Box>
              <Box width={DATE_W}><Text color={dateColor} wrap="truncate">{dateLabel}</Text></Box>
              {isActive && bugCount > 0 && <Text color={theme.subtle}> {bugCount}b</Text>}
            </Box>
          )
        }}
      />
    </Box>
  )
}

