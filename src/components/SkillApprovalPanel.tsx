// SkillApprovalPanel - blocks skill invocation when guardrails fire, asks user y/n.

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../app/theme.js'
import type { LoadedSkill } from '../skills/loader.js'

type Props = {
  skill: LoadedSkill
  categories: string[]
  onDecide: (allow: boolean) => void
}

export default function SkillApprovalPanel({ skill, categories, onDecide }: Props): React.ReactElement {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(t)
  }, [])

  useInput((input, key) => {
    if (!ready) return
    const ch = input.toLowerCase()
    if (ch === 'y' || key.return) {
      onDecide(true)
    } else if (ch === 'n' || key.escape || (key.ctrl && input === 'c')) {
      onDecide(false)
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box gap={2}>
        <Text color={theme.warning} bold>⚠ skill guardrail</Text>
        <Text dimColor>{skill.name}</Text>
      </Box>

      <Box flexDirection="column">
        <Text color={theme.subtle}>violations detected:</Text>
        {categories.map(c => (
          <Text key={c} color={theme.error}>{`  · ${c}`}</Text>
        ))}
      </Box>

      <Box gap={0}>
        <Text color={theme.subtle}>load anyway?  </Text>
        <Text color={theme.warning} bold>y</Text>
        <Text color={theme.subtle}> yes  </Text>
        <Text color={theme.brand} bold>n</Text>
        <Text color={theme.subtle}> block</Text>
      </Box>
    </Box>
  )
}
