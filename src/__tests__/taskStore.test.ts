import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  getBlockedTasks,
  type Task,
  type TaskStatus,
} from '../agent/taskStore.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agent-tasks-'))
  process.env['AGENT_TASKS_PATH'] = join(tmpDir, 'tasks.json')
})

afterEach(() => {
  delete process.env['AGENT_TASKS_PATH']
  rmSync(tmpDir, { recursive: true, force: true })
})

// ─── createTask ───────────────────────────────────────────────────────────────

describe('createTask', () => {
  test('creates a task with default status pending', () => {
    const t = createTask('fix bug', 'describe the bug')
    expect(t.subject).toBe('fix bug')
    expect(t.description).toBe('describe the bug')
    expect(t.status).toBe('pending')
    expect(t.blockedBy).toEqual([])
    expect(typeof t.id).toBe('string')
    expect(t.id.length).toBeGreaterThan(0)
  })

  test('persists to disk so listTasks returns it', () => {
    createTask('task A', 'desc A')
    const tasks = listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.subject).toBe('task A')
  })

  test('assigns unique IDs for multiple tasks', () => {
    const a = createTask('A', '')
    const b = createTask('B', '')
    const c = createTask('C', '')
    const ids = new Set([a.id, b.id, c.id])
    expect(ids.size).toBe(3)
  })

  test('accepts optional owner', () => {
    const t = createTask('owned task', 'desc', 'alice')
    expect(t.owner).toBe('alice')
  })

  test('accepts blockedBy array', () => {
    const blocker = createTask('prerequisite', '')
    const dependent = createTask('dependent', '', undefined, [blocker.id])
    expect(dependent.blockedBy).toContain(blocker.id)
  })

  test('sets createdAt and updatedAt timestamps', () => {
    const before = Date.now()
    const t = createTask('timed', '')
    const after = Date.now()
    expect(t.createdAt).toBeGreaterThanOrEqual(before)
    expect(t.createdAt).toBeLessThanOrEqual(after)
    expect(t.updatedAt).toBe(t.createdAt)
  })
})

// ─── getTask ──────────────────────────────────────────────────────────────────

describe('getTask', () => {
  test('returns task by id', () => {
    const t = createTask('find me', '')
    const found = getTask(t.id)
    expect(found).toBeDefined()
    expect(found!.subject).toBe('find me')
  })

  test('returns undefined for unknown id', () => {
    expect(getTask('does-not-exist')).toBeUndefined()
  })
})

// ─── listTasks ────────────────────────────────────────────────────────────────

describe('listTasks', () => {
  test('returns empty array when no tasks', () => {
    expect(listTasks()).toEqual([])
  })

  test('returns all tasks in insertion order', () => {
    createTask('first', '')
    createTask('second', '')
    createTask('third', '')
    const subjects = listTasks().map(t => t.subject)
    expect(subjects).toEqual(['first', 'second', 'third'])
  })
})

// ─── updateTask ───────────────────────────────────────────────────────────────

describe('updateTask', () => {
  test('updates status', () => {
    const t = createTask('update me', '')
    const updated = updateTask(t.id, { status: 'in_progress' })
    expect(updated!.status).toBe('in_progress')
    expect(getTask(t.id)!.status).toBe('in_progress')
  })

  test('updates subject and description', () => {
    const t = createTask('old subject', 'old desc')
    updateTask(t.id, { subject: 'new subject', description: 'new desc' })
    const loaded = getTask(t.id)!
    expect(loaded.subject).toBe('new subject')
    expect(loaded.description).toBe('new desc')
  })

  test('updates updatedAt but not createdAt', () => {
    const t = createTask('ts test', '')
    const origCreated = t.createdAt
    // force a tick
    const updated = updateTask(t.id, { status: 'completed' })
    expect(updated!.createdAt).toBe(origCreated)
    // updatedAt >= createdAt
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(origCreated)
  })

  test('accepts all valid statuses', () => {
    const statuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'blocked']
    const t = createTask('status cycle', '')
    for (const s of statuses) {
      const u = updateTask(t.id, { status: s })
      expect(u!.status).toBe(s)
    }
  })

  test('returns null for unknown id', () => {
    expect(updateTask('no-such-id', { status: 'completed' })).toBeNull()
  })

  test('can update blockedBy list', () => {
    const a = createTask('A', '')
    const b = createTask('B', '')
    updateTask(b.id, { blockedBy: [a.id] })
    expect(getTask(b.id)!.blockedBy).toContain(a.id)
  })
})

// ─── deleteTask ───────────────────────────────────────────────────────────────

describe('deleteTask', () => {
  test('removes task from store', () => {
    const t = createTask('delete me', '')
    expect(deleteTask(t.id)).toBe(true)
    expect(getTask(t.id)).toBeUndefined()
    expect(listTasks()).toHaveLength(0)
  })

  test('returns false for unknown id', () => {
    expect(deleteTask('ghost')).toBe(false)
  })

  test('cascades: removes deleted id from other tasks blockedBy', () => {
    const a = createTask('A', '')
    const b = createTask('B', '', undefined, [a.id])
    expect(getTask(b.id)!.blockedBy).toContain(a.id)

    deleteTask(a.id)
    expect(getTask(b.id)!.blockedBy).not.toContain(a.id)
  })

  test('only removes targeted task, not others', () => {
    const a = createTask('A', '')
    const b = createTask('B', '')
    deleteTask(a.id)
    expect(listTasks()).toHaveLength(1)
    expect(listTasks()[0]!.id).toBe(b.id)
  })
})

// ─── getBlockedTasks ──────────────────────────────────────────────────────────

describe('getBlockedTasks', () => {
  test('returns IDs of tasks that are blocked by the given task', () => {
    const a = createTask('blocker', '')
    const b = createTask('blocked-1', '', undefined, [a.id])
    const c = createTask('blocked-2', '', undefined, [a.id])
    const d = createTask('unrelated', '')

    const blocked = getBlockedTasks(a.id)
    expect(blocked).toContain(b.id)
    expect(blocked).toContain(c.id)
    expect(blocked).not.toContain(d.id)
    expect(blocked).not.toContain(a.id)
  })

  test('returns empty array when nothing is blocked by the given task', () => {
    const t = createTask('solo', '')
    expect(getBlockedTasks(t.id)).toEqual([])
  })
})

// ─── persistence ──────────────────────────────────────────────────────────────

describe('persistence', () => {
  test('multiple operations survive re-reads from disk', () => {
    const a = createTask('alpha', 'first task')
    const b = createTask('beta', 'second task', 'owner1')
    updateTask(a.id, { status: 'in_progress' })
    deleteTask(b.id)

    const tasks = listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe(a.id)
    expect(tasks[0]!.status).toBe('in_progress')
  })

  test('loading from non-existent path returns empty array', () => {
    // Delete any existing file
    expect(listTasks()).toEqual([])
  })
})
