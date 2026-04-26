// Unit tests for extra tools (nuc genome).
// Network tools (fetch_url, web_search) and AI tools (agent) are excluded.
// replTool runs real subprocesses. cronTool tests share in-memory state - cleaned
// between tests via the public API. configTool reads/writes ~/.agents/config.json
// (side-effects are acceptable in local dev).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  askUserTool,
  replTool,
  scheduleCronTool,
  cronListTool,
  cronDeleteTool,
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  createToolSearchTool,
  createTaskOutputTool,
  createConfigTool,
} from '../agent/extraTools.js'
import type { Tool } from '../agent/QueryEngine.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Remove all cron jobs created during a test via the public API. */
async function clearAllCronJobs(): Promise<void> {
  const list = String(await scheduleCronTool.execute({ action: 'list' }))
  if (list === 'No scheduled jobs') return
  const ids = list.split('\n').map(line => {
    const m = line.match(/^\[([a-f0-9]{8})\]/)
    return m?.[1]
  }).filter(Boolean) as string[]
  for (const id of ids) {
    await scheduleCronTool.execute({ action: 'remove', id })
  }
}

// ─── ask_user ─────────────────────────────────────────────────────────────────

describe('askUserTool', () => {
  test('empty question returns error immediately without blocking', async () => {
    const result = await askUserTool.execute({ question: '' })
    expect(String(result)).toMatch(/Error/)
  })

  test('whitespace-only question returns error', async () => {
    const result = await askUserTool.execute({ question: '   ' })
    expect(String(result)).toMatch(/Error/)
  })
})

// ─── repl ─────────────────────────────────────────────────────────────────────

describe('replTool', () => {
  test('executes node.js code and returns output', async () => {
    const result = await replTool.execute({ code: 'console.log(2 + 3)' })
    expect(String(result)).toBe('5')
  })

  test('executes python code and returns output', async () => {
    const result = await replTool.execute({ code: 'print(2 + 3)', language: 'python' })
    expect(String(result)).toBe('5')
  })

  test('empty code returns error', async () => {
    const result = await replTool.execute({ code: '' })
    expect(String(result)).toMatch(/Error/)
  })

  test('returns (no output) when code produces no stdout', async () => {
    const result = await replTool.execute({ code: 'const x = 1 + 1' })
    expect(String(result)).toBe('(no output)')
  })

  test('node syntax error returns stderr output, not throws', async () => {
    const result = await replTool.execute({ code: '{{{{invalid syntax' })
    expect(typeof result).toBe('string')
    expect(String(result).length).toBeGreaterThan(0)
  })

  test('python syntax error returns stderr, not throws', async () => {
    const result = await replTool.execute({ code: 'def (:', language: 'python' })
    expect(typeof result).toBe('string')
    expect(String(result).length).toBeGreaterThan(0)
  })

  test('default language is node', async () => {
    const result = await replTool.execute({ code: 'console.log("hello")' })
    expect(String(result)).toBe('hello')
  })
})

// ─── schedule_cron / cron_list / cron_delete ─────────────────────────────────

describe('scheduleCronTool', () => {
  beforeEach(clearAllCronJobs)
  afterEach(clearAllCronJobs)

  test('list returns no-jobs when empty', async () => {
    const result = await scheduleCronTool.execute({ action: 'list' })
    expect(String(result)).toBe('No scheduled jobs')
  })

  test('add: missing expression returns error', async () => {
    const result = await scheduleCronTool.execute({ action: 'add', command: 'echo hi' })
    expect(String(result)).toMatch(/Error/)
  })

  test('add: missing command returns error', async () => {
    const result = await scheduleCronTool.execute({ action: 'add', expression: '*/5 * * * *' })
    expect(String(result)).toMatch(/Error/)
  })

  test('add: valid job returns job ID in response', async () => {
    const result = await scheduleCronTool.execute({ action: 'add', expression: '*/5 * * * *', command: 'echo tick' })
    expect(String(result)).toMatch(/Scheduled job \[[a-f0-9]{8}\]/)
  })

  test('add: created job appears in list', async () => {
    await scheduleCronTool.execute({ action: 'add', expression: '*/2 * * * *', command: 'echo hi' })
    const list = String(await scheduleCronTool.execute({ action: 'list' }))
    expect(list).toContain('echo hi')
    expect(list).toContain('*/2 * * * *')
  })

  test('remove: removes a job by id', async () => {
    const added = String(await scheduleCronTool.execute({ action: 'add', expression: '*/3 * * * *', command: 'echo bye' }))
    const id = added.match(/\[([a-f0-9]{8})\]/)?.[1]
    expect(id).toBeDefined()
    const result = await scheduleCronTool.execute({ action: 'remove', id })
    expect(String(result)).toContain(`Removed job [${id}]`)
  })

  test('remove: unknown id returns job not found', async () => {
    const result = await scheduleCronTool.execute({ action: 'remove', id: 'deadbeef' })
    expect(String(result)).toMatch(/Job not found/)
  })

  test('unknown action returns error', async () => {
    const result = await scheduleCronTool.execute({ action: 'nuke' })
    expect(String(result)).toMatch(/Unknown action/)
  })
})

