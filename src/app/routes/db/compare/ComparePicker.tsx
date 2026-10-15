import { History, RotateCw, Search, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '../../../../components/buttonStyles'
import { cx } from '../../../../components/cx'
import { GateBadge } from '../../../../components/GateBadge'
import { asRarity } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { ProgressionData, SpriteIndex, Weapon } from '../../../../data-access/types'
import type { SearchDocType } from '../../../../schemas'
import { availabilityOf, type Availability } from '../../../../scoring/candidates'
import { effectiveProgress, type TrackedProgress } from '../../../../scoring/progress'
import { loadSearchIndex, peekSearchIndex, type SearchIndex } from '../../../../search'
import { comboboxKeyAction } from '../../../../search/combobox'
import { humanizeSlug } from '../weapons/weaponDisplay'
import * as copy from './compareCopy'
import { recentWeaponIds, refWeaponId } from './compareModel'

/**
 * ComparePicker (UX_SPEC §3.6 PickerRow "OmniSearch slots"; PRD P4-S1 AC1 "selects weapons via
 * search"): adds or swaps one weapon through the SAME search index as the shell's OmniSearch, weapons
 * only. The readiness SlotPicker's pattern, not its component (that one is bound to loadout slots): a
 * Radix modal dialog (focus trap, Esc, focus handed back by the page), the OmniSearch keyboard model
 * (↑/↓ move, Enter picks), recently viewed weapons before typing — else a hint, never a blank sheet —
 * and each row saying what the user's TRACKED progress makes of it (gate badges, availability
 * Unknown). Weapons already compared stay listed, marked, and can't be picked twice.
 */
export type PickerMode = { kind: 'add' } | { kind: 'swap'; weapon: Weapon }

export interface ComparePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: PickerMode
  selectedIds: readonly number[]
  weapons: ReadonlyMap<number, Weapon>
  graph: ProgressionData
  progress: TrackedProgress
  sprites: SpriteIndex | null
  onPick: (id: number) => void
  /** Where focus goes on close (Radix returns it to a Trigger; this controlled dialog has none). */
  returnFocus: () => HTMLElement | null | undefined
}

type IndexState = { status: 'loading' } | { status: 'ready'; index: SearchIndex } | { status: 'error' }

interface Row {
  weapon: Weapon
  detail: string
  availability: Availability
  selected: boolean
}

const MAX_ROWS = 60
const WEAPON_TYPES: ReadonlySet<SearchDocType> = new Set<SearchDocType>(['weapon'])

