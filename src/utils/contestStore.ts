// contestStore.ts - persistence helpers for warden contests, bookmarks, and bugs.
// All data lives under ~/.agents/auditwizard/contests/<slug>/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { agentsDir, ensureAgentsDir } from '../config/agentsDir.js'
import type { Contest } from './wardenData.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Bug = {
  id: string
  title: string
  pocId?: string       // links to PocMeta.id in contests/<slug>/pocs/<pocId>/
  submissionUrl?: string
  markdownPath?: string
  pocPath?: string     // manual path reference (legacy / external pocs)
  notes?: string
  createdAt: number
}

export type BookmarkedContest = {
  slug: string
  contest: Contest
  bookmarkedAt: number
}

// ─── Slug ─────────────────────────────────────────────────────────────────────

export function slugify(platform: string | undefined, name: string): string {
  const raw = `${platform ?? 'unknown'}-${name}`
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function contestDir(slug: string): string {
  return agentsDir('auditwizard', 'contests', slug)
}

export function ensureContestDir(slug: string): string {
  return ensureAgentsDir('auditwizard', 'contests', slug)
}

function bugsPath(slug: string): string {
  return join(agentsDir('auditwizard', 'contests', slug), 'bugs.json')
}

function bookmarksPath(): string {
  return agentsDir('auditwizard', 'warden', 'bookmarks.json')
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export function loadBookmarks(): BookmarkedContest[] {
  const p = bookmarksPath()
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as BookmarkedContest[]
  } catch {
    return []
  }
}

export function saveBookmarks(bookmarks: BookmarkedContest[]): void {
  ensureAgentsDir('auditwizard', 'warden')
  writeFileSync(bookmarksPath(), JSON.stringify(bookmarks, null, 2))
}

export function toggleBookmark(contest: Contest): boolean {
  const slug = slugify(contest['platform'] as string | undefined, contest['name'])
  const bookmarks = loadBookmarks()
  const idx = bookmarks.findIndex(b => b.slug === slug)
  if (idx >= 0) {
    bookmarks.splice(idx, 1)
    saveBookmarks(bookmarks)
    return false  // removed
  } else {
    bookmarks.push({ slug, contest, bookmarkedAt: Date.now() })
    saveBookmarks(bookmarks)
    return true   // added
  }
}

export function isBookmarked(contest: Contest): boolean {
  const slug = slugify(contest['platform'] as string | undefined, contest['name'])
  return loadBookmarks().some(b => b.slug === slug)
}

// ─── Bugs ─────────────────────────────────────────────────────────────────────

export function loadBugs(slug: string): Bug[] {
  const p = bugsPath(slug)
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Bug[]
  } catch {
    return []
  }
}

export function saveBug(slug: string, bug: Bug): void {
  ensureContestDir(slug)
  const bugs = loadBugs(slug)
  const idx = bugs.findIndex(b => b.id === bug.id)
  if (idx >= 0) bugs[idx] = bug
  else bugs.push(bug)
  writeFileSync(bugsPath(slug), JSON.stringify(bugs, null, 2))
}

export function deleteBug(slug: string, bugId: string): void {
  const bugs = loadBugs(slug).filter(b => b.id !== bugId)
  ensureContestDir(slug)
  writeFileSync(bugsPath(slug), JSON.stringify(bugs, null, 2))
}

export function newBugId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ─── Contest meta snapshot ────────────────────────────────────────────────────

export function saveContestMeta(contest: Contest): string {
  const slug = slugify(contest['platform'] as string | undefined, contest['name'])
  ensureContestDir(slug)
  writeFileSync(join(contestDir(slug), 'meta.json'), JSON.stringify(contest, null, 2))
  // ensure pocs/ dir exists (and will be git-ignored separately)
  mkdirSync(join(contestDir(slug), 'pocs'), { recursive: true })
  mkdirSync(join(contestDir(slug), 'code'), { recursive: true })
  return slug
}
