// TasksPanel - interactive viewer for the shared agent task board.
// Opened when mode === 'tasks'. Scrollable list with status badges,
// subject + description display, keyboard navigation, and delete.
// Keys: ↑/↓ navigate  u cycle status  d delete (confirm)  c clear done  Esc/q close

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import { listTasks, updateTask, deleteTask, type Task, type TaskStatus } from '../agent/taskStore.js'

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'completed', 'blocked']

function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'pending':     return theme.inactive as string
    case 'in_progress': return theme.brand as string
    case 'completed':   return 'green'
    case 'blocked':     return 'red'
  }
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending':     return 'pending'
    case 'in_progress': return 'in progress'
    case 'completed':   return 'done'
    case 'blocked':     return 'blocked'
  }
}

function TaskRow({ task, isSelected, cols }: {
  task: Task
  isSelected: boolean
  cols: number
}): React.ReactElement {
  const accent = isSelected ? theme.brand : undefined
  const dimColor = !isSelected
  const maxDescLen = Math.max(20, cols - 10)

  const meta = [
    task.owner ? `@${task.owner}` : null,
    task.blockedBy.length > 0 ? `blocks: ${task.blockedBy.join(',')}` : null,
  ].filter(Boolean).join('  ')

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={theme.subtle}>[{task.id}]</Text>
        <Text color={statusColor(task.status)} bold={isSelected}>[{statusLabel(task.status)}]</Text>
        <Text color={accent} dimColor={dimColor} bold={isSelected} wrap="truncate">{task.subject}</Text>
      </Box>
      {(task.description || meta) && (
        <Box paddingLeft={2}>
          <Text color={accent} dimColor wrap="truncate">
            {task.description
              ? task.description.slice(0, maxDescLen) + (task.description.length > maxDescLen ? '…' : '')
              : meta}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default function TasksPanel({ panelHeight, cols }: {
  panelHeight: number
  cols: number
}): React.ReactElement {
  const { setState } = useAppState()
  const [tasks, setTasks] = useState<Task[]>(() => listTasks())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const reload = () => setTasks(listTasks())

  const clampedIdx = Math.min(selectedIdx, Math.max(0, tasks.length - 1))
  const selected = tasks[clampedIdx]

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (confirmDelete) { setConfirmDelete(false); return }
      setState(prev => ({ ...prev, mode: 'agent' }))
      return
    }

    if (key.upArrow) {
      setConfirmDelete(false)
      setSelectedIdx(i => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setConfirmDelete(false)
      setSelectedIdx(i => Math.min(tasks.length - 1, i + 1))
      return
    }

    if (!selected) return
    const ch = input.toLowerCase()

    // u = cycle status
    if (ch === 'u') {
      setConfirmDelete(false)
      const cur = STATUS_ORDER.indexOf(selected.status)
      const next = STATUS_ORDER[(cur + 1) % STATUS_ORDER.length]!
      updateTask(selected.id, { status: next })
      reload()
      return
    }

    // d = delete with confirm
    if (ch === 'd') {
      if (!confirmDelete) { setConfirmDelete(true); return }
      setConfirmDelete(false)
      deleteTask(selected.id)
      reload()
      setSelectedIdx(i => Math.max(0, i - 1))
      addSystemMessage(setState, 'info', `Task [${selected.id}] removed`)
      return
    }

    // c = clear completed
    if (ch === 'c') {
      setConfirmDelete(false)
      const done = tasks.filter(t => t.status === 'completed')
      for (const t of done) deleteTask(t.id)
      reload()
      if (done.length > 0) addSystemMessage(setState, 'info', `Cleared ${done.length} completed task${done.length === 1 ? '' : 's'}`)
      return
    }

    setConfirmDelete(false)
  })

  const CHROME = 3 // title + hint
  const ROW_H = 2
  const maxVisible = Math.max(1, Math.floor((panelHeight - CHROME) / ROW_H))
  const winStart = Math.max(0, clampedIdx - maxVisible + 1)
  const visible = tasks.slice(winStart, winStart + maxVisible)

  const hintText = confirmDelete && selected
    ? `d again to confirm delete [${selected.id}]  Esc cancel`
    : tasks.length === 0
    ? 'Esc close'
    : 'u cycle status  d delete  c clear done  Esc close'

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Title */}
      <Box gap={2} marginBottom={1}>
        <Text color={theme.brand} bold>Tasks</Text>
        {tasks.length > 0
          ? <Text dimColor>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Text>
          : <Text dimColor>no tasks</Text>
        }
        {tasks.length > maxVisible && (
          <Text dimColor>{winStart + 1}–{winStart + visible.length} of {tasks.length}</Text>
        )}
      </Box>

      {tasks.length === 0
        ? (
          <Box paddingLeft={2}>
            <Text color={theme.inactive}>No tasks - the AI can create tasks with task_create</Text>
          </Box>
        )
        : (
          <Box flexDirection="column">
            {winStart > 0 && <Text dimColor>  ↑ {winStart} more</Text>}
            {visible.map((task, i) => {
              const globalIdx = winStart + i
              const isSelected = globalIdx === clampedIdx
              return (
                <Box key={task.id} flexDirection="row" gap={1}>
                  <Text color={isSelected ? theme.brand : theme.inactive}>
                    {isSelected ? '❯' : ' '}
                  </Text>
                  <TaskRow task={task} isSelected={isSelected} cols={cols} />
                </Box>
              )
            })}
            {winStart + maxVisible < tasks.length && (
              <Text dimColor>  ↓ {tasks.length - (winStart + maxVisible)} more</Text>
            )}
          </Box>
        )
      }

      {/* Hint */}
      <Box marginTop={1} paddingLeft={1}>
        <Text color={confirmDelete ? 'yellow' : theme.subtle}>{hintText}</Text>
      </Box>
    </Box>
  )
}
