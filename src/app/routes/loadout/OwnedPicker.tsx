import { Check, RotateCw, Search, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import type { SearchDocType } from '../../../schemas'
import { availabilityOf, type Availability } from '../../../scoring/candidates'
import type { BuilderData } from '../../../scoring/recommend'
import { loadSearchIndex, peekSearchIndex, type SearchIndex } from '../../../search'
import { comboboxKeyAction } from '../../../search/combobox'
import type { SpriteIndex } from '../../../data-access/types'
import { GateGroup } from '../bosses/readiness/ReadinessFactorCard'
import { refItemId } from '../bosses/readiness/readinessUi'
import * as copy from './loadoutCopy'
import { ownable, recordOf, spriteOf } from './loadoutView'

/**
 * "Gear you own" (UX_SPEC §3.5 Step1 "owned equipment (OmniSearch multi-add into InventoryGrid)";
 * SCORING_SPEC §4 `owned[]`; AMENDMENTS-014 B69/Q2): the shell's search index, filtered to what the
 * builder can place (weapons, armor pieces, accessories, ammo, potions). Each match says what the
 * builder's progress makes of it — the same tracked ∪ virtual availability the recommendation uses —
 * before it's added. Multi-add: the dialog stays open; added rows say so.
 */
export interface OwnedPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: BuilderData
  /** The builder's effective progress (tracked ∪ virtual). */
  ep: ReadonlySet<string>
  sprites: SpriteIndex | null
  bossName: (id: string) => string
  owned: readonly number[]
  onAdd: (id: number) => void
  returnFocus: () => HTMLElement | null | undefined
}

const TYPES: ReadonlySet<SearchDocType> = new Set<SearchDocType>(['weapon', 'armor', 'accessory', 'item'])
const MAX_ROWS = 60

type IndexState = { status: 'loading' } | { status: 'ready'; index: SearchIndex } | { status: 'error' }

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

export function OwnedPicker(props: OwnedPickerProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            const input = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[role="combobox"]')
            if (!input) return
            event.preventDefault()
            input.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            props.returnFocus()?.focus()
          }}
          data-owned-picker=""
          className={cx(
            'fixed z-(--z-dialog) flex flex-col bg-surface text-fg shadow-pixel-drop',
            'inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[80dvh] md:w-[min(36rem,calc(100vw-2rem))] md:-translate-1/2 md:border-2 md:border-panel-border',
          )}
        >
          {props.open ? <PickerBody {...props} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * What the builder's progress makes of a match, on every row (the picker's hint promises it): verified
 * obtainable, the gate chip naming the bosses still to defeat, or the Unknown marker.
 */
export function OwnedOptionAvailability({ availability, bossName }: { availability: Availability; bossName: (id: string) => string }) {
  if (availability.status === 'gated') return <GateGroup gates={availability.missing} ctx={{ bossName }} />
  if (availability.status === 'unknown')
    return (
      <span className="inline-flex items-center gap-1" data-owned-option-status="unknown">
        <UnknownValue field="gatedBy" interactive={false} />
        <span>{copy.AVAILABILITY_WORD}</span>
      </span>
    )
  return <span data-owned-option-status="yes">{copy.OWNED_PICKER_YES}</span>
}

function PickerBody({ data, ep, sprites, bossName, owned, onAdd }: OwnedPickerProps) {
  const id = useId()
  const listId = `${id}list`
  const optionId = (i: number) => `${id}opt-${i}`
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [index, retry] = useSearchIndex()
  const trimmed = query.trim()

  const rows = useMemo(() => {
    if (trimmed === '' || index.status !== 'ready') return undefined
    const out: { id: number; detail: string }[] = []
    for (const option of index.index.suggest(trimmed, { types: TYPES, perGroup: 600 }).options) {
      const itemId = refItemId(option.ref)
      if (itemId === undefined || !ownable(data, itemId) || out.some((r) => r.id === itemId)) continue
      out.push({ id: itemId, detail: option.detail ?? '' })
      if (out.length >= MAX_ROWS) break
    }
    return out
  }, [trimmed, index, data])
  const list = rows ?? []
  const [shownFor, setShownFor] = useState(rows)
  if (shownFor !== rows) {
    setShownFor(rows)
    setActive(list.length > 0 ? 0 : -1)
  }
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const add = (itemId: number) => {
    if (!owned.includes(itemId)) onAdd(itemId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Escape') return
    const action = comboboxKeyAction(event.key, { expanded: list.length > 0, hasQuery: trimmed !== '', active, optionCount: list.length })
    if (!action) return
    event.preventDefault()
    if (action.type === 'move') setActive(action.to)
    else if (action.type === 'activate') add(list[action.index].id)
  }
  const status =
    trimmed === '' ? copy.OWNED_PICKER_START_BODY
    : index.status === 'error' ? copy.OWNED_PICKER_ERROR
    : rows === undefined ? copy.OWNED_PICKER_LOADING
    : list.length === 0 ? copy.ownedPickerNone(trimmed)
    : copy.ownedPickerCount(list.length)

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Dialog.Title className="font-display text-sm leading-relaxed text-accent md:text-base">{copy.OWNED_PICKER_TITLE}</Dialog.Title>
        <Dialog.Close aria-label={copy.SWAP_CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{copy.OWNED_PICKER_DESCRIPTION}</Dialog.Description>
      <div className="px-3 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            role="combobox"
            aria-label={copy.OWNED_PICKER_SEARCH}
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
            placeholder={copy.OWNED_PICKER_SEARCH}
            className="h-tap w-full min-w-0 border-2 border-panel-border bg-surface-sunken pr-3 pl-10 text-base text-fg caret-accent placeholder:text-fg-muted focus:border-gold-600"
          />
        </div>
        <p role="status" className="mt-1.5 text-xs text-fg-muted">
          {status}
        </p>
        {index.status === 'error' && trimmed !== '' ? (
          <button type="button" onClick={retry} className={buttonClass('secondary', 'mt-2')}>
            <RotateCw aria-hidden="true" className="size-5" />
            {copy.OWNED_PICKER_RETRY}
          </button>
        ) : null}
      </div>
      <div role="listbox" id={listId} aria-label={copy.OWNED_PICKER_LIST} onMouseDown={(e) => e.preventDefault()} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-safe">
        {list.map((row, i) => {
          const r = recordOf(data, row.id)
          if (!r) return null
          const s = spriteOf(data, row.id)
          const availability = availabilityOf(r, data.graph, ep)
          const added = owned.includes(row.id)
          return (
            <div
              key={row.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={added || undefined}
              data-owned-option={row.id}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => add(row.id)}
              className={cx('flex min-h-14 cursor-pointer items-center gap-3 px-2 py-1.5 select-none', i === active && 'bg-night-800 outline-2 -outline-offset-2 outline-ring outline-solid', added && 'opacity-70')}
            >
              <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
                <SpriteImg src={s.src} sprites={sprites} damageClass={s.damageClass} placeholder={s.placeholder} box={32} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <RarityText rarity={asRarity(r.rarity)} className="truncate leading-snug font-semibold">
                  {r.name}
                </RarityText>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                  {row.detail ? <span className="truncate">{row.detail}</span> : null}
                  <OwnedOptionAvailability availability={availability} bossName={bossName} />
                </span>
              </span>
              {added ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <Check aria-hidden="true" className="size-4" />
                  {copy.OWNED_PICKER_ADDED}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
