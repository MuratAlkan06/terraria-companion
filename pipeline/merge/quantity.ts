/**
 * AMENDMENTS-016 B105 — the no-stated-quantity ruling (closes AMENDMENTS-015 B84's open item).
 *
 * merge/drops.ts keeps a drop's quantity Unknown when its wiki cell states none and hands those records
 * over (`unstatedQuantity`). Once every collection is built, this pass rules on each of them:
 * - the item is a weapon, an armor piece or an accessory, or an Item of category vanity / tool / pet / mount
 *   (DROP_UNIT_QUANTITY.kinds), AND Module:Iteminfo/data says it is not consumable → quantity { min 1, max 1 },
 *   its `quantity.*` Unknowns lifted, `quantity` listed in `_prov.modeledFields` (the derivation is visible
 *   and auditable, never mistaken for a wiki-stated amount; validate re-checks every such record);
 * - anything else — coins, materials, placeables (trophies, altars), potions, ammo, grab bags, permanent
 *   boosters, a consumable weapon (Beenade), an Item of another category (kites, "other") — keeps its Unknown:
 *   a stack size is a real, unstated number, never defaulted.
 * Pure + deterministic: record order and every other field are unchanged.
 */
import { DROP_UNIT_QUANTITY, type DropSource, type DropUnitQuantityKind, type ItemCategory } from '../../src/schemas'

export type DropItemKind = 'weapon' | 'armor' | 'accessory' | ItemCategory

const RULED: ReadonlySet<string> = new Set<string>(DROP_UNIT_QUANTITY.kinds)
export const isUnitQuantityKind = (kind: DropItemKind | undefined): kind is DropUnitQuantityKind => kind !== undefined && RULED.has(kind)

export interface UnitQuantityInput {
  drops: readonly DropSource[]
  /** merge/drops.ts `unstatedQuantity`: record id → its own cross-check failed. */
  unstated: ReadonlyMap<string, boolean>
  /** The emitted collection / Item category of an item id (undefined = not emitted). */
  kindOf: (itemId: number) => DropItemKind | undefined
  /** Module:Iteminfo/data `consumable` of an item id (undefined = no such item / no boolean). */
  consumable: (itemId: number) => boolean | undefined
}

export interface UnitQuantityOutcome {
  drop: DropSource
  kind: DropItemKind | 'not emitted'
  /** Why the Unknown stays (kept records only). */
  reason?: 'not a ruled item kind' | 'consumable'
}

export interface UnitQuantityResult {
  drops: DropSource[]
  /** Records whose quantity was derived (after the derivation). */
  derived: UnitQuantityOutcome[]
  /** Unstated-quantity records left Unknown, with the reason. */
  kept: UnitQuantityOutcome[]
}

const isQuantityField = (f: string) => f === 'quantity' || f.startsWith('quantity.')

export function applyUnitQuantity(input: UnitQuantityInput): UnitQuantityResult {
  const derived: UnitQuantityOutcome[] = []
  const kept: UnitQuantityOutcome[] = []
  const drops = input.drops.map((drop): DropSource => {
    const crossCheckFailed = input.unstated.get(drop.id)
    if (crossCheckFailed === undefined) return drop
    const kind = input.kindOf(drop.itemId)
    if (!isUnitQuantityKind(kind)) {
      kept.push({ drop, kind: kind ?? 'not emitted', reason: 'not a ruled item kind' })
      return drop
    }
    if (input.consumable(drop.itemId) !== false) {
      kept.push({ drop, kind, reason: 'consumable' })
      return drop
    }
    const { _prov, ...rest } = drop
    const unverifiedFields = _prov.unverifiedFields.filter((f) => !isQuantityField(f))
    const record: DropSource = {
      ...rest,
      quantity: { min: 1, max: 1 },
      _prov: {
        ..._prov,
        verified: unverifiedFields.length === 0 && !crossCheckFailed,
        unverifiedFields,
        modeledFields: [...new Set([...(_prov.modeledFields ?? []), DROP_UNIT_QUANTITY.path])].sort(),
      },
    }
    derived.push({ drop: record, kind })
    return record
  })
  return { drops, derived, kept }
}
