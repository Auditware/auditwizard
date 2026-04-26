// taskStore - Persistent task board backed by ~/.agents/tasks.json.
// Atomic writes (temp file + rename) protect against crashes.
// Safe for single-process concurrent use (sync I/O serializes in Node/Bun).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { homedir, tmpdir } from 'os'
import { agentsDir } from '../config/agentsDir.js'

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

export type Task = {
  id: string
  subject: string
  description: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]   // IDs of tasks that must complete before this one
  createdAt: number
  updatedAt: number
}

import { instanceName } from '../config/AgentConfig.js'

const TASKS_PATH = () => process.env['AGENT_TASKS_PATH'] ?? agentsDir(instanceName(), 'tasks.json')

function ensureDir(): void {
  const dir = dirname(TASKS_PATH())
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadTasks(): Task[] {
  try {
    if (!existsSync(TASKS_PATH())) return []
    return JSON.parse(readFileSync(TASKS_PATH(), 'utf8')) as Task[]
  } catch {
    return []
  }
}

function saveTasks(tasks: Task[]): void {
  ensureDir()
  const tmp = join(tmpdir(), `agent-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8')
  renameSync(tmp, TASKS_PATH())
}

export function createTask(
  subject: string,
  description: string,
  owner?: string,
  blockedBy: string[] = [],
): Task {
  const tasks = loadTasks()
  const task: Task = {
    id: crypto.randomUUID().slice(0, 8),
    subject,
    description,
    status: 'pending',
    owner,
    blockedBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  tasks.push(task)
  saveTasks(tasks)
  return task
}

export function getTask(id: string): Task | undefined {
  return loadTasks().find(t => t.id === id)
}

export function listTasks(): Task[] {
  return loadTasks()
}

// Derive which tasks a given task blocks (reverse of blockedBy)
export function getBlockedTasks(id: string): string[] {
  return loadTasks()
    .filter(t => t.blockedBy.includes(id))
    .map(t => t.id)
}

export function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
): Task | null {
  const tasks = loadTasks()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return null
  const task = tasks[idx]!
  Object.assign(task, { ...updates, updatedAt: Date.now() })
  saveTasks(tasks)
  return task
}

// Deletes a task and removes it from all other tasks' blockedBy arrays.
export function deleteTask(id: string): boolean {
  const tasks = loadTasks()
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return false
  tasks.splice(idx, 1)
  // Cascade: remove deleted id from blockedBy of remaining tasks
  for (const task of tasks) {
    task.blockedBy = task.blockedBy.filter(bid => bid !== id)
  }
  saveTasks(tasks)
  return true
}
