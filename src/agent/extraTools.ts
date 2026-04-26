// Extra tools: AskUserQuestion, REPL, ScheduleCron, ConfigTool, AgentTool,
// CronList, CronDelete, Brief, Task CRUD, ToolSearch, TaskOutput.
// Factories (createConfigTool, createAgentTool, etc.) take narrow interfaces to avoid
// leaking implementation details across remounts.

import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import { userInputChannel } from '../utils/userInputChannel.js'
import { briefChannel } from '../utils/briefChannel.js'
import type { Tool } from './QueryEngine.js'
import { BUILTIN_TOOLS } from './tools.js'
import { saveConfig, loadConfig } from '../config/AgentConfig.js'
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  getBlockedTasks,
  type TaskStatus,
} from './taskStore.js'

// ─── ask_user ─────────────────────────────────────────────────────────────────

export const askUserTool: Tool = {
  name: 'ask_user',
  description: 'Ask the user a question and wait for their response before continuing. Use when you need clarification, a decision, or information only the user can provide.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of suggested answers to present as choices',
      },
    },
    required: ['question'],
  },
  async execute(input) {
    const question = String(input['question'] ?? '').trim()
    const options = Array.isArray(input['options']) ? (input['options'] as string[]) : undefined
    if (!question) return 'Error: question is required'
    const answer = await userInputChannel.ask(question, options)
    return answer
  },
}

// ─── repl ─────────────────────────────────────────────────────────────────────

