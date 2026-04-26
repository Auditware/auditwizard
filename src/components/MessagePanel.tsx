// MessagePanel - two-stage panel: pick an online agent, then compose and send a message.
// Stage 1: agent list (↑↓ navigate, Enter select, Esc close)
// Stage 2: compose (type message, Enter send, Esc back to list)

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import { useAppState, addSystemMessage } from '../app/AppState.js'
import { sendMessage } from '../utils/mailbox.js'
import { listReachableAgents, type ReachableAgent } from '../utils/agentDiscovery.js'
import { truncate } from '../utils/stringWidth.js'
import { SlashPicker } from './SlashPicker.js'

type Stage = 'pick' | 'compose'

type Props = {
  panelHeight: number
  cols: number
  selfSession: string
}

export default function MessagePanel({ panelHeight, cols, selfSession }: Props): React.ReactElement {
  const { setState } = useAppState()
  const [agents, setAgents] = useState<ReachableAgent[]>([])
  const [cursor, setCursor] = useState(0)
  const [stage, setStage] = useState<Stage>('pick')
  const [target, setTarget] = useState<ReachableAgent | null>(null)
  const [draft, setDraft] = useState('')

  // Ignore the Enter keypress that opened this panel
  const ignoreEnter = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => { ignoreEnter.current = false }, 150)
    return () => clearTimeout(t)
  }, [])

  // Refresh agent list periodically
  useEffect(() => {
    const refresh = () => setAgents(listReachableAgents(selfSession))
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [selfSession])

  const close = useCallback(() => {
    setState(prev => ({ ...prev, mode: 'agent' }))
  }, [setState])

  const send = useCallback(() => {
    if (!target || !draft.trim()) return
    sendMessage(target.session, selfSession, draft.trim())
    addSystemMessage(setState, 'info', `\u2192 ${target.session}: ${draft.trim()}`)
    close()
  }, [target, draft, selfSession, setState, close])

  useInput(useCallback((input, key) => {
    if (stage === 'pick') {
      if (key.escape || (key.ctrl && input === 'c')) { close(); return }
      if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setCursor(c => Math.min(agents.length - 1, c + 1)); return }
      if (key.return) {
        if (ignoreEnter.current) return
        const agent = agents[cursor]
        if (!agent) return
        setTarget(agent)
        setStage('compose')
        return
      }
      return
    }

    // compose stage
    if (key.escape || (key.ctrl && input === 'c')) { setStage('pick'); setDraft(''); return }
    if (key.return) { send(); return }
    if (key.backspace || key.delete) { setDraft(d => d.slice(0, -1)); return }
    if (input && !key.ctrl && !key.meta) { setDraft(d => d + input) }
  }, [stage, agents, cursor, draft, close, send]))

  if (stage === 'compose' && target) {
    const hint = cols >= 46 ? 'Enter send · Esc back' : undefined
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
        <Box marginBottom={1}>
          <Text color={theme.brand} bold>Message </Text>
          <Text color={theme.text} bold>{target.session}</Text>
          <Text color={theme.inactive}> ({target.status})</Text>
        </Box>
        <Box>
          <Text color={theme.brand}>&gt; </Text>
          <Text color={theme.text}>{draft}</Text>
          <Text color={theme.brand}>_</Text>
        </Box>
        {hint && (
          <Box marginTop={1}>
            <Text color={theme.inactive}>{hint}</Text>
          </Box>
        )}
      </Box>
    )
  }

  const onlineCount = agents.filter(a => a.status !== 'offline').length
  const showHints = cols >= 46
  const nameCols = Math.max(8, cols - 20)

  return (
    <SlashPicker
      items={agents}
      selected={Math.min(cursor, Math.max(0, agents.length - 1))}
      getKey={a => a.session}
      height={panelHeight}
      cols={cols}
      accentColor={theme.brand}
      emptyText="no other agents found"
      hintText={showHints ? '↑↓ navigate · Enter compose · Esc close' : undefined}
      variant="inline"
      title="Send message"
      titleRight={
        <Text color={theme.subtle}>{onlineCount > 0 ? `${onlineCount} online` : 'all offline'}</Text>
      }
      renderRow={(a, isActive) => (
        <>
          <Text color={isActive ? theme.text : theme.inactive} bold={isActive} wrap="truncate">
            {truncate(a.session, nameCols)}
          </Text>
          <Text color={a.status === 'idle' ? theme.success : a.status === 'busy' ? theme.warning : theme.inactive}>
            {a.status}
          </Text>
        </>
      )}
    />
  )
}
