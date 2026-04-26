import React, { useState, useEffect, useCallback, useRef } from 'react'
import { spawnSync } from 'child_process'
import { Box, Text, useInput, useStdout } from 'ink'
import { AppStateContext, makeInitialState, addSystemMessage, appendMessage, instanceSuffix, type AppState, isBottomPanelMode } from '../app/AppState.js'
import { detectConflicts, DEFAULT_BINDINGS } from '../utils/keybindings.js'
import GengharSprite, { GENGHAR_HEIGHT } from '../components/GengharSprite.js'
import { theme } from '../app/theme.js'
import StatusLine from '../components/StatusLine.js'
import PromptInput from '../components/PromptInput.js'
import MessageHistory from '../components/MessageHistory.js'
import CtxPanel from '../components/CtxPanel.js'
import EveryPanel from '../commands/EveryPanel.js'
import MessagePanel from '../components/MessagePanel.js'
import { QueryEngine } from '../agent/QueryEngine.js'
import { BUILTIN_TOOLS } from '../agent/tools.js'
import {
  askUserTool, replTool, scheduleCronTool,
  cronListTool, cronDeleteTool, briefTool,
  taskCreateTool, taskListTool, taskGetTool, taskUpdateTool,
  createConfigTool, createAgentTool, createToolSearchTool, createTaskOutputTool,
} from '../agent/extraTools.js'
import { userInputChannel, type PendingQuestion } from '../utils/userInputChannel.js'
import { briefChannel } from '../utils/briefChannel.js'
import { loadMessages, readMeta } from '../context/session.js'
import { HotReloader } from '../reload/HotReloader.js'
import type { ImageAttachment } from '../utils/imagePaste.js'
import { loadConfig, saveConfig } from '../config/AgentConfig.js'
import { agentsDir } from '../config/agentsDir.js'
import { useMouse } from '../hooks/useMouse.js'
import { setOverlayPaused } from '../utils/selectionOverlay.js'
import { defaultRegistry } from '../commands/index.js'
import type { CommandContext, SlashCommandModule } from '../commands/types.js'
import { GenomePanelRegistry } from '../commands/GenomePanelRegistry.js'
import { SlashPicker } from '../components/SlashPicker.js'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { readUnread, markRead, heartbeat } from '../utils/mailbox.js'
import { getDueTasks, advanceIntervalTask } from '../utils/intervalTasks.js'
import { ALL_GENOMES } from '../genomes/index.js'

const AWAY_THRESHOLD_MS = 30 * 60 * 1000  // 30 minutes

type Props = {
  sessionId?: string
  sessionName?: string
  justReloaded?: boolean
  reloadedPatchInfo?: string
  genomeFilter?: string[] | null
}

function BottomPanel({ height, borderColor, children }: { height: number; borderColor: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      height={height}
      overflow="hidden"
    >
      {children}
    </Box>
  )
}

