import { History, RotateCw, Search, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '../../../../components/buttonStyles'
import { cx } from '../../../../components/cx'
import { asRarity } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { SpriteIndex } from '../../../../data-access/types'
import { availabilityOf, type Availability } from '../../../../scoring/candidates'
import { effectiveProgress, type TrackedProgress } from '../../../../scoring/progress'
import type { ReadinessData } from '../../../../scoring/readiness'
import { loadSearchIndex, peekSearchIndex, type SearchIndex } from '../../../../search'
import { comboboxKeyAction } from '../../../../search/combobox'
import { loadDomain } from '../../../../storage'
import type { ReadinessSetup } from '../../../../storage/readiness'
import { GateGroup } from './ReadinessFactorCard'
import { fits, LIST_ALL_MAX, poolKind, recentFits, refItemId, searchTypes, slotPool, type PickerTarget } from './readinessUi'
import * as copy from './readinessUiCopy'

/**
 * SlotPicker (UX_SPEC §3.8 "LoadoutSlots input (OmniSearch fill)"; PRD §9 Feature A AC1): fills one
 * loadout slot from the live database through the SAME search index as the shell's OmniSearch,
 * filtered to what fits the slot. A modal dialog (Radix: focus trap, Esc, focus back to the slot);
 * the combobox follows the OmniSearch keyboard model (↑/↓ move, Enter picks). Small pools list every
 * item before typing; big ones show the recently viewed items that fit, else a hint — never a blank
 * sheet (B96d). Each row says what the user's TRACKED progress makes of it — a gate chip naming the
 * bosses not marked defeated, "availability Unknown" — before it's picked (picking is allowed: it's
 * the user's own gear; the analysis then says what it counts).
 */
export interface SlotPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: PickerTarget | null
  label: string
  data: ReadinessData
  setup: ReadinessSetup
  progress: TrackedProgress
  sprites: SpriteIndex | null
  bossName: (id: string) => string
  onPick: (id: number) => void
  /**
   * Where focus goes on close. Radix's modal Dialog returns focus to its Trigger, and this controlled
   * dialog has none (slots open it), so the page names the element: the opener, or the slot itself.
   */
  returnFocus: () => HTMLElement | null | undefined
}

type IndexState = { status: 'idle' | 'loading' } | { status: 'ready'; index: SearchIndex } | { status: 'error' }

interface Row {
  id: number
  name: string
  sprite?: string
  rarity?: string | number
  damageClass?: string
  detail: string
  availability: Availability
}

const MAX_ROWS = 60

/** Recently viewed refs (tc.v1.recent), newest first; [] when none or storage is unavailable. */
function readRecentRefs(): string[] {
  try {
    const result = loadDomain('recent')
    return result.kind === 'loaded' ? result.data.entries.map((e) => e.ref) : []
  } catch {
    return []
  }
}

