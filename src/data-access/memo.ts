/**
 * Lazy singleton for one async resource: the factory runs on first `get()`, concurrent callers
 * share the in-flight promise, and a failure is NOT cached (the next `get()` retries — this is
 * what powers ErrorState "Retry"). `peek()` reads a settled value synchronously so a page can
 * render cached data on its first frame (back navigation + scroll restoration).
 */
export interface Memo<T> {
  get(): Promise<T>
  peek(): T | undefined
  invalidate(): void
}

export function memo<T>(factory: () => Promise<T>): Memo<T> {
  let promise: Promise<T> | undefined
  let settled: { value: T } | undefined
  return {
    get() {
      if (!promise) {
        const attempt = factory().then(
          (value) => {
            if (promise === attempt) settled = { value }
            return value
          },
          (error: unknown) => {
            if (promise === attempt) promise = undefined
            throw error
          },
        )
        promise = attempt
      }
      return promise
    },
    peek: () => settled?.value,
    invalidate() {
      promise = undefined
      settled = undefined
    },
  }
}
