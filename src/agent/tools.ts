// Built-in tools available to the agent.

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import type { Tool } from './QueryEngine.js'
import { agentsDir, ensureAgentsDir } from '../config/agentsDir.js'

// ─── bash ─────────────────────────────────────────────────────────────────────

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command in the current working directory. Returns stdout/stderr. Timeout: 30s.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
    },
    required: ['command'],
  },
  async execute(input) {
    const cmd = String(input['command'] ?? '')
    try {
      const out = execSync(cmd, {
        cwd: process.cwd(),
        timeout: 30_000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return out || '(no output)'
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const e = err as { stdout: string; stderr: string; status: number }
        return [e.stdout, e.stderr].filter(Boolean).join('\n') || `Exit code: ${e.status}`
      }
      return String(err)
    }
  },
}

// ─── read_file ────────────────────────────────────────────────────────────────

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content as text.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
    },
    required: ['path'],
  },
  async execute(input) {
    const filePath = resolve(process.cwd(), String(input['path'] ?? ''))
    if (!existsSync(filePath)) return `File not found: ${filePath}`
    try {
      return readFileSync(filePath, 'utf8')
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── write_file ───────────────────────────────────────────────────────────────

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file, creating it if it does not exist.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(input) {
    const filePath = resolve(process.cwd(), String(input['path'] ?? ''))
    try {
      writeFileSync(filePath, String(input['content'] ?? ''), 'utf8')
      return `Written: ${filePath}`
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── list_dir ─────────────────────────────────────────────────────────────────

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List files and directories at a path. Returns names, types, and sizes.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: cwd)' },
    },
    required: [],
  },
  async execute(input) {
    const dirPath = resolve(process.cwd(), String(input['path'] ?? '.'))
    if (!existsSync(dirPath)) return `Directory not found: ${dirPath}`
    try {
      const entries = readdirSync(dirPath)
      const lines = entries.map(name => {
        const fullPath = `${dirPath}/${name}`
        try {
          const stat = statSync(fullPath)
          const type = stat.isDirectory() ? 'd' : 'f'
          const size = stat.isFile() ? ` (${stat.size}b)` : ''
          return `${type} ${name}${size}`
        } catch {
          return `? ${name}`
        }
      })
      return lines.join('\n') || '(empty)'
    } catch (err) {
      return `Error listing dir: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── fetch_url ────────────────────────────────────────────────────────────────

export const fetchUrlTool: Tool = {
  name: 'fetch_url',
  description: 'Fetch the content of a URL and return it as plain text. Use this whenever the user shares a URL or asks you to look at a website, documentation, or any web resource.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      raw: { type: 'boolean', description: 'Return raw HTML instead of stripped text (default: false)' },
    },
    required: ['url'],
  },
  async execute(input) {
    const url = String(input['url'] ?? '').trim()
    const raw = Boolean(input['raw'])
    if (!url) return 'Error: url is required'
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Agent/1.0; +https://github.com/auditware)' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`
      const text = await res.text()
      if (raw) return text.slice(0, 50_000)
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
      return stripped.slice(0, 30_000) || '(empty page)'
    } catch (err) {
      return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── web_search ───────────────────────────────────────────────────────────────

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Max results to return (default: 8, max: 20)' },
    },
    required: ['query'],
  },
  async execute(input) {
    const query = String(input['query'] ?? '').trim()
    const maxResults = Math.min(20, Number(input['max_results'] ?? 8))
    if (!query) return 'Error: query is required'
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`
      const html = await res.text()
      // Extract result titles + snippets from DuckDuckGo HTML
      const results: string[] = []
      const resultPattern = /class="result__title"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
      let match: RegExpExecArray | null
      while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
        const href = match[1] ?? ''
        const title = (match[2] ?? '').replace(/<[^>]+>/g, '').trim()
        const snippet = (match[3] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        // DuckDuckGo wraps URLs - extract the real URL from the redirect
        const realUrl = href.startsWith('/l/?') ? decodeURIComponent(href.replace(/.*[?&]uddg=([^&]+).*/, '$1')) : href
        if (title) results.push(`[${results.length + 1}] ${title}\n    ${realUrl}\n    ${snippet}`)
      }
      if (results.length === 0) return `No results found for: ${query}`
      return results.join('\n\n')
    } catch (err) {
      return `Error searching: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── grep ─────────────────────────────────────────────────────────────────────

export const grepTool: Tool = {
  name: 'grep',
  description: 'Search for a pattern in files using ripgrep (or grep as fallback). Returns matching lines with file paths and line numbers.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search (default: cwd)' },
      glob: { type: 'string', description: 'Glob pattern to filter files, e.g. "*.ts"' },
      case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
      context_lines: { type: 'number', description: 'Lines of context to show before and after each match (default: 0)' },
    },
    required: ['pattern'],
  },
  async execute(input) {
    const pattern = String(input['pattern'] ?? '')
    const searchPath = resolve(process.cwd(), String(input['path'] ?? '.'))
    const glob = input['glob'] ? String(input['glob']) : undefined
    const ci = Boolean(input['case_insensitive'])
    const ctx = Number(input['context_lines'] ?? 0)

    // Try ripgrep first, fall back to grep
    const useRg = (() => { try { execSync('which rg', { encoding: 'utf8', stdio: 'pipe' }); return true } catch { return false } })()

    try {
      let cmd: string
      if (useRg) {
        const flags = ['-n', '--color=never', ci ? '-i' : '', ctx > 0 ? `-C${ctx}` : '', glob ? `--glob=${glob}` : ''].filter(Boolean).join(' ')
        cmd = `rg ${flags} ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>&1 | head -200`
      } else {
        const flags = ['-rn', ci ? '-i' : '', ctx > 0 ? `-C${ctx}` : ''].filter(Boolean).join(' ')
        const globPart = glob ? `--include=${JSON.stringify(glob)}` : ''
        cmd = `grep ${flags} ${globPart} -E ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>&1 | head -200`
      }
      const out = execSync(cmd, { encoding: 'utf8', timeout: 15_000 })
      return out.trim() || 'No matches found'
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err) {
        const out = (err as { stdout: string }).stdout?.trim()
        if (out) return out
      }
      return 'No matches found'
    }
  },
}

