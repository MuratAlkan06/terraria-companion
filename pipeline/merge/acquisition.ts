/**
 * Acquisition routes + §7b gating for one Cargo Items row — shared by the weapons (P2-S2) and ammo
 * (P2-S7) builders, so every item dataset links recipes / drops / vendors by the same rules:
 *
 * - craft = recipes producing the item (incl. Shimmer transmutations); drop = drop records yielding
 *   it (NPCs, bosses, bags, chests, crates); purchase = one route per `vendor:<NPC>` Cargo tag (price
 *   from a single-coin `buy` cell; shop conditions are not structured on the wiki → Unknown).
 * - A wiki self-conflict (AMENDMENTS-004 B19, overlays/withheld.json) withholds the whole acquisition
 *   (Unknown + source-mismatch); route hints in the Cargo tags / listcat that no record backs are
 *   reported as gaps, never inferred.
 * - gating: the deriver's result, adjusted for the item's own purchase routes (their conditions are
 *   Unknown, so a derived craft/drop gate is exact only when it is already gate-free).
 */
import type { Acquisition, GapEntry } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { OverlayError } from './registry'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** A `buy` cell holding exactly one coin amount → copper (the coin template's data-sort-value). */
export function coinPrice(cell: string): number | undefined {
  const coins = [...cell.matchAll(/class="coin"[^>]*data-sort-value="(\d+)"/g)]
  if (coins.length !== 1) return undefined
  const v = Number(coins[0][1])
  return Number.isInteger(v) && v > 0 ? v : undefined
}

/** AMENDMENTS-004 B19: a wiki self-conflict on an item field (overlays/withheld.json). */
export interface WithheldField {
  field: 'acquisition'
  detail: string
  /** The conflicting Cargo Items tag; must still be present (else the entry is stale). */
  cargoTag: string
  sources: string[]
}

export interface RouteContext {
  id: number
  /** Display name (gap details, reason tallies). */
  name: string
  /** What the record is, for reason text ("weapon", "ammo item"). */
  noun: string
  row: CargoRow
  wikiUrl: string
  recipesBy: ReadonlyMap<number, readonly string[]>
  dropsBy: ReadonlyMap<number, readonly string[]>
  withheld?: WithheldField
  gating: (itemId: number) => GatingResult
  /** Lists a field as Unknown (absent + listed) with a reason for the report. */
  unknown: (field: string, why: string) => void
  /** Withholds a field because sources conflict (Unknown + source-mismatch gap). */
  mismatch: (field: string, detail: string, sources: string[]) => void
  gaps: { add(entry: GapEntry): void }
  reasons: ReasonTally
}

export interface RouteResult {
  acquisition: Acquisition[]
  /** Vendor NPC names (purchase routes). */
  vendors: string[]
  gating: GatingResult
}

export function itemRoutes(c: RouteContext): RouteResult {
  const { id, name, row, wikiUrl, withheld } = c
  const ref = `i:${id}`
  const acquisition: Acquisition[] = []
  const recipeIds = [...(c.recipesBy.get(id) ?? [])].sort()
  const dropIds = [...(c.dropsBy.get(id) ?? [])].sort()
  const tagList = str(row.tag).split('^').map((t) => t.trim()).filter(Boolean)
  const lower = tagList.map((t) => t.toLowerCase())
  const listcat = str(row.listcat).split('^').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (withheld && !tagList.includes(withheld.cargoTag)) throw new OverlayError(`[E_SCHEMA] overlay withheld/i:${id}: Cargo Items no longer carries the conflicting tag "${withheld.cargoTag}" — the conflict was resolved upstream; remove the entry`)
  const vendors = withheld ? [] : [...new Set(tagList.filter((t) => /^vendor:/i.test(t) && !/^vendor:seed:/i.test(t)).map((t) => t.slice('vendor:'.length).trim()))].sort()
  if (withheld) {
    // B19: never pick a side on conflicting wiki sources — the whole acquisition is Unknown
    c.mismatch('acquisition', withheld.detail, [...new Set([wikiUrl, ...withheld.sources])])
  } else {
    if (recipeIds.length > 0) acquisition.push({ method: 'craft', recipeIds })
    if (dropIds.length > 0) acquisition.push({ method: 'drop', dropIds })
  }
  const price = vendors.length === 1 ? coinPrice(str(row.buy)) : undefined
  for (const npcName of vendors) {
    const i = acquisition.length
    acquisition.push({ method: 'purchase', npcName, ...(price ? { priceCopper: price } : {}), conditions: [] })
    c.unknown(`acquisition.${i}.conditions`, 'shop availability conditions are not structured on the wiki')
    if (!price) c.unknown(`acquisition.${i}.priceCopper`, vendors.length > 1 ? 'one wiki buy price for several vendors' : 'the wiki buy price is not a single coin amount (e.g. Defender Medals)')
  }
  if (acquisition.length === 0 && !withheld) c.unknown('acquisition', `no recipe, drop or named vendor on the wiki for this ${c.noun}`)
  // route hints with no backing record (reported, never inferred)
  const hints: string[] = []
  // a withheld acquisition (B19) is itself the finding; route hints would restate the conflicting tag
  if (!withheld) {
    if (listcat.includes('craftable items') && recipeIds.length === 0) hints.push('listed as craftable but no desktop recipe resolves')
    if ((lower.some((t) => ['drop', 'bag loot', 'treasure bag loot', 'loot'].includes(t)) || listcat.some((x) => /(drop|loot) items$/.test(x))) && dropIds.length === 0) hints.push('tagged drop/loot but no Cargo Drops row resolves')
    if (lower.some((t) => ['vendor', 'buy', 'buyable'].includes(t)) && vendors.length === 0) hints.push('tagged as sold but no vendor NPC is named')
    if (lower.some((t) => /^vendor:seed:/.test(t))) hints.push('sold only in secret-seed worlds (not modeled)')
    if (lower.includes('fished') || listcat.includes('fished items')) hints.push('obtained by fishing (not modeled)')
    if (lower.includes('plunder') || listcat.includes('plunder items')) hints.push('plunder (not modeled)')
  }
  for (const h of hints) tally(c.reasons, `acquisition: ${h}`, name)
  if (hints.length > 0) c.gaps.add({ ref, field: 'acquisition', kind: 'missing-field', detail: `${name}: ${hints.join('; ')}`, sources: [wikiUrl] })

  // gating (§7b) — a withheld acquisition is an unverified input, so gating is Unknown too
  let gating: GatingResult = withheld ? { ok: false, blockers: ['acquisition-withheld'] } : c.gating(id)
  // own purchase routes take part in §7b too: their conditions are Unknown, so they never derive,
  // and an Unknown route could be the less gated one — a derived craft/drop gate is only exact
  // when it is already gate-free (same rule as the deriver's minimum over routes)
  if (vendors.length > 0) {
    if (!gating.ok) gating = { ok: false, blockers: [...new Set([...gating.blockers.filter((b) => b !== 'cycle'), 'vendor-conditions-unknown' as const])].sort() }
    else if (gating.gatedBy.bosses.length > 0 || gating.gatedBy.conditions.length > 0) gating = { ok: false, blockers: ['alternative-route-unverified', 'vendor-conditions-unknown'] }
  }
  return { acquisition, vendors, gating }
}
