import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Hash anchors on async-mounted sections (AMENDMENTS-016 B113c). A link such as the readiness checker's
 * "how to get it" (`/items/188#acq-title`) names a section that only exists once the page's data has
 * loaded: the browser's own jump (a hard load) and React Router's ScrollRestoration (in-app) both look
 * for it before it mounts, find nothing and leave the page at the top. The section's page calls
 * `useHashTarget` where the section mounts: when the location's hash names one of `ids` and that element
 * is in the document, it is scrolled into view and focused (headings carry tabIndex={-1}) — ONCE per
 * history entry, so a later re-render, a section loading below, or coming back to the entry (where
 * ScrollRestoration restores the old position) never moves the page again.
 */

/** The id a location hash names, when it is one of `ids` ("#acq-title" → "acq-title"); undefined otherwise. */
export function hashTargetId(hash: string, ids: readonly string[]): string | undefined {
  if (hash.length < 2 || !hash.startsWith('#')) return undefined
  let id: string
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return undefined
  }
  return ids.includes(id) ? id : undefined
}

/** The part of a document the reveal needs (tests pass a stand-in). */
export interface HashTargetDocument {
  getElementById(id: string): Pick<HTMLElement, 'scrollIntoView' | 'focus'> | null
}

/** History entries already handled (location.key), so each entry jumps once. */
const handled = new Set<string>()

/**
 * Reveals the hash's element once for the history entry `key`: scrolls it into view (its scroll-margin
 * keeps it clear of the sticky header) and focuses it without a second scroll. True when it did.
 */
export function revealHashTarget(hash: string, key: string, ids: readonly string[], doc: HashTargetDocument, done: Set<string> = handled): boolean {
  const id = hashTargetId(hash, ids)
  if (id === undefined || done.has(key)) return false
  const el = doc.getElementById(id)
  if (!el) return false
  done.add(key)
  el.scrollIntoView({ block: 'start' })
  el.focus({ preventScroll: true })
  return true
}

/**
 * Call where the section(s) mount, with `ready` once they are in the document. The reveal waits one
 * frame: the shell moves focus to <main> on a route change in the same commit (parent effects run after
 * child effects), and the heading must win that.
 */
export function useHashTarget(ids: readonly string[], ready = true): void {
  const { hash, key } = useLocation()
  const idList = ids.join('\n')
  useEffect(() => {
    if (!ready || hashTargetId(hash, idList.split('\n')) === undefined) return
    const frame = requestAnimationFrame(() => revealHashTarget(hash, key, idList.split('\n'), document))
    return () => cancelAnimationFrame(frame)
  }, [ready, hash, key, idList])
}