describe('cronListTool', () => {
  beforeEach(clearAllCronJobs)
  afterEach(clearAllCronJobs)

  test('returns no-jobs when empty', async () => {
    const result = await cronListTool.execute({})
    expect(String(result)).toBe('No scheduled jobs')
  })

  test('lists jobs added via scheduleCronTool', async () => {
    await scheduleCronTool.execute({ action: 'add', expression: '*/10 * * * *', command: 'echo x' })
    const result = String(await cronListTool.execute({}))
    expect(result).toContain('echo x')
    expect(result).toContain('*/10 * * * *')
  })
})

describe('cronDeleteTool', () => {
  beforeEach(clearAllCronJobs)
  afterEach(clearAllCronJobs)

  test('cancels an existing job', async () => {
    const added = String(await scheduleCronTool.execute({ action: 'add', expression: '*/1 * * * *', command: 'echo del' }))
    const id = added.match(/\[([a-f0-9]{8})\]/)?.[1]!
    const result = String(await cronDeleteTool.execute({ id }))
    expect(result).toContain(`Cancelled job [${id}]`)
  })

  test('job is gone after delete', async () => {
    const added = String(await scheduleCronTool.execute({ action: 'add', expression: '*/1 * * * *', command: 'echo gone' }))
    const id = added.match(/\[([a-f0-9]{8})\]/)?.[1]!
    await cronDeleteTool.execute({ id })
    const list = String(await cronListTool.execute({}))
    expect(list).toBe('No scheduled jobs')
  })

  test('unknown id returns job not found', async () => {
    const result = await cronDeleteTool.execute({ id: 'notareal0' })
    expect(String(result)).toMatch(/Job not found/)
  })
})

// ─── task_create / task_list / task_get / task_update ─────────────────────────

let tmpTaskDir: string

beforeEach(() => {
  tmpTaskDir = mkdtempSync(join(tmpdir(), 'agent-extratool-tasks-'))
  process.env['AGENT_TASKS_PATH'] = join(tmpTaskDir, 'tasks.json')
})

afterEach(() => {
  delete process.env['AGENT_TASKS_PATH']
  rmSync(tmpTaskDir, { recursive: true, force: true })
})

describe('taskCreateTool', () => {
  test('creates task and returns id in response', async () => {
    const result = String(await taskCreateTool.execute({ subject: 'Fix bug', description: 'Details here' }))
    expect(result).toMatch(/Created task \[/)
    expect(result).toContain('Fix bug')
  })

  test('missing subject returns error', async () => {
    const result = await taskCreateTool.execute({ subject: '', description: 'desc' })
    expect(String(result)).toMatch(/Error/)
  })

  test('missing description returns error', async () => {
    const result = await taskCreateTool.execute({ subject: 'title', description: '' })
    expect(String(result)).toMatch(/Error/)
  })

  test('accepts optional owner', async () => {
    const result = String(await taskCreateTool.execute({ subject: 'owned', description: 'desc', owner: 'alice' }))
    expect(result).toMatch(/Created task/)
  })

  test('accepts optional blockedBy array', async () => {
    const r1 = String(await taskCreateTool.execute({ subject: 'A', description: 'a' }))
    const id = r1.match(/\[([^\]]+)\]/)?.[1]!
    const r2 = String(await taskCreateTool.execute({ subject: 'B', description: 'b', blockedBy: [id] }))
    expect(r2).toMatch(/Created task/)
  })
})

