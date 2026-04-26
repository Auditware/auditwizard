// SkillPickerPanel - interactive skill load/unload picker.
// Space to toggle, arrow keys to navigate, Enter to apply, Esc to cancel.
// Uses SlashPicker for consistent scroll/chrome.

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import type { LoadedSkill } from '../skills/loader.js'
import { SlashPicker } from './SlashPicker.js'

type Props = {
  allSkills: LoadedSkill[]
  activeSlug: Set<string>
  height: number
  cols: number
  onConfirm: (enabled: Set<string>) => void
  onCancel: () => void
}

export default function SkillPickerPanel({
  allSkills,
  activeSlug,
  height,
  cols,
  onConfirm,
  onCancel,
}: Props): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set(activeSlug))
  const [cursor, setCursor] = useState(0)

  useInput(useCallback((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return }
    if (key.return) { onConfirm(selected); return }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(allSkills.length - 1, c + 1)); return }
    if (input === ' ') {
      const skill = allSkills[cursor]
      if (!skill) return
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(skill.slug)) next.delete(skill.slug)
        else next.add(skill.slug)
        return next
      })
    }
  }, [cursor, selected, allSkills, onConfirm, onCancel]))

  return (
    <SlashPicker
      items={allSkills}
      selected={cursor}
      getKey={s => s.slug}
      height={height}
      cols={cols}
      accentColor={theme.brand}
      emptyText="No skills found"
      hintText="Space toggle  ↑↓ navigate  Enter apply  Esc cancel"
      variant="inline"
      title="Skills"
      titleRight={
        <Text color={theme.inactive}>{selected.size}/{allSkills.length} enabled</Text>
      }
      renderRow={(skill, isActive) => (
        <Box flexDirection="row" gap={1}>
          <Text color={selected.has(skill.slug) ? theme.success : theme.inactive}>
            {selected.has(skill.slug) ? '[x]' : '[ ]'}
          </Text>
          <Text color={isActive ? theme.text : theme.inactive} bold={isActive}>
            {skill.slug.padEnd(20).slice(0, 20)}
          </Text>
          <Text color={theme.inactive}>
            {skill.description ? skill.description.slice(0, 38) + (skill.description.length > 38 ? '..' : '') : ''}
          </Text>
        </Box>
      )}
    />
  )
}
