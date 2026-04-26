// MemPanel - renders session picker, model picker, and API key input panels.
// Owns state for all mem-genome UI.

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../../app/theme.js'
import { addSystemMessage } from '../../app/AppState.js'
import { saveConfig } from '../../config/AgentConfig.js'
import SessionPicker from '../../components/SessionPicker.js'
import ApiKeyInput from '../../components/ApiKeyInput.js'
import { SlashPicker } from '../../components/SlashPicker.js'
import type { GenomePanelProps } from '../types.js'

function BottomPanel({ height, borderColor, children }: { height: number; borderColor: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={borderColor} height={height} overflow="hidden">
      {children}
    </Box>
  )
}

// ─── Model Picker ─────────────────────────────────────────────────────────────

const FALLBACK_MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
]

type ModelPickerProps = {
  current: string
  apiKey?: string
  height: number
  cols: number
  onSelect: (model: string) => void
  onCancel: () => void
}

function ModelPicker({ current, apiKey, height, cols, onSelect, onCancel }: ModelPickerProps): React.ReactElement {
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    const key = apiKey ?? process.env['ANTHROPIC_API_KEY']
    if (!key) {
      setModels(FALLBACK_MODELS)
      setSelected(Math.max(0, FALLBACK_MODELS.indexOf(current)))
      setLoading(false)
      return
    }
    fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    })
      .then(r => r.json())
      .then((data: unknown) => {
        const d = data as { data?: Array<{ id: string }> }
        const ids = (d.data ?? []).map(m => m.id).filter(id => id.startsWith('claude-')).sort((a, b) => b.localeCompare(a))
        const list = ids.length > 0 ? ids : FALLBACK_MODELS
        setModels(list)
        setSelected(Math.max(0, list.indexOf(current)))
      })
      .catch(() => {
        setModels(FALLBACK_MODELS)
        setSelected(Math.max(0, FALLBACK_MODELS.indexOf(current)))
      })
      .finally(() => setLoading(false))
  }, [])

  useInput((input, key) => {
    if (key.upArrow)   { setSelected(i => Math.max(0, i - 1)); return }
    if (key.downArrow) { setSelected(i => Math.min(models.length - 1, i + 1)); return }
    if (key.return)    { onSelect(models[selected] ?? current); return }
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return }
  })

  if (loading) {
    return (
      <Box borderStyle="round" borderColor={theme.brand} marginX={1} padding={1} width={cols - 2}>
        <Text dimColor>fetching models...</Text>
      </Box>
    )
  }

  return (
    <SlashPicker
      items={models}
      selected={selected}
      getKey={(m: string) => m}
      height={height}
      cols={cols}
      accentColor={theme.brand}
      emptyText="no models available"
      hintText="↑↓ navigate · Enter select · Esc cancel"
      title="Switch model"
      renderRow={(m: string, isActive: boolean) => (
        <Box flexDirection="row" gap={1}>
          <Text color={isActive ? theme.text : theme.inactive} bold={isActive} wrap="truncate">{m}</Text>
          {m === current && <Text color={theme.subtle} dimColor>(current)</Text>}
        </Box>
      )}
    />
  )
}

// ─── MemPanel ─────────────────────────────────────────────────────────────────

export function MemPanel({ state, setState, engineRef, termCols, panelSize }: GenomePanelProps): React.ReactElement | null {
  const sessionPanelH = panelSize(state.mode === 'session')
  const modelPanelH   = panelSize(state.mode === 'model-picker')
  const apiKeyPanelH  = panelSize(state.mode === 'api-key-input')

  if (state.mode === 'session') {
    return (
      <BottomPanel height={sessionPanelH - 1} borderColor={theme.modeSession}>
        <SessionPicker panelHeight={sessionPanelH - 2} cols={termCols} />
      </BottomPanel>
    )
  }

  if (state.mode === 'model-picker') {
    return (
      <BottomPanel height={modelPanelH - 1} borderColor={theme.brand}>
        <ModelPicker
          current={state.model}
          apiKey={engineRef.current?.getApiKey()}
          height={modelPanelH - 2}
          cols={termCols}
          onSelect={model => {
            setState(prev => ({ ...prev, model, mode: 'agent' }))
            saveConfig({ model }).catch(() => {})
            addSystemMessage(setState, 'success', `Model -> ${model}`)
          }}
          onCancel={() => setState(prev => ({ ...prev, mode: 'agent' }))}
        />
      </BottomPanel>
    )
  }

  if (state.mode === 'api-key-input') {
    return (
      <BottomPanel height={apiKeyPanelH - 1} borderColor={theme.brand}>
        <ApiKeyInput
          currentKey={engineRef.current?.getApiKey()}
          onSave={key => {
            engineRef.current!.setApiKey(key)
            void saveConfig({ apiKey: key })
            setState(prev => ({ ...prev, mode: 'agent' }))
            addSystemMessage(setState, 'success', `API key saved ....${key.slice(-4)}`)
          }}
          onCancel={() => setState(prev => ({ ...prev, mode: 'agent' }))}
        />
      </BottomPanel>
    )
  }

  return null
}
