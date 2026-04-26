import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'

// Genghar sprite. All frames have a blank line 0 which is stripped per renderSprite convention.
const EYE = 'o'
const RAW_FRAMES = [
  ['  /\\  /\\    ', ` (${EYE}    ${EYE}) `, ' (/\\/\\/\\)  ', " `------´   "],
  ['  /\\  /\\    ', ` (${EYE}    ${EYE}) `, '(≥/\\/\\/\\≤) ', " `------´   "],
  ['   ·        ', '  /\\  /\\    ', ` (${EYE}    ${EYE}) `, ' (/\\/\\/\\)  '],
]

const IDLE_SEQ = [0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
const COLOR = '#7C3AED'  // violet - matches audit-wizard brand

// 4 rows (blank first line trimmed by convention)
export const GENGHAR_HEIGHT = 4

type Props = {
  topClip?: number
}

export default function GengharSprite({ topClip = 0 }: Props): React.ReactElement {
  const [seqIdx, setSeqIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSeqIdx(i => (i + 1) % IDLE_SEQ.length), 500)
    return () => clearInterval(t)
  }, [])

  const frame = RAW_FRAMES[IDLE_SEQ[seqIdx % IDLE_SEQ.length]!]!
  const visibleLines = frame.slice(Math.max(0, topClip))

  return (
    <Box flexDirection="column" alignItems="center">
      {visibleLines.map((line, i) => (
        <Text key={i} color={COLOR}>{line.trimEnd()}</Text>
      ))}
    </Box>
  )
}
