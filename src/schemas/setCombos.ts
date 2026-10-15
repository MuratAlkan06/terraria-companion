/**
 * Armor-set combinations (P6 fix round; DATA_SCHEMA_SPEC §2.5 as extended additively: `pieces.chests`, optional
 * `pieces.legs`, `variants[].chestId`). Pure and Zod-free — the scoring engine and the pages import this module
 * directly (not the schema barrel), so no schema code rides into their chunks. Every consumer reads a set's
 * wearable full sets through `setCombos`, so a one-chest set (every set before the fix round) keeps its old
 * keys: one combination per helmet, keyed by the helmet id.
 */
import type { ArmorSet, ArmorSetVariant } from './equipment'

type SetShape = { pieces: ArmorSet['pieces']; variants: readonly ArmorSetVariant[] }

/** The chests that complete a set: `chests ?? [chest]`. */
export const setChestIds = (set: Pick<SetShape, 'pieces'>): number[] => set.pieces.chests ?? [set.pieces.chest]

/** Every piece of a set in wearing order — helmets, chests, then legs (when it has a legs piece). */
export const setPieceIds = (set: Pick<SetShape, 'pieces'>): number[] => [...new Set([...set.pieces.helmets, ...setChestIds(set), ...(set.pieces.legs === undefined ? [] : [set.pieces.legs])])]

/** One wearable full set: a helmet, a chest and the legs (none when the set has no legs piece), with its variant. */
export interface SetCombo {
  /** Stable within the set: the helmet id, or `<helmet>.<chest>` when the set has several chests. */
  key: string
  variantIndex: number
  variant: ArmorSetVariant
  helmetId: number
  chestId: number
  legsId: number | undefined
}

/** Every combination that completes the set and activates a variant, in variant order (then chest order). */
export function setCombos(set: SetShape): SetCombo[] {
  const chests = setChestIds(set)
  return set.variants.flatMap((variant, variantIndex) =>
    (variant.chestId === undefined ? chests : [variant.chestId]).map((chestId) => ({
      key: chests.length > 1 ? `${variant.helmetId}.${chestId}` : String(variant.helmetId),
      variantIndex,
      variant,
      helmetId: variant.helmetId,
      chestId,
      legsId: set.pieces.legs,
    })),
  )
}

/** The pieces that tell a combination apart from the set's others: its helmet (several helmets), its chest (several chests). */
export const comboDistinctIds = (set: Pick<SetShape, 'pieces'>, combo: Pick<SetCombo, 'helmetId' | 'chestId'>): number[] => [
  ...(set.pieces.helmets.length > 1 ? [combo.helmetId] : []),
  ...(setChestIds(set).length > 1 ? [combo.chestId] : []),
]

/** "Hallowed armor (Hallowed Mask)", "Beetle armor (Beetle Shell)", "Wizard set (Wizard Hat, Mystic Robe)"; the bare name for a one-combination set. */
export function comboName(set: Pick<SetShape, 'pieces'> & { name: string }, combo: Pick<SetCombo, 'helmetId' | 'chestId'>, nameOf: (id: number) => string): string {
  const parts = comboDistinctIds(set, combo).map(nameOf)
  return parts.length > 0 ? `${set.name} (${parts.join(', ')})` : set.name
}

/** The combination a worn helmet + chest (+ legs) completes, if any — a set without a legs piece takes any legs. */
export function wornCombo(set: SetShape, helmetId: number | undefined, chestId: number | undefined, legsId: number | undefined): SetCombo | undefined {
  if (set.pieces.legs !== undefined && legsId !== set.pieces.legs) return undefined
  return setCombos(set).find((c) => c.helmetId === helmetId && c.chestId === chestId)
}
