import { useEffect, useState } from 'react'
import { cx } from '../../../components/cx'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import { pickerOptionId } from './labIds'
import { PickerIntent } from './pickerIntent'

/**
 * Minimal in-Lab weapon picker (PRD P3-S1 scope; the full searchable browser is P3-S2): every
 * weapon the Lab can equip — data-driven from `labWeapons()` — with sprite, rarity-tinted name and
 * damage. Native radios: arrow keys move through the list, the checked row is the equipped weapon
 * (every change equips it immediately, as a live preview). A deliberate pick — click, tap, Space or
 * Enter on a row — also calls `onCommit`; arrow-key browsing never does (./pickerIntent.ts).
 */
export interface WeaponPickerProps {
  weapons: readonly Weapon[]
  equippedId: number
  sprites: SpriteIndex | null
  onEquip: (weapon: Weapon) => void
  /** A row was picked with a click, tap, Space or Enter (not arrow keys): e.g. close the sheet. */
  onCommit?: (weapon: Weapon) => void
  /** Unique per instance (desktop panel vs mobile sheet). */
  name: string
  className?: string
}

/** Scrolls the nearest scrollable ancestor (the panel or sheet body) so `element` sits in its middle. */
function centreInScroller(element: HTMLElement): void {
  let scroller = element.parentElement
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement
  }
  if (!scroller || scroller === document.scrollingElement) return
  const row = element.getBoundingClientRect()
  const box = scroller.getBoundingClientRect()
  scroller.scrollTop += row.top - box.top - (box.height - row.height) / 2
}

export function WeaponPicker({ weapons, equippedId, sprites, onEquip, onCommit, name, className }: WeaponPickerProps) {
  const legendId = `${name}-legend`
  const [intent] = useState(() => new PickerIntent())
  // When the picker opens, the equipped row (e.g. a deep-linked weapon far down the list) is
  // centred in the list's own scroller — never scrolling the page. Only on mount: choosing a row
  // must not scroll the list under the pointer.
  useEffect(() => {
    const row = document.getElementById(pickerOptionId(name, equippedId))?.closest('li')
    if (row) centreInScroller(row)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  return (
    <fieldset className={cx('min-w-0', className)} aria-describedby={`${name}-scope`}>
      <legend id={legendId} className="sr-only">
        Weapon to equip
      </legend>
      <p id={`${name}-scope`} className="mb-3 text-xs text-fg-muted">
        {weapons.length} swung melee weapons are simulated so far. Choosing one equips it.
      </p>
      <ul className="space-y-1.5" data-lab-picker="" onPointerDown={() => intent.pointerDown()}>
        {weapons.map((weapon) => {
          const checked = weapon.id === equippedId
          const id = pickerOptionId(name, weapon.id)
          const rarityView = getField(weapon, 'rarity')
          const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
          return (
            // `relative`: the sr-only radio stays inside the scrolling list, so focusing it scrolls
            // the list — not the page (an escaped radio stretched the page and pulled it into blank space).
            <li key={weapon.id} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={weapon.id}
                checked={checked}
                onChange={() => onEquip(weapon)}
                onClick={() => {
                  // The change (if any) equips; this only decides whether it was a deliberate pick.
                  if (intent.click() === 'commit') onCommit?.(weapon)
                }}
                onKeyDown={(event) => {
                  if (intent.keyDown(event.key) !== 'commit' || !onCommit) return
                  event.preventDefault()
                  if (!event.currentTarget.checked) onEquip(weapon)
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
                  checked ? 'border-gold-500 bg-night-700' : 'border-panel-border bg-panel hover:bg-night-700',
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center border-2 border-slot-border bg-slot">
                  <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={32} maxScale={2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <RarityText rarity={rarity} className="truncate text-sm font-semibold">
                    {weapon.name}
                  </RarityText>
                  <span className="text-xs text-fg-muted tabular-nums">Damage {weapon.damage}</span>
                </span>
                {checked ? <span className="shrink-0 text-xs font-semibold text-accent">Equipped</span> : null}
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