export const replTool: Tool = {
  name: 'repl',
  description: 'Execute code in a Node.js or Python3 subprocess. Great for calculations, data transformations, scripting, and testing code snippets. Note: state is not shared between calls.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Code to execute' },
      language: {
        type: 'string',
        enum: ['node', 'python'],
        description: 'Language runtime (default: node)',
      },
    },
    required: ['code'],
  },
  async execute(input) {
    const code = String(input['code'] ?? '').trim()
    const language = input['language'] === 'python' ? 'python' : 'node'
    if (!code) return 'Error: code is required'

    const ext = language === 'python' ? 'py' : 'cjs'
    const tmpFile = `/tmp/agent-repl-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    try {
      writeFileSync(tmpFile, code, 'utf8')
      const cmd = language === 'python'
        ? `python3 ${JSON.stringify(tmpFile)}`
        : `node ${JSON.stringify(tmpFile)}`
      const out = execSync(cmd, {
        encoding: 'utf8',
        timeout: 30_000,
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return out.trim() || '(no output)'
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const e = err as { stdout: string; stderr: string }
        return [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || 'Process exited with non-zero code'
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      try { unlinkSync(tmpFile) } catch { /* ignore */ }
    }
  },
}

// ─── schedule_cron ────────────────────────────────────────────────────────────

type CronJob = {
  id: string
  expression: string
  command: string
  lastRunAt: number | null
  nextRunAt: number
  runCount: number
}

const cronJobs = new Map<string, CronJob>()
let cronIntervalId: ReturnType<typeof setInterval> | null = null

function parseCronNextRun(expression: string): number {
  // Simple cron parser supporting: */N (every N units), fixed values
  // Supports only 5-field cron: min hour dom mon dow
  // For simplicity: only handles */N patterns and exact values
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5) throw new Error('Cron expression must have 5 fields: min hour dom mon dow')
  const [minPart] = parts
  // Parse the minute field as a base case: */N means every N minutes
  const everyN = minPart?.startsWith('*/') ? parseInt(minPart.slice(2), 10) : null
  if (everyN && !isNaN(everyN)) {
    return Date.now() + everyN * 60_000
  }
  // For anything else, default to running in 1 minute
  return Date.now() + 60_000
}

function startCronRunner(): void {
  if (cronIntervalId) return
  cronIntervalId = setInterval(() => {
    const now = Date.now()
    for (const job of cronJobs.values()) {
      if (now < job.nextRunAt) continue
      job.lastRunAt = now
      job.runCount++
      try {
        execSync(job.command, { encoding: 'utf8', timeout: 30_000, stdio: 'pipe' })
      } catch { /* log or ignore - we're in a background timer */ }
      try { job.nextRunAt = parseCronNextRun(job.expression) }
      catch { cronJobs.delete(job.id) }
    }
  }, 10_000) // check every 10 seconds
}

export const scheduleCronTool: Tool = {
  name: 'schedule_cron',
  description: 'Schedule a shell command to run periodically within this session. Jobs are lost on restart. Use "*/N * * * *" syntax for every-N-minutes intervals (e.g. "*/5 * * * *" for every 5 minutes). Only minute-interval scheduling (*/N in the minute field) is supported.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'list'],
        description: 'Action to perform',
      },
      expression: { type: 'string', description: 'Cron expression, e.g. "*/5 * * * *" (required for add)' },
      command: { type: 'string', description: 'Shell command to run (required for add)' },
      id: { type: 'string', description: 'Job ID to remove (required for remove)' },
    },
    required: ['action'],
  },
  async execute(input) {
    const action = String(input['action'] ?? 'list')
    if (action === 'list') {
      if (cronJobs.size === 0) return 'No scheduled jobs'
      return [...cronJobs.values()].map(j =>
        `[${j.id}] ${j.expression} → ${j.command} (runs: ${j.runCount}, next: ${new Date(j.nextRunAt).toISOString()})`
      ).join('\n')
    }
    if (action === 'add') {
      const expr = String(input['expression'] ?? '').trim()
      const cmd = String(input['command'] ?? '').trim()
      if (!expr) return 'Error: expression is required'
      if (!cmd) return 'Error: command is required'
      let nextRunAt: number
      try { nextRunAt = parseCronNextRun(expr) }
      catch (e) { return `Error parsing cron expression: ${e instanceof Error ? e.message : String(e)}` }
      const id = crypto.randomUUID().slice(0, 8)
      cronJobs.set(id, { id, expression: expr, command: cmd, lastRunAt: null, nextRunAt, runCount: 0 })
      startCronRunner()
      return `Scheduled job [${id}]: "${expr}" → ${cmd} (next: ${new Date(nextRunAt).toISOString()})`
    }
    if (action === 'remove') {
      const id = String(input['id'] ?? '')
      if (!cronJobs.has(id)) return `Job not found: ${id}`
      cronJobs.delete(id)
      if (cronJobs.size === 0 && cronIntervalId) {
        clearInterval(cronIntervalId)
        cronIntervalId = null
      }
      return `Removed job [${id}]`
    }
    return `Unknown action: ${action}`
  },
}

// ─── cron_list ────────────────────────────────────────────────────────────────

export const cronListTool: Tool = {
  name: 'cron_list',
  description: 'List all active scheduled cron jobs in this session.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute() {
    if (cronJobs.size === 0) return 'No scheduled jobs'
    return [...cronJobs.values()].map(j =>
      `[${j.id}] ${j.expression} → ${j.command} (runs: ${j.runCount}, next: ${new Date(j.nextRunAt).toISOString()})`
    ).join('\n')
  },
}

// ─── cron_delete ──────────────────────────────────────────────────────────────

export const cronDeleteTool: Tool = {
  name: 'cron_delete',
  description: 'Cancel a scheduled cron job by its ID (from cron_list).',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Job ID to cancel' },
    },
    required: ['id'],
  },
  async execute(input) {
    const id = String(input['id'] ?? '').trim()
    if (!cronJobs.has(id)) return `Job not found: ${id}`
    cronJobs.delete(id)
    if (cronJobs.size === 0 && cronIntervalId) {
      clearInterval(cronIntervalId)
      cronIntervalId = null
    }
    return `Cancelled job [${id}]`
  },
}

// ─── brief ────────────────────────────────────────────────────────────────────

export const briefTool: Tool = {
  name: 'brief',
  description: 'Send an explicit message to the user - useful for background agents to surface updates. Use status "proactive" for unsolicited updates (task completion, blockers) and "normal" for direct replies.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The message to send. Supports markdown.' },
      status: {
        type: 'string',
        enum: ['normal', 'proactive'],
        description: '"proactive" for unsolicited updates, "normal" for direct replies',
      },
    },
    required: ['message'],
  },
  async execute(input) {
    const message = String(input['message'] ?? '').trim()
    const status = input['status'] === 'proactive' ? 'proactive' as const : 'normal' as const
    if (!message) return 'Error: message is required'
    briefChannel.send(message, status)
    return 'Message delivered to user.'
  },
}

// ─── task_create ──────────────────────────────────────────────────────────────

export const taskCreateTool: Tool = {
  name: 'task_create',
  description: 'Create a task on the shared task board (~/.agents/tasks.json). Use for multi-step work tracking or coordinating sub-tasks in a swarm.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Brief title for the task' },
      description: { type: 'string', description: 'What needs to be done' },
      owner: { type: 'string', description: 'Agent or user who owns this task (optional)' },
      blockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that must complete before this task can start (optional)',
      },
    },
    required: ['subject', 'description'],
  },
  async execute(input) {
    const subject = String(input['subject'] ?? '').trim()
    const description = String(input['description'] ?? '').trim()
    if (!subject) return 'Error: subject is required'
    if (!description) return 'Error: description is required'
    const owner = input['owner'] ? String(input['owner']) : undefined
    const blockedBy = Array.isArray(input['blockedBy']) ? (input['blockedBy'] as string[]) : []
    const task = createTask(subject, description, owner, blockedBy)
    return `Created task [${task.id}]: ${task.subject}`
  },
}

// ─── task_list ────────────────────────────────────────────────────────────────

export const taskListTool: Tool = {
  name: 'task_list',
  description: 'List all tasks on the task board with their status, owner, and blockers.',
  input_schema: { type: 'object', properties: {}, required: [] },
  async execute() {
    const tasks = listTasks()
    if (tasks.length === 0) return 'No tasks'
    return tasks.map(t => {
      const blocked = t.blockedBy.length > 0 ? ` [blocked by: ${t.blockedBy.join(', ')}]` : ''
      const owner = t.owner ? ` (${t.owner})` : ''
      return `[${t.id}] [${t.status}] ${t.subject}${owner}${blocked}`
    }).join('\n')
  },
}

// ─── task_get ─────────────────────────────────────────────────────────────────

export const taskGetTool: Tool = {
  name: 'task_get',
  description: 'Get full details for a task by ID, including what tasks it blocks.',
  input_schema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
    },
    required: ['taskId'],
  },
  async execute(input) {
    const id = String(input['taskId'] ?? '').trim()
    const task = getTask(id)
    if (!task) return `Task not found: ${id}`
    const blocks = getBlockedTasks(id)
    const lines = [
      `Task [${task.id}]: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ]
    if (task.owner) lines.push(`Owner: ${task.owner}`)
    if (task.blockedBy.length > 0) lines.push(`Blocked by: ${task.blockedBy.join(', ')}`)
    if (blocks.length > 0) lines.push(`Blocks: ${blocks.join(', ')}`)
    return lines.join('\n')
  },
}