export default function App({ sessionId, sessionName, justReloaded, reloadedPatchInfo, genomeFilter = null }: Props): React.ReactElement {
  const { stdout } = useStdout()
  // Resize counter - incrementing it triggers a re-render so termCols/termRows
  // (read live from stdout below) pick up the new dimensions. No manual screen
  // clearing: that fights Ink's diff renderer and causes blank screens.
  const [, setResizeTick] = useState(0)

  useEffect(() => {
    const handler = () => setResizeTick(n => n + 1)
    stdout?.on('resize', handler)
    return () => { stdout?.off('resize', handler) }
  }, [stdout])

  const termCols = stdout?.columns ?? 80
  const termRows = stdout?.rows ?? 24

  const [state, setState] = useState<AppState>(() => {
    const resolvedSession = sessionName ?? 'default'
    const childSlug = process.env['AGENT_CHILD_SLUG']
    const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim() || 'main'
    const name = childSlug ? `child/${childSlug}` : branch
    return makeInitialState({
      sessionId: sessionId ?? crypto.randomUUID(),
      sessionName: resolvedSession,
      justReloaded: justReloaded ?? false,
      reloadedPatchInfo,
      paneId: process.env.TMUX_PANE ?? '',
      genome: genomeFilter,
      instanceName: name,
    })
  })

  // Register pane title so external tools can target this agent instance by name.
  // Use -t $TMUX_PANE to target agent's OWN pane (not the currently active pane).
  // Write per-instance file ~/.agent/panes/<instanceName> so main/child/strain
  // instances never clobber each other's pane registration.
  useEffect(() => {
    const paneId = process.env['TMUX_PANE']
    if (paneId && state.instanceName) {
      // Strains use their own name as the prefix so the pane title reflects their identity.
      const prefix = state.strainConfig?.name ?? 'agent'
      spawnSync('tmux', ['select-pane', '-t', paneId, '-T', `${prefix}:${state.instanceName}`])
      spawnSync('mkdir', ['-p', agentsDir('panes')])
      Bun.write(agentsDir('panes', state.instanceName), paneId).catch(() => {})
    }
  }, [state.instanceName, state.strainConfig?.name])

  // Copy toast - transient, replaces itself on new copy, auto-dismisses
  const [copyToast, setCopyToast] = useState<string | null>(null)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mouse: wheel scroll + click-drag-release copy via screen buffer
  useMouse(
    useCallback((delta: number) => {
      setState(prev => ({ ...prev, scrollOffset: Math.max(0, prev.scrollOffset + delta) }))
    }, []),
    useCallback((charCount: number) => {
      if (charCount >= 2) setCopyToast('copied to clipboard')
      if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current)
      copyToastTimerRef.current = setTimeout(() => setCopyToast(null), 2500)
    }, []),
    useCallback((row: number) => {
      // Mouse press in footer area while a pane is open → close pane, focus input
      const rows = process.stdout.rows ?? 24
      const fH = stateRef.current.inputValue.startsWith('/') ? 4 : 3  // rough footer height
      if (row >= rows - fH && isBottomPanelMode(stateRef.current.mode)) {
        setState(prev => ({ ...prev, mode: 'agent' }))
      }
    }, [])
  )

  // QueryEngine singleton - stable across renders
  const engineRef = useRef<QueryEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current = new QueryEngine()
    for (const tool of BUILTIN_TOOLS) {
      engineRef.current.registerTool(tool)
    }
    // Extra tools registered once - state setters are stable React references
    engineRef.current.registerTool(askUserTool)
    engineRef.current.registerTool(replTool)
    engineRef.current.registerTool(scheduleCronTool)
    engineRef.current.registerTool(cronListTool)
    engineRef.current.registerTool(cronDeleteTool)
    engineRef.current.registerTool(briefTool)
    engineRef.current.registerTool(taskCreateTool)
    engineRef.current.registerTool(taskListTool)
    engineRef.current.registerTool(taskGetTool)
    engineRef.current.registerTool(taskUpdateTool)
  }

  // Always-current state ref for callbacks that outlive renders
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  // Tracks whether an ask_user question is pending so the mailbox poller doesn't
  // inject new messages mid-turn while isStreaming is temporarily false.
  const pendingQuestionRef = useRef<PendingQuestion | null>(null)

  // Messages received while the engine is busy are queued here and injected on
  // the next idle poll rather than being silently dropped.
  const pendingInjectRef = useRef<import('../utils/mailbox.js').MailboxEntry[]>([])

  // Pause selection overlay while streaming so stale screenBuffer content can't
  // corrupt the display by being repainted on top of fresh Ink renders.
  useEffect(() => { setOverlayPaused(state.isStreaming) }, [state.isStreaming])

  // HotReloader singleton - watches src/ and re-execs on file change
  const hotReloaderRef = useRef<HotReloader | null>(null)
  if (!hotReloaderRef.current) {
    hotReloaderRef.current = new HotReloader()
  }

  // HotReloader - start watching src/ for live changes (skipped for strains)
  useEffect(() => {
    const reloader = hotReloaderRef.current
    if (!reloader) return
    reloader.start(() => stateRef.current, setState)
    return () => reloader.stop()
  }, [])

  // Load config on mount - apply API key from env var > config file > nothing
  useEffect(() => {
    loadConfig().then(cfg => {
      // env var always wins over stored config key (prevents stale key poisoning)
      const envKey = process.env['ANTHROPIC_API_KEY']
      const existingKey = engineRef.current!.getApiKey()
      const effectiveKey = existingKey || envKey || cfg.apiKey
      if (effectiveKey) {
        engineRef.current!.setApiKey(effectiveKey)
      }
      if (cfg.model && typeof cfg.model === 'string' && cfg.model.trim().length > 0) {
        setState(prev => ({ ...prev, model: cfg.model!.trim() }))
      }
      // Register config + agent tools now that we have the API key and setState
      const configTool = createConfigTool({
        setModel: (model) => setState(prev => ({ ...prev, model })),
        setApiKey: (key) => {
          engineRef.current!.setApiKey(key)
          void saveConfig({ apiKey: key })
        },
        setVerbose: (_verbose) => { /* verbose is persisted via saveConfig in the tool */ },
      })
      const agentTool = createAgentTool(
        () => engineRef.current!.getApiKey(),
        () => engineRef.current!.getTranscriptForFork()
      )
      engineRef.current!.registerTool(configTool)
      engineRef.current!.registerTool(agentTool)
      engineRef.current!.registerTool(createToolSearchTool(() => engineRef.current!.getTools()))
      engineRef.current!.registerTool(createTaskOutputTool())
    }).catch(() => {})
  }, [])

  // Auto-submit initial prompt from .agent-seed.json if present in cwd (written by parent on spawn/strain)
  useEffect(() => {
    const seedPath = join(process.cwd(), '.agent-seed.json')
    if (!existsSync(seedPath)) return
    try {
      const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { prompt?: string; from?: string; apiKey?: string }
      unlinkSync(seedPath)
      // API key from seed takes highest priority - parent explicitly passed it
      if (seed.apiKey) {
        engineRef.current!.setApiKey(seed.apiKey)
      }
      if (seed.prompt && seed.prompt.trim()) {
        const from = seed.from ?? 'parent'
        addSystemMessage(setState, 'info', `\u2190 ${from}: ${seed.prompt.trim()}`)
        // Delay slightly so the engine and API key are ready
        setTimeout(() => {
          if (engineRef.current) {
            engineRef.current.submit(seed.prompt!.trim(), stateRef.current, setState)
          }
        }, 800)
      }
    } catch { /* non-fatal -- bad seed file is silently ignored */ }
  }, [])

  // Timestamp captured at mount - used to distinguish messages queued while offline
  // from messages that arrive during this live session.
  const startupTimeRef = useRef(Date.now())
  // Whether we've already surfaced the offline-queued mail prompt this session.
  const offlineMailCheckedRef = useRef(false)

  // Poll mailbox for incoming messages from other agents + emit heartbeat
  useEffect(() => {
    const POLL_MS = 2000
    const id = setInterval(() => {
      const session = stateRef.current.sessionName
      if (!session) return
      // Heartbeat - let others know we're alive
      heartbeat(session, stateRef.current.isStreaming ? 'busy' : 'idle', process.cwd())
      const unread = readUnread(session)
      if (unread.length > 0) {
        // Split into messages that arrived while we were offline vs this session
        const offline = unread.filter(e => e.timestamp < startupTimeRef.current)
        const live    = unread.filter(e => e.timestamp >= startupTimeRef.current)

        // Mark all read immediately to avoid duplicate notifications
        markRead(session, unread.map(e => e.id))

        // Live messages: notify + queue for auto-inject as before
        for (const entry of live) {
          addSystemMessage(setState, 'info', `\u2190 ${entry.from}: ${entry.content}`)
        }
        if (live.length > 0) pendingInjectRef.current.push(...live)

        // Offline-queued messages: surface once, let the AI ask the user whether to process
        if (offline.length > 0 && !offlineMailCheckedRef.current) {
          offlineMailCheckedRef.current = true
          const senders = [...new Set(offline.map(e => e.from))].join(', ')
          addSystemMessage(setState, 'info', `\uD83D\uDCEC ${offline.length} message(s) queued while offline from: ${senders}`)
          const bundle = offline.map(e => `[from ${e.from}]: ${e.content}`).join('\n\n')
          pendingInjectRef.current.push({
            id: `offline-bundle-${Date.now()}`,
            from: senders,
            to: session,
            content: `You received ${offline.length} message(s) while you were offline:\n\n${bundle}\n\nBefore doing anything, use ask_user to ask whether the user wants to review and process these now or skip them.`,
            timestamp: Date.now(),
            read: true,
          })
        }
      }
      // Drain queued messages into engine only when genuinely idle (no streaming, no ask_user)
      if (
        !stateRef.current.isStreaming &&
        !pendingQuestionRef.current &&
        engineRef.current &&
        pendingInjectRef.current.length > 0
      ) {
        const toInject = pendingInjectRef.current.splice(0)
        const body = toInject
          .map(e => `[message from ${e.from}]: ${e.content}`)
          .join('\n')
        engineRef.current.submit(body, stateRef.current, setState)
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Interval task scheduler - fires due /every tasks when genuinely idle
  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current.isStreaming || pendingQuestionRef.current || !engineRef.current) return
      for (const task of getDueTasks()) {
        advanceIntervalTask(task.id)
        engineRef.current.submit(task.prompt, stateRef.current, setState)
      }
    }, 15_000)
    return () => clearInterval(id)
  }, [])

  // Listen for ask_user questions from the tool execution loop
  useEffect(() => {
    const onQuestion = (q: PendingQuestion) => {
      setPendingQuestion(q)
      pendingQuestionRef.current = q
      // Inject question into chat flow so it appears in the main message history
      const optionsText = q.options && q.options.length > 0
        ? `\n  Options: ${q.options.join(' · ')}`
        : ''
      addSystemMessage(setState, 'progress', `${q.question}${optionsText}`)
      // Temporarily disable streaming indicator so the user can type their answer
      setState(prev => ({ ...prev, isStreaming: false }))
    }
    const onAnswered = () => {
      if (!userInputChannel.hasPending()) {
        setPendingQuestion(null)
        pendingQuestionRef.current = null
        // Restore streaming indicator - engine is still running
        setState(prev => ({ ...prev, isStreaming: true }))
      } else {
        const next = userInputChannel.getFirst()
        setPendingQuestion(next)
        pendingQuestionRef.current = next ?? null
      }
    }
    const onCancelled = () => {
      if (!userInputChannel.hasPending()) {
        setPendingQuestion(null)
        pendingQuestionRef.current = null
      }
      // isStreaming will be set to false by the engine's finally block on abort
    }
    userInputChannel.on('question', onQuestion)
    userInputChannel.on('answered', onAnswered)
    userInputChannel.on('cancelled', onCancelled)
    return () => {
      userInputChannel.off('question', onQuestion)
      userInputChannel.off('answered', onAnswered)
      userInputChannel.off('cancelled', onCancelled)
    }
  }, [])

  // Brief tool events - ephemeral messages shown in the chat but not persisted
  useEffect(() => {
    return briefChannel.onBrief((event) => {
      appendMessage(setState, { role: 'assistant', content: `[brief] ${event.message}` })
    })
  }, [])

  // Load persisted session messages on mount
  useEffect(() => {
    const name = sessionName ?? 'default'
    loadMessages(name).then(messages => {
      if (messages.length > 0) {
        setState(prev => ({ ...prev, messages }))
        addSystemMessage(setState, 'info', `Resumed session "${name}" · ${messages.length} messages`)
      }
    }).catch(() => { /* no prior session */ })
  }, [sessionName])

  // Detect keybinding conflicts at startup and surface as warnings
  useEffect(() => {
    const conflicts = detectConflicts(DEFAULT_BINDINGS)
    for (const c of conflicts) {
      addSystemMessage(setState, 'warning', `Keybinding conflict: "${c.actions[0]}" and "${c.actions[1]}" both bound to ${c.combo}`)
    }
  }, [])

  // Show reload banner briefly then clear it
  useEffect(() => {
    if (!justReloaded) return
    const msg = reloadedPatchInfo
      ? `↺ Reloaded · ${reloadedPatchInfo}`
      : '↺ Reloaded'
    addSystemMessage(setState, 'success', msg)
    setState(prev => ({ ...prev, justReloaded: false }))
  }, [justReloaded, reloadedPatchInfo])

  // Startup companion message - provided by div genome when active
  useEffect(() => {
    const divGenome = ALL_GENOMES.find(g => g.id === 'div' && (!genomeFilter || genomeFilter.includes('div')))
    const msg = divGenome?.startupMessage?.({
      strainName: state.strainConfig?.name,
      strainSpeech: state.strainConfig?.speech,
    })
    if (msg) addSystemMessage(setState, 'info', msg)
  }, [])

  // Away detection - track last activity, show resume dialog on return
  const [showAwayDialog, setShowAwayDialog] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)

  // Panel registry - genome PanelComponents register their openers each render.
  // Commands call ctx.panels.open('name', cfg) without knowing React state details.
  const panelRegistryRef = useRef<GenomePanelRegistry | null>(null)
  if (!panelRegistryRef.current) panelRegistryRef.current = new GenomePanelRegistry()
  const panelRegistry = panelRegistryRef.current

  const lastActivityRef = useRef(Date.now())
  const awayCheckedRef = useRef(false)

  useEffect(() => {
    function check() {
      if (awayCheckedRef.current) return
      const away = Date.now() - lastActivityRef.current
      if (away > AWAY_THRESHOLD_MS && state.messages.length > 0) {
        awayCheckedRef.current = true
        setShowAwayDialog(true)
      }
    }
    const interval = setInterval(check, 60_000)
    return () => clearInterval(interval)
  }, [state.messages.length])

  // Reload messages and restore token counts when sessionName changes
  useEffect(() => {
    engineRef.current?.resetCompactCache()
    const name = state.sessionName
    Promise.all([
      loadMessages(name).catch(() => []),
      readMeta(name).catch(() => null),
    ]).then(([messages, meta]) => {
      const sessionIn = meta?.inputTokens ?? 0
      const sessionOut = meta?.outputTokens ?? 0
      const sessionTok = (sessionIn + sessionOut) || (meta?.tokenCount ?? 0)
      setState(prev => ({
        ...prev,
        ...(messages.length > 0 ? { messages } : {}),
        sessionInputTokens: sessionIn,
        sessionOutputTokens: sessionOut,
        sessionTokens: sessionTok,
      }))
      // Rebuild transcript from loaded messages (lossy but gives Claude conversation context)
      engineRef.current?.resetTranscript(messages.length > 0 ? messages : undefined)
    })
  }, [state.sessionName])

  const handleSubmit = useCallback((value: string, attachments?: ImageAttachment[]) => {
    // If an ask_user tool is waiting for a response, route directly to it
    if (pendingQuestion) {
      appendMessage(setState, { role: 'user', content: value })
      userInputChannel.answer(pendingQuestion.requestId, value)
      setPendingQuestion(userInputChannel.getFirst())
      return
    }

    // Echo slash commands as user messages for UX continuity (except /clear which resets)
    if (value.startsWith('/') && value !== '/clear') {
      appendMessage(setState, { role: 'user', content: value })
    }

    // Build command context for the registry
    const cmdCtx: CommandContext = {
      state: stateRef.current,
      setState,
      engineRef: engineRef as React.MutableRefObject<QueryEngine>,
      panels: panelRegistry,
      genomeFilter,
      submitToEngine: async (text: string) => {
        // Full engine submit flow: add user message then call engine
        setState(prev => {
          const updatedState = {
            ...prev,
            isStreaming: true,
            messages: [
              ...prev.messages,
              { id: crypto.randomUUID(), role: 'user' as const, content: text, timestamp: Date.now() },
            ],
          }
          engineRef.current!.submit(text, updatedState, setState).catch(err => {
            addSystemMessage(setState, 'error', `Engine error: ${err instanceof Error ? err.message : String(err)}`)
            setState(s => ({ ...s, isStreaming: false }))
          })
          return updatedState
        })
      },
    }

    // Also handle '?' alias and '/child' alias before registry dispatch
    const normalised = value === '?' ? '/help' : value === '/child' ? '/children' : value
    if (defaultRegistry.dispatch(normalised, cmdCtx, genomeFilter)) return

    // Unknown slash command - fall through to agent
    if (value.startsWith('/')) {
      addSystemMessage(setState, 'error', `Unknown command: ${value.split(' ')[0]}. Type /help for a list.`)
      return
    }

    setState(prev => ({ ...prev, isStreaming: true }))

    // We need current state snapshot for the engine call
    setState(prev => {
      const displayContent = attachments && attachments.length > 0
        ? `${value} [+${attachments.length} image${attachments.length > 1 ? 's' : ''}]`
        : value
      const updatedState = {
        ...prev,
        messages: [
          ...prev.messages,
          { id: crypto.randomUUID(), role: 'user' as const, content: displayContent, timestamp: Date.now() },
        ],
        isStreaming: true,
      }
      engineRef.current!.submit(value, updatedState, setState, attachments).catch(err => {
        addSystemMessage(setState, 'error', `Engine error: ${err instanceof Error ? err.message : String(err)}`)
        setState(s => ({ ...s, isStreaming: false }))
      })
      return updatedState
    })
  }, [pendingQuestion])
  // Estimate available rows for the message area
  // Count actual wrapped lines in the input (respecting explicit \n and hard-wrap)
  const _inputWidth = Math.max(1, termCols - 7)
  const _estimatedWrapped = state.inputValue.split('\n').reduce(
    (sum, line) => sum + Math.max(1, Math.ceil((line.length || 1) / _inputWidth)), 0
  )
  const _inputDisplayLines = Math.min(_estimatedWrapped, 5)
  const _hasOverflowIndicator = _estimatedWrapped > 5
  const footerHBase = 1 /* divider */ +
    (copyToast ? 1 : 0) /* toast */ +
    1 /* scroll hint slot (always reserved) */ +
    1 /* status */ +
    1 /* input paddingTop */ +
    _inputDisplayLines /* input lines (max 5) */ +
    (_hasOverflowIndicator ? 1 : 0) /* +N lines ↑ indicator */ +
    1 /* paddingBottom */
  // Children panel: size to actual available space rather than raw termRows percentage
  const availableForContent = Math.max(8, termRows - 2 /* border */ - footerHBase)
  const panelSize = (active: boolean, minH = 9) => active
    ? Math.min(Math.max(minH, Math.min(availableForContent - 4, 20)), availableForContent) + 1
    : 0
  const ctxPanelH     = panelSize(state.mode === 'ctx', 12)
  const everyPanelH   = panelSize(state.mode === 'every', 12)
  const messagePanelH = panelSize(state.mode === 'message-picker', 12)
  const bottomPanelH = isBottomPanelMode(state.mode) ? panelSize(true) : 0
  // Slash menu: suppress when awaiting ask_user answer (user input has different purpose)
  const slashMenuOpen = !state.isStreaming && !pendingQuestion && state.inputValue.startsWith('/')
  const slashMenuFilter = state.inputValue.toLowerCase()
  // Active commands: nuc (always) + genome commands filtered to active genomes.
  // defaultRegistry holds all commands; getForGenome filters to the active set.
  const activeGenomes = ALL_GENOMES.filter(g => !genomeFilter || genomeFilter.includes(g.id))
  const activeGenomeIds = ['nuc', ...activeGenomes.map(g => g.id)]
  const activeCommands = defaultRegistry.getForGenome(activeGenomeIds)
  const slashMenuMatchCount = slashMenuOpen ? activeCommands.filter(c => c.cmd.startsWith(slashMenuFilter)).length : 0
  const slashMenuMaxRows = Math.max(3, termRows - 2 - footerHBase - bottomPanelH - 4 /* keep min 4 msg rows */ - 2 /* menu border */)
  const slashMenuVisibleCount = Math.min(slashMenuMatchCount, slashMenuMaxRows)
  const slashMenuHeight = slashMenuVisibleCount > 0
    ? 2 /* border */ + slashMenuVisibleCount + (slashMenuMatchCount > slashMenuVisibleCount ? 1 : 0) /* scroll hint */
    : 0
  const footerH = footerHBase + slashMenuHeight
  const msgAreaHeight = Math.max(4, termRows - 2 /* border */ - footerH - bottomPanelH)

  return (
    <AppStateContext.Provider value={{ state, setState }}>
      {/* Outer frame - fills the full terminal window */}
      <Box
        flexDirection="column"
        width={termCols}
        height={termRows}
        borderStyle="round"
        borderColor={theme.promptBorder}
      >
        {/* ── Main content ── */}
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {showAwayDialog
            ? (
              <Box flexGrow={1} alignItems="center" justifyContent="center">
                <AwayDialog
                  ctxPct={state.lastInputTokens > 0 ? Math.min(99, Math.round((state.lastInputTokens / 200_000) * 100)) : null}
                  onContinue={() => { setShowAwayDialog(false); awayCheckedRef.current = false; lastActivityRef.current = Date.now() }}
                  onExit={() => process.exit(0)}
                />
              </Box>
            )
            : (
              <>
                <Box height={msgAreaHeight} flexDirection="column" overflow="hidden">
                  {(() => {
                    const companionRender = (topClip: number) => <GengharSprite topClip={topClip} />
                    const welcomeHeight = 3 + GENGHAR_HEIGHT + 1 + (state.messages.length > 0 ? 0 : 1)
                    return (
                      <MessageHistory
                        msgAreaHeight={msgAreaHeight}
                        cols={termCols}
                        companionRender={companionRender}
                        welcomeHeight={welcomeHeight}
                      />
                    )
                  })()}
                </Box>

                {/* Genome panels - each genome mounts its own PanelComponent */}
                {activeGenomes.map(g => g.PanelComponent && (
                  <g.PanelComponent
                    key={g.id}
                    registry={panelRegistry}
                    state={state}
                    setState={setState}
                    stateRef={stateRef}
                    engineRef={engineRef as React.MutableRefObject<QueryEngine>}
                    termCols={termCols}
                    activeCommands={activeCommands}
                    allGenomes={activeGenomes}
                    panelSize={panelSize}
                  />
                ))}

                {/* ctx panel - nuc genome, always available */}
                {state.mode === 'ctx' && (
                  <BottomPanel height={ctxPanelH - 1} borderColor={theme.brand}>
                    <CtxPanel
                      panelHeight={ctxPanelH - 2}
                      cols={termCols}
                      engineRef={engineRef as React.MutableRefObject<QueryEngine>}
                      onClose={() => setState(prev => ({ ...prev, mode: 'agent' }))}
                      onReset={() => setState(prev => ({ ...prev, mode: 'agent' }))}
                    />
                  </BottomPanel>
                )}

                {/* every panel - nuc genome, interval task manager */}
                {state.mode === 'every' && (
                  <BottomPanel height={everyPanelH - 1} borderColor={theme.brand}>
                    <EveryPanel
                      panelHeight={everyPanelH - 2}
                      cols={termCols}
                      engineRef={engineRef as React.MutableRefObject<QueryEngine>}
                      stateRef={stateRef}
                    />
                  </BottomPanel>
                )}

                {/* message panel - send messages to other agents */}
                {state.mode === 'message-picker' && (
                  <BottomPanel height={messagePanelH - 1} borderColor={theme.brand}>
                    <MessagePanel
                      panelHeight={messagePanelH - 2}
                      cols={termCols}
                      selfSession={state.sessionName}
                    />
                  </BottomPanel>
                )}
              </>
            )
          }
        </Box>

        {/* ── Footer: status + input ── */}
        <Box flexDirection="column" flexShrink={0} paddingBottom={1}>
          <Text color={theme.subtle}>{'─'.repeat(termCols - 2)}</Text>
          {copyToast && (
            <Box paddingX={2}>
              <Text color={theme.brand}>{copyToast}</Text>
            </Box>
          )}
          <Box paddingX={2} height={1}>
            {state.scrollOffset > 0 && (
              <Text color={theme.inactive} dimColor>scroll mode · scroll down to return</Text>
            )}
          </Box>
          <StatusLine />
          <PromptInput
            onSubmit={handleSubmit}
            onAbort={() => { engineRef.current?.abort(); setPendingQuestion(null) }}
            overlayOpen={showAwayDialog || isBottomPanelMode(state.mode)}
            slashMenuMaxRows={slashMenuMaxRows}
            commands={activeCommands}
          />
        </Box>
      </Box>
    </AppStateContext.Provider>
  )
}

