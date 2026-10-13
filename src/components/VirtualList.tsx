import { useVirtualizer, useWindowVirtualizer, windowScroll, type Virtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Key, type ReactNode, type Ref } from 'react'
import { cx } from './cx'

/**
 * VirtualList (UX_SPEC §3.1; ADR D7 "~30 live rows"): only the rows near the viewport are mounted,
 * and rows are measured after render, so wrapping content never overlaps.
 *
 * Two scroll modes:
 * - `window` (default): window-scrolled, so a page list scrolls naturally (no nested scroll box on
 *   mobile).
 * - `container`: the list scrolls with its nearest scrollable ancestor — a side panel or a bottom
 *   sheet (the Lab's weapon browser, UX_SPEC §3.4). Content above the list inside that scroller
 *   (search, filters) is measured as the scroll margin.
 *
 * Keyboard: overscan keeps rows beyond the viewport mounted, and the browser scrolls a focused
 * row into view, so Tab/Shift+Tab (and arrow keys in a radio list) walk the whole list. Each row
 * carries aria-setsize / aria-posinset so assistive tech announces "n of N" despite virtualization.
 *
 * Back navigation (window mode): React Router's ScrollRestoration owns the window scroll position.
 * With a `restoreKey`, measured row sizes are kept for the session and fed back on remount, so the
 * restored offset lands on the same rows instead of drifting by estimate-vs-real height.
 */

/** Measured row sizes per list state (`restoreKey@viewportWidth`), for the session. */
const measurementSnapshots = new Map<string, VirtualItem[]>()

/** Imperative scrolling for callers that move focus to a row that may not be mounted yet. */
export interface VirtualListHandle {
  scrollToIndex(index: number, align?: 'start' | 'center' | 'end' | 'auto'): void
  /** Scroll to an offset through the virtualizer (replaces any scroll it is still settling). */
  scrollToOffset(offset: number): void
}

export interface VirtualListProps<T> {
  items: readonly T[]
  getKey: (item: T) => Key
  renderItem: (item: T, index: number) => ReactNode
  /** Estimated row height in px incl. gap (refined by measurement). */
  estimateSize: number
  /** Vertical gap between rows in px. */
  gap?: number
  overscan?: number
  /** Identifies this list's content (e.g. its filters) to restore row measurements on remount (window mode). */
  restoreKey?: string
  /** What scrolls the list: the window (default) or its nearest scrollable ancestor. */
  scroller?: 'window' | 'container'
  /** Container mode: imperative scrolling (e.g. to a row that is about to take focus). */
  handle?: Ref<VirtualListHandle>
  /** Container mode: the row centred in the scroller when the list mounts (e.g. the selected one). */
  initialIndex?: number
  'aria-label'?: string
  className?: string
}

/** Document-relative top of an element (the virtualizer's scrollMargin). */
function documentTop(element: HTMLElement): number {
  return element.getBoundingClientRect().top + window.scrollY
}

/** The nearest ancestor that scrolls vertically (overflow-y auto/scroll), or null. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  return props.scroller === 'container' ? <ContainerVirtualList {...props} /> : <WindowVirtualList {...props} />
}

function WindowVirtualList<T>({
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

  return <Rows virtualizer={virtualizer} scrollMargin={scrollMargin} items={items} renderItem={renderItem} listRef={listRef} ariaLabel={ariaLabel} className={className} />
}

function ContainerVirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  gap = 0,
  overscan = 8,
  handle,
  initialIndex,
  'aria-label': ariaLabel,
  className,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const initialScrollDone = useRef(false)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Where the list starts inside its scroller: anything above it (search, filters opening) moves
  // it, so re-measure whenever the scroller or its content resizes.
  useLayoutEffect(() => {
    const element = listRef.current
    const parent = element ? scrollParent(element) : null
    setScroller(parent)
    if (!element || !parent) return
    const update = () => setScrollMargin(element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    if (parent.firstElementChild) observer.observe(parent.firstElementChild)
    return () => observer.disconnect()
  }, [items])

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimateSize,
    gap,
    overscan,
    scrollMargin,
    getItemKey: (index) => getKey(items[index]),
    useFlushSync: false,
  })
  useImperativeHandle(
    handle,
    () => ({
      scrollToIndex: (index, align = 'auto') => virtualizer.scrollToIndex(index, { align }),
      scrollToOffset: (offset) => virtualizer.scrollToOffset(offset),
    }),
    [virtualizer],
  )

  // Once the scroller is attached: centre the initial row (only on mount — choosing a row later
  // must not scroll the list under the pointer).
  useEffect(() => {
    if (initialScrollDone.current || !scroller) return
    initialScrollDone.current = true
    if (initialIndex !== undefined && initialIndex >= 0 && initialIndex < items.length) virtualizer.scrollToIndex(initialIndex, { align: 'center' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller])

  return <Rows virtualizer={virtualizer} scrollMargin={scrollMargin} items={items} renderItem={renderItem} listRef={listRef} ariaLabel={ariaLabel} className={className} />
}

interface RowsProps<T> {
  virtualizer: Virtualizer<Window, Element> | Virtualizer<HTMLElement, Element>
  scrollMargin: number
  items: readonly T[]
  renderItem: (item: T, index: number) => ReactNode
  listRef: Ref<HTMLUListElement>
  ariaLabel?: string
  className?: string
}

function Rows<T>({ virtualizer, scrollMargin, items, renderItem, listRef, ariaLabel, className }: RowsProps<T>) {
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
