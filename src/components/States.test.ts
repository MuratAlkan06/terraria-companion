import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkLoadError } from '../data-access/errors'
import { ErrorState } from './States'

/** The Retry button's click handler from ErrorState's element tree (no DOM renderer needed). */
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

function stubDom(elements: Record<string, { focus: ReturnType<typeof vi.fn> }>, main: { focus: ReturnType<typeof vi.fn> }) {
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: (selector: string) => (selector === 'main' ? main : null),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('ErrorState Retry keeps keyboard focus off <body> (design review P2-S3)', () => {
  it('focuses the given stable target (e.g. the section heading) and retries', () => {
    const heading = { focus: vi.fn() }
    const main = { focus: vi.fn() }
    stubDom({ 'acq-title': heading }, main)
    const onRetry = vi.fn()
    retryHandler(ErrorState({ error: new Error('boom'), onRetry, retryFocusId: 'acq-title' }))()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(main.focus).not.toHaveBeenCalled()
  })

  it('falls back to <main> without a target id (or when the id is missing)', () => {
    const main = { focus: vi.fn() }
    stubDom({}, main)
    retryHandler(ErrorState({ error: new Error('boom'), onRetry: vi.fn() }))()
    retryHandler(ErrorState({ error: new Error('boom'), onRetry: vi.fn(), retryFocusId: 'gone' }))()
    expect(main.focus).toHaveBeenCalledTimes(2)
  })

  it('a failed module chunk reloads the page instead (focus starts fresh)', () => {
    const reload = vi.fn()
    const main = { focus: vi.fn() }
    stubDom({}, main)
    vi.stubGlobal('window', { location: { reload } })
    const onRetry = vi.fn()
    retryHandler(ErrorState({ error: new ChunkLoadError('weapons.list', new Error('net')), onRetry }))()
    expect(reload).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
  })
})