// ─── Away dialog ──────────────────────────────────────────────────────────────

type AwayDialogProps = {
  ctxPct: number | null
  onContinue: () => void
  onExit: () => void
}

function AwayDialog({ ctxPct, onContinue, onExit }: AwayDialogProps): React.ReactElement {
  const [selected, setSelected] = useState(0)
  const options = ['Continue', 'End session']

  useInput((input, key) => {
    if (key.upArrow) { setSelected(i => Math.max(0, i - 1)); return }
    if (key.downArrow) { setSelected(i => Math.min(options.length - 1, i + 1)); return }
    if (key.return) {
      selected === 0 ? onContinue() : onExit()
      return
    }
    if (key.escape) { onContinue(); return }
    if (key.ctrl && input === 'c') { onExit(); return }
  })

  return (
    <Box borderStyle="round" borderColor={theme.permission} marginX={4} marginY={1} paddingX={2} paddingY={1} flexDirection="column" gap={1}>
      <Text color={theme.warning} bold>You were away for a while</Text>
      {ctxPct != null && <Text color={theme.inactive}>context {ctxPct}% used</Text>}
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => (
          <Box key={opt} gap={1}>
            <Text color={i === selected ? theme.brand : theme.inactive}>{i === selected ? '❯' : ' '}</Text>
            <Text color={i === selected ? theme.text : theme.inactive} bold={i === selected}>{opt}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.subtle}>↑↓ navigate · Enter select · Ctrl+C exit</Text>
      </Box>
    </Box>
  )
}
