/**
 * The storage backend in use (ADR D6: localStorage behind a swappable surface) and the helpers every
 * storage module shares: resolving the default, and listing keys where the backend can enumerate them
 * (localStorage can; the minimal test backends need not).
 */
import type { StorageBackend } from './types'

/** localStorage, or null when unavailable (SSR/tests, privacy modes that throw on access). */
export function defaultBackend(): StorageBackend | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** `undefined` means "the default backend" everywhere in the storage API; this resolves it. */
export function resolveBackend(backend: StorageBackend | null | undefined): StorageBackend | null {
  return backend === undefined ? defaultBackend() : backend
}

const stuck = new WeakMap<StorageBackend, Set<string>>()

/**
 * Domain keys on `backend` whose unreadable payload couldn't be copied aside (storage refused the copy),
 * so it is still in place — listed with the set-aside copies until it reads again, is discarded or gone.
 */
export function stuckKeys(backend: StorageBackend): Set<string> {
  let keys = stuck.get(backend)
  if (!keys) {
    keys = new Set()
    stuck.set(backend, keys)
  }
  return keys
}

/** Every key the backend holds, or null when it can't enumerate them (or access throws). */
export function listKeys(backend: StorageBackend | null): string[] | null {
  if (!backend || typeof backend.key !== 'function' || typeof backend.length !== 'number') return null
  try {
    const keys: string[] = []
    for (let i = 0; i < backend.length; i++) {
      const key = backend.key(i)
      if (key !== null) keys.push(key)
    }
    return keys
  } catch {
    return null
  }
}