export function SlotPicker({ open, onOpenChange, target, label, data, setup, progress, sprites, bossName, onPick, returnFocus }: SlotPickerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          // Open on the search field (Radix would focus the first focusable: the Close button).
          onOpenAutoFocus={(event) => {
            const input = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[role="combobox"]')
            if (!input) return
            event.preventDefault()
            input.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus()?.focus()
          }}
          data-slot-picker={target ? poolKind(target) : ''}
          className={cx(
            'fixed z-(--z-dialog) flex flex-col bg-surface text-fg shadow-pixel-drop',
            'inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[80dvh] md:w-[min(36rem,calc(100vw-2rem))] md:-translate-1/2 md:border-2 md:border-panel-border',
          )}
        >
          {target ? <PickerBody target={target} label={label} data={data} setup={setup} progress={progress} sprites={sprites} bossName={bossName} onPick={onPick} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function useSearchIndex(): [IndexState, () => void] {
  const [state, setState] = useState<IndexState>(() => {
    const index = peekSearchIndex()
    return index ? { status: 'ready', index } : { status: 'loading' }
  })
  useEffect(() => {
    if (state.status !== 'loading') return
    let cancelled = false
    loadSearchIndex().then(
      (index) => !cancelled && setState({ status: 'ready', index }),
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [state.status])
  return [state, () => setState({ status: 'loading' })]
}

function PickerBody({ target, label, data, setup, progress, sprites, bossName, onPick }: Omit<SlotPickerProps, 'open' | 'onOpenChange' | 'target' | 'returnFocus'> & { target: PickerTarget }) {
  const id = useId()
  const listId = `${id}list`
  const optionId = (i: number) => `${id}opt-${i}`
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [index, retry] = useSearchIndex()
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()

  const ep = useMemo(() => effectiveProgress(data.graph, progress), [data.graph, progress])
  const pool = useMemo(() => slotPool(target, data, setup), [target, data, setup])
  const bigPool = pool.length > LIST_ALL_MAX
  const [recentRefs] = useState(readRecentRefs)
  const recent = useMemo(() => (bigPool ? recentFits(recentRefs, target, data, setup) : []), [bigPool, recentRefs, target, data, setup])
  const record = (itemId: number) => data.weapons.get(itemId) ?? data.armor.get(itemId) ?? data.accessories.get(itemId) ?? data.items.get(itemId)
  const toRow = (itemId: number, detail = ''): Row | undefined => {
    const r = record(itemId)
    if (!r) return undefined
    return { id: itemId, name: r.name, sprite: r.sprite, rarity: r.rarity, damageClass: r.type === 'weapon' ? r.damageClass : undefined, detail, availability: availabilityOf(r, data.graph, ep) }
  }

  const rows: Row[] | undefined = useMemo(() => {
    if (trimmed === '') return (bigPool ? recent : pool).flatMap((i) => toRow(i) ?? [])
    if (index.status !== 'ready') return undefined
    const options = index.index.suggest(trimmed, { types: searchTypes(target), perGroup: 600 }).options
    const out: Row[] = []
    for (const option of options) {
      const itemId = refItemId(option.ref)
      if (itemId === undefined || !fits(target, itemId, data, setup)) continue
      const row = toRow(itemId, option.detail)
      if (row) out.push(row)
      if (out.length >= MAX_ROWS) break
    }
    return out
    // toRow reads only data/ep, both deps
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, index, pool, bigPool, recent, target, data, setup, ep])

  const list = rows ?? []
  // A new result set highlights the best match (Enter picks it); none when empty.
  const [highlightedFor, setHighlightedFor] = useState(rows)
  if (highlightedFor !== rows) {
    setHighlightedFor(rows)
    setActive(trimmed !== '' && list.length > 0 ? 0 : -1)
  }
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Escape') return // Escape closes the dialog
    const action = comboboxKeyAction(event.key, { expanded: list.length > 0, hasQuery: trimmed !== '', active, optionCount: list.length })
    if (!action) return
    event.preventDefault()
    if (action.type === 'move') setActive(action.to)
    else if (action.type === 'activate') onPick(list[action.index].id)
  }

  const what = copy.PICKER_WHAT[poolKind(target)]
  const status =
    trimmed === '' ? (bigPool ? (list.length > 0 ? copy.pickerRecentCount(list.length, pool.length, what) : copy.pickerHint(pool.length, what)) : copy.pickerCount(list.length))
    : index.status === 'error' ? copy.PICKER_ERROR
    : rows === undefined ? copy.PICKER_LOADING
    : list.length === 0 ? copy.pickerNone(trimmed)
    : copy.pickerCount(list.length)

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Dialog.Title className="font-display text-sm leading-relaxed text-accent md:text-base">{copy.pickerTitle(label)}</Dialog.Title>
        <Dialog.Close aria-label={copy.PICKER_CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{copy.PICKER_DESCRIPTION}</Dialog.Description>
      <div className="px-3 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={copy.PICKER_SEARCH}
            aria-expanded={list.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && active < list.length ? optionId(active) : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={copy.PICKER_SEARCH}
            className="h-tap w-full min-w-0 border-2 border-panel-border bg-surface-sunken pr-3 pl-10 text-base text-fg caret-accent placeholder:text-fg-muted focus:border-gold-600"
          />
        </div>
        <p role="status" className="mt-1.5 text-xs text-fg-muted">
          {status}
        </p>
        {index.status === 'error' && trimmed !== '' ? (
          <button type="button" onClick={retry} className={buttonClass('secondary', 'mt-2')}>
            <RotateCw aria-hidden="true" className="size-5" />
            {copy.PICKER_RETRY}
          </button>
        ) : null}
      </div>
      {trimmed === '' && bigPool ? (
        list.length > 0 ? (
          <p data-picker-recent="" className="flex items-center gap-1.5 px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            <History aria-hidden="true" className="size-4" />
            {copy.PICKER_RECENT}
          </p>
        ) : (
          // Before typing in a big pool: what to do, not a blank sheet.
          <div data-picker-start="" className="mx-3 mt-1 flex gap-3 border-2 border-dashed border-panel-border p-3 text-sm">
            <Search aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="space-y-1">
              <p className="font-semibold">{copy.PICKER_START_TITLE}</p>
              <p className="text-fg-muted">{copy.PICKER_START_BODY}</p>
            </div>
          </div>
        )
      ) : null}
      <div role="listbox" id={listId} aria-label={list.length > 0 && trimmed === '' && bigPool ? copy.PICKER_RECENT : copy.PICKER_LIST} onMouseDown={(e) => e.preventDefault()} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-safe">
        {list.map((row, i) => (
          <div
            key={row.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-pick={row.id}
            onMouseMove={() => i !== active && setActive(i)}
            onClick={() => onPick(row.id)}
            className={cx('flex min-h-14 cursor-pointer items-center gap-3 px-2 py-1.5 select-none', i === active && 'bg-night-800 outline-2 -outline-offset-2 outline-ring outline-solid')}
          >
            <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
              <SpriteImg src={row.sprite} sprites={sprites} damageClass={row.damageClass} placeholder={row.damageClass ? undefined : 'material'} box={32} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <RarityText rarity={asRarity(row.rarity)} className="truncate leading-snug font-semibold">
                {row.name}
              </RarityText>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                {row.detail ? <span className="truncate">{row.detail}</span> : null}
                {row.availability.status === 'gated' ? <GateGroup gates={row.availability.missing} ctx={{ bossName }} /> : null}
                {row.availability.status === 'unknown' ? (
                  <span className="inline-flex items-center gap-1">
                    <UnknownValue field="gatedBy" interactive={false} />
                    <span>{copy.PICKER_AVAILABILITY_WORD}</span>
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
