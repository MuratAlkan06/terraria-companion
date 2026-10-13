/**
 * Every Unknown the weapon detail page renders, in page order (design review P2-S3 #1): the
 * weapon record's own unverified fields AND those of the drop records its acquisition section
 * shows (each with its own `_prov`). The partially-verified badge reads this, so its count and
 * its list always match the Unknown markers on screen; a test renders every weapon and checks
 * `sum(count)` against the rendered `data-unknown-field` markers.
 *
 * Mirrors the render rules of WeaponDetailView (header + stats) and AcquisitionView (routes,
 * drop tables, required progress) — change both together.
 */
import type { DropIndex, Weapon } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { DIFFICULTY_LABELS, dropTableRows, fieldLabel, weaponStatRows } from './weaponDisplay'
import type { DropSource } from '../../../../schemas'

export interface PageUnknown {
  /** Stable key (the marker's field path, drop-scoped for drop records). */
  key: string
  /** Human label worded like the on-page section, e.g. "Sold by Demolitionist — price". */
  label: string
  /** Unknown markers this entry stands for (a drop's three difficulty cells count three). */
  count: number
}

/** Unknown cells of one drop card (rates/quantity per difficulty, conditions). */
export function dropUnknowns(drop: DropSource): PageUnknown[] {
  const rows = dropTableRows(drop)
  const out: PageUnknown[] = []
  const column = (kind: 'rate' | 'quantity', noun: string) => {
    const unknown = rows.filter((row) => row[kind].view.status === 'unverified')
    if (unknown.length === 0) return
    const difficulties = unknown.map((row) => DIFFICULTY_LABELS[row.difficulty]).join(', ')
    out.push({ key: `drop:${drop.id}:${kind}`, label: `${drop.source.npcName} — ${noun} (${difficulties})`, count: unknown.length })
  }
  if (getField(drop, 'conditions').status === 'unverified') {
    out.push({ key: `drop:${drop.id}:conditions`, label: `${drop.source.npcName} — conditions`, count: 1 })
  }
  column('rate', 'drop chance')
  column('quantity', 'quantity')
  return out
}

/**
 * `drops` is the loaded drop index, or undefined while it loads / when it failed — then no drop
 * table is on screen either, so the weapon-level entries alone are exactly what the page shows.
 */
export function weaponPageUnknowns(weapon: Weapon, drops: DropIndex | undefined): PageUnknown[] {
  const out: PageUnknown[] = []
  const add = (path: string) => out.push({ key: path, label: fieldLabel(path, weapon), count: 1 })

  // DetailHeader
  for (const path of ['damageClass', 'rarity', 'stage']) {
    if (getField(weapon, path).status === 'unverified') add(path)
  }
  // StatsPanel: a row without text renders Unknown.
  for (const row of weaponStatRows(weapon)) {
    if (row.text === undefined) add(row.field)
  }
  // AcquisitionSection
  if (getField(weapon, 'acquisition').status === 'unverified') {
    add('acquisition')
  } else {
    weapon.acquisition.forEach((route, index) => {
      if (route.method === 'drop') {
        for (const id of route.dropIds) {
          const drop = drops?.byId.get(id)
          if (drop) out.push(...dropUnknowns(drop))
        }
        return
      }
      if (route.method === 'purchase' && getField(weapon, `acquisition.${index}.priceCopper`).status === 'unverified') {
        add(`acquisition.${index}.priceCopper`)
      }
      const hasConditionsRow = route.method === 'purchase' || route.method === 'loot' || route.method === 'fishing'
      if (hasConditionsRow && getField(weapon, `acquisition.${index}.conditions`).status === 'unverified') {
        add(`acquisition.${index}.conditions`)
      }
    })
  }
  // Required progress: Unknown when unverified, or listed-applicable without a value.
  const gate = getField(weapon, 'gatedBy')
  if (gate.status === 'unverified' || (gate.status !== 'not-applicable' && !gate.value)) add('gatedBy')

  return out
}

/** Total Unknown markers the entries stand for. */
export function unknownCount(entries: readonly PageUnknown[]): number {
  return entries.reduce((n, entry) => n + entry.count, 0)
}