// ─── task_update ──────────────────────────────────────────────────────────────

export const taskUpdateTool: Tool = {
  name: 'task_update',
  description: 'Update a task\'s status, subject, description, owner, or blockedBy. Set status to "deleted" to remove the task (cascades blockedBy cleanup).',
  input_schema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to update' },
      subject: { type: 'string', description: 'New subject' },
      description: { type: 'string', description: 'New description' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'blocked', 'deleted'],
        description: 'New status. Use "deleted" to permanently remove the task.',
      },
      owner: { type: 'string', description: 'New owner' },
      blockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replace the full blockedBy list with these task IDs',
      },
    },
    required: ['taskId'],
  },
  async execute(input) {
    const id = String(input['taskId'] ?? '').trim()
    if (!id) return 'Error: taskId is required'

    const status = input['status'] ? String(input['status']) : undefined

    if (status === 'deleted') {
      const deleted = deleteTask(id)
      return deleted ? `Deleted task [${id}]` : `Task not found: ${id}`
    }

    const updates: Record<string, unknown> = {}
    if (input['subject']) updates['subject'] = String(input['subject'])
    if (input['description']) updates['description'] = String(input['description'])
    if (status) updates['status'] = status as TaskStatus
    if (input['owner']) updates['owner'] = String(input['owner'])
    if (Array.isArray(input['blockedBy'])) updates['blockedBy'] = input['blockedBy']

    const task = updateTask(id, updates as Partial<Parameters<typeof updateTask>[1]>)
    if (!task) return `Task not found: ${id}`
    return `Updated task [${id}]: ${Object.keys(updates).join(', ')}`
  },
}

// ─── tool_search factory ──────────────────────────────────────────────────────

export function createToolSearchTool(getTools: () => Tool[]): Tool {
  return {
    name: 'tool_search',
    description: 'Search available tools by name or keyword. Returns matching tool names and descriptions. Useful when you need to discover what tools are available for a specific purpose.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords or partial tool name to search for' },
      },
      required: ['query'],
    },
    async execute(input) {
      const query = String(input['query'] ?? '').trim().toLowerCase()
      if (!query) return 'Error: query is required'
      const tools = getTools()
      const results = tools.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
      )
      if (results.length === 0) return `No tools found matching: "${query}"`
      return results.map(t => `${t.name}: ${t.description.slice(0, 120)}`).join('\n')
    },
  }
}

