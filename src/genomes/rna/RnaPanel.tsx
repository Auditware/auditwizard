// RnaPanel - renders the skill picker panel and manages SkillWatcher lifecycle.

import React, { useState, useRef, useEffect } from 'react'
import { Box } from 'ink'
import { existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { theme } from '../../app/theme.js'
import { addSystemMessage } from '../../app/AppState.js'
import { SkillWatcher } from '../../skills/watcher.js'
import SkillPickerPanel from '../../components/SkillPickerPanel.js'
import SkillApprovalPanel from '../../components/SkillApprovalPanel.js'
import AddSkillPanel from '../../components/AddSkillPanel.js'
import { agentsDir } from '../../config/agentsDir.js'
import { parseInstallInput, installFromGithub, loadFromPath } from '../../skills/installer.js'
import type { GenomePanelProps } from '../types.js'
import type { LoadedSkill } from '../../skills/loader.js'

type PendingApproval = {
  skill: LoadedSkill
  categories: string[]
  approve: (allow: boolean) => void
}

function BottomPanel({ height, borderColor, children }: { height: number; borderColor: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={borderColor} height={height} overflow="hidden">
      {children}
    </Box>
  )
}

export function RnaPanel({ registry, state, setState, engineRef, termCols, panelSize }: GenomePanelProps): React.ReactElement | null {
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [addSkillOpen, setAddSkillOpen] = useState(false)
  const skillWatcherRef = useRef<SkillWatcher | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [enabledSlugs, setEnabledSlugs] = useState<Set<string>>(new Set())
  const countOnOpenRef = useRef<number>(0)

  // Start SkillWatcher on mount, stop on unmount
  useEffect(() => {
    const watcher = new SkillWatcher(engineRef.current!)
    skillWatcherRef.current = watcher
    watcher.onEvent(event => {
      if (event.type === 'ready') {
        setEnabledSlugs(new Set(watcher.getLoadedSkills().map(s => s.slug)))
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
      } else if (event.type === 'needs-approval') {
        setPendingApproval({ skill: event.skill, categories: event.categories, approve: event.approve })
      }
    })

    void watcher.start().then(async () => {
      const defaults = state.strainConfig?.defaultSkills
      if (!defaults?.length) return
      // Install defaultSkills into the strain's own skills/ dir (strain-scoped, not global)
      const strainSkillsDir = join(process.cwd(), 'skills')
      for (const spec of defaults) {
        const existing = watcher.getAvailableSkills()
        try {
          const src = parseInstallInput(spec)
          if (src.kind === 'path') {
            // Local path: session-only if not already discovered
            const alreadyLoaded = existing.some(s => s.path.startsWith(src.resolvedPath))
            if (!alreadyLoaded) {
              const skill = await loadFromPath(src.resolvedPath)
              watcher.addSessionSkill(skill)
            }
          } else {
            // GitHub: install into strain dir if slug not already present
            // Derive expected slug from subpath or repo name to check before fetching
            const expectedSlug = src.subpath ? (src.subpath.split('/').pop() ?? src.repo) : src.repo
            const alreadyPresent = existing.some(s => s.slug === expectedSlug)
            if (!alreadyPresent) {
              await installFromGithub(src.owner, src.repo, src.subpath, src.ref, { isBuiltIn: true, installDir: strainSkillsDir })
              // File watcher picks it up automatically - no manual add needed
            } else {
              // Backfill .meta.json for already-installed skills that predate this feature
              const existingSkill = existing.find(s => s.slug === expectedSlug)
              if (existingSkill && !existingSkill.source) {
                const metaPath = join(dirname(existingSkill.path), '.meta.json')
                if (!existsSync(metaPath)) {
                  try {
                    writeFileSync(metaPath, JSON.stringify({ source: 'github', sha: src.ref, isBuiltIn: true }, null, 2), 'utf-8')
                  } catch { /* ignore */ }
                }
              }
            }
          }
        } catch (err) {
          addSystemMessage(setState, 'warning', `defaultSkill "${spec}" failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })

    return () => { void watcher.stop() }
  }, [])

  // Register panel opener into shared registry each render
  registry.register('skills', () => {
    countOnOpenRef.current = skillWatcherRef.current?.getLoadedSkills().length ?? 0
    setSkillPickerOpen(true)
  })

  const panelH = panelSize(state.mode === 'skill-picker')

  // Approval dialog takes priority over skill picker
  if (pendingApproval) {
    return (
      <BottomPanel height={panelH - 1} borderColor={theme.warning}>
        <SkillApprovalPanel
          skill={pendingApproval.skill}
          categories={pendingApproval.categories}
          onDecide={allow => {
            pendingApproval.approve(allow)
            setPendingApproval(null)
            if (allow) {
              addSystemMessage(setState, 'warning', `skill loaded with guardrail override: ${pendingApproval.skill.name}`)
            } else {
              addSystemMessage(setState, 'info', `skill blocked by user: ${pendingApproval.skill.name}`)
            }
          }}
        />
      </BottomPanel>
    )
  }

  if (state.mode !== 'skill-picker' || !skillPickerOpen) return null

  if (addSkillOpen) {
    const existingSlugs = new Set(skillWatcherRef.current?.getAvailableSkills().map(s => s.slug) ?? [])
    return (
      <BottomPanel height={panelH - 1} borderColor={theme.brand}>
        <AddSkillPanel
          existingSlugs={existingSlugs}
          onAdded={(skill, sessionOnly) => {
            if (sessionOnly) {
              skillWatcherRef.current?.addSessionSkill(skill)
            }
            // For GitHub global installs, the file watcher auto-discovers the skill
            setAddSkillOpen(false)
            const label = sessionOnly ? '(session only)' : '(installed globally)'
            addSystemMessage(setState, 'success', `skill "${skill.name}" added ${label}`)
          }}
          onCancel={() => setAddSkillOpen(false)}
        />
      </BottomPanel>
    )
  }

  return (
    <BottomPanel height={panelH - 1} borderColor={theme.brand}>
      <SkillPickerPanel
        allSkills={skillWatcherRef.current?.getAvailableSkills() ?? []}
        activeSlug={enabledSlugs}
        height={panelH - 2}
        cols={termCols}
        onToggle={slug => {
          skillWatcherRef.current?.toggleSkill(slug)
          const updated = new Set(skillWatcherRef.current?.getLoadedSkills().map(s => s.slug) ?? [])
          setEnabledSlugs(updated)
          const sessionName = state.sessionName
          if (sessionName) {
            const path = agentsDir('sessions', `${sessionName}.skills`)
            Bun.write(path, [...updated].join('\n') + '\n').catch(() => {})
          }
        }}
        onInvoke={slug => {
          setSkillPickerOpen(false)
          setState(prev => ({ ...prev, mode: 'agent' }))
          void skillWatcherRef.current?.invokeSkill(slug).then(msg => {
            if (msg.startsWith('⛔')) {
              addSystemMessage(setState, 'error', msg)
            } else {
              addSystemMessage(setState, 'success', `skill "${slug}" loaded into context`)
            }
          })
        }}
        onClose={() => {
          setSkillPickerOpen(false)
          setState(prev => ({ ...prev, mode: 'agent' }))
          const nowCount = skillWatcherRef.current?.getLoadedSkills().length ?? 0
          if (nowCount !== countOnOpenRef.current) {
            addSystemMessage(setState, 'info', `${nowCount} skill${nowCount !== 1 ? 's' : ''} loaded`)
          }
        }}
        onAdd={() => setAddSkillOpen(true)}
      />
    </BottomPanel>
  )
}
