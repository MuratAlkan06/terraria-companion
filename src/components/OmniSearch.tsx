import { ChevronRight, ExternalLink, RotateCw, Search, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { pathFor } from '../app/routes'
import { useDelayedFlag } from '../app/useResource'
import { ChunkLoadError } from '../data-access/errors'
import type { SpriteIndex } from '../data-access/types'
import rawMeta from '../data/meta.json'
import { loadSearchIndex, peekSearchIndex, type SearchIndex, type SearchResultItem, type SearchSuggestions } from '../search'
import { autofocusSearch, comboboxKeyAction, isSearchShortcut } from '../search/combobox'
import { ENTITY_TYPES, searchableCounts, searchPlaceholder, searchScopeSummary } from '../search/entityTypes'
import { EmptyChest } from './art/EmptyChest'
import { buttonClass } from './buttonStyles'
import { cx } from './cx'
import { asRarity } from './rarity'
import { RarityText } from './RarityText'
import { SpriteImg } from './SpriteImg'

/**
 * OmniSearch (UX_SPEC §2/§3.1/§5; PRD P2-S4): the shell-level global search, mounted once in the
 * header so it is reachable from every page (AC4). The homepage hero adds a second, larger
 * instance of the same component family: HeroSearch below (UX_SPEC §3.2, AMENDMENTS-007 B28).
 *
 * - ≥ lg: inline combobox, centred in the header; results drop down below it.
 * - < lg: a search-field-styled trigger opens a full-screen overlay (Radix Dialog: focus trap,
 *   Esc, scroll lock) holding the same combobox.
 * - "/" anywhere (not while typing elsewhere) focuses the inline field or opens the overlay, with
 *   no animation (UX_SPEC §9/§12).
 *
 * Combobox semantics follow the WAI-ARIA APG list-autocomplete pattern (Radix has no combobox
 * primitive): focus stays in the input, rows are `role="option"` in labelled groups, the
 * highlight is `aria-activedescendant`, the best match is pre-highlighted so Enter opens it.
 * The index is built lazily on the first focus/keystroke (ADR D7) — see src/search/index.ts.
 */

const SHIPPED = searchableCounts(rawMeta.counts)
const PLACEHOLDER = searchPlaceholder(SHIPPED)
const SCOPE = searchScopeSummary(SHIPPED)
/** UX_SPEC §5.1: the inline spinner appears only once loading passes 150ms. */
const SPINNER_DELAY_MS = 150

/** Where the overlay was opened from (trigger tap or "/"), for focus return on close. */
interface OverlayOrigin {
  path: string
  focus: Element | null
}

export function OmniSearch() {
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const overlay = useOverlayState()
  const setOverlay = overlay.onOpenChange

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      const input = inlineInputRef.current
      if (input && input.getClientRects().length > 0) {
        input.focus()
        input.select()
      } else {
        setOverlay(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setOverlay])

  return (
    <>
      {/* B29: the inline search never shrinks below 240px; the header's nav collapses instead. */}
      <div className="hidden min-w-0 flex-1 justify-center lg:flex lg:min-w-60">
        <SearchCombobox variant="inline" inputRef={inlineInputRef} />
      </div>
      <SearchOverlay trigger="header" {...overlay} />
    </>
  )
}

/**
 * HeroSearch — the homepage's large OmniSearch instance (UX_SPEC §3.2, AMENDMENTS-007 B28): the
 * same lazy index, combobox and overlay as the header instance, drawn larger.
 *
 * - ≥ lg: inline combobox, autofocused on desktop only (`autofocusSearch`: mouse/trackpad, nothing
 *   else focused) and quietly — the index still loads on the first keystroke or a real focus, so
 *   the homepage pulls no search code or data on load (ADR D7).
 * - < lg: a large search-field-styled trigger opening the same full-screen overlay (no autofocus:
 *   touch devices would pop the keyboard).
 * The "/" shortcut stays with the header instance.
 */
export function HeroSearch({ className }: { className?: string }) {
  const overlay = useOverlayState()
  return (
    <div className={className}>
      <div className="hidden lg:block">
        <SearchCombobox variant="hero" autoFocus />
      </div>
      <SearchOverlay trigger="hero" {...overlay} />
    </div>
  )
}

/** Open state of one overlay instance + where it was opened from (for focus return on close). */
function useOverlayState() {
  const [open, setOpen] = useState(false)
  const origin = useRef<OverlayOrigin | null>(null)
  const onOpenChange = useCallback((next: boolean) => {
    if (next) origin.current = { path: window.location.pathname, focus: document.activeElement }
    setOpen(next)
  }, [])

  // Close the overlay whenever navigation happens (incl. back/forward): adjust during render.
  const { pathname } = useLocation()
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (renderedPath !== pathname) {
    setRenderedPath(pathname)
    setOpen(false)
  }

  return { open, onOpenChange, origin }
}

type OverlayTrigger = 'header' | 'hero'

// Below md the right padding and icon gap are a step tighter than the left padding: the labels
// had only ~4px to spare at 360px (hero) or were cut by ~1px (header), so platforms with slightly
// wider text rendering ellipsized them (design review B42c).
const TRIGGER_CLASSES: Record<OverlayTrigger, string> = {
  header: 'min-h-tap min-w-0 flex-1 gap-1.5 border-panel-border pr-2 pl-3 shadow-pixel hover:border-border-strong',
  // Hero: larger, with a strong border + drop so the field reads clearly over the pixel art.
  hero: 'h-14 w-full gap-1.5 border-border-strong pr-2 pl-3 shadow-pixel-drop hover:border-stone-400 md:gap-3 md:px-4',
}

interface SearchOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  origin: RefObject<OverlayOrigin | null>
  /** Which small-screen trigger opens this overlay. */
  trigger: OverlayTrigger
}