export function ComparePicker({ open, onOpenChange, returnFocus, ...body }: ComparePickerProps) {
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
          data-compare-picker={body.mode.kind}
          className={cx(
            'fixed z-(--z-dialog) flex flex-col bg-surface text-fg shadow-pixel-drop',
            'inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[80dvh] md:w-[min(36rem,calc(100vw-2rem))] md:-translate-1/2 md:border-2 md:border-panel-border',
          )}
        >
          {open ? <PickerBody {...body} /> : null}
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

function PickerBody({ mode, selectedIds, weapons, graph, progress, sprites, onPick }: Omit<ComparePickerProps, 'open' | 'onOpenChange' | 'returnFocus'>) {
  const id = useId()
  const listId = `${id}list`
  const optionId = (i: number) => `${id}opt-${i}`
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [index, retry] = useSearchIndex()
  const trimmed = query.trim()

  const ep = useMemo(() => effectiveProgress(graph, progress), [graph, progress])
  const [recent] = useState(() => recentWeaponIds(weapons))

  const rows: Row[] | undefined = useMemo(() => {
    const memo = new Map<string, boolean>()
    const toRow = (weapon: Weapon, detail: string): Row => ({ weapon, detail, availability: availabilityOf(weapon, graph, ep, memo), selected: selectedIds.includes(weapon.id) })
    if (trimmed === '') return recent.flatMap((wid) => (weapons.has(wid) ? [toRow(weapons.get(wid) as Weapon, '')] : []))
    if (index.status !== 'ready') return undefined
    const out: Row[] = []
    for (const option of index.index.suggest(trimmed, { types: WEAPON_TYPES, perGroup: MAX_ROWS }).options) {
      const wid = refWeaponId(option.ref)
      const weapon = wid === undefined ? undefined : weapons.get(wid)
      if (weapon) out.push(toRow(weapon, option.detail))
      if (out.length >= MAX_ROWS) break
    }
    return out
  }, [trimmed, index, recent, weapons, graph, ep, selectedIds])

  const list = rows ?? []
  // A new result set highlights the first pickable match (Enter picks it); none before typing.
  const [highlightedFor, setHighlightedFor] = useState(rows)
  if (highlightedFor !== rows) {
    setHighlightedFor(rows)
    setActive(trimmed !== '' ? list.findIndex((r) => !r.selected) : -1)
  }
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const pick = (row: Row | undefined) => {
    if (row && !row.selected) onPick(row.weapon.id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Escape') return // Escape closes the dialog
    const action = comboboxKeyAction(event.key, { expanded: list.length > 0, hasQuery: trimmed !== '', active, optionCount: list.length })
    if (!action) return
    event.preventDefault()
    if (action.type === 'move') setActive(action.to)
    else if (action.type === 'activate') pick(list[action.index])
  }

  const status =
    trimmed === '' ? (list.length > 0 ? copy.pickerRecentCount(list.length) : '')
    : index.status === 'error' ? copy.PICKER_ERROR
    : rows === undefined ? copy.PICKER_LOADING
    : list.length === 0 ? copy.pickerNone(trimmed)
    : copy.pickerCount(list.length)

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Dialog.Title className="font-display text-sm leading-relaxed text-accent md:text-base">{copy.pickerTitle(mode.kind, mode.kind === 'swap' ? mode.weapon.name : undefined)}</Dialog.Title>
        <Dialog.Close aria-label={copy.PICKER_CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{copy.PICKER_DESCRIPTION}</Dialog.Description>
      <div className="px-3 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
          <input
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
        <p role="status" className="mt-1.5 min-h-4 text-xs text-fg-muted">
          {status}
        </p>
        {index.status === 'error' && trimmed !== '' ? (
          <button type="button" onClick={retry} className={buttonClass('secondary', 'mt-2')}>
            <RotateCw aria-hidden="true" className="size-5" />
            {copy.PICKER_RETRY}
          </button>
        ) : null}
      </div>
      {trimmed === '' ? (
        list.length > 0 ? (
          <p data-picker-recent="" className="flex items-center gap-1.5 px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            <History aria-hidden="true" className="size-4" />
            {copy.PICKER_RECENT}
          </p>
        ) : (
          // Before typing with nothing recent: what to do, not a blank sheet.
          <div data-picker-start="" className="mx-3 mt-1 flex gap-3 border-2 border-dashed border-panel-border p-3 text-sm">
            <Search aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="space-y-1">
              <p className="font-semibold">{copy.PICKER_START_TITLE}</p>
              <p className="text-fg-muted">{copy.PICKER_START_BODY}</p>
            </div>
          </div>
        )
      ) : null}
      <div
        role="listbox"
        id={listId}
        aria-label={trimmed === '' ? copy.PICKER_RECENT : copy.PICKER_LIST}
        onMouseDown={(e) => e.preventDefault()}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-safe"
      >
        {list.map((row, i) => (
          <div
            key={row.weapon.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            aria-disabled={row.selected || undefined}
            data-pick={row.weapon.id}
            onMouseMove={() => i !== active && setActive(i)}
            onClick={() => pick(row)}
            className={cx(
              'flex min-h-14 items-center gap-3 px-2 py-1.5 select-none',
              row.selected ? 'cursor-default' : 'cursor-pointer',
              i === active && 'bg-night-800 outline-2 -outline-offset-2 outline-ring outline-solid',
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
              <SpriteImg src={row.weapon.sprite} sprites={sprites} damageClass={row.weapon.damageClass} box={32} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <RarityText rarity={asRarity(row.weapon.rarity)} className="truncate leading-snug font-semibold">
                {row.weapon.name}
              </RarityText>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                {row.selected ? <span className="font-semibold text-fg">{copy.PICKER_ALREADY}</span> : null}
                {row.detail ? <span className="truncate">{row.detail}</span> : null}
                {row.availability.status === 'gated'
                  ? row.availability.missing.map((gate) => <GateBadge key={gate} name={graph.nodeById.get(gate)?.name ?? humanizeSlug(gate)} />)
                  : null}
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
