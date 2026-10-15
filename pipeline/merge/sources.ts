/**
 * AMENDMENTS-014 B68 / AMENDMENTS-015 B78 gating expansion: the reviewed acquisition sources the §7b
 * derivation (merge/gating.ts) may use beyond recipes and boss drops — built once per build from
 * overlays/vendors.json, overlays/containers.json, overlays/gatherables.json, the conditions overlay's
 * exhaustive groups and the vendor NPC articles' shop tables (parse/shops.ts). Every overlay claim is a
 * verbatim quote checked against the cached article revision (merge/evidence.ts); every condition is a
 * registry slug. Nothing is assumed: a route that cannot be derived stays in the derivation as an
 * explicit `unknown` route (so it still blocks a gated minimum), with its reason in the report.
 *
 * VENDOR ROUTES. Every Cargo Items row that is the same desktop item in Module:Iteminfo/data (any item,
 * emitted or not — ingredients need them too) contributes one route per `vendor:<NPC>` tag:
 * - the NPC must be reviewed (vendors.json `npcs` or `unavailable`; an unreviewed name fails the build);
 * - an `unavailable` NPC → unknown (vendor-availability-unknown);
 * - the item must have a row in the NPC article's shop table (by display name) whose Availability cell
 *   is a reviewed text; several rows → an unconditional one wins, else they must agree; otherwise
 *   unknown (vendor-conditions-unknown).
 * A derivable route = the row's conditions + "this NPC is present" (the NPC's own availability: its
 * conditions, the minimum over its "one of these items" list, the NPCs it needs).
 * A B19-withheld item (overlays/withheld.json) gets only an unknown route (acquisition-withheld).
 *
 * FISHING ROUTES (P6-S0, AMENDMENTS-004 B20): every item the "Fishing catches" article lists
 * (merge/fishing.ts) gets an unknown route (fishing-route-ungated): its emitted `fishing` acquisition
 * is real, but no fishing place is reviewed for gating, so it blocks a gated minimum like any
 * unverified input (a gate-free route of another kind still derives exactly).
 */
import type { Acquisition, ProvSource } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import { resolveItemName, type Iteminfo, type IteminfoItem } from '../parse/iteminfo'
import { parseShopTables, type ShopRow } from '../parse/shops'
import { stripMarkup } from '../parse/text'
import type { WithheldField } from './acquisition'
import { Evidence } from './evidence'
import type { FishingRoute } from './fishing'
import { containerKey, type ExtraRoute, type NpcAvailability } from './gating'
import type { ConditionsOverlay, ContainersOverlay, GatherablesOverlay, VendorsOverlay } from './overlays'
import { OverlayError } from './registry'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

export type VendorRoute =
  | { ok: true; npc: string; conditions: string[] }
  | { ok: false; npc: string; blocker: 'vendor-availability-unknown' | 'vendor-conditions-unknown'; why: string }

export interface GatherRoute {
  /** The verbatim evidence sentence (emitted as the `other` acquisition description). */
  description: string
  sourceUrl: string
  conditions: string[]
}

export interface SourcesInput {
  itemRows: readonly CargoRow[]
  iteminfo: Iteminfo
  articles: ReadonlyMap<string, Article>
  evidence: Evidence
  vendors: VendorsOverlay
  containers: ContainersOverlay
  gatherables: GatherablesOverlay
  conditions: ConditionsOverlay
  withheld?: ReadonlyMap<number, WithheldField>
  /** P6-S0 B20: fishing routes per item (merge/fishing.ts) + the "Fishing catches" article provenance. */
  fishing?: { byItem: ReadonlyMap<number, readonly FishingRoute[]>; source: ProvSource }
}

export interface SourcesReport {
  /** Per reviewed NPC: shop rows parsed, rows whose availability is mapped. */
  shops: { npc: string; status: 'derivable' | 'unavailable'; rows: number; mapped: number; why: string; url: string }[]
  /** Availability texts no mapping covers (count of shop rows). */
  unmappedTexts: Map<string, number>
  /** Vendor routes of all Cargo rows by outcome ("derivable", "unavailable NPC", "not in shop table", "availability not mapped"). */
  routeOutcomes: Map<string, number>
  gatherables: { item: string; id: number; url: string; conditions: string[] }[]
  containers: { container: string; url: string; conditions: string[] }[]
}

