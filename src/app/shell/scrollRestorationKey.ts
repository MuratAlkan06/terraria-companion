import type { Location } from 'react-router'

/**
 * `<ScrollRestoration getKey>` for the app shell.
 *
 * React Router keys saved scroll positions by `location.key`, but every fresh
 * document load (typed URL, external link, reload of such an entry) gets the
 * same key, `"default"`, so one page would inherit another page's scroll.
 * Those entries are keyed by path instead; in-app history entries keep their
 * unique key, so new link navigations still start at the top and back/forward
 * still restores.
 */
export function scrollRestorationKey(location: Pick<Location, 'key' | 'pathname' | 'search'>): string {
  return location.key === 'default' ? location.pathname + location.search : location.key
}