describe('taskListTool', () => {
  test('returns "No tasks" when empty', async () => {
    const result = await taskListTool.execute({})
    expect(String(result)).toBe('No tasks')
  })

  test('lists tasks with id, status, subject', async () => {
    await taskCreateTool.execute({ subject: 'Alpha', description: 'first' })
    await taskCreateTool.execute({ subject: 'Beta', description: 'second' })
    const result = String(await taskListTool.execute({}))
    expect(result).toContain('Alpha')
    expect(result).toContain('Beta')
    expect(result).toContain('pending')
  })

  test('shows blocked-by info for dependent tasks', async () => {
    const r1 = String(await taskCreateTool.execute({ subject: 'Blocker', description: 'd' }))
    const id = r1.match(/\[([^\]]+)\]/)?.[1]!
    await taskCreateTool.execute({ subject: 'Dep', description: 'd', blockedBy: [id] })
    const list = String(await taskListTool.execute({}))
    expect(list).toContain('blocked by')
  })

  test('shows owner when set', async () => {
    await taskCreateTool.execute({ subject: 'My task', description: 'd', owner: 'bob' })
    const list = String(await taskListTool.execute({}))
    expect(list).toContain('bob')
  })
})

describe('taskGetTool', () => {
  test('returns task details for known id', async () => {
    const created = String(await taskCreateTool.execute({ subject: 'Lookup me', description: 'detailed desc' }))
    const id = created.match(/\[([^\]]+)\]/)?.[1]!
    const result = String(await taskGetTool.execute({ taskId: id }))
    expect(result).toContain('Lookup me')
    expect(result).toContain('detailed desc')
    expect(result).toContain('pending')
  })

  test('returns task not found for unknown id', async () => {
    const result = await taskGetTool.execute({ taskId: 'no-such-task' })
    expect(String(result)).toMatch(/Task not found/)
  })

  test('shows Blocks field when task is a prerequisite of another', async () => {
    const r1 = String(await taskCreateTool.execute({ subject: 'Prereq', description: 'd' }))
    const prereqId = r1.match(/\[([^\]]+)\]/)?.[1]!
    await taskCreateTool.execute({ subject: 'Dependent', description: 'd', blockedBy: [prereqId] })
    const details = String(await taskGetTool.execute({ taskId: prereqId }))
    expect(details).toContain('Blocks:')
  })

  test('shows Blocked by field for dependent task', async () => {
    const r1 = String(await taskCreateTool.execute({ subject: 'A', description: 'd' }))
    const aId = r1.match(/\[([^\]]+)\]/)?.[1]!
    const r2 = String(await taskCreateTool.execute({ subject: 'B', description: 'd', blockedBy: [aId] }))
    const bId = r2.match(/\[([^\]]+)\]/)?.[1]!
    const details = String(await taskGetTool.execute({ taskId: bId }))
    expect(details).toContain('Blocked by:')
  })
})

describe('taskUpdateTool', () => {
  test('updates status successfully', async () => {
    const created = String(await taskCreateTool.execute({ subject: 'Update me', description: 'd' }))
    const id = created.match(/\[([^\]]+)\]/)?.[1]!
    const result = String(await taskUpdateTool.execute({ taskId: id, status: 'in_progress' }))
    expect(result).toContain('Updated task')
    expect(result).toContain('status')
  })

  test('delete via status=deleted removes task', async () => {
    const created = String(await taskCreateTool.execute({ subject: 'Delete me', description: 'd' }))
    const id = created.match(/\[([^\]]+)\]/)?.[1]!
    const result = String(await taskUpdateTool.execute({ taskId: id, status: 'deleted' }))
    expect(result).toMatch(/Deleted task/)
    // Verify gone
    const afterList = String(await taskListTool.execute({}))
    expect(afterList).toBe('No tasks')
  })

  test('unknown id returns task not found', async () => {
    const result = await taskUpdateTool.execute({ taskId: 'ghost', status: 'completed' })
    expect(String(result)).toMatch(/Task not found/)
  })

  test('missing taskId returns error', async () => {
    const result = await taskUpdateTool.execute({ taskId: '' })
    expect(String(result)).toMatch(/Error/)
  })

  test('updates subject and description', async () => {
    const created = String(await taskCreateTool.execute({ subject: 'Old', description: 'old' }))
    const id = created.match(/\[([^\]]+)\]/)?.[1]!
    const result = String(await taskUpdateTool.execute({ taskId: id, subject: 'New', description: 'new' }))
    expect(result).toContain('subject')
    expect(result).toContain('description')
  })

  test('delete cascades blockedBy cleanup', async () => {
    const r1 = String(await taskCreateTool.execute({ subject: 'Blocker', description: 'd' }))
    const blockerId = r1.match(/\[([^\]]+)\]/)?.[1]!
    const r2 = String(await taskCreateTool.execute({ subject: 'Dep', description: 'd', blockedBy: [blockerId] }))
    const depId = r2.match(/\[([^\]]+)\]/)?.[1]!
    await taskUpdateTool.execute({ taskId: blockerId, status: 'deleted' })
    const details = String(await taskGetTool.execute({ taskId: depId }))
    expect(details).not.toContain('Blocked by:')
  })
})