export interface AcquisitionSources {
  extraRoutes: Map<number, ExtraRoute[]>
  npcs: Map<string, NpcAvailability>
  containers: Map<string, { conditions: string[] }>
  /** World-specific container loot: item → world conditions (overlays/containers.json worldSpecificLoot). */
  containerItemConditions: Map<number, string[]>
  exhaustive: string[][]
  /** AMENDMENTS-016 B141: conditions that ride along on a route free of boss/progression gates (overlays/conditions.json rideAlong). */
  rideAlong: string[]
  /** The vendor route of one item + vendor tag name (the emitted purchase acquisition reads it). */
  vendorRoute: (itemId: number, itemName: string, vendorTag: string) => VendorRoute
  gather: Map<number, GatherRoute>
  /** P6-S0 B20: fishing routes per item (emitted as `fishing` acquisitions) and their article provenance. */
  fishing: ReadonlyMap<number, readonly FishingRoute[]>
  fishingSource?: ProvSource
  /** Curated provenance of the overlay pages (for records whose gating used them — report only). */
  sources: ProvSource[]
  report: SourcesReport
}

/** Cargo `vendor:<NPC>` tags of a row (seed-world vendors excluded, as merge/acquisition.ts). */
export const vendorTags = (row: CargoRow): string[] =>
  [...new Set(str(row.tag).split('^').map((t) => t.trim()).filter((t) => /^vendor:/i.test(t) && !/^vendor:seed:/i.test(t)).map((t) => t.slice('vendor:'.length).trim()))].sort()

/** The Iteminfo item a Cargo row is (positive item id carried by Iteminfo under the same display name). */
export function sameDesktopItem(row: CargoRow, info: Iteminfo): IteminfoItem | undefined {
  const id = Number(str(row.itemid))
  if (str(row.itemid).trim() === '' || !Number.isInteger(id) || id <= 0) return undefined
  const item = info.items.get(id)
  if (!item) return undefined
  const cargoName = stripMarkup(str(row.name))
  return (item.name !== undefined ? item.name === cargoName : item.internalName === stripMarkup(str(row.internalname))) ? item : undefined
}

