// EveryPanel - interactive manager for /every interval tasks.
// Opened when mode === 'every'. Shows all scheduled tasks with stats,
// supports fire-now, edit interval, and delete with confirmation.

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import {
  listIntervalTasks,
  removeIntervalTask,
  updateIntervalTask,
  advanceIntervalTask,
  formatInterval,
  formatAgo,
  parseInterval,
  type IntervalTask,
} from '../utils/intervalTasks.js'
import type { QueryEngine } from '../agent/QueryEngine.js'

type EditMode = 'interval' | 'prompt'

type EditState = {
  taskId: string
  field: EditMode
  value: string
}

function formatNextIn(nextFireAt: number): string {
  const ms = nextFireAt - Date.now()
  if (ms <= 0) return 'now'
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.ceil(s / 60)}m`
  return `${Math.ceil(s / 3600)}h`
}

function TaskRow({ task, isSelected, editing }: {
  task: IntervalTask
  isSelected: boolean
  editing: EditState | null
}): React.ReactElement {
  const accent = isSelected ? theme.brand : undefined
  const dimColor = !isSelected

  const statsLine = [
    `every ${formatInterval(task.intervalMs)}`,
    task.fireCount > 0 ? `fired ${task.fireCount}x` : 'not fired',
    task.lastFiredAt ? `last ${formatAgo(task.lastFiredAt)}` : null,
    `next in ${formatNextIn(task.nextFireAt)}`,
  ].filter(Boolean).join('  ')

  const showIntervalEdit = editing?.taskId === task.id && editing.field === 'interval'
  const showPromptEdit = editing?.taskId === task.id && editing.field === 'prompt'

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={theme.subtle}>[{task.id}]</Text>
        {showIntervalEdit
          ? <Text color={theme.brand}>interval: <Text bold>{editing!.value}</Text><Text color={theme.inactive}>_</Text></Text>
          : <Text color={accent} dimColor={dimColor}>{statsLine}</Text>
        }
      </Box>
      <Box paddingLeft={2}>
        {showPromptEdit
          ? <Text color={theme.brand}>prompt: <Text bold>{editing!.value}</Text><Text color={theme.inactive}>_</Text></Text>
          : <Text color={accent} dimColor={dimColor} wrap="truncate">{task.prompt}</Text>
        }
      </Box>
    </Box>
  )
}

export default function EveryPanel({
  panelHeight,
  cols,
  engineRef,
  stateRef,
}: {
  panelHeight: number
  cols: number
  engineRef: React.MutableRefObject<QueryEngine>
  stateRef: React.MutableRefObject<import('../app/AppState.js').AppState>
}): React.ReactElement {
  const { state, setState } = useAppState()
  const [tasks, setTasks] = useState<IntervalTask[]>(() => listIntervalTasks())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editState, setEditState] = useState<EditState | null>(null)

  // Refresh task list + timings every second
  useEffect(() => {
    const id = setInterval(() => setTasks(listIntervalTasks()), 1_000)
    return () => clearInterval(id)
  }, [])

  const clampedIdx = Math.min(selectedIdx, Math.max(0, tasks.length - 1))
  const selected = tasks[clampedIdx]

  useInput((input, key) => {
    if (state.mode !== 'every') return

    // Edit mode: capture keystrokes for the inline input field
    if (editState) {
      if (key.escape) { setEditState(null); return }
      if (key.return) {
        if (editState.field === 'interval') {
          const ms = parseInterval(editState.value.trim())
          if (ms !== null) {
            updateIntervalTask(editState.taskId, { intervalMs: ms })
            setTasks(listIntervalTasks())
          } else {
            addSystemMessage(setState, 'error', 'Invalid interval - use e.g. 5m, 2h, 1d')
          }
        } else {
          const prompt = editState.value.trim()
          if (prompt) {
            updateIntervalTask(editState.taskId, { prompt })
            setTasks(listIntervalTasks())
          }
        }
        setEditState(null)
        return
      }
      if (key.backspace || key.delete) {
        setEditState(prev => prev ? { ...prev, value: prev.value.slice(0, -1) } : null)
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setEditState(prev => prev ? { ...prev, value: prev.value + input } : null)
      }
      return
    }

    if (key.escape) {
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

    // Enter = fire now
    if (key.return) {
      setConfirmDelete(false)
      if (stateRef.current.isStreaming) {
        addSystemMessage(setState, 'warning', 'Agent is busy - wait for it to finish before firing')
        return
      }
      advanceIntervalTask(selected.id)
      setTasks(listIntervalTasks())
      setState(prev => ({ ...prev, mode: 'agent' }))
      engineRef.current?.submit(selected.prompt, stateRef.current, setState)
      return
    }

    // i = edit interval
    if (ch === 'i') {
      setConfirmDelete(false)
      setEditState({ taskId: selected.id, field: 'interval', value: formatInterval(selected.intervalMs) })
      return
    }

    // e = edit prompt
    if (ch === 'e') {
      setConfirmDelete(false)
      setEditState({ taskId: selected.id, field: 'prompt', value: selected.prompt })
      return
    }

    // d = delete with confirm
    if (ch === 'd') {
      if (!confirmDelete) { setConfirmDelete(true); return }
      setConfirmDelete(false)
      removeIntervalTask(selected.id)
      setTasks(listIntervalTasks())
      setSelectedIdx(i => Math.max(0, i - 1))
      addSystemMessage(setState, 'info', `Cancelled [${selected.id}]`)
      return
    }

    setConfirmDelete(false)
  })

  // Row height = 2 lines per task + 1 gap; compute visible window
  const CHROME = 4 // title row + hint row + padding
  const ROW_H = 2
  const maxVisible = Math.max(1, Math.floor((panelHeight - CHROME) / ROW_H))
  const winStart = Math.max(0, clampedIdx - maxVisible + 1)
  const visible = tasks.slice(winStart, winStart + maxVisible)

  let hintText: string
  if (editState) {
    hintText = editState.field === 'interval'
      ? 'type interval (e.g. 5m, 2h)  Enter confirm  Esc cancel'
      : 'edit prompt  Enter confirm  Esc cancel'
  } else if (confirmDelete && selected) {
    hintText = `d again to confirm delete [${selected.id}]  Esc cancel`
  } else if (!selected) {
    hintText = 'Esc close'
  } else {
    hintText = 'Enter fire now  i edit interval  e edit prompt  d delete  Esc close'
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Title */}
      <Box gap={2} marginBottom={1}>
        <Text color={theme.brand} bold>Every</Text>
        {tasks.length > 0
          ? <Text dimColor>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Text>
          : <Text dimColor>no tasks</Text>
        }
        {tasks.length > maxVisible && (
          <Text dimColor>{winStart + 1}-{winStart + visible.length} of {tasks.length}</Text>
        )}
      </Box>

      {tasks.length === 0
        ? (
          <Box paddingLeft={2}>
            <Text color={theme.inactive}>No scheduled tasks - use /every &lt;interval&gt; &lt;prompt&gt;</Text>
          </Box>
        )
        : (
          <Box flexDirection="column" gap={0}>
            {winStart > 0 && <Text dimColor>  {'\u2191'} {winStart} more</Text>}
            {visible.map((task, i) => {
              const globalIdx = winStart + i
              const isSelected = globalIdx === clampedIdx
              return (
                <Box key={task.id} flexDirection="row" gap={1}>
                  <Text color={isSelected ? theme.brand : theme.inactive}>
                    {isSelected ? '\u276F' : ' '}
                  </Text>
                  <TaskRow
                    task={task}
                    isSelected={isSelected}
                    editing={editState?.taskId === task.id ? editState : null}
                  />
                </Box>
              )
            })}
            {winStart + maxVisible < tasks.length && (
              <Text dimColor>  {'\u2193'} {tasks.length - (winStart + maxVisible)} more</Text>
            )}
          </Box>
        )
      }

      {/* Hint */}
      <Box marginTop={1} paddingLeft={1}>
        <Text color={confirmDelete ? theme.warning : theme.subtle}>{hintText}</Text>
      </Box>
    </Box>
  )
}
