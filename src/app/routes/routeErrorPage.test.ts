/* The route error page's Retry (UX_SPEC §5.4; AMENDMENTS-016 B114 M7, B128): it reloads the document and leaves
 * the page's <main> as the reloaded page's focus target (retryFocus) — keyboard and screen-reader users don't
 * restart at the top of the page. */
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RETRY_FOCUS_KEY, resumeRetryFocus, type RetryFocusStorage } from '../../components/retryFocus'
import RouteErrorPage from './RouteErrorPage'

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useRouteError: () => new TypeError('Failed to fetch dynamically imported module: /assets/WeaponsListPage.js'),
}))
vi.mock('../useDocumentTitle', () => ({ useDocumentTitle: () => {} }))

/** The Retry button's click handler from the page's element tree (no DOM renderer needed). */
function retryHandler(element: ReactNode): () => void {
  const visit = (node: ReactNode): (() => void) | undefined => {
    if (Array.isArray(node)) return node.map(visit).find(Boolean)
    if (!isValidElement(node)) return undefined
    const { type, props } = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>
    if (type === 'button' && props.onClick) return props.onClick
    if (typeof type === 'function') return visit((type as (p: unknown) => ReactNode)(props))
    return visit(props.children)
  }
  const handler = visit(element)
  if (!handler) throw new Error('Retry button not found')
  return handler
}

function memoryStorage(): RetryFocusStorage & { getItem(key: string): string | null } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('RouteErrorPage Retry keeps focus across its reload (B128)', () => {
  it('leaves <main> as the focus target, then reloads — and the reloaded page focuses <main>', () => {
    const reload = vi.fn()
    const session = memoryStorage()
    vi.stubGlobal('window', { location: { reload }, sessionStorage: session })
    retryHandler(RouteErrorPage())()
    expect(reload).toHaveBeenCalledOnce()
    expect(session.getItem(RETRY_FOCUS_KEY)).toBe('') // '' = the page's <main>
    const main = { focus: vi.fn() }
    const body = {}
    resumeRetryFocus(session, { getElementById: () => null, querySelector: () => main, activeElement: body, body })
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(session.getItem(RETRY_FOCUS_KEY)).toBeNull()
  })

  it('blocked storage never stops the reload', () => {
    const reload = vi.fn()
    vi.stubGlobal('window', {
      location: { reload },
      get sessionStorage(): Storage {
        throw new Error('SecurityError')
      },
    })
    retryHandler(RouteErrorPage())()
    expect(reload).toHaveBeenCalledOnce()
  })
})
