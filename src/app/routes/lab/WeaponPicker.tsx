import { Check, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../../components/cx'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import { VirtualList, type VirtualListHandle } from '../../../components/VirtualList'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import type { LabBrowserRow } from './browserModel'
import { pickerOptionId } from './labIds'
import { PickerIntent } from './pickerIntent'

/**
 * The weapon list of the in-Lab browser (PRD P3-S2 AC1/AC2, UX_SPEC §3.4): every weapon the
 * browser's search and filters let through, virtualized inside the panel (or sheet) that scrolls
 * it. Each row: sprite, rarity-tinted name, base damage and a badge — "Simulated" (choosing it
 * equips it) or "Not simulated" (choosing it shows its LimitationCard) — marked by text and icon,
 * not colour alone (§9).
 *
 * Native radios: the checked row is the weapon the arena shows (the equipped one, or a
 * not-simulated one whose card is open); arrow keys move through the list and every change applies
 * at once, as a live preview. A deliberate pick — click, tap, Space or Enter on a row — also calls
 * `onCommit`; arrow-key browsing never does (./pickerIntent.ts). Rows carry their "n of N" position
 * because only the rows near the viewport are mounted.
 */
export interface WeaponPickerProps {
  rows: readonly LabBrowserRow[]
  /** The checked row: the equipped weapon, or the not-simulated weapon whose card is shown. */
  selectedId: number
  equippedId: number
  sprites: SpriteIndex | null
  onSelect: (weapon: Weapon) => void
  /** A row was picked with a click, tap, Space or Enter (not arrow keys): e.g. close the sheet. */
  onCommit?: (weapon: Weapon) => void
  /** Unique per instance (desktop panel vs mobile sheet). */
  name: string
  /** Id of the text describing the list (what choosing a row does). */
  describedBy?: string
  /** Move focus to a row's radio, scrolling it into view first (bump `nonce` to repeat). */
  focusRequest?: { id: number; nonce: number } | null
  /** Row to focus when the requested one is filtered out (e.g. the search box). */
  fallbackFocusId?: string
  /** Centre the selected row when the list mounts (opening the panel), else start at the top (new results). */
  centerSelected?: boolean
  className?: string
}

/** Row height estimate (two text lines + padding + 2px borders), as measured; the gap is separate. */
const ROW_ESTIMATE = 66
const ROW_GAP = 6

/** Focuses `id` once React and the virtualizer have mounted it (a few frames at most). */
function focusWhenMounted(id: string, frames = 12): void {
  const element = document.getElementById(id)
  if (element) {
    element.focus({ preventScroll: false })
    return
  }
  if (frames > 0) requestAnimationFrame(() => focusWhenMounted(id, frames - 1))
}

export function WeaponPicker({
  rows,
  selectedId,
  equippedId,
  sprites,
  onSelect,
  onCommit,
  name,
  describedBy,
  focusRequest,
  fallbackFocusId,
  centerSelected = true,
  className,
}: WeaponPickerProps) {
  const legendId = `${name}-legend`
  const [intent] = useState(() => new PickerIntent())
  const list = useRef<VirtualListHandle>(null)
  // Mount: the selected row (e.g. a deep-linked weapon far down the list) is centred in the
  // list's own scroller — never scrolling the page.
  const [initialIndex] = useState(() => (centerSelected ? rows.findIndex((r) => r.weapon.id === selectedId) : -1))

  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    if (!focusRequest) return
    const index = rowsRef.current.findIndex((r) => r.weapon.id === focusRequest.id)
    if (index < 0) {
      if (fallbackFocusId) document.getElementById(fallbackFocusId)?.focus()
      return
    }
    list.current?.scrollToIndex(index, 'center')
    requestAnimationFrame(() => focusWhenMounted(pickerOptionId(name, focusRequest.id)))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce])

  return (
    <fieldset className={cx('min-w-0', className)} aria-describedby={describedBy}>
      <legend id={legendId} className="sr-only">
        Weapon to show in the Lab
      </legend>
      <div onPointerDown={() => intent.pointerDown()} data-lab-picker="">
        <VirtualList
          items={rows}
          getKey={(row) => row.weapon.id}
          estimateSize={ROW_ESTIMATE}
          gap={ROW_GAP}
          scroller="container"
          handle={list}
          initialIndex={initialIndex >= 0 ? initialIndex : undefined}
          aria-label="Weapons"
          renderItem={(row, index) => (
            <PickerRow
              row={row}
              index={index}
              total={rows.length}
              name={name}
              checked={row.weapon.id === selectedId}
              equipped={row.weapon.id === equippedId}
              sprites={sprites}
              intent={intent}
              onSelect={onSelect}
              onCommit={onCommit}
            />
          )}
        />
      </div>
    </fieldset>
  )
}