export function buildAcquisitionSources(input: SourcesInput): AcquisitionSources {
  const { vendors, evidence, iteminfo: info } = input
  const known = new Set(input.conditions.entries.map((e) => e.id))
  const checkConditions = (list: readonly string[], where: string) => {
    for (const c of list) if (!known.has(c)) throw new OverlayError(`[E_SCHEMA] ${where}: condition "${c}" is not in overlays/conditions.json`)
  }
  const resolve = (name: string, where: string): number => {
    const r = resolveItemName(info, name)
    if (!r.ok) throw new OverlayError(`[E_SCHEMA] ${where}: ${r.reason}`)
    if (r.ambiguous) throw new OverlayError(`[E_SCHEMA] ${where}: item name "${name}" is ambiguous (ids ${r.ambiguous.join(', ')})`)
    return r.id
  }
  const pageSources = new Map<string, ProvSource>()
  const cite = (page: string, quote: string, where: string) => {
    const p = evidence.quote(page, quote, where)
    pageSources.set(p.url, Evidence.source(where.split('/')[0].replace(/^overlay /, ''), p))
    return p
  }

  // ---------------- vendors ----------------
  const canonical = new Map<string, string>()
  for (const n of [...vendors.npcs, ...vendors.unavailable]) for (const name of [n.npc, ...(n.aliases ?? [])]) canonical.set(name, n.npc)
  const npcs = new Map<string, NpcAvailability>()
  const unavailable = new Map(vendors.unavailable.map((u) => [u.npc, u]))
  const shops = new Map<string, ShopRow[]>()
  const report: SourcesReport = { shops: [], unmappedTexts: new Map(), routeOutcomes: new Map(), gatherables: [], containers: [] }
  const mapping = new Map(vendors.availability.map((a) => [a.text, a]))
  for (const a of vendors.availability) checkConditions(a.conditions, `overlay vendors/availability "${a.text}"`)
  const usedTexts = new Set<string>()
  const shopOf = (npc: string, page: string): ShopRow[] => {
    if (!shops.has(npc)) {
      const article = input.articles.get(page)
      if (!article) throw new OverlayError(`[E_SCHEMA] overlay vendors/${npc}: article "${page}" was not fetched by the sync plan (run npm run pipeline:fetch)`)
      const rows = parseShopTables(article.html)
      if (rows.length === 0) throw new OverlayError(`[E_SCHEMA] overlay vendors/${npc}: no "Item · Cost · Availability" shop table on "${page}"`)
      shops.set(npc, rows)
      for (const r of rows) if (mapping.has(r.availability)) usedTexts.add(r.availability)
    }
    return shops.get(npc) as ShopRow[]
  }
  for (const n of vendors.npcs) {
    const where = `overlay vendors/${n.npc}`
    checkConditions(n.conditions, where)
    for (const e of n.evidence) cite(e.page, e.quote, where)
    const anyOf: number[][] = []
    if (n.requiresAnyOf) {
      cite(n.page, n.requiresAnyOf.quote, `${where} requiresAnyOf`)
      // every listed item must be named on the NPC article (the quoted list), then resolve to an ID
      anyOf.push(n.requiresAnyOf.items.map((name) => (cite(n.page, name, `${where} requiresAnyOf "${name}"`), resolve(name, `${where} requiresAnyOf`))))
    }
    if (n.requiresNpcs) {
      cite(n.page, n.requiresNpcs.quote, `${where} requiresNpcs`)
      for (const other of n.requiresNpcs.npcs) if (!vendors.npcs.some((x) => x.npc === other)) throw new OverlayError(`[E_SCHEMA] ${where}: requires NPC "${other}", whose availability is not in overlays/vendors.json npcs`)
    }
    npcs.set(n.npc, { conditions: [...n.conditions], ...(anyOf.length ? { requiresAnyOf: anyOf } : {}), ...(n.requiresNpcs ? { requiresNpcs: [...n.requiresNpcs.npcs] } : {}) })
    const rows = shopOf(n.npc, n.page)
    report.shops.push({ npc: n.npc, status: 'derivable', rows: rows.length, mapped: rows.filter((r) => mapping.has(r.availability)).length, why: n.why, url: wikiPageUrl(n.page) })
  }
  for (const u of vendors.unavailable) {
    cite(u.page, u.quote, `overlay vendors/${u.npc}`)
    report.shops.push({ npc: u.npc, status: 'unavailable', rows: shopOf(u.npc, u.page).length, mapped: 0, why: u.reason, url: wikiPageUrl(u.page) })
  }
  for (const a of vendors.availability) if (!usedTexts.has(a.text)) throw new OverlayError(`[E_SCHEMA] overlay vendors/availability "${a.text}": no shop row of a reviewed NPC has this Availability text — remove the stale mapping`)
  for (const [npc, rows] of shops) {
    if (unavailable.has(npc)) continue
    for (const r of rows) if (!mapping.has(r.availability)) report.unmappedTexts.set(r.availability, (report.unmappedTexts.get(r.availability) ?? 0) + 1)
  }

  const vendorRoute = (itemId: number, itemName: string, tag: string): VendorRoute => {
    const npc = canonical.get(tag)
    if (!npc) throw new OverlayError(`[E_SCHEMA] Cargo Items i:${itemId} (${itemName}) names the vendor "${tag}", which overlays/vendors.json does not review — add it to npcs (with quoted availability) or unavailable (with the quoted reason)`)
    const u = unavailable.get(npc)
    if (u) return { ok: false, npc, blocker: 'vendor-availability-unknown', why: `the ${npc}'s availability is not derivable: ${u.reason}` }
    const rows = (shops.get(npc) ?? []).filter((r) => r.item === itemName)
    if (rows.length === 0) return { ok: false, npc, blocker: 'vendor-conditions-unknown', why: `the ${npc}'s shop table on the wiki does not list "${itemName}"` }
    const mapped = rows.map((r) => mapping.get(r.availability))
    const free = mapped.find((m) => m !== undefined && m.conditions.length === 0)
    let rowConditions: string[] | undefined
    if (free) rowConditions = []
    else if (mapped.every((m) => m !== undefined) && new Set(mapped.map((m) => JSON.stringify([...(m?.conditions ?? [])].sort()))).size === 1) rowConditions = [...(mapped[0]?.conditions ?? [])]
    if (!rowConditions) return { ok: false, npc, blocker: 'vendor-conditions-unknown', why: `the ${npc}'s shop row availability is not a reviewed condition ("${rows.map((r) => r.availability || '(empty)').join('" / "')}")` }
    return { ok: true, npc, conditions: [...new Set([...(npcs.get(npc)?.conditions ?? []), ...rowConditions])].sort() }
  }

  // ---------------- extra routes (every Cargo item row) ----------------
  const extraRoutes = new Map<number, ExtraRoute[]>()
  const push = (id: number, r: ExtraRoute) => extraRoutes.set(id, [...(extraRoutes.get(id) ?? []), r])
  const seenRoute = new Set<string>()
  for (const row of input.itemRows) {
    const tags = vendorTags(row)
    if (tags.length === 0) continue
    const item = sameDesktopItem(row, info)
    if (!item) continue
    const name = item.name ?? item.internalName
    if (input.withheld?.has(item.id)) {
      if (!seenRoute.has(`${item.id}|withheld`)) push(item.id, { kind: 'unknown', blocker: 'acquisition-withheld' })
      seenRoute.add(`${item.id}|withheld`)
      continue
    }
    for (const tag of tags) {
      const key = `${item.id}|${canonical.get(tag) ?? tag}`
      if (seenRoute.has(key)) continue
      seenRoute.add(key)
      const r = vendorRoute(item.id, name, tag)
      const outcome = r.ok ? 'derivable' : r.blocker === 'vendor-availability-unknown' ? 'vendor availability not derivable' : r.why.includes('does not list') ? 'item not in the NPC shop table' : 'shop row availability not mapped'
      report.routeOutcomes.set(outcome, (report.routeOutcomes.get(outcome) ?? 0) + 1)
      if (!r.ok) push(item.id, { kind: 'unknown', blocker: r.blocker })
      else {
        const rowConditions = r.conditions.filter((c) => !(npcs.get(r.npc)?.conditions ?? []).includes(c))
        push(item.id, { kind: 'purchase', conditions: rowConditions, requiresNpcs: [r.npc] })
      }
    }
  }

  // ---------------- gatherables ----------------
  const gather = new Map<number, GatherRoute>()
  for (const g of input.gatherables.entries) {
    const where = `overlay gatherables/${g.item}`
    checkConditions(g.conditions, where)
    const p = cite(g.page, g.quote, where)
    for (const x of g.support ?? []) cite(x.page, x.quote, `${where} support`)
    const id = resolve(g.item, where)
    if (gather.has(id)) throw new OverlayError(`[E_DUPLICATE_ID] ${where}: item i:${id} listed twice`)
    const anyOf = (g.requiresAnyOf ?? []).map((name) => (cite(g.page, name, `${where} requiresAnyOf "${name}"`), resolve(name, `${where} requiresAnyOf`)))
    gather.set(id, { description: g.quote, sourceUrl: p.url, conditions: [...g.conditions].sort() })
    push(id, { kind: 'gather', conditions: [...g.conditions].sort(), ...(anyOf.length > 0 ? { requiresAnyOf: [anyOf] } : {}) })
    report.gatherables.push({ item: g.item, id, url: p.url, conditions: [...g.conditions].sort() })
  }

  // ---------------- fishing (P6-S0 B20) ----------------
  for (const id of [...(input.fishing?.byItem.keys() ?? [])].sort((a, b) => a - b)) {
    if (input.withheld?.has(id)) continue // the withheld acquisition already blocks (acquisition-withheld)
    push(id, { kind: 'unknown', blocker: 'fishing-route-ungated' })
  }

  // ---------------- containers ----------------
  const containers = new Map<string, { conditions: string[] }>()
  for (const c of input.containers.entries) {
    const where = `overlay containers/${c.container}`
    checkConditions(c.conditions, where)
    for (const e of c.evidence) cite(e.page, e.quote, where)
    const url = wikiPageUrl(c.page)
    containers.set(containerKey(c.container, url), { conditions: [...c.conditions].sort() })
    report.containers.push({ container: c.container, url, conditions: [...c.conditions].sort() })
  }

  const containerItemConditions = new Map<number, string[]>()
  for (const w of input.containers.worldSpecificLoot ?? []) {
    const where = `overlay containers/worldSpecificLoot ${w.item}`
    checkConditions(w.conditions, where)
    cite(w.page, w.quote, where)
    containerItemConditions.set(resolve(w.item, where), [...w.conditions].sort())
  }

  // ---------------- exhaustive condition groups ----------------
  const exhaustive = (input.conditions.exhaustive ?? []).map((g) => {
    cite(g.page, g.quote, `overlay conditions/exhaustive ${g.conditions.join('+')}`)
    return [...g.conditions]
  })

  // ---------------- ride-along conditions (B141) ----------------
  const rideAlong = [...(input.conditions.rideAlong?.conditions ?? [])].sort()
  checkConditions(rideAlong, 'overlay conditions/rideAlong')

  for (const routes of extraRoutes.values()) routes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    extraRoutes,
    npcs,
    containers,
    containerItemConditions,
    exhaustive,
    rideAlong,
    vendorRoute,
    gather,
    fishing: input.fishing?.byItem ?? new Map(),
    ...(input.fishing ? { fishingSource: input.fishing.source } : {}),
    sources: [...pageSources.values()].sort((a, b) => a.url.localeCompare(b.url)),
    report,
  }
}

/** The emitted `other` acquisition of a gatherable item (B78): its evidence sentence + article. */
export const gatherAcquisition = (g: GatherRoute): Acquisition => ({ method: 'other', description: g.description, sourceUrl: g.sourceUrl, conditions: [...g.conditions] })
