import { useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'

/**
 * Client-side navigation pending state (design review P2-S3 #6).
 *
 * RouterProvider commits every navigation inside `React.startTransition`, so while a lazy route
 * chunk (`React.lazy`) is still downloading, React keeps the previous page on screen — and
 * `useNavigation()` stays "idle" (it only tracks loaders / route-level `lazy`). The router's
 * own state, however, moves to the new location immediately. So "the router's latest location
 * differs from the location React has committed" is exactly "a navigation is pending".
 * router.tsx publishes the router's location key here via the public `router.subscribe`.
 */
type Listener = () => void

let latestKey: string | undefined
const listeners = new Set<Listener>()

/** Called by the router module with `router.state.location.key` on every router state change. */
export function publishRouterLocation(key: string): void {
  if (key === latestKey) return
  latestKey = key
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => latestKey

/** True while the router has moved on but React still shows the previous route. */
export function useNavigationPending(): boolean {
  // An external store is read synchronously (outside the router's transition), while
  // useLocation() is the committed location.
  const routerKey = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { key } = useLocation()
  return routerKey !== undefined && routerKey !== key
}