// ─── background agent task tracking ──────────────────────────────────────────

type BackgroundAgentTask = {
  id: string
  task: string
  status: 'running' | 'completed' | 'failed'
  result: string | null
  startedAt: number
  completedAt?: number
}

const backgroundTasks = new Map<string, BackgroundAgentTask>()
const MAX_BG_TASKS = 20

function registerBackgroundTask(task: BackgroundAgentTask): void {
  // Drop oldest completed entry if at capacity
  if (backgroundTasks.size >= MAX_BG_TASKS) {
    for (const [k, v] of backgroundTasks) {
      if (v.status !== 'running') {
        backgroundTasks.delete(k)
        break
      }
    }
  }
  backgroundTasks.set(task.id, task)
}

// ─── task_output factory ──────────────────────────────────────────────────────

export function createTaskOutputTool(): Tool {
  return {
    name: 'task_output',
    description: 'Check the status and output of a background agent task started with agent(run_in_background: true). Omit taskId to list all background tasks. Note: background task results are stored in-memory and lost on restart.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Background task ID (omit to list all)' },
      },
      required: [],
    },
    async execute(input) {
      const taskId = input['taskId'] ? String(input['taskId']).trim() : undefined

      if (!taskId) {
        if (backgroundTasks.size === 0) return 'No background agent tasks'
        return [...backgroundTasks.values()].map(t => {
          const elapsed = Math.round(((t.completedAt ?? Date.now()) - t.startedAt) / 1000)
          return `[${t.id}] [${t.status}] ${t.task.slice(0, 60)} (${elapsed}s)`
        }).join('\n')
      }

      const task = backgroundTasks.get(taskId)
      if (!task) return `Background task not found: ${taskId}`

      const elapsed = Math.round(((task.completedAt ?? Date.now()) - task.startedAt) / 1000)
      const lines = [`Task [${task.id}]: ${task.status} (${elapsed}s)`]
      if (task.status === 'running') {
        lines.push('Still running...')
      } else {
        lines.push(`Result:\n${task.result}`)
      }
      return lines.join('\n')
    },
  }
}

export type ConfigActions = {
  setModel: (model: string) => void
  setApiKey: (key: string) => void
  setVerbose: (verbose: boolean) => void
}

export function createConfigTool(actions: ConfigActions): Tool {
  return {
    name: 'config',
    description: 'Read or update agent configuration settings mid-conversation. Supported keys: model (e.g. "claude-opus-4-5"), apiKey, verbose (true/false).',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set'],
          description: '"get" to read current config, "set" to update a value',
        },
        key: {
          type: 'string',
          enum: ['model', 'apiKey', 'verbose'],
          description: 'Config key to get or set',
        },
        value: { type: 'string', description: 'New value (required for set)' },
      },
      required: ['action'],
    },
    async execute(input) {
      const action = String(input['action'] ?? 'get')
      const key = String(input['key'] ?? '')
      if (action === 'get') {
        const cfg = await loadConfig()
        if (key) return `${key}: ${JSON.stringify((cfg as Record<string, unknown>)[key] ?? null)}`
        return JSON.stringify(cfg, null, 2)
      }
      if (action === 'set') {
        const value = String(input['value'] ?? '')
        if (key === 'model') {
          actions.setModel(value)
          await saveConfig({ model: value })
          return `Model set to: ${value}`
        }
        if (key === 'apiKey') {
          actions.setApiKey(value)
          return `API key updated (last 4: ••••${value.slice(-4)})`
        }
        if (key === 'verbose') {
          const verbose = value === 'true' || value === '1'
          actions.setVerbose(verbose)
          await saveConfig({ verbose })
          return `Verbose: ${verbose}`
        }
        return `Unknown key: ${key}. Supported: model, apiKey, verbose`
      }
      return `Unknown action: ${action}`
    },
  }
}

// ─── agent_tool factory ───────────────────────────────────────────────────────

// Sub-agent tools: a subset of BUILTIN_TOOLS that is safe for headless use.
// Excludes ask_user (deadlocks), config/schedule_cron (conflicts), brief (no UI).
// Includes task_* tools so swarm agents can coordinate via the task board.
const AGENT_SAFE_TOOL_NAMES = [
  'bash', 'read_file', 'write_file', 'edit_file', 'grep', 'glob',
  'fetch_url', 'web_search', 'sleep', 'todo_write',
  'task_create', 'task_list', 'task_get', 'task_update',
]

