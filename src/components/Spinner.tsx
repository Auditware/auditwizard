import React, { useState, useEffect } from 'react'
import { Text } from 'ink'
import { theme } from '../app/theme.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80

/** Animated braille spinner. Renders a single cycling character. */
export function Spinner({ color = theme.brand }: { color?: string }): React.ReactElement {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  return <Text color={color}>{FRAMES[frame]}</Text>
}

/** Elapsed-seconds counter. Mounts at 0, increments each second. */
export function ElapsedSeconds({ color = theme.inactive }: { color?: string }): React.ReactElement {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (secs === 0) return <Text color={color}> </Text>
  return <Text color={color}> {secs}s</Text>
}
