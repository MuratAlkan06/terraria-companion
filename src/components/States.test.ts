import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ChunkLoadError } from '../data-access/errors'
import { RETRY_FOCUS_KEY, RETRY_FOCUS_WAIT_MS, resumeRetryFocus, type RetryFocusStorage } from './retryFocus'
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

  it('a failed module chunk reloads the page instead, leaving its focus target for the reloaded page (B114 M7)', () => {
    const reload = vi.fn()
    const main = { focus: vi.fn() }
    stubDom({}, main)
    const session = memoryStorage()
    vi.stubGlobal('window', { location: { reload }, sessionStorage: session })
    const onRetry = vi.fn()
    retryHandler(ErrorState({ error: new ChunkLoadError('weapons.list', new Error('net')), onRetry, retryFocusId: 'acq-title' }))()
    expect(reload).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
    expect(session.getItem(RETRY_FOCUS_KEY)).toBe('acq-title')
    // no target id: '' stands for the page's <main>
    retryHandler(ErrorState({ error: new ChunkLoadError('weapons.list', new Error('net')), onRetry }))()
    expect(session.getItem(RETRY_FOCUS_KEY)).toBe('')
  })

  it('blocked storage never stops the reload', () => {
    const reload = vi.fn()
    stubDom({}, { focus: vi.fn() })
    vi.stubGlobal('window', {
      location: { reload },
      get sessionStorage(): Storage {
        throw new Error('SecurityError')
      },
    })
    retryHandler(ErrorState({ error: new ChunkLoadError('weapons.list', new Error('net')), onRetry: vi.fn(), retryFocusId: 'x' }))()
    expect(reload).toHaveBeenCalledOnce()
  })
})

function memoryStorage(seed: Record<string, string> = {}): RetryFocusStorage & { getItem(key: string): string | null } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

type Focusable = { focus: Mock<(options?: FocusOptions) => void> }
const focusable = (): Focusable => ({ focus: vi.fn<(options?: FocusOptions) => void>() })

describe('resumeRetryFocus: the reloaded page puts focus where the Retry would have (B114 M7)', () => {
  const body = {}
  const doc = (elements: Record<string, Focusable>, main: Focusable | null = null, active: unknown = body) => ({
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: () => main,
    activeElement: active,
    body,
  })
  afterEach(() => vi.useRealTimers())

  it('no note from a Retry: nothing is focused', () => {
    const heading = focusable()
    resumeRetryFocus(memoryStorage(), doc({ 'acq-title': heading }))
    expect(heading.focus).not.toHaveBeenCalled()
  })

  it('the target already in the document: focused at once, without scrolling; the note is used once', () => {
    const heading = focusable()
    const storage = memoryStorage({ [RETRY_FOCUS_KEY]: 'acq-title' })
    resumeRetryFocus(storage, doc({ 'acq-title': heading }))
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(storage.getItem(RETRY_FOCUS_KEY)).toBeNull()
    resumeRetryFocus(storage, doc({ 'acq-title': heading }))
    expect(heading.focus).toHaveBeenCalledOnce()
  })

  it("'' means the page's <main>", () => {
    const main = focusable()
    resumeRetryFocus(memoryStorage({ [RETRY_FOCUS_KEY]: '' }), doc({}, main))
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('a section that mounts once its data loads: focused when it appears, within the wait', () => {
    vi.useFakeTimers()
    const elements: Record<string, Focusable> = {}
    resumeRetryFocus(memoryStorage({ [RETRY_FOCUS_KEY]: 'acq-title' }), doc(elements))
    vi.advanceTimersByTime(1_000)
    const heading = focusable()
    elements['acq-title'] = heading
    vi.advanceTimersByTime(200)
    expect(heading.focus).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(RETRY_FOCUS_WAIT_MS)
    expect(heading.focus).toHaveBeenCalledOnce()
  })

  it('gives up after the wait, and never takes focus the user already moved', () => {
    vi.useFakeTimers()
    const late: Record<string, Focusable> = {}
    resumeRetryFocus(memoryStorage({ [RETRY_FOCUS_KEY]: 'acq-title' }), doc(late))
    vi.advanceTimersByTime(RETRY_FOCUS_WAIT_MS + 500)
    const heading = focusable()
    late['acq-title'] = heading
    vi.advanceTimersByTime(1_000)
    expect(heading.focus).not.toHaveBeenCalled()
    const button = {}
    const other = focusable()
    resumeRetryFocus(memoryStorage({ [RETRY_FOCUS_KEY]: 'acq-title' }), doc({ 'acq-title': other }, null, button))
    expect(other.focus).not.toHaveBeenCalled()
  })
})
