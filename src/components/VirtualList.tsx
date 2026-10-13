import { useWindowVirtualizer, windowScroll, type VirtualItem } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState, type Key, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * VirtualList (UX_SPEC §3.1; ADR D7 "~30 live rows"): window-scrolled virtualization, so the
 * page scrolls naturally (no nested scroll box on mobile) and only the rows near the viewport
 * are mounted. Rows are measured after render, so wrapping content never overlaps.
 *
 * Keyboard: overscan keeps rows beyond the viewport mounted, and the browser scrolls a focused
 * row into view, so Tab/Shift+Tab walk the whole list. Each row carries aria-setsize /
 * aria-posinset so assistive tech announces "n of N" despite virtualization.
 *
 * Back navigation: React Router's ScrollRestoration owns the window scroll position. With a
 * `restoreKey`, measured row sizes are kept for the session and fed back on remount, so the
 * restored offset lands on the same rows instead of drifting by estimate-vs-real height.
 */

/** Measured row sizes per list state (`restoreKey@viewportWidth`), for the session. */
const measurementSnapshots = new Map<string, VirtualItem[]>()
export interface VirtualListProps<T> {
  items: readonly T[]
  getKey: (item: T) => Key
  renderItem: (item: T, index: number) => ReactNode
  /** Estimated row height in px incl. gap (refined by measurement). */
  estimateSize: number
  /** Vertical gap between rows in px. */
  gap?: number
  overscan?: number
  /** Identifies this list's content (e.g. its filters) to restore row measurements on remount. */
  restoreKey?: string
  'aria-label'?: string
  className?: string
}

/** Document-relative top of an element (the virtualizer's scrollMargin). */
function documentTop(element: HTMLElement): number {
  return element.getBoundingClientRect().top + window.scrollY
}

export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  gap = 0,
  overscan = 8,
  restoreKey,
  'aria-label': ariaLabel,
  className,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const snapshotKey = restoreKey === undefined ? undefined : `${restoreKey}@${window.innerWidth}`

  // Content above the list (filters, chips, wrapping text) can move it: re-measure when the
  // items change and whenever the page's layout box resizes. setState bails out when unchanged.
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    const update = () => setScrollMargin(documentTop(element))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [items])

  // No React Compiler in this project; TanStack Virtual's hook is used as documented.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    gap,
    overscan,
    scrollMargin,
    getItemKey: (index) => getKey(items[index]),
    // React 19: avoid flushSync-in-lifecycle warnings; async updates are smooth at this size.
    useFlushSync: false,
    initialMeasurementsCache: snapshotKey ? measurementSnapshots.get(snapshotKey) : undefined,
    // This list never asks the virtualizer to scroll. Its only non-adjustment scroll is
    // re-applying a cached offset when it attaches to the window, which would undo
    // ScrollRestoration on back navigation — so only size-change adjustments get through.
    scrollToFn: (offset, options, instance) => {
      if (options.adjustments !== undefined) windowScroll(offset, options, instance)
    },
  })

  // Keep the latest measurements when this list state goes away (navigation or new filters).
  const latest = useRef({ virtualizer, snapshotKey })
  useEffect(() => {
    latest.current = { virtualizer, snapshotKey }
  })
  useEffect(
    () => () => {
      const { virtualizer: v, snapshotKey: key } = latest.current
      if (key) measurementSnapshots.set(key, v.takeSnapshot())
    },
    [snapshotKey],
  )

  return (
    <ul
      ref={listRef}
      // Explicit role: Safari drops list semantics for list-style:none lists.
      role="list"
      aria-label={ariaLabel}
      className={cx('relative w-full', className)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <li
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          aria-setsize={items.length}
          aria-posinset={row.index + 1}
          className="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
        >
          {renderItem(items[row.index], row.index)}
        </li>
      ))}
    </ul>
  )
}
