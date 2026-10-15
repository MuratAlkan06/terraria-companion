/**
 * AMENDMENTS-016 B105 (closes the AMENDMENTS-015 B84 "no stated quantity" item): a drop entry whose wiki
 * cell states no quantity keeps quantity Unknown — coins and every consumable / stackable item (materials,
 * placeables, potions, ammo) always — EXCEPT non-consumable equipment and corpus items of the ruled kinds
 * (Module:Iteminfo/data consumable = false), which cannot drop as a stack: their quantity is ruled 1, derived
 * from the item kind, and the record lists `quantity` in `_prov.modeledFields` so the derivation stays
 * visible, auditable and distinguishable from a wiki-stated quantity (validate checks every such record;
 * the drop tables label the value with `note`).
 *
 * Zod-free on purpose: the app's drop tables import it.
 */
export const DROP_UNIT_QUANTITY = {
  id: 'non-consumable-unit-quantity',
  ruling: 'AMENDMENTS-016 B105',
  /** The `_prov.modeledFields` entry of a derived quantity. */
  path: 'quantity',
  /** The provenance note of a derived quantity. */
  note: 'quantity: 1 derived from non-consumable item kind',
  /** Collections (weapon / armor / accessory) and Item categories the ruling covers. */
  kinds: ['weapon', 'armor', 'accessory', 'vanity', 'tool', 'pet', 'mount'],
} as const
export type DropUnitQuantityKind = (typeof DROP_UNIT_QUANTITY.kinds)[number]

/** True when `record._prov.modeledFields` lists `path` (B49 / B105: a derived value, never extracted data). */
export function isModeledField(record: unknown, path: string): boolean {
  const prov = typeof record === 'object' && record !== null ? (record as { _prov?: { modeledFields?: unknown } })._prov : undefined
  const modeled = prov?.modeledFields
  return Array.isArray(modeled) && modeled.some((entry) => typeof entry === 'string' && entry.split('#', 1)[0] === path)
}