// ─── glob ─────────────────────────────────────────────────────────────────────

export const globTool: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts" or "**/*.json"' },
      path: { type: 'string', description: 'Base directory to search from (default: cwd)' },
    },
    required: ['pattern'],
  },
  async execute(input) {
    const pattern = String(input['pattern'] ?? '')
    const basePath = resolve(process.cwd(), String(input['path'] ?? '.'))
    try {
      const g = new Bun.Glob(pattern)
      const files: string[] = []
      for await (const file of g.scan({ cwd: basePath, absolute: false, followSymlinks: false })) {
        files.push(file)
        if (files.length >= 500) { files.push('... (truncated at 500 results)'); break }
      }
      return files.length > 0 ? files.join('\n') : 'No files matched'
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── edit_file ────────────────────────────────────────────────────────────────

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Replace an exact string in a file with a new string. Fails if the old_str is not found or appears more than once (to prevent ambiguous edits).',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      old_str: { type: 'string', description: 'Exact string to find and replace (must appear exactly once)' },
      new_str: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  async execute(input) {
    const filePath = resolve(process.cwd(), String(input['path'] ?? ''))
    const oldStr = String(input['old_str'] ?? '')
    const newStr = String(input['new_str'] ?? '')
    if (!existsSync(filePath)) return `File not found: ${filePath}`
    try {
      const content = readFileSync(filePath, 'utf8')
      const count = content.split(oldStr).length - 1
      if (count === 0) return `Error: old_str not found in ${filePath}. Check the exact whitespace and content.`
      if (count > 1) return `Error: old_str appears ${count} times in ${filePath}. Make old_str more specific to match exactly once.`
      writeFileSync(filePath, content.replace(oldStr, newStr), 'utf8')
      return `Edited: ${filePath}`
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── sleep ────────────────────────────────────────────────────────────────────

export const sleepTool: Tool = {
  name: 'sleep',
  description: 'Wait for a specified number of seconds before continuing. Useful for rate-limiting or waiting for async operations.',
  input_schema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', description: 'Number of seconds to wait (max: 60)' },
    },
    required: ['seconds'],
  },
  async execute(input) {
    const secs = Math.min(60, Math.max(0, Number(input['seconds'] ?? 1)))
    await new Promise(r => setTimeout(r, secs * 1000))
    return `Slept ${secs}s`
  },
}

// ─── todo_write ───────────────────────────────────────────────────────────────

import { instanceName } from '../config/AgentConfig.js'

const TODO_PATH = () => process.env['AGENT_TODOS_PATH'] ?? agentsDir(instanceName(), 'todos.json')

type TodoItem = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }

function loadTodos(): TodoItem[] {
  try { return JSON.parse(readFileSync(TODO_PATH(), 'utf8')) as TodoItem[] }
  catch { return [] }
}
function saveTodos(todos: TodoItem[]): void {
  try {
    ensureAgentsDir(instanceName())
    writeFileSync(TODO_PATH(), JSON.stringify(todos, null, 2), 'utf8')
  } catch { /* ignore */ }
}

export const todoWriteTool: Tool = {
  name: 'todo_write',
  description: 'Create and manage a todo list to track tasks in the current session. Use to plan multi-step work and track progress visibly.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'update', 'remove', 'list', 'clear'],
        description: 'Action to perform',
      },
      content: { type: 'string', description: 'Todo content (required for add)' },
      id: { type: 'string', description: 'Todo ID (required for update/remove)' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status (required for update)',
      },
    },
    required: ['action'],
  },
  async execute(input) {
    const action = String(input['action'] ?? 'list')
    const todos = loadTodos()
    if (action === 'list' || !action) {
      if (todos.length === 0) return 'No todos'
      return todos.map(t => `[${t.id}] [${t.status}] ${t.content}`).join('\n')
    }
    if (action === 'clear') {
      saveTodos([])
      return 'Todos cleared'
    }
    if (action === 'add') {
      const content = String(input['content'] ?? '').trim()
      if (!content) return 'Error: content is required for add'
      const id = crypto.randomUUID().slice(0, 8)
      todos.push({ id, content, status: 'pending' })
      saveTodos(todos)
      return `Added todo [${id}]: ${content}`
    }
    if (action === 'update') {
      const id = String(input['id'] ?? '')
      const status = input['status'] as TodoItem['status']
      const idx = todos.findIndex(t => t.id === id)
      if (idx < 0) return `Todo not found: ${id}`
      todos[idx]!.status = status
      saveTodos(todos)
      return `Updated [${id}] → ${status}`
    }
    if (action === 'remove') {
      const id = String(input['id'] ?? '')
      const before = todos.length
      const updated = todos.filter(t => t.id !== id)
      if (updated.length === before) return `Todo not found: ${id}`
      saveTodos(updated)
      return `Removed todo [${id}]`
    }
    return `Unknown action: ${action}`
  },
}

export const BUILTIN_TOOLS: Tool[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  listDirTool,
  fetchUrlTool,
  webSearchTool,
  grepTool,
  globTool,
  editFileTool,
  sleepTool,
  todoWriteTool,
]
