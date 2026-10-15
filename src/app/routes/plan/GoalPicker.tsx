import { History, RotateCw, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SearchDocType } from '../../../schemas'
import { loadSearchIndex, peekSearchIndex, type SearchIndex, type SearchResultItem } from '../../../search'
import { comboboxKeyAction } from '../../../search/combobox'
import { peekSearchDocs } from '../../../data-access'
import { loadDomain } from '../../../storage'
import * as copy from './planCopy'
import { PICKED_STATE, planNewHref } from './planLinks'

/**
 * The goal picker (PRD P6-S5 AC1 "searches/selects any obtainable item"; brief: "pick ANY database item"): the
 * SAME search index as the shell's OmniSearch, filtered to items, weapons, armor and accessories — the
 * combobox keyboard model (↑/↓ move, Enter picks), recently viewed items before typing, else a hint. Picking
 * opens the item's plan preview (`/plan/new?item=:id`).
 */
type IndexState = { status: 'loading' } | { status: 'ready'; index: SearchIndex } | { status: 'error' }

const ITEM_TYPES: ReadonlySet<SearchDocType> = new Set<SearchDocType>(['item', 'weapon', 'armor', 'accessory'])
const MAX_ROWS = 40
const RECENT_MAX = 8
const ITEM_REF = /^i:([1-9]\d*)$/

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

function recentRefs(): string[] {
  try {
    const result = loadDomain('recent')
    return result.kind === 'loaded' ? result.data.entries.map((e) => e.ref).filter((r) => ITEM_REF.test(r)) : []
  } catch {
    return []
  }
}

export function GoalPicker() {
  const id = useId()
  const navigate = useNavigate()
  const listId = `${id}list`
  const optionId = (i: number) => `${id}opt-${i}`
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [index, retry] = useSearchIndex()
  const trimmed = query.trim()
  const [recent] = useState(recentRefs)

  const rows: SearchResultItem[] | undefined = useMemo(() => {
    if (index.status !== 'ready') return trimmed === '' ? [] : undefined
    if (trimmed === '') {
      // recently viewed items (any kind with a plan), from their search docs (loaded with the index)
      const docs = peekSearchDocs() ?? []
      const byRef = new Map(docs.map((d) => [d.id, d]))
      const out: SearchResultItem[] = []
      for (const ref of recent) {
        const doc = byRef.get(ref)
        if (doc && ITEM_TYPES.has(doc.type)) out.push({ ref, name: doc.name, type: doc.type, rarity: doc.rarity, damageClass: doc.class, sprite: doc.sprite, detail: '', target: { kind: 'internal', to: '' } })
        if (out.length >= RECENT_MAX) break
      }
      return out
    }
    return index.index.suggest(trimmed, { types: ITEM_TYPES, perGroup: MAX_ROWS }).options.slice(0, MAX_ROWS)
  }, [trimmed, index, recent])

  const list = rows ?? []
  const [highlightedFor, setHighlightedFor] = useState(rows)
  if (highlightedFor !== rows) {
    setHighlightedFor(rows)
    setActive(trimmed !== '' && list.length > 0 ? 0 : -1)
  }
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const pick = (row: SearchResultItem | undefined) => {
    const match = row ? ITEM_REF.exec(row.ref) : null
    // same path (/plan/new), so the shell won't move focus: the preview takes it on its heading (B118(g))
    if (match) navigate(planNewHref(Number(match[1])), { state: { [PICKED_STATE]: true } })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const action = comboboxKeyAction(event.key, { expanded: list.length > 0, hasQuery: trimmed !== '', active, optionCount: list.length })
    if (!action) return
    event.preventDefault()
    if (action.type === 'move') setActive(action.to)
    else if (action.type === 'activate') pick(list[action.index])
    else if (action.type === 'clear') setQuery('')
  }

  const status =
    trimmed === '' ? ''
    : index.status === 'error' ? copy.PICKER_ERROR
    : rows === undefined ? copy.PICKER_LOADING
    : list.length === 0 ? copy.pickerNone(trimmed)
    : copy.pickerCount(list.length)

  return (
    <div className="space-y-2" data-goal-picker="">
      <label htmlFor={`${id}input`} className="block font-semibold">
        {copy.PICKER_LABEL}
      </label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
        <input
          id={`${id}input`}
          type="text"
          role="combobox"
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
          placeholder={copy.PICKER_PLACEHOLDER}
          className="h-tap w-full min-w-0 border-2 border-panel-border bg-surface-sunken pr-3 pl-10 text-base text-fg caret-accent placeholder:text-fg-muted focus:border-gold-600"
        />
      </div>
      <p role="status" className="min-h-4 text-xs text-fg-muted">
        {status}
      </p>
      {index.status === 'error' && trimmed !== '' ? (
        <button type="button" onClick={retry} className={buttonClass('secondary')}>
          <RotateCw aria-hidden="true" className="size-5" />
          {copy.PICKER_RETRY}
        </button>
      ) : null}
      {trimmed === '' ? (
        list.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            <History aria-hidden="true" className="size-4" />
            {copy.PICKER_RECENT}
          </p>
        ) : (
          <p className="border-2 border-dashed border-panel-border p-3 text-sm text-fg-muted" data-picker-start="">
            {copy.PICKER_START}
          </p>
        )
      ) : null}
      <div role="listbox" id={listId} aria-label={trimmed === '' ? copy.PICKER_RECENT : copy.PICKER_LIST} onMouseDown={(e) => e.preventDefault()} className="max-h-[60dvh] overflow-y-auto overscroll-contain border-panel-border empty:hidden md:border-2">
        {list.map((row, i) => (
          <div
            key={row.ref}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-pick={row.ref}
            onMouseMove={() => i !== active && setActive(i)}
            onClick={() => pick(row)}
            className={cx('flex min-h-14 cursor-pointer items-center gap-3 px-2 py-1.5 select-none', i === active && 'bg-night-800 outline-2 -outline-offset-2 outline-ring outline-solid')}
          >
            <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
              {row.damageClass ? <SpriteImg src={row.sprite} sprites={index.status === 'ready' ? index.index.sprites : null} damageClass={row.damageClass} box={32} /> : <SpriteImg src={row.sprite} sprites={index.status === 'ready' ? index.index.sprites : null} placeholder="material" box={32} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <RarityText rarity={asRarity(row.rarity)} className="truncate leading-snug font-semibold">
                {row.name}
              </RarityText>
              <span className="truncate text-xs text-fg-muted">
                {copy.TYPE_LABEL[row.type] ?? row.type}
                {row.detail ? ` · ${row.detail}` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
