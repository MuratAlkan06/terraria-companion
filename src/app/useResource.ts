import { useCallback, useEffect, useState } from 'react'

/**
 * Async data for a page section, backed by a data-access loader.
 *
 * - `peek` is read synchronously on the first render (and whenever `key` changes), so cached
 *   data renders on the first frame — back navigation restores scroll without a loading flash.
 * - `retry()` re-runs `load` (data-access never caches failures).
 * Pass a stable `key` that identifies what `load` fetches; `load`/`peek` may be inline closures.
 */
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown }

interface Tracked<T> {
  key: string
  attempt: number
  state: ResourceState<T>
}

function initial<T>(key: string, attempt: number, peek?: () => T | undefined): Tracked<T> {
  const cached = peek?.()
  return { key, attempt, state: cached === undefined ? { status: 'loading' } : { status: 'ready', data: cached } }
}

export function useResource<T>(
  key: string,
  load: () => Promise<T>,
  peek?: () => T | undefined,
): ResourceState<T> & { retry: () => void } {
  const [tracked, setTracked] = useState<Tracked<T>>(() => initial(key, 0, peek))

  // Key changed (e.g. /weapons/1 -> /weapons/2): reset during render, no stale frame.
  let current = tracked
  if (tracked.key !== key) {
    current = initial(key, tracked.attempt + 1, peek)
    setTracked(current)
  }

  const { status } = current.state
  const { attempt } = current
  useEffect(() => {
    if (status !== 'loading') return
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setTracked((t) => (t.key === key && t.attempt === attempt ? { ...t, state: { status: 'ready', data } } : t))
      },
      (error: unknown) => {
        if (!cancelled) setTracked((t) => (t.key === key && t.attempt === attempt ? { ...t, state: { status: 'error', error } } : t))
      },
    )
    return () => {
      cancelled = true
    }
    // `load` is intentionally not a dependency: `key` + `attempt` identify the request, and
    // `load` is usually an inline closure that would otherwise refetch on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, status])

  const retry = useCallback(() => {
    setTracked((t) => ({ key: t.key, attempt: t.attempt + 1, state: { status: 'loading' } }))
  }, [])

  return { ...current.state, retry }
}

/** True only once `active` has stayed true for `delayMs` (UX_SPEC §5.1: skeleton only if >300ms). */
export function useDelayedFlag(active: boolean, delayMs = 300): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active, delayMs])
  return active && elapsed
}