function SearchOverlay({ open, onOpenChange, origin, trigger }: SearchOverlayProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const onCloseAutoFocus = (event: Event) => {
    const from = origin.current
    // A result navigated: focus belongs to <main> (UX_SPEC §9), which the shell focuses.
    if (!from || from.path !== window.location.pathname) {
      event.preventDefault()
      return
    }
    // Opened by "/" with nothing focused: land on the trigger, never on <body>. Otherwise Radix
    // returns focus to where it was (the trigger, or the element "/" was pressed on).
    if (!from.focus || from.focus === document.body) {
      event.preventDefault()
      triggerRef.current?.focus()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger
        ref={triggerRef}
        className={cx(
          'flex items-center border-2 bg-surface-sunken text-left text-base text-fg-muted lg:hidden',
          'transition-colors duration-(--dur-ui) ease-out-strong hover:text-fg',
          TRIGGER_CLASSES[trigger],
        )}
      >
        {trigger === 'hero' ? (
          <>
            <Search aria-hidden="true" className="size-5 shrink-0 md:size-6" />
            <span className="truncate">{PLACEHOLDER}</span>
          </>
        ) : (
          <>
            <Search aria-hidden="true" className="size-5 shrink-0" />
            <span className="truncate md:hidden">Search…</span>
            <span className="hidden truncate md:inline">{PLACEHOLDER}</span>
          </>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* No enter animation: opening search is never animated (UX_SPEC §12). */}
        <Dialog.Content onCloseAutoFocus={onCloseAutoFocus} className="fixed inset-0 z-(--z-dialog) flex flex-col bg-surface text-fg">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Dialog.Description className="sr-only">
            {SCOPE ? `Search ${SCOPE}. ` : ''}Suggestions update as you type.
          </Dialog.Description>
          <SearchCombobox
            variant="overlay"
            onActivated={() => onOpenChange(false)}
            endSlot={
              <Dialog.Close
                aria-label="Close search"
                className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
              >
                <X aria-hidden="true" className="size-5" />
              </Dialog.Close>
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type IndexState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; index: SearchIndex }
  | { status: 'error'; error: unknown }

/** The shared lazy index. `request()` starts (or, after a failure, retries) the one-time build. */
function useSearchIndex() {
  const [state, setState] = useState<IndexState>(() => {
    const index = peekSearchIndex()
    return index ? { status: 'ready', index } : { status: 'idle' }
  })
  const request = useCallback(() => {
    setState((s) => (s.status === 'idle' || s.status === 'error' ? { status: 'loading' } : s))
  }, [])
  useEffect(() => {
    if (state.status !== 'loading') return
    let cancelled = false
    loadSearchIndex().then(
      (index) => {
        if (!cancelled) setState({ status: 'ready', index })
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [state.status])
  return { state, request }
}

interface SearchComboboxProps {
  /** inline = header field (≥ lg); hero = the homepage's large field (≥ lg); overlay = full screen. */
  variant: 'inline' | 'hero' | 'overlay'
  inputRef?: RefObject<HTMLInputElement | null>
  /** After a result or the browse link was activated (the overlay closes itself). */
  onActivated?: () => void
  /** Rendered after the input in the overlay's top bar (its Close button). */
  endSlot?: ReactNode
  /** Desktop-only autofocus on mount (see autofocusSearch); never starts the index load. */
  autoFocus?: boolean
}

function SearchCombobox({ variant, inputRef, onActivated, endSlot, autoFocus = false }: SearchComboboxProps) {
  const overlay = variant === 'overlay'
  const hero = variant === 'hero'
  const id = useId()
  const listboxId = `${id}listbox`
  const optionId = (index: number) => `${id}option-${index}`
  const ownInputRef = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInputRef
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { state, request } = useSearchIndex()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const scrollToActive = useRef(false)
  const trimmed = query.trim()

  const suggestions = useMemo(
    () => (state.status === 'ready' && trimmed !== '' ? state.index.suggest(trimmed) : undefined),
    [state, trimmed],
  )
  const options = suggestions?.options ?? []

  // A new result set pre-highlights the best match (Enter opens it); nothing when empty.
  const [highlightedFor, setHighlightedFor] = useState(suggestions)
  if (highlightedFor !== suggestions) {
    setHighlightedFor(suggestions)
    setActive(options.length > 0 ? 0 : -1)
  }

  const hasPanel = trimmed !== '' && (state.status === 'ready' || state.status === 'error')
  const expanded = hasPanel && (overlay || open)
  const spinner = useDelayedFlag(state.status === 'loading' && trimmed !== '', SPINNER_DELAY_MS)

  useEffect(() => {
    if (!scrollToActive.current || active < 0) return
    scrollToActive.current = false
    document.getElementById(`${id}option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  // Autofocus is quiet: the focus event it fires (synchronously, inside focus()) must not start
  // the lazy index — the first keystroke or a real focus does (ADR D7, AMENDMENTS-007 B28).
  const quietFocus = useRef(false)
  useEffect(() => {
    if (!autoFocus) return
    quietFocus.current = true
    try {
      autofocusSearch(input.current, {
        matchMedia: typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined,
        activeElement: document.activeElement,
        body: document.body,
      })
    } finally {
      quietFocus.current = false
    }
  }, [autoFocus, input])

  const finish = () => {
    setQuery('')
    setOpen(false)
    onActivated?.()
  }

  const activate = (item: SearchResultItem) => {
    if (item.target.kind === 'external') {
      // Types without a local page yet open their wiki article in a new tab (src/search/links.ts).
      window.open(item.target.href, '_blank', 'noopener,noreferrer')
    } else {
      navigate(item.target.to)
    }
    finish()
  }

  const retry = () => {
    if (state.status === 'error' && state.error instanceof ChunkLoadError && state.error.moduleImport) {
      // A failed module chunk stays failed for this document: only a reload can refetch it.
      window.location.reload()
      return
    }
    input.current?.focus({ preventScroll: true })
    request()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    // In the overlay, Escape belongs to the dialog (closes the whole search).
    if (overlay && event.key === 'Escape') return
    const action = comboboxKeyAction(event.key, { expanded, hasQuery: trimmed !== '', active, optionCount: options.length })
    if (!action) return
    event.preventDefault()
    switch (action.type) {
      case 'open':
        setOpen(true)
        request()
        break
      case 'move':
        scrollToActive.current = true
        setActive(action.to)
        break
      case 'activate':
        activate(options[action.index])
        break
      case 'close':
        setOpen(false)
        break
      case 'clear':
        setQuery('')
        break
    }
  }

  // Inline: the popup closes when focus leaves the whole widget (input, popup links/buttons).
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
  }

  const field = (
    <SearchField
      inputRef={input}
      inputProps={{
        role: 'combobox',
        'aria-expanded': expanded,
        'aria-controls': listboxId,
        'aria-autocomplete': 'list',
        'aria-activedescendant': expanded && active >= 0 && active < options.length ? optionId(active) : undefined,
        // Only the header field owns the "/" shortcut.
        'aria-keyshortcuts': variant === 'inline' ? '/' : undefined,
        value: query,
        onChange: (event) => {
          setQuery(event.target.value)
          setOpen(true)
          request()
        },
        onFocus: () => {
          if (quietFocus.current) return
          setOpen(true)
          request()
        },
        onKeyDown,
      }}
      spinner={spinner}
      shortcutHint={variant === 'inline'}
      size={hero ? 'large' : 'default'}
    />
  )

  const results = (
    <>
      <div role="listbox" id={listboxId} aria-label="Search suggestions" hidden={!expanded || options.length === 0}>
        {suggestions ? (
          <ResultGroups
            suggestions={suggestions}
            idPrefix={id}
            optionId={optionId}
            active={active}
            sprites={state.status === 'ready' ? state.index.sprites : null}
            onHover={(index) => {
              if (index !== active) setActive(index)
            }}
            onActivate={activate}
          />
        ) : null}
      </div>
      {expanded && state.status === 'error' ? <SearchError error={state.error} onRetry={retry} /> : null}
      {expanded && suggestions && options.length === 0 ? <NoResults query={trimmed} onBrowse={finish} /> : null}
    </>
  )

  const status = (
    <p role="status" className="sr-only">
      {statusText(state, trimmed, suggestions, spinner)}
    </p>
  )

  // Mouse presses inside the results must not blur the input (that would close the popup first).
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()

  if (overlay) {
    return (
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b-2 border-panel-border bg-surface px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          {field}
          {endSlot}
        </div>
        <div onMouseDown={keepFocus} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">
          {trimmed === '' && SCOPE ? <p className="px-4 py-4 text-sm text-fg-muted">Search {SCOPE}.</p> : null}
          {results}
        </div>
        {status}
      </div>
    )
  }

  return (
    <div ref={rootRef} onBlur={onBlur} className={cx('relative w-full', !hero && 'max-w-md')}>
      {field}
      <div
        hidden={!expanded}
        onMouseDown={keepFocus}
        className={cx(
          'absolute top-full z-(--z-popover) mt-2',
          // Header: centred under the field, at least 28rem wide. Hero: the field's own width.
          hero ? 'left-0 w-full' : 'left-1/2 w-[max(100%,28rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2',
          'max-h-[min(70dvh,34rem)] overflow-y-auto overscroll-contain border-2 border-panel-border bg-surface shadow-pixel-drop',
        )}
      >
        {results}
      </div>
      {status}
    </div>
  )
}

function statusText(state: IndexState, query: string, suggestions: SearchSuggestions | undefined, spinner: boolean): string {
  if (query === '') return ''
  if (state.status === 'error') return 'Search couldn’t load.'
  if (state.status !== 'ready') return spinner ? 'Loading search…' : ''
  const count = suggestions?.options.length ?? 0
  return count === 0 ? `No results for “${query}”.` : `${count} ${count === 1 ? 'suggestion' : 'suggestions'}.`
}

interface SearchFieldProps {
  inputRef: RefObject<HTMLInputElement | null>
  inputProps: InputHTMLAttributes<HTMLInputElement>
  spinner: boolean
  /** Show the "/" key hint while the field is empty and unfocused. */
  shortcutHint: boolean
  /** large = the homepage hero instance (B28). */
  size: 'default' | 'large'
}

const FIELD_SIZES = {
  default: {
    input: 'h-tap pr-10 pl-10 text-base border-panel-border shadow-pixel',
    icon: 'left-3 size-5',
    end: 'right-3',
  },
  // Hero: taller, larger type, and a strong border + drop so it reads clearly over the pixel art.
  large: {
    input: 'h-14 pr-12 pl-12 text-lg border-border-strong shadow-pixel-drop',
    icon: 'left-4 size-6',
    end: 'right-4',
  },
} as const

function SearchField({ inputRef, inputProps, spinner, shortcutHint, size }: SearchFieldProps) {
  const sizing = FIELD_SIZES[size]
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted', sizing.icon)}
      />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search"
        placeholder={PLACEHOLDER}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        className={cx(
          'peer w-full min-w-0 border-2 bg-surface-sunken text-fg',
          'text-ellipsis caret-accent placeholder:text-fg-muted focus:border-gold-600',
          sizing.input,
        )}
        {...inputProps}
      />
      {/* Siblings of the `peer` input, absolutely placed in its right padding: no layout shift. */}
      {spinner ? (
        <span
          aria-hidden="true"
          className={cx('pointer-events-none absolute top-1/2 flex -translate-y-1/2 gap-0.5', sizing.end)}
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 bg-accent motion-safe:animate-pixel-march"
              style={{ animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </span>
      ) : shortcutHint ? (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 border-2 border-panel-border px-1.5 font-sans text-xs leading-4 font-semibold text-fg-muted peer-placeholder-shown:block peer-focus:hidden"
        >
          /
        </kbd>
      ) : null}
    </div>
  )
}

interface ResultGroupsProps {
  suggestions: SearchSuggestions
  idPrefix: string
  optionId: (index: number) => string
  active: number
  sprites: SpriteIndex | null
  onHover: (index: number) => void
  onActivate: (item: SearchResultItem) => void
}

/** Grouped options (APG grouped listbox). Exported for markup tests. */
export function ResultGroups({ suggestions, idPrefix, optionId, active, sprites, onHover, onActivate }: ResultGroupsProps) {
  let index = 0
  // The "keep typing" hint goes on the first truncated group only (once per panel, not per group).
  const hintGroup = suggestions.groups.find((group) => group.total > group.items.length)
  return suggestions.groups.map((group) => {
    const headingId = `${idPrefix}group-${group.type}`
    return (
      <div key={group.type} role="group" aria-labelledby={headingId} className="py-1">
        <div
          role="presentation"
          id={headingId}
          className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase"
        >
          <span>{group.label}</span>
          {group.total > group.items.length ? (
            <span className="text-right font-normal tracking-normal normal-case">
              top {group.items.length} of {group.total}
              {group === hintGroup ? ' · keep typing to narrow' : null}
            </span>
          ) : null}
        </div>
        {group.items.map((item) => {
          const optionIndex = index++
          return (
            <ResultOption
              key={item.ref}
              id={optionId(optionIndex)}
              item={item}
              active={optionIndex === active}
              sprites={sprites}
              onHover={() => onHover(optionIndex)}
              onActivate={() => onActivate(item)}
            />
          )
        })}
      </div>
    )
  })
}

interface ResultOptionProps {
  id: string
  item: SearchResultItem
  active: boolean
  sprites: SpriteIndex | null
  onHover: () => void
  onActivate: () => void
}

function ResultOption({ id, item, active, sprites, onHover, onActivate }: ResultOptionProps) {
  const info = ENTITY_TYPES[item.type]
  const external = item.target.kind === 'external'
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-target={item.target.kind}
      onMouseMove={onHover}
      onClick={onActivate}
      className={cx(
        // Active row stays on night-800: rarity text keeps >= 4.5:1 there (tokens.css note).
        'flex min-h-14 cursor-pointer items-center gap-3 px-3 py-1.5 select-none',
        active && 'bg-night-800 outline-2 -outline-offset-2 outline-ring outline-solid',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
        <SpriteImg
          src={item.sprite}
          sprites={sprites}
          damageClass={item.damageClass}
          placeholder={info.placeholder === 'by-class' ? undefined : info.placeholder}
          box={32}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <RarityText rarity={asRarity(item.rarity)} className="truncate font-semibold leading-snug">
          {item.name}
        </RarityText>
        <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex shrink-0 items-center border-2 border-stone-600 bg-night-900 px-1.5 leading-4 font-semibold tracking-wide text-fg uppercase">
            {info.label}
          </span>
          {item.detail ? <span className="truncate">{item.detail}</span> : null}
        </span>
      </span>
      {external ? (
        <span className={cx('flex shrink-0 items-center gap-1 text-xs font-semibold', active ? 'text-accent' : 'text-fg-muted')}>
          Wiki
          <ExternalLink aria-hidden="true" className="size-4" />
          <span className="sr-only">, opens terraria.wiki.gg in a new tab</span>
        </span>
      ) : (
        <ChevronRight aria-hidden="true" className={cx('size-5 shrink-0', active ? 'text-accent' : 'text-fg-muted')} />
      )}
    </div>
  )
}

function NoResults({ query, onBrowse }: { query: string; onBrowse: () => void }) {
  return (
    <div className="flex items-start gap-3 p-4">
      <EmptyChest className="h-auto w-10 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-fg">No matches for “{query}”</p>
        <p className="text-sm text-fg-muted">
          Check the spelling or try fewer letters.{SCOPE ? ` Search covers ${SCOPE}.` : ''}
        </p>
        <Link
          to={pathFor('weapons')}
          onClick={onBrowse}
          className="inline-flex min-h-tap items-center gap-1 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
        >
          Browse all weapons
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </div>
  )
}

function SearchError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-2 p-4">
      <p className="font-semibold text-fg">Search couldn’t load</p>
      <p className="text-sm text-fg-muted">
        {error instanceof ChunkLoadError
          ? 'Part of the site’s data failed to download. Check your connection, then retry.'
          : 'Something went wrong while preparing search.'}
      </p>
      <button type="button" onClick={onRetry} className={buttonClass('secondary')}>
        <RotateCw aria-hidden="true" className="size-5" />
        Retry
      </button>
    </div>
  )
}
