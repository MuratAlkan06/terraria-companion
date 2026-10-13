import { useSyncExternalStore } from 'react'

/**
 * True while the user asks for reduced motion (`prefers-reduced-motion: reduce`, UX_SPEC §9).
 * CSS handles our own animations (src/styles/index.css); this is for motion CSS can't stop,
 * e.g. animated GIF sprites. Live: follows the OS setting without a reload. False without a DOM.
 */
const QUERY = '(prefers-reduced-motion: reduce)'

function mediaQuery(): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean => mediaQuery()?.matches ?? false
const getServerSnapshot = (): boolean => false

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
