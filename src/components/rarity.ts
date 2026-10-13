/**
 * Rarity helpers. The union mirrors DATA_SCHEMA_SPEC §2.2 `Rarity`
 * (int -1..11 | "rainbow" | "fiery-red" | "amber"); colours come from the
 * `--rarity-*` tokens (AMENDMENTS-001 A17). Names per https://terraria.wiki.gg/wiki/Rarity.
 */
export type NumericRarity = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
export type Rarity = NumericRarity | 'rainbow' | 'fiery-red' | 'amber'

const RARITY_NAMES: Record<string, string> = {
  '-1': 'Gray',
  '0': 'White',
  '1': 'Blue',
  '2': 'Green',
  '3': 'Orange',
  '4': 'Light Red',
  '5': 'Pink',
  '6': 'Light Purple',
  '7': 'Lime',
  '8': 'Yellow',
  '9': 'Cyan',
  '10': 'Red',
  '11': 'Purple',
  rainbow: 'Rainbow (Expert)',
  'fiery-red': 'Fiery Red (Master)',
  amber: 'Amber (Quest)',
}

/** CSS colour reference for a rarity, e.g. `var(--rarity-3)`. */
export function rarityColor(rarity: Rarity): string {
  return `var(--rarity-${rarity})`
}

/** Text label so rarity is never conveyed by colour alone (UX_SPEC §9). */
export function rarityLabel(rarity: Rarity): string {
  const name = RARITY_NAMES[String(rarity)]
  return typeof rarity === 'number' ? `${name} (${rarity})` : name
}
