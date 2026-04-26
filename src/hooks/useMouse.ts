import { useEffect, useRef } from 'react'
import { spawn } from 'child_process'
import { parseMouseEvents } from '../utils/mouse.js'
import { screenBuffer } from '../utils/ScreenBuffer.js'
import { setSelection } from '../utils/selectionOverlay.js'
const WHEEL_STEP = 3

export function useMouse(
  onWheel: (delta: number) => void,
  onCopied: (charCount: number) => void,
  onPress?: (row: number, col: number) => void,
): void {
  const pressRowRef = useRef<number | null>(null)
  const pressColRef = useRef<number | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    const stdin = process.stdin
    if (!stdin?.readable) return

    function handler(data: Buffer | string) {
      const events = parseMouseEvents(data)
      for (const ev of events) {
        if ('direction' in ev) {
          onWheel(ev.direction === 'up' ? WHEEL_STEP : -WHEEL_STEP)
          continue
        }
        if (ev.button !== 0) continue

        if (ev.type === 'press') {
          pressRowRef.current = ev.row
          pressColRef.current = ev.col
          didDragRef.current = false
          // Don't start selection on press alone - wait to see if drag follows
        } else if (ev.type === 'drag' && pressRowRef.current !== null) {
          didDragRef.current = true
          setSelection({
            startRow: pressRowRef.current, startCol: pressColRef.current!,
            endRow: ev.row, endCol: ev.col,
          })
        } else if (ev.type === 'release' && pressRowRef.current !== null) {
          const sRow = pressRowRef.current, sCol = pressColRef.current!
          const wasDrag = didDragRef.current
          pressRowRef.current = null
          pressColRef.current = null
          didDragRef.current = false
          setSelection(null)

          if (!wasDrag) {
            // Single click - focus input, no copy
            onPress?.(sRow, sCol)
          } else {
            // Drag-release - copy selected text
            const text = screenBuffer.getSelectedText(sRow, sCol, ev.row, ev.col)
            if (text.trim().length >= 2) {
              const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
              proc.stdin.write(text)
              proc.stdin.end()
              proc.on('close', () => onCopied(text.length))
            } else {
              onCopied(0)
            }
          }
        }
      }
    }

    stdin.on('data', handler)
    return () => { stdin.off('data', handler) }
  }, [onWheel, onCopied, onPress])
}
