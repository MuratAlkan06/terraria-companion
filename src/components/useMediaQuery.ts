import { useCallback, useSyncExternalStore } from 'react'

/**
 * Live `matchMedia` match for layout decisions CSS can't make on its own (e.g. a sprite box size
 * that must stay a whole-number scale). False without a DOM (SSR markup tests).
 */
function mediaQueryList(query: string): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList(query)?.matches ?? false,
    () => false,
  )
}

export type BreakpointName = 'md' | 'lg' | 'xl'

const breakpointQueries = new Map<BreakpointName, string>()

/**
 * `(min-width: …)` for a design-token breakpoint. tokens.css emits `--breakpoint-*` to :root
 * (`@theme static`), so JS reads the value instead of duplicating it. Never matches without a DOM.
 */
export function breakpointQuery(name: BreakpointName): string {
  const cached = breakpointQueries.get(name)
  if (cached) return cached
  if (typeof document === 'undefined') return 'not all'
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--breakpoint-${name}`).trim()
  if (!value) return 'not all'
  const query = `(min-width: ${value})`
  breakpointQueries.set(name, query)
  return query
}

/** True from the given token breakpoint up (mirrors Tailwind's `lg:` etc.). */
export function useBreakpoint(name: BreakpointName): boolean {
  return useMediaQuery(breakpointQuery(name))
}
