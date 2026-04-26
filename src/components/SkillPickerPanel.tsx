// SkillPickerPanel - interactive skill load/unload picker.
// Space to toggle (live), Enter to invoke selected skill, Esc to close.

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
  onToggle: (slug: string) => void
  onInvoke: (slug: string) => void
  onClose: () => void
  onAdd: () => void
}

/** Build a fixed-width (19 char) meta string so all rows align perfectly.
 *  Format: source(10) + " " + origin(8)
 *  GitHub (always global): "gh abc1234 built-in" / "gh abc1234 custom  "
 *  Local global dir:       "fs global  built-in" / "fs global  custom  "
 *  Local project path:     "fs project built-in" / "fs project custom  "
 */
function skillMetaTag(skill: LoadedSkill): string {
  const isGlobal = skill.path.includes('/.claude/skills') || skill.path.includes('/.agents/skills')
  let source: string
  if (skill.source === 'github' && skill.commitSha) {
    source = `gh ${skill.commitSha.slice(0, 7)}`   // "gh abc1234" = 10
  } else if (skill.source === 'github') {
    source = 'gh        '                           // no sha yet
  } else {
    source = isGlobal ? 'fs global ' : 'fs project' // "fs global " = 10
  }
  const origin = skill.isBuiltIn ? 'built-in  ' : 'discovered'
  return `${source.padEnd(10)} ${origin}`
}

const META_WIDTH = 21   // "gh abc1234 discovered".length
const DESC_MAX   = 28   // hard cap on description characters

export default function SkillPickerPanel({
  allSkills,
  activeSlug,
  height,
  cols,
  onToggle,
  onInvoke,
  onClose,
  onAdd,
}: Props): React.ReactElement {
  const [cursor, setCursor] = useState(0)

  useInput(useCallback((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onClose(); return }
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => Math.min(allSkills.length - 1, c + 1)); return }
    if (input === ' ') {
      const skill = allSkills[cursor]
      if (skill) onToggle(skill.slug)
      return
    }
    if (key.return) {
      const skill = allSkills[cursor]
      if (skill) onInvoke(skill.slug)
      return
    }
    if (input === 'a' || input === 'A') {
      onAdd()
      return
    }
  }, [cursor, allSkills, onToggle, onInvoke, onClose, onAdd]))

  return (
    <SlashPicker
      items={allSkills}
      selected={cursor}
      getKey={s => s.slug}
      height={height}
      cols={cols}
      accentColor={theme.brand}
      emptyText="No skills found"
      hintText="Space toggle  ↑↓ navigate  Enter invoke  a add  Esc close"
      variant="inline"
      rowSpacing={0}
      title="Skills"
      titleRight={
        <Text color={theme.inactive}>{activeSlug.size}/{allSkills.length} enabled</Text>
      }
      renderRow={(skill, isActive, innerCols) => {
        const meta = skillMetaTag(skill)
        // Layout: [x](3) gap(3) slug(20) gap(3) desc(dynamic, capped) gap(3) meta(21)
        // Overhead without desc = 3+3+20+3+3+21 = 53; remainder is available for desc
        const descAvail = Math.max(8, innerCols - 53)
        const descWidth = Math.min(DESC_MAX, descAvail)
        const raw = skill.description ?? ''
        const desc = raw.length > descWidth ? raw.slice(0, descWidth - 2) + '..' : raw.padEnd(descWidth)
        return (
          <Box flexDirection="row" gap={3}>
            <Text color={activeSlug.has(skill.slug) ? theme.success : theme.inactive}>
              {activeSlug.has(skill.slug) ? '[x]' : '[ ]'}
            </Text>
            <Text color={isActive ? theme.text : theme.inactive} bold={isActive}>
              {skill.slug.padEnd(20).slice(0, 20)}
            </Text>
            <Text color={theme.inactive}>
              {desc}
            </Text>
            <Text color={theme.subtle} dimColor>
              {meta}
            </Text>
          </Box>
        )
      }}
    />
  )
}
