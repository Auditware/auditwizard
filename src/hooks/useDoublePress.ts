import { useCallback, useEffect, useRef } from 'react'

const DOUBLE_PRESS_TIMEOUT_MS = 800

export function useDoublePress(
  setPending: (pending: boolean) => void,
  onDoublePress: () => void,
): () => void {
  const lastPressRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])

  useEffect(() => () => clearTimeoutSafe(), [clearTimeoutSafe])

  return useCallback(() => {
    const now = Date.now()
    const isDoublePress =
      now - lastPressRef.current <= DOUBLE_PRESS_TIMEOUT_MS &&
      timeoutRef.current !== undefined

    if (isDoublePress) {
      clearTimeoutSafe()
      setPending(false)
      onDoublePress()
    } else {
      setPending(true)
      clearTimeoutSafe()
      timeoutRef.current = setTimeout(() => {
        setPending(false)
        timeoutRef.current = undefined
      }, DOUBLE_PRESS_TIMEOUT_MS)
    }

    lastPressRef.current = now
  }, [setPending, onDoublePress, clearTimeoutSafe])
}
