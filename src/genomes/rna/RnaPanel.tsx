// RnaPanel - renders the skill picker panel and manages SkillWatcher lifecycle.

import React, { useState, useRef, useEffect } from 'react'
import { Box } from 'ink'
import { theme } from '../../app/theme.js'
import { addSystemMessage } from '../../app/AppState.js'
import { SkillWatcher } from '../../skills/watcher.js'
import SkillPickerPanel from '../../components/SkillPickerPanel.js'
import { agentsDir } from '../../config/agentsDir.js'
import type { GenomePanelProps } from '../types.js'

function BottomPanel({ height, borderColor, children }: { height: number; borderColor: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={borderColor} height={height} overflow="hidden">
      {children}
    </Box>
  )
}

export function RnaPanel({ registry, state, setState, engineRef, termCols, panelSize }: GenomePanelProps): React.ReactElement | null {
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const skillWatcherRef = useRef<SkillWatcher | null>(null)

  // Start SkillWatcher on mount, stop on unmount
  useEffect(() => {
    const watcher = new SkillWatcher(engineRef.current!)
    skillWatcherRef.current = watcher
    watcher.onEvent(event => {
      if (event.type === 'ready') {
        if (event.count > 0) addSystemMessage(setState, 'info', `${event.count} skill${event.count !== 1 ? 's' : ''} loaded`)
      } else if (event.type === 'loaded') {
        addSystemMessage(setState, 'info', `skill loaded: ${event.skill.name}`)
      } else if (event.type === 'reloaded') {
        addSystemMessage(setState, 'success', `skill reloaded: ${event.skill.name}`)
      } else if (event.type === 'removed') {
        addSystemMessage(setState, 'info', `skill removed: ${event.slug}`)
      } else if (event.type === 'error') {
        addSystemMessage(setState, 'error', `skill error: ${event.path.split('/').pop()} - ${event.message}`)
      } else if (event.type === 'warning') {
        addSystemMessage(setState, 'warning', `skill guardrail: ${event.skill.name} - ${event.categories.join(', ')}`)
      }
    })
    void watcher.start()
    return () => { void watcher.stop() }
  }, [])

  // Register panel opener into shared registry each render
  registry.register('skills', () => setSkillPickerOpen(true))

  const panelH = panelSize(state.mode === 'skill-picker')

  if (state.mode !== 'skill-picker' || !skillPickerOpen) return null

  return (
    <BottomPanel height={panelH - 1} borderColor={theme.brand}>
      <SkillPickerPanel
        allSkills={skillWatcherRef.current?.getAvailableSkills() ?? []}
        activeSlug={new Set(skillWatcherRef.current?.getLoadedSkills().map(s => s.slug) ?? [])}
        height={panelH - 2}
        cols={termCols}
        onConfirm={enabled => {
          skillWatcherRef.current?.setEnabled(enabled)
          setSkillPickerOpen(false)
          setState(prev => ({ ...prev, mode: 'agent' }))
          const sessionName = state.sessionName
          if (sessionName) {
            const path = agentsDir('sessions', `${sessionName}.skills`)
            Bun.write(path, [...enabled].join('\n') + '\n').catch(() => {})
          }
          addSystemMessage(setState, 'success', `skills updated: ${enabled.size} enabled`)
        }}
        onCancel={() => {
          setSkillPickerOpen(false)
          setState(prev => ({ ...prev, mode: 'agent' }))
        }}
      />
    </BottomPanel>
  )
}
