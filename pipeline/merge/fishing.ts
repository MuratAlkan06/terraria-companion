/**
 * Fishing acquisition routes (AMENDMENTS-004 B20, P6-S0): the wiki's "Fishing catches" article
 * (parse/fishing.ts) → per item, the `fishing` Acquisition routes it can be caught by.
 *
 * ROUTE = one catch-table row holding the item's "Internal Item ID". Its WHERE text (Acquisition
 * `biomes`) is read off the row, never inferred:
 * - the catch category when it is a liquid other than water ("Lava", "Honey");
 * - the row's environment conditions — the table's General condition and the row's Other conditions
 *   that the article defines under "3. Biome" or as the Ocean bobber location ("Corruption",
 *   "The Hallow", "Beach"; several are joined with " + ": "Corruption + Snow biome"); the
 *   "(overridable)" priority marker is dropped (it is catch-priority mechanics, not a place);
 * - else, for a table without a General condition whose caption is a biome requirement
 *   (ENVIRONMENT_CAPTIONS: "Pure biome" — no other biome may overlap), the caption; else the heights
 *   (the "Space" table's rows: "Space", "Space, Surface"); else "Any biome";
 * - the Heights cell, when it is not "Any", in parentheses: "Pure biome (Underground, Cavern, Underworld)".
 * Rows with the same conditions are merged into one route listing every place.
 *
 * CONDITIONS: World status / generic conditions (and biome requirements, e.g. the Dungeon's
 * "Skeletron is defeated") map onto registry slugs through the conditions overlay's
 * `match.fishingConditions` (by the article's label: "Hardmode", "Pre-Hardmode", "Blood Moon", "Quest
 * fish", "Can fish in lava", "Dungeon"). The group markers "Crate" and "Enemies" name the catch group,
 * not a condition. Any other label ("Junk", ">1000 tiles of liquid", "No Advanced Combat
 * Techniques", …) makes the route's conditions Unknown (emitted [] + listed), never dropped.
 * SKIPPED: NPC catches (Truffle Worm / Enemy tables: no item) and Remix-seed rows ("Remix",
 * "Ocean Crates(Remix)": seed worlds are not modeled, as seed vendors).
 *
 * Gating (§7b): a fishing route is an `unknown` route for the deriver (blocker fishing-route-ungated):
 * whether a pond, biome or height is reachable before a boss is not reviewed, so a fished item is never
 * "obtainable now" through fishing alone; a gate-free route of another kind still derives exactly.
 */
import type { Acquisition } from '../../src/schemas'
import type { FishingCatches, FishingConditionRef } from '../parse/fishing'
import type { ConditionMatchers } from './overlays'

export const FISHING_CATCHES_PAGE = 'Fishing catches'

/** Tables without a General condition whose caption is a biome requirement of their catches. */
export const ENVIRONMENT_CAPTIONS: ReadonlySet<string> = new Set(['Pure biome'])
/** Generic-condition anchors that name the catch group rather than a condition. */
const GROUP_MARKERS: ReadonlySet<string> = new Set(['crate', 'enemies', 'dukefishron'])

export type FishingAcquisition = Extract<Acquisition, { method: 'fishing' }>

export interface FishingRoute {
  acquisition: FishingAcquisition
  /** Condition labels with no registry mapping: the route's conditions are Unknown. */
  unmapped: string[]
}

export interface FishingRoutesReport {
  rows: number
  itemRows: number
  skipped: Map<string, number>
  unmapped: Map<string, number>
  items: number
}

const place = (label: string) => label.replace(/\s*\(overridable\)\s*$/i, '').trim()

export function buildFishingRoutes(catches: FishingCatches, matchers: Pick<ConditionMatchers, 'fishing'>): { byItem: Map<number, FishingRoute[]>; report: FishingRoutesReport } {
  const report: FishingRoutesReport = { rows: catches.rows.length, itemRows: 0, skipped: new Map(), unmapped: new Map(), items: 0 }
  const skip = (why: string) => report.skipped.set(why, (report.skipped.get(why) ?? 0) + 1)
  const groupOf = (ref: FishingConditionRef) => (ref.anchor ? catches.definitions.get(ref.anchor)?.group : undefined)
  // item → condition key → route under construction
  const draft = new Map<number, Map<string, { places: string[]; conditions: string[]; unmapped: string[] }>>()

  for (const row of catches.rows) {
    if (row.itemIds.length === 0) {
      skip(row.npcIds.length > 0 ? 'NPC catch (no item)' : 'row without a catch')
      continue
    }
    const refs = [...(row.general ? [row.general] : []), ...row.conditions]
    if (refs.some((r) => (r.anchor ?? '').startsWith('remix'))) {
      skip('Remix special seed only (seed worlds not modeled)')
      continue
    }
    report.itemRows += 1
    const environment: string[] = []
    const conditions = new Set<string>()
    const unmapped = new Set<string>()
    for (const ref of refs) {
      const group = groupOf(ref)
      const mapped = matchers.fishing.get(ref.label)?.id
      if (group === 'biome' || (group === 'bobber' && ref.anchor === 'ocean')) {
        environment.push(place(ref.label))
        if (mapped) conditions.add(mapped)
        continue
      }
      if (ref.anchor && GROUP_MARKERS.has(ref.anchor)) continue
      if (mapped) conditions.add(mapped)
      else unmapped.add(ref.label)
    }
    const heights = row.heights.filter((h) => h !== 'Any')
    const liquid = row.category === 'Lava' || row.category === 'Honey' ? row.category : undefined
    let where = [...(liquid ? [liquid] : []), ...environment].join(' + ')
    if (where === '') where = !row.general && ENVIRONMENT_CAPTIONS.has(row.table) ? row.table : heights.length > 0 ? heights.join(', ') : 'Any biome'
    if (heights.length > 0 && where !== heights.join(', ')) where = `${where} (${heights.join(', ')})`
    const condList = [...conditions].sort()
    const unmappedList = [...unmapped].sort()
    for (const label of unmappedList) report.unmapped.set(label, (report.unmapped.get(label) ?? 0) + 1)
    const key = JSON.stringify([condList, unmappedList])
    for (const id of new Set(row.itemIds)) {
      const routes = draft.get(id) ?? new Map()
      const r = routes.get(key) ?? { places: [], conditions: condList, unmapped: unmappedList }
      if (!r.places.includes(where)) r.places.push(where)
      routes.set(key, r)
      draft.set(id, routes)
    }
  }

  const byItem = new Map<number, FishingRoute[]>()
  for (const [id, routes] of [...draft].sort((a, b) => a[0] - b[0])) {
    const list = [...routes.values()]
      .map((r): FishingRoute => ({ acquisition: { method: 'fishing', biomes: [...r.places], conditions: r.unmapped.length > 0 ? [] : r.conditions }, unmapped: r.unmapped }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    byItem.set(id, list)
  }
  report.items = byItem.size
  return { byItem, report }
}
