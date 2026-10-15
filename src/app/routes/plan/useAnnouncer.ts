import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A polite live region's text (AMENDMENTS-016 B118(b)(g): completion, route switch, update and delete are
 * announced). The region is rendered empty from the start and the message is set a tick later — cleared first,
 * so the same words are announced again (the boss map's announcer pattern).
 */
export function useAnnouncer(): [string, (message: string) => void] {
  const [text, setText] = useState('')
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const announce = useCallback((message: string) => {
    window.clearTimeout(timer.current)
    setText('')
    timer.current = window.setTimeout(() => setText(message), 50)
  }, [])
  return [text, announce]
}