// ─── createToolSearchTool ─────────────────────────────────────────────────────

describe('createToolSearchTool', () => {
  const mockTools: Tool[] = [
    {
      name: 'read_file',
      description: 'Read contents of a file from disk',
      input_schema: { type: 'object', properties: {}, required: [] },
      execute: async () => '',
    },
    {
      name: 'write_file',
      description: 'Write content to a file on disk',
      input_schema: { type: 'object', properties: {}, required: [] },
      execute: async () => '',
    },
    {
      name: 'web_search',
      description: 'Search the internet for current information',
      input_schema: { type: 'object', properties: {}, required: [] },
      execute: async () => '',
    },
  ]
  const toolSearch = createToolSearchTool(() => mockTools)

  test('finds tools by name substring', async () => {
    const result = String(await toolSearch.execute({ query: 'file' }))
    expect(result).toContain('read_file')
    expect(result).toContain('write_file')
    expect(result).not.toContain('web_search')
  })

  test('finds tools by description keyword (case-insensitive)', async () => {
    const result = String(await toolSearch.execute({ query: 'INTERNET' }))
    expect(result).toContain('web_search')
    expect(result).not.toContain('read_file')
  })

  test('returns no-match message for unknown query', async () => {
    const result = String(await toolSearch.execute({ query: 'xyzzy_does_not_exist' }))
    expect(result).toMatch(/No tools found/)
  })

  test('empty query returns error', async () => {
    const result = String(await toolSearch.execute({ query: '' }))
    expect(result).toMatch(/Error/)
  })

  test('result includes tool description snippet', async () => {
    const result = String(await toolSearch.execute({ query: 'read' }))
    expect(result).toContain('Read contents')
  })
})

// ─── createTaskOutputTool ─────────────────────────────────────────────────────

describe('createTaskOutputTool', () => {
  const taskOutput = createTaskOutputTool()

  test('returns no-tasks message when no background tasks', async () => {
    const result = await taskOutput.execute({})
    expect(String(result)).toBe('No background agent tasks')
  })

  test('unknown taskId returns not found', async () => {
    const result = await taskOutput.execute({ taskId: 'fake-task-id' })
    expect(String(result)).toMatch(/Background task not found/)
  })
})

// ─── createConfigTool ─────────────────────────────────────────────────────────

describe('createConfigTool', () => {
  test('get action returns config JSON', async () => {
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'get' }))
    // loadConfig returns {} if no config exists; either way it's parseable JSON
    expect(() => JSON.parse(result)).not.toThrow()
  })

  test('get with key returns key:value line', async () => {
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'get', key: 'model' }))
    expect(result).toMatch(/^model:/)
  })

  test('set model calls setModel callback', async () => {
    let called = ''
    const tool = createConfigTool({ setModel: (m) => { called = m }, setApiKey: () => {}, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'set', key: 'model', value: 'claude-sonnet-4-6' }))
    expect(called).toBe('claude-sonnet-4-6')
    expect(result).toContain('claude-sonnet-4-6')
  })

  test('set apiKey calls setApiKey and masks in response', async () => {
    let captured = ''
    const tool = createConfigTool({ setModel: () => {}, setApiKey: (k) => { captured = k }, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'set', key: 'apiKey', value: 'sk-ant-test1234' }))
    expect(captured).toBe('sk-ant-test1234')
    expect(result).toContain('1234')
    expect(result).not.toContain('sk-ant-test')
  })

  test('set verbose true calls setVerbose(true)', async () => {
    let captured: boolean | null = null
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: (v) => { captured = v } })
    const result = String(await tool.execute({ action: 'set', key: 'verbose', value: 'true' }))
    expect(captured).toBe<boolean | null>(true)
    expect(result).toContain('true')
  })

  test('set verbose false calls setVerbose(false)', async () => {
    let captured: boolean | null = null
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: (v) => { captured = v } })
    await tool.execute({ action: 'set', key: 'verbose', value: 'false' })
    expect(captured).toBe<boolean | null>(false)
  })

  test('set unknown key returns error', async () => {
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'set', key: 'theme', value: 'dark' }))
    expect(result).toMatch(/Unknown key/)
  })

  test('unknown action returns error', async () => {
    const tool = createConfigTool({ setModel: () => {}, setApiKey: () => {}, setVerbose: () => {} })
    const result = String(await tool.execute({ action: 'noop' }))
    expect(result).toMatch(/Unknown action/)
  })
})