interface PickerRowProps {
  row: LabBrowserRow
  index: number
  total: number
  name: string
  checked: boolean
  equipped: boolean
  sprites: SpriteIndex | null
  intent: PickerIntent
  onSelect: (weapon: Weapon) => void
  onCommit?: (weapon: Weapon) => void
}

export function PickerRow({ row, index, total, name, checked, equipped, sprites, intent, onSelect, onCommit }: PickerRowProps) {
  const { weapon, simulated } = row
  const id = pickerOptionId(name, weapon.id)
  const rarityView = getField(weapon, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  return (
    // `relative`: the sr-only radio stays inside the scrolling list, so focusing it scrolls the
    // list — not the page (an escaped radio stretched the page and pulled it into blank space).
    <div className="relative" data-lab-row={simulated ? 'simulated' : 'not-simulated'}>
      <input
        type="radio"
        id={id}
        name={name}
        value={weapon.id}
        checked={checked}
        aria-posinset={index + 1}
        aria-setsize={total}
        onChange={() => onSelect(weapon)}
        onClick={() => {
          // The change (if any) applies; this only decides whether it was a deliberate pick.
          if (intent.click() === 'commit') onCommit?.(weapon)
        }}
        onKeyDown={(event) => {
          if (intent.keyDown(event.key) !== 'commit' || !onCommit) return
          event.preventDefault()
          if (!event.currentTarget.checked) onSelect(weapon)
          onCommit(weapon)
        }}
        onKeyUp={(event) => {
          if (intent.keyUp(event.key, event.currentTarget.checked) === 'commit') onCommit?.(weapon)
        }}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cx(
          'flex min-h-tap items-center gap-3 border-2 px-2 py-1 transition-colors duration-(--dur-ui)',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
          checked ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-panel hover:border-border-strong',
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
          <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={32} maxScale={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <RarityText rarity={rarity} className="line-clamp-2 min-w-0 text-sm leading-tight font-semibold">
              {weapon.name}
            </RarityText>
            {equipped ? (
              <span className="shrink-0 text-xs font-semibold text-accent">Equipped</span>
            ) : checked ? (
              <span className="shrink-0 text-xs font-semibold text-fg-muted">Shown</span>
            ) : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
            <SimBadge simulated={simulated} />
            <span className="tabular-nums">
              Damage{' '}
              {weapon.damage !== undefined ? (
                <span className="font-semibold text-fg">{weapon.damage}</span>
              ) : (
                <UnknownValue field="damage" interactive={false} />
              )}
            </span>
          </span>
        </span>
      </label>
    </div>
  )
}

/** "Simulated" vs "Not simulated" — icon + word + frame style, never colour alone (UX_SPEC §9). */
export function SimBadge({ simulated }: { simulated: boolean }) {
  return simulated ? (
    <span className="inline-flex items-center gap-1 border-2 border-forest-400 px-1 leading-4 font-semibold text-success" data-sim-badge="simulated">
      <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      Simulated
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 border-2 border-dashed border-stone-500 px-1 leading-4 font-semibold text-fg-muted" data-sim-badge="not-simulated">
      <Info aria-hidden="true" className="size-3" />
      Not simulated
    </span>
  )
}