function buildAgentToolList(extra: Tool[] = []): Tool[] {
  const builtins = BUILTIN_TOOLS.filter(t => AGENT_SAFE_TOOL_NAMES.includes(t.name))
  const extraSafe = extra.filter(t => AGENT_SAFE_TOOL_NAMES.includes(t.name))
  return [...builtins, ...extraSafe]
}

async function runSubAgent(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  initialMessages: Anthropic.Messages.MessageParam[],
  agentTools: Tool[],
): Promise<string> {
  const apiTools: Anthropic.Messages.Tool[] = agentTools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
  }))

  const messages = [...initialMessages]
  const MAX_ITER = 15

  for (let i = 0; i < MAX_ITER; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: apiTools,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find(b => b.type === 'text')
      return textBlock?.type === 'text' ? textBlock.text : '(sub-agent produced no text output)'
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const tool = agentTools.find(t => t.name === block.name)
      let result: string
      if (tool) {
        try { result = await tool.execute(block.input as Record<string, unknown>) }
        catch (e) { result = `Error: ${e instanceof Error ? e.message : String(e)}` }
      } else {
        result = `Unknown tool: ${block.name}`
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return 'Sub-agent reached max iterations without producing a final response'
}

export function createAgentTool(
  getApiKey: () => string | undefined,
  getTranscriptForFork?: () => Anthropic.Messages.MessageParam[],
): Tool {
  return {
    name: 'agent',
    description: 'Spawn a sub-agent to handle a self-contained sub-task. ' +
      'Set run_in_background: true to run async (returns task ID, poll with task_output). ' +
      'Set fork: true to give the sub-agent your full conversation context. ' +
      'Good for delegating complex research or parallel work.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Full description of the task for the sub-agent' },
        model: { type: 'string', description: 'Model to use (default: claude-haiku-4-5)' },
        run_in_background: {
          type: 'boolean',
          description: 'Run async - returns a task ID immediately. Use task_output to check results.',
        },
        fork: {
          type: 'boolean',
          description: 'Inherit parent conversation context (last 40 messages). Useful for continuations.',
        },
      },
      required: ['task'],
    },
    async execute(input) {
      const task = String(input['task'] ?? '').trim()
      const model = String(input['model'] ?? 'claude-haiku-4-5')
      const runInBackground = Boolean(input['run_in_background'])
      const fork = Boolean(input['fork'])
      if (!task) return 'Error: task is required'

      const apiKey = getApiKey()
      const client = new Anthropic({ apiKey })

      const agentTools = buildAgentToolList([
        taskCreateTool, taskListTool, taskGetTool, taskUpdateTool,
      ])

      // Build initial messages - fork inherits parent transcript
      let initialMessages: Anthropic.Messages.MessageParam[]
      if (fork && getTranscriptForFork) {
        const parentSnap = getTranscriptForFork()
        initialMessages = [...parentSnap, { role: 'user', content: `[Delegated sub-task]: ${task}` }]
      } else {
        initialMessages = [{ role: 'user', content: task }]
      }

      const systemPrompt = fork
        ? 'You are a focused sub-agent continuing from the parent conversation. Complete the delegated sub-task using available tools, then respond with your final result.'
        : 'You are a focused sub-agent. Complete the given task using available tools, then respond with your final result.'

      if (runInBackground) {
        const taskId = crypto.randomUUID().slice(0, 8)
        const bgTask: BackgroundAgentTask = {
          id: taskId,
          task,
          status: 'running',
          result: null,
          startedAt: Date.now(),
        }
        registerBackgroundTask(bgTask)

        // Fire and forget - updates bgTask in-place
        runSubAgent(client, model, systemPrompt, initialMessages, agentTools)
          .then(result => {
            bgTask.status = 'completed'
            bgTask.result = result
            bgTask.completedAt = Date.now()
          })
          .catch(err => {
            bgTask.status = 'failed'
            bgTask.result = `Error: ${err instanceof Error ? err.message : String(err)}`
            bgTask.completedAt = Date.now()
          })

        return `Background agent started [${taskId}]. Use task_output to check status and retrieve results.`
      }

      return runSubAgent(client, model, systemPrompt, initialMessages, agentTools)
    },
  }
}
