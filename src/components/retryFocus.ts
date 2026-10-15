/**
 * Retry across a reload (AMENDMENTS-016 B114 M7). A failed module chunk can only be retried by reloading the
 * document (States.tsx ErrorState), which used to drop keyboard and screen-reader users at the top of the page.
 * The reloading Retry now leaves its focus target in sessionStorage ('' = the page's <main>), and the reloaded
 * page focuses it once it's in the document — the same target an in-document Retry focuses.
 */
export const RETRY_FOCUS_KEY = 'tc.retryFocus'
/** How long the reloaded page looks for the target: sections that need their data mount late. */
export const RETRY_FOCUS_WAIT_MS = 10_000
const RETRY_FOCUS_POLL_MS = 100

type FocusTarget = { focus(options?: FocusOptions): void }
export interface RetryFocusDocument {
  getElementById(id: string): FocusTarget | null
  querySelector(selector: 'main'): FocusTarget | null
  readonly activeElement: unknown
  readonly body: unknown
}
export type RetryFocusStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** sessionStorage, or null where the browser blocks it (reading the property itself can throw). */
function sessionStore(): RetryFocusStorage | null {
  try {
    return window.sessionStorage ?? null
  } catch {
    return null
  }
}

/** Before a reloading Retry: where focus should land on the reloaded page. */
export function rememberRetryFocus(retryFocusId: string | undefined, storage: RetryFocusStorage | null = sessionStore()): void {
  try {
    storage?.setItem(RETRY_FOCUS_KEY, retryFocusId ?? '')
  } catch {
    // storage full or blocked: the reloaded page starts with focus at the top, as before
  }
}

/**
 * Once per document load (main.tsx): focuses the target a reloading Retry left, as soon as it's in the document
 * (within RETRY_FOCUS_WAIT_MS) — unless the user has put focus somewhere first. The note is used once. Returns a
 * cancel function.
 */
export function resumeRetryFocus(storage: RetryFocusStorage | null = sessionStore(), doc: RetryFocusDocument = document, waitMs = RETRY_FOCUS_WAIT_MS): () => void {
  let id: string | null
  try {
    id = storage?.getItem(RETRY_FOCUS_KEY) ?? null
    if (id !== null) storage?.removeItem(RETRY_FOCUS_KEY)
  } catch {
    id = null
  }
  if (id === null) return () => {}
  const target = id
  const settle = () => {
    if (doc.activeElement && doc.activeElement !== doc.body) return true // the user got there first
    const el = target ? doc.getElementById(target) : doc.querySelector('main')
    el?.focus({ preventScroll: true })
    return el !== null
  }
  if (settle()) return () => {}
  let polls = Math.ceil(waitMs / RETRY_FOCUS_POLL_MS)
  const timer = setInterval(() => {
    if (settle() || --polls <= 0) clearInterval(timer)
  }, RETRY_FOCUS_POLL_MS)
  return () => clearInterval(timer)
}
