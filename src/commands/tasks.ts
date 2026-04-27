// Tasks command module - /tasks for viewing the shared agent task board.
// genome: ['nuc']
//
// Usage:
//   /tasks         - list all active tasks
//   /tasks clear   - remove all completed tasks

import { addSystemMessage } from '../app/AppState.js'
import {
  briefTool,
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
} from '../agent/extraTools.js'
import { listTasks, deleteTask } from '../agent/taskStore.js'
import type { SlashCommandModule } from './types.js'

export const tasksCommands: SlashCommandModule[] = [
  {
    cmd: '/tasks',
    desc: 'view the agent task board',
    usage: '/tasks [clear]',
    genome: ['nuc'],
    tools: [briefTool, taskCreateTool, taskListTool, taskGetTool, taskUpdateTool],
    handler(args, ctx) {
      const sub = args.trim()

      if (sub === 'clear') {
        const tasks = listTasks()
        const done = tasks.filter(t => t.status === 'completed')
        for (const t of done) deleteTask(t.id)
        addSystemMessage(ctx.setState, 'info', done.length > 0
          ? `Cleared ${done.length} completed task${done.length === 1 ? '' : 's'}.`
          : 'No completed tasks to clear.')
        return
      }

      ctx.setState(prev => ({ ...prev, mode: 'tasks' }))
    },
  },
]
