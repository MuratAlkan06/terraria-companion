/**
 * Storage change notifications (P7-S2): how the app's stores refresh live when data changes underneath
 * them — an import, a restored set-aside copy, a cleared domain — and how the quarantine notice learns
 * that something was set aside (or discarded) after it first looked.
 *
 * Events carry the backend they happened on, resolved (`undefined` = the default backend), so a store
 * reacts only to changes in its own storage — the app's stores to localStorage, a test's stores to its
 * in-memory backend.
 */
import { resolveBackend } from './backend'
import type { DomainKey } from './index'
import type { StorageBackend } from './types'

export type StorageEvent =
  /** These domains' stored data was replaced outside their store (import, restore, clear). */
  | { type: 'changed'; domains: readonly DomainKey[] }
  /** The set-aside copies changed: one was added (a quarantine, an import's unreadable part) or removed. */
  | { type: 'quarantine'; domain: DomainKey }

type Listener = (event: StorageEvent, backend: StorageBackend | null) => void

const listeners = new Set<Listener>()

export function subscribeStorage(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitStorage(event: StorageEvent, backend: StorageBackend | null | undefined): void {
  const resolved = resolveBackend(backend)
  for (const listener of [...listeners]) listener(event, resolved)
}

/**
 * Runs `reload` whenever one of `domains` changes on `backend` (a store's own backend; `undefined` =
 * the default). Returns the unsubscribe function.
 */
export function onDomainsChanged(backend: StorageBackend | null | undefined, domains: readonly DomainKey[], reload: () => void): () => void {
  return subscribeStorage((event, at) => {
    if (event.type !== 'changed' || at !== resolveBackend(backend)) return
    if (event.domains.some((d) => domains.includes(d))) reload()
  })
}
