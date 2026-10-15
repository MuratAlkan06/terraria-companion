/**
 * Boss page model (PRD P5-S2; UX_SPEC §3.7): pure functions from the boss record, its drop records,
 * the item lists and the progression graph to what the page shows. No React, no I/O — the page
 * (BossPage.tsx) loads the data, the view (BossPageView.tsx) renders this model, tests drive both.
 *
 * Honesty rules applied here (UX_SPEC §5.3/§8; DATA_SCHEMA_SPEC §2.1):
 * - every curated field is read through getField; "unverified" means Unknown, never an empty list;
 * - items link to their own page where one exists (weapons → /weapons/:id; every Item record — ammo,
 *   potions, materials, the boss's drops — → /items/:id, the P6 encyclopedia, AMENDMENTS-016 B104; armor
 *   pieces → /armor/:id and accessories → /accessories/:id, PRD P6-S1/S2 — B131(b) retires their wiki links),
 *   else to the article titled exactly the item's name that another loaded record carries (e.g. a potion's
 *   article on its buff record), else the wiki's search for its exact name (src/search/links.ts fallback: a
 *   live page, never a guessed article URL, never a dead local link); an id with no name stays inert;
 * - "next" steps come only from typed progression edges, each with its own quoted note + source.
 */
import { dropTableRows, type DifficultyKey, type DropCell } from '../db/weapons/weaponDisplay'
import { weaponHref } from '../db/weapons/weaponNav'
import { accessoryHref } from '../db/accessories/accessoryNav'
import { armorPieceHref } from '../db/armor/armorNav'
import { itemHref } from '../db/items/itemNav'
import type { AccessoryListRecord, ArmorListRecord, Boss, DropIndex, DropSource, GapEntry, Item, ItemNames, WeaponListRecord } from '../../../data-access/types'
import { connectionsOf, type Connection, type MapGraph, type MapNode } from '../../../components/nodeMap/graph'
import type { EdgeType } from '../../../components/nodeMap/edgeStyles'
import type { AttackPatternTag, Difficulty } from '../../../schemas'
import { getField } from '../../../schemas/getField'
import { wikiSearchUrl } from '../../../search/links'
import { guideHref } from '../guides/guideModel'
import { prepEntryId } from './prepChecklistStore'

/** Heading ids of the page's sections (each section is labelled by its heading). */
export const SECTION_IDS = {
  summon: 'boss-summon-title',
  where: 'boss-where-title',
  prep: 'boss-prep-title',
  gear: 'boss-gear-title',
  patterns: 'boss-patterns-title',
  drops: 'boss-drops-title',
  stats: 'boss-stats-title',
  next: 'boss-next-title',
} as const

// --- items ----------------------------------------------------------------------------------

export type ItemLink = { kind: 'internal'; to: string } | { kind: 'external'; href: string }

export interface ItemInfo {
  id: number
  name: string
  /** Record sprite path (SpriteImg resolves it against the manifest; absent → placeholder). */
  sprite?: string
  /** Weapon damage class (placeholder silhouette); absent for other items. */
  damageClass?: string
  kind: 'weapon' | 'accessory' | 'armor' | 'item' | 'other'
  link?: ItemLink
}

export interface ItemSources {
  names: ItemNames
  weapons: readonly WeaponListRecord[]
  accessories: readonly AccessoryListRecord[]
  armor: readonly ArmorListRecord[]
  /**
   * items.detail.json (ammo, potions, every item a boss record references — summon, prep-checklist and, since
   * AMENDMENTS-016 B104, drop items): each has its encyclopedia page.
   */
  items: readonly Item[]
  /**
   * terraria.wiki.gg article URLs carried by other loaded records (the buff registry). An item with
   * no record of its own links the article whose title is exactly its name, when one is here — e.g.
   * the Ironskin buff's article is "Ironskin_Potion". Never a URL built from the name.
   */
  articles?: Iterable<string>
}

/** "https://terraria.wiki.gg/wiki/Ironskin_Potion" → "Ironskin Potion" (undefined for other URLs). */
export function wikiArticleTitle(url: string): string | undefined {
  const match = /^https:\/\/terraria\.wiki\.gg\/wiki\/([^?#]+)$/.exec(url)
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ')
  } catch {
    return undefined
  }
}

/**
 * How a stored wiki sentence (a progression edge's note) starts where it is quoted. One the extraction
 * cut mid-sentence — it starts lowercase, its subject left behind ("are four late-Hardmode, stationary
 * bosses…") — gets a marked lead: the subject in square brackets when the quote's source article is
 * about a node the edge connects (the article's title is that node's name: "[Celestial Pillars] "),
 * else an ellipsis marking the cut. A whole sentence has none. The stored quote itself never changes
 * (evidence checks compare it verbatim); the lead is display only.
 */
export function quoteLead(text: string, sourceUrl: string, subjects: readonly string[]): string | undefined {
  if (!/^\p{Ll}/u.test(text)) return undefined
  const title = wikiArticleTitle(sourceUrl)
  return title !== undefined && subjects.includes(title) ? `[${title}] ` : '…'
}

/** A stored wiki sentence pinned verbatim, with its source. */
export interface PinnedQuote {
  sourceUrl: string
  text: string
}

/**
 * Stored wiki sentences the extraction cut at the END, mid-promise (AMENDMENTS-015 B93(ii)), pinned
 * verbatim with their source. Pinned, never inferred from a missing full stop — whole sentences without
 * one ship too (Wall of Flesh → Hardmode, Queen Bee, Plantera → Frost Moon). Empty since P6-S0
 * (AMENDMENTS-016 B104): its one entry, the Mechanical bosses article's "…causes the following to
 * happen", was re-extracted as a whole sentence, so the pin matched nothing. The mechanism stays for the
 * next sentence a re-extraction cannot make whole.
 */
export const CUT_AT_END: readonly PinnedQuote[] = []

/**
 * quoteLead's counterpart at the other end: an ellipsis after a stored sentence pinned as cut at the
 * end (CUT_AT_END by default), else none. Display only; the stored quote never changes.
 */
export function quoteTrail(text: string, sourceUrl: string, cutAtEnd: readonly PinnedQuote[] = CUT_AT_END): string | undefined {
  return cutAtEnd.some((q) => q.text === text && q.sourceUrl === sourceUrl) ? '…' : undefined
}

/** Item id → what the page can say about it: name, sprite, and its real page (see module doc). */
export function itemResolver(src: ItemSources): (id: number) => ItemInfo {
  const byId = new Map<number, ItemInfo>()
  for (const w of src.weapons) byId.set(w.id, { id: w.id, name: w.name, sprite: w.sprite, damageClass: w.damageClass, kind: 'weapon', link: { kind: 'internal', to: weaponHref(w.id) } })
  for (const a of src.accessories) byId.set(a.id, { id: a.id, name: a.name, sprite: a.sprite, kind: 'accessory', link: { kind: 'internal', to: accessoryHref(a.id) } })
  for (const a of src.armor) byId.set(a.id, { id: a.id, name: a.name, sprite: a.sprite, kind: 'armor', link: { kind: 'internal', to: armorPieceHref(a.id) } })
  for (const i of src.items) if (!byId.has(i.id)) byId.set(i.id, { id: i.id, name: i.name, sprite: i.sprite, kind: 'item', link: { kind: 'internal', to: itemHref(i.id) } })
  const articleByTitle = new Map<string, string>()
  for (const url of src.articles ?? []) {
    const title = wikiArticleTitle(url)
    if (title && !articleByTitle.has(title)) articleByTitle.set(title, url)
  }
  return (id) => {
    const known = byId.get(id)
    if (known) return known
    const name = src.names.byId.get(id)
    if (name === undefined) return { id, name: `Item #${id}`, kind: 'other' }
    return { id, name, kind: 'other', link: { kind: 'external', href: articleByTitle.get(name) ?? wikiSearchUrl(name) } }
  }
}

// --- weapon names in quoted tips ------------------------------------------------------------

/** A quoted tip, split into plain text and the weapon names it mentions (linked to their pages). */
export type TipSegment = string | { text: string; item: ItemInfo }

/**
 * Finds the names of real weapon records in a verbatim wiki quote, so the quote can link them
 * without changing a word (M3). Matching is exact and case-sensitive on whole words, longest name
 * first ("Flaming Mace" before "Mace"); a multi-word name may carry a plural "s" ("Bone Javelins"
 * → Bone Javelin). Single-word names never match a plural ("Spears" is the weapon class, not the
 * Spear). Links come from the same resolver as every other item on the page (weapons → their page).
 */
export function tipLinker(weapons: readonly WeaponListRecord[], itemOf: (id: number) => ItemInfo): (text: string) => TipSegment[] {
  const byName = new Map(weapons.map((w) => [w.name, w.id]))
  const names = [...byName.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))
  if (names.length === 0) return (text) => [text]
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}'’-])(${names.map(escape).join('|')})(s?)(?![\\p{L}\\p{N}'’-])`, 'gu')
  return (text) => {
    const out: TipSegment[] = []
    let last = 0
    for (const match of text.matchAll(pattern)) {
      const [whole, name, plural] = match
      if (plural && !name.includes(' ')) continue
      const start = match.index
      if (start > last) out.push(text.slice(last, start))
      out.push({ text: whole, item: itemOf(byName.get(name) as number) })
      last = start + whole.length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }
}

// --- drops ----------------------------------------------------------------------------------

export interface DropRow {
  drop: DropSource
  item: ItemInfo
  /** Dropped by the boss's Treasure Bag (Expert / Master) rather than the boss itself. */
  bag: boolean
  /**
   * Who drops it: the boss itself; one SEGMENT of it (a part's own drop, made each time that part
   * dies, on top of the whole boss's drop of the same item — Eater of Worlds); another NPC variant
   * of the boss ("Skeletron (Red Hat Skeletron)"); or its Treasure Bag.
   */
  role: 'boss' | 'segment' | 'variant' | 'bag'
  /** The segment's name without the boss's ("Head" for "Eater of Worlds Head"), for role 'segment'. */
  part?: string
}

export interface DropCellView {
  difficulty: DifficultyKey
  rate: DropCell
  /** The quantity for this difficulty; undefined where the rate is not applicable (cell shows "n/a"). */
  quantity?: DropCell
}

/** One table cell per difficulty: the rate, and the quantity wherever the drop applies. */
export function dropCells(drop: DropSource): DropCellView[] {
  return dropTableRows(drop).map((r) => ({ difficulty: r.difficulty, rate: r.rate, ...(r.rate.view.status === 'not-applicable' ? {} : { quantity: r.quantity }) }))
}

/** Unknown markers a drop row renders: its rate / quantity cells and its conditions line. */
export function dropRowUnknowns(drop: DropSource): number {
  const cells = dropCells(drop).reduce((n, c) => n + (c.rate.view.status === 'unverified' ? 1 : 0) + (c.quantity?.view.status === 'unverified' ? 1 : 0), 0)
  return cells + (getField(drop, 'conditions').status === 'unverified' ? 1 : 0)
}

/**
 * How the drops table reads (H2): what the fight is for first, flat-rate rows that only apply under
 * unverified conditions last and apart.
 * - `rewards`: the boss's Treasure Bag first, then its equipment (weapons, accessories, armor) and
 *   the single items only this boss drops (vanity, trophies, pets, mounts…), by best verified
 *   chance;
 * - `materials`: the rest — stackable drops (ores, scales, potions, ammo) and items other sources
 *   drop too (coins), by best verified chance;
 * - `conditional`: records whose conditions are Unknown. Their chance applies only under those
 *   conditions, so they sit in their own collapsed group, never among the real rewards.
 */
export type DropTier = 'rewards' | 'materials' | 'conditional'
export const DROP_TIERS: readonly DropTier[] = ['rewards', 'materials', 'conditional']

/** One item's records within a tier, read together: the boss's own row, then its segments / variants, then the bag's. */
export interface DropGroup {
  item: ItemInfo
  tier: DropTier
  rows: DropRow[]
  /** The boss's own Treasure Bag (the item its bag rows are dropped from). */
  treasureBag: boolean
  /** Best verified chance among the rows, any difficulty; -1 when none is verified. */
  topRate: number
  /** Per-segment rows next to the whole boss's row (they add up; no row is a total of the others). */
  segmented: boolean
}

export interface DropSections {
  tiers: Record<DropTier, DropGroup[]>
  /** Every loaded record once, in display order. */
  rows: DropRow[]
  /** Boss.dropIds missing from the loaded drop data. */
  missing: number
  /**
   * The one NPC variant every non-bag record comes from ("Plantera (Second Form)"), when there is
   * exactly one and it isn't the boss itself: said once above the table instead of on every row.
   */
  commonSource?: string
}

const conditionsUnknown = (drop: DropSource) => getField(drop, 'conditions').status === 'unverified'

/** Verified (or curated) numeric view value, else undefined. */
const known = <T>(view: { status: string; value?: unknown }): T | undefined => (view.status === 'verified' || view.status === 'editorial' ? (view.value as T) : undefined)

const topRateOf = (rows: readonly DropRow[]) => Math.max(-1, ...rows.flatMap((r) => dropCells(r.drop).flatMap((c) => known<number>(c.rate.view) ?? [])))

const stackable = (rows: readonly DropRow[]) => rows.some((r) => dropCells(r.drop).some((c) => (c.quantity ? (known<{ max: number }>(c.quantity.view)?.max ?? 0) > 1 : false)))

/** Which bosses drop each item, over the whole drop index (undefined = a non-boss source). Cached per index. */
const dropSourcesCache = new WeakMap<DropIndex, Map<number, Set<string | undefined>>>()
function bossesDropping(drops: DropIndex): Map<number, Set<string | undefined>> {
  let index = dropSourcesCache.get(drops)
  if (!index) {
    index = new Map()
    for (const d of drops.byId.values()) {
      const set = index.get(d.itemId) ?? new Set<string | undefined>()
      set.add(d.source.bossId)
      index.set(d.itemId, set)
    }
    dropSourcesCache.set(drops, index)
  }
  return index
}

const ROLE_ORDER: Readonly<Record<DropRow['role'], number>> = { boss: 0, segment: 1, variant: 2, bag: 3 }
/** Game order of a record's NPC (Eater of Worlds Head 13, Body 14, Tail 15); bags last. */
const npcOrder = (drop: DropSource) => drop.source.npcIds?.[0] ?? Number.MAX_SAFE_INTEGER

/** The boss's drop records (Boss.dropIds) grouped by item and sorted into the three tiers above. */
export function bossDropSections(boss: Boss, drops: DropIndex, itemOf: (id: number) => ItemInfo): DropSections {
  const loaded = boss.dropIds.map((id) => drops.byId.get(id))
  const records = loaded.filter((d): d is DropSource => d !== undefined)
  // The bag rows' source is the bag item ("Treasure Bag (Eye of Cthulhu)").
  const bagNames = new Set(records.filter((d) => d.source.treasureBag === true).map((d) => d.source.npcName))
  const droppers = bossesDropping(drops)
  const segmentOf = (npcName: string): string | undefined => {
    const inner = npcName.startsWith(`${boss.name} (`) && npcName.endsWith(')') ? npcName.slice(boss.name.length + 2, -1) : undefined
    return inner?.startsWith(`${boss.name} `) ? inner.slice(boss.name.length + 1) : undefined
  }

  // Group by tier (conditional vs not) and item.
  const buckets = new Map<string, { conditional: boolean; records: DropSource[] }>()
  for (const drop of records) {
    const conditional = conditionsUnknown(drop)
    const key = `${conditional ? 'c' : 'u'}:${drop.itemId}`
    const bucket = buckets.get(key) ?? { conditional, records: [] }
    bucket.records.push(drop)
    buckets.set(key, bucket)
  }

  const tiers: Record<DropTier, DropGroup[]> = { rewards: [], materials: [], conditional: [] }
  for (const { conditional, records: list } of buckets.values()) {
    const item = itemOf(list[0].itemId)
    const hasBossRow = list.some((d) => d.source.treasureBag !== true && d.source.npcName === boss.name)
    const rows: DropRow[] = list
      .map((drop): DropRow => {
        const base = { drop, item, bag: drop.source.treasureBag === true }
        if (base.bag) return { ...base, role: 'bag' }
        if (drop.source.npcName === boss.name) return { ...base, role: 'boss' }
        const part = hasBossRow ? segmentOf(drop.source.npcName) : undefined
        return part ? { ...base, role: 'segment', part } : { ...base, role: 'variant' }
      })
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || npcOrder(a.drop) - npcOrder(b.drop) || a.drop.source.npcName.localeCompare(b.drop.source.npcName) || a.drop.id.localeCompare(b.drop.id))
    const treasureBag = !conditional && rows.some((r) => !r.bag && bagNames.has(item.name))
    const equipment = item.kind === 'weapon' || item.kind === 'accessory' || item.kind === 'armor'
    const onlyThisBoss = [...(droppers.get(item.id) ?? [])].every((id) => id === boss.id)
    const tier: DropTier = conditional ? 'conditional' : treasureBag || equipment || (onlyThisBoss && !stackable(rows)) ? 'rewards' : 'materials'
    tiers[tier].push({ item, tier, rows, treasureBag, topRate: topRateOf(rows), segmented: rows.some((r) => r.role === 'segment') })
  }

  const byName = (a: DropGroup, b: DropGroup) => a.item.name.localeCompare(b.item.name) || a.item.id - b.item.id
  tiers.rewards.sort((a, b) => Number(b.treasureBag) - Number(a.treasureBag) || b.topRate - a.topRate || byName(a, b))
  tiers.materials.sort((a, b) => b.topRate - a.topRate || byName(a, b))
  tiers.conditional.sort(byName)
  const rows = DROP_TIERS.flatMap((t) => tiers[t].flatMap((g) => g.rows))
  const own = rows.filter((r) => !r.bag)
  const sources = new Set(own.map((r) => r.drop.source.npcName))
  const commonSource = sources.size === 1 && own.every((r) => r.role === 'variant') ? own[0].drop.source.npcName : undefined
  return { tiers, rows, missing: loaded.length - records.length, ...(commonSource ? { commonSource } : {}) }
}

/** The boss's drop records as table rows, in display order (see bossDropSections). */
export function bossDropRows(boss: Boss, drops: DropIndex, itemOf: (id: number) => ItemInfo): { rows: DropRow[]; missing: number } {
  const { rows, missing } = bossDropSections(boss, drops, itemOf)
  return { rows, missing }
}

// --- curated fields -------------------------------------------------------------------------

export type CuratedList<T> = { status: 'curated'; entries: T[] } | { status: 'unknown' } | { status: 'none' }

/** A curated list field through getField: entries (editorial), Unknown (listed), or not applicable. */
export function curatedList<K extends 'prepChecklist' | 'strategies' | 'suggestedEquipment' | 'attackPatternTags'>(boss: Boss, field: K): CuratedList<NonNullable<Boss[K]>[number]> {
  const view = getField(boss, field)
  if (view.status === 'unverified') return { status: 'unknown' }
  if (view.status === 'not-applicable') return { status: 'none' }
  return { status: 'curated', entries: [...(view.value as NonNullable<Boss[K]>)] }
}

export interface PrepEntry {
  /** Persisted check-off id (prepChecklistStore.prepEntryId). */
  id: string
  text: string
  itemIds: number[]
  sourceUrl?: string
}

export function prepEntries(boss: Boss): CuratedList<PrepEntry> {
  const list = curatedList(boss, 'prepChecklist')
  if (list.status !== 'curated') return list
  return { status: 'curated', entries: list.entries.map((p) => ({ id: prepEntryId(p.text), text: p.text, itemIds: p.itemIds ?? [], sourceUrl: p.sourceUrl })) }
}

export type Strategy = NonNullable<Boss['strategies']>[number]
export const GEAR_CLASSES = ['melee', 'ranged', 'magic', 'summon'] as const
export type GearClass = (typeof GEAR_CLASSES)[number]

export interface StrategyGroups {
  /** Class-less tips for every difficulty — the page's "survival tips". */
  general: Strategy[]
  /** Class-less tips tagged with a difficulty (Expert / Master Mode). */
  byDifficulty: Strategy[]
  /** Class tips, per class tab (a class tip may also carry a difficulty). */
  byClass: Record<GearClass, Strategy[]>
}

export function strategyGroups(entries: readonly Strategy[]): StrategyGroups {
  const groups: StrategyGroups = { general: [], byDifficulty: [], byClass: { melee: [], ranged: [], magic: [], summon: [] } }
  for (const s of entries) {
    if (s.class && s.class !== 'other') groups.byClass[s.class].push(s)
    else if (s.difficulty) groups.byDifficulty.push(s)
    else groups.general.push(s)
  }
  return groups
}

export const CLASS_LABEL: Readonly<Record<GearClass, string>> = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summon' }
export const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = { classic: 'Classic Mode', expert: 'Expert Mode', master: 'Master Mode' }

/** Display names of the curated attack-pattern taxonomy (DATA_SCHEMA_SPEC §2.8). */
export const ATTACK_TAG_LABEL: Readonly<Record<AttackPatternTag, string>> = {
  charges: 'Charges',
  dashes: 'Dashes',
  flies: 'Flies',
  'ground-bound': 'Ground-bound',
  burrows: 'Burrows',
  teleports: 'Teleports',
  'projectile-spam': 'Projectile barrages',
  'homing-projectiles': 'Homing projectiles',
  'summons-adds': 'Summons minions',
  'inflicts-debuffs': 'Inflicts debuffs',
  'high-contact-damage': 'High contact damage',
  'multi-phase': 'Multiple phases',
  'enrage-mechanic': 'Can enrage',
  'despawn-leash': 'Can despawn',
}

export const TIME_LABEL: Readonly<Record<NonNullable<Boss['location']['time']>, string>> = {
  day: 'Daytime',
  night: 'Night',
  any: 'Any time',
  dusk: 'Dusk',
}

/**
 * The stated reason behind a declared Unknown (a `missing-field` stage gap of this boss + field,
 * written by the overlay author), without the boss-name prefix the gap log adds. Undefined when none.
 */
export function declaredGapReason(gaps: readonly GapEntry[] | undefined, boss: Pick<Boss, 'id' | 'name'>, field: string): string | undefined {
  const entry = gaps?.find((g) => g.ref === `boss:${boss.id}` && g.field === field && g.kind === 'missing-field')
  if (!entry) return undefined
  const prefix = `${boss.name}: `
  return entry.detail.startsWith(prefix) ? entry.detail.slice(prefix.length) : entry.detail
}

// --- suggested gear --------------------------------------------------------------------------

export type GearEntry = NonNullable<Boss['suggestedEquipment']>[number]

/** The curated gear entries for one class tab. */
export const gearFor = (entries: readonly GearEntry[], cls: GearClass): GearEntry[] => entries.filter((g) => g.class === cls)

/** Path of one class's gear (P5-S3 honest partial: listed in unverifiedFields = that class's gear is Unknown). */
export const gearClassField = (cls: GearClass) => `suggestedEquipment.${cls}`

/**
 * One class tab's gear while the boss's suggested gear is curated: its entries, Unknown (the class
 * is listed on its own path — no weapon both recommended by a quote and verified obtainable before
 * the fight), or nothing curated for it. While the whole field is not curated this is `none`: the
 * field's own Unknown (one block above the tabs) covers every class.
 */
export function classGear(boss: Boss, cls: GearClass): { status: 'curated'; entries: GearEntry[] } | { status: 'unknown' } | { status: 'none' } {
  const gear = curatedList(boss, 'suggestedEquipment')
  if (gear.status !== 'curated') return { status: 'none' }
  const entries = gearFor(gear.entries, cls)
  if (entries.length > 0) return { status: 'curated', entries }
  return getField(boss, gearClassField(cls)).status === 'unverified' ? { status: 'unknown' } : { status: 'none' }
}

// --- next steps -----------------------------------------------------------------------------

export interface NextSteps {
  /** What usually comes before this fight (for an either/or member: what comes before its pair). */
  before: Connection[]
  /** Either/or partners (Eater of Worlds / Brain of Cthulhu). */
  alternatives: Connection[]
  /**
   * Links out of this node; an either/or target lists its partners too. A milestone target (a world
   * change with no page: Hardmode after the Wall of Flesh) also lists what IT opens — its own links
   * out, ranked like these — so the page names the fights the marker leads to.
   */
  after: { connection: Connection; partners: MapNode[]; opens?: Connection[] }[]
  /**
   * A side branch (no links out): where the path it branched from continues — that node's
   * recommended-next / required-gate links, other than this node.
   */
  continueFrom?: { from: MapNode; next: Connection[] }
}

export function nextSteps(graph: MapGraph, nodeId: string): NextSteps {
  const own = connectionsOf(graph, nodeId)
  const group = graph.groups.find((g) => g.includes(nodeId))
  const before = own.before.length > 0 || !group ? own.before : connectionsOf(graph, group[0]).before
  const partnersOf = (id: string) => (graph.groups.find((g) => g[0] === id) ?? []).slice(1).flatMap((m) => graph.nodeById.get(m) ?? [])
  // Fights first, then events (each kind in step order).
  const KIND_ORDER = { boss: 0, event: 1, milestone: 2 } as const
  const opensOf = (node: MapNode) =>
    node.kind === 'milestone' ? { opens: rankSteps(graph, connectionsOf(graph, node.id).after).sort((a, b) => KIND_ORDER[a.other.kind] - KIND_ORDER[b.other.kind]) } : {}
  const after = rankSteps(graph, own.after).map((connection) => ({ connection, partners: partnersOf(connection.other.id), ...opensOf(connection.other) }))
  const steps: NextSteps = { before, alternatives: own.alternatives, after }
  if (after.length === 0) {
    const origin = before.find((c) => connectionsOf(graph, c.other.id).after.some((x) => x.other.id !== nodeId && isMainPath(x)))
    if (origin) {
      const next = rankSteps(
        graph,
        connectionsOf(graph, origin.other.id).after.filter((x) => x.other.id !== nodeId && isMainPath(x)),
      )
      steps.continueFrom = { from: origin.other, next }
    }
  }
  return steps
}

const isMainPath = (c: Connection) => c.link.types.includes('recommended-next') || c.link.types.includes('required-gate')

/** Edge types by how directly they say "do this next" (M1). */
const STEP_TYPE_RANK: Readonly<Record<EdgeType, number>> = { 'recommended-next': 0, 'required-gate': 1, 'early-challenge-possible': 2, optional: 3, 'alternative-route': 4 }

/**
 * Each node's depth along the progression: the longest chain of flow links leading to it (either/or
 * partners share their group's depth). A far-downstream target (Skeletron → Lunatic Cultist, an
 * endgame fight it gates) is deep; the usual next fight (Wall of Flesh) is one step on. Cached per graph.
 */
const depthCache = new WeakMap<MapGraph, ReadonlyMap<string, number>>()
export function pathDepths(graph: MapGraph): ReadonlyMap<string, number> {
  const cached = depthCache.get(graph)
  if (cached) return cached
  const depth = new Map(graph.nodes.map((n) => [n.id, 0]))
  // Longest path by relaxation; at most one pass per node, so a cycle in bad data can't loop forever.
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let changed = false
    for (const l of graph.links) {
      const next = (depth.get(l.from) ?? 0) + 1
      if (next > (depth.get(l.to) ?? 0)) {
        depth.set(l.to, next)
        changed = true
      }
    }
    for (const g of graph.groups) {
      const shared = Math.max(...g.map((id) => depth.get(id) ?? 0))
      for (const id of g) {
        if (depth.get(id) !== shared) {
          depth.set(id, shared)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  depthCache.set(graph, depth)
  return depth
}

/**
 * "After this fight" order (M1): steps that are only optional last; otherwise the nearest step first
 * (path depth), then the most direct edge type (recommended next before a required gate), then name.
 */
export function rankSteps(graph: MapGraph, connections: readonly Connection[]): Connection[] {
  const depth = pathDepths(graph)
  const optionalOnly = (c: Connection) => c.link.types.every((t) => t === 'optional')
  const rank = (c: Connection) => Math.min(...c.link.types.map((t) => STEP_TYPE_RANK[t]))
  return [...connections].sort(
    (a, b) =>
      Number(optionalOnly(a)) - Number(optionalOnly(b)) ||
      (depth.get(a.other.id) ?? 0) - (depth.get(b.other.id) ?? 0) ||
      rank(a) - rank(b) ||
      a.other.name.localeCompare(b.other.name),
  )
}

/**
 * The relation in plain words (M1), one phrase per edge type of the link. `before`: the other node
 * comes before this fight; `after`: this fight comes before the other node.
 */
export function stepPhrase(types: readonly EdgeType[], direction: 'before' | 'after', names: { self: string; other: string }): string {
  const phrase = (t: EdgeType): string => {
    switch (t) {
      case 'recommended-next':
        return direction === 'before' ? `Usually fought after ${names.other}` : 'Usually fought next'
      case 'required-gate':
        return direction === 'before' ? `Needs ${names.other} first` : `Needs ${names.self} defeated first`
      case 'optional':
        return direction === 'before' ? `Optional side fight, from ${names.other} on` : 'Optional'
      case 'early-challenge-possible':
        return 'Can be fought early, at a much harder difficulty'
      case 'alternative-route':
        return 'Either this or the other'
    }
  }
  return [...new Set(types.map(phrase))].join(' · ')
}

// --- guides ---------------------------------------------------------------------------------

/**
 * Guides with curated, per-class weapon suggestions for one boss — what the boss page can't offer
 * while its suggested gear, or one class's, is Unknown (M3; AMENDMENTS-015 B91(a): the starter-tier
 * fights, the Eye of Cthulhu and its optional alternative King Slime, both covered by the first-boss
 * guide). Editorial cross-links; bossPage.test checks that each guide exists under this title and
 * covers the boss.
 */
export const BOSS_PREP_GUIDES: Readonly<Record<string, { slug: string; title: string }>> = {
  'eye-of-cthulhu': { slug: 'first-boss-prep', title: 'Preparing for your first boss' },
  'king-slime': { slug: 'first-boss-prep', title: 'Preparing for your first boss' },
}

export function prepGuideFor(bossId: string): { title: string; to: string } | undefined {
  const guide = BOSS_PREP_GUIDES[bossId]
  return guide ? { title: guide.title, to: guideHref(guide.slug) } : undefined
}

// --- unknowns -------------------------------------------------------------------------------

export interface PageUnknown {
  key: string
  label: string
  count?: number
}

export const STAT_DIFFICULTIES = ['classic', 'expert', 'master'] as const
export const STAT_KEYS = ['hp', 'defense', 'contactDamage'] as const

/** Field path of one stat cell. */
export const statField = (difficulty: (typeof STAT_DIFFICULTIES)[number], key: (typeof STAT_KEYS)[number]) => `statsByDifficulty.${difficulty}.${key}`

/**
 * The stats are the boss's BASE stats, i.e. its first form's (the dataset's stat rule). That caveat
 * only means something for a boss that changes form mid-fight — one whose curated attack patterns
 * include multiple phases (Eye of Cthulhu, Plantera, …); for any other boss it would be noise (B82).
 */
export function isMultiForm(boss: Boss): boolean {
  const tags = curatedList(boss, 'attackPatternTags')
  return tags.status === 'curated' && tags.entries.includes('multi-phase')
}

/**
 * How the stats panel reads (H1): `none` when not one value is verified — one honest line with the
 * stated reason (a `missing-field` gap on `statsByDifficulty`, when the gap log carries one) instead
 * of a grid of nine Unknown cells; otherwise the table.
 */
export type StatsView = { kind: 'none'; reason?: string } | { kind: 'table'; unknownCells: number }

export function statsView(boss: Boss, gaps: readonly GapEntry[] | undefined): StatsView {
  const cells = STAT_DIFFICULTIES.flatMap((d) => STAT_KEYS.map((k) => getField(boss, statField(d, k)).status))
  if (cells.every((s) => s === 'unverified')) return { kind: 'none', reason: declaredGapReason(gaps, boss, 'statsByDifficulty') }
  return { kind: 'table', unknownCells: cells.filter((s) => s === 'unverified').length }
}

/**
 * Every Unknown marker the page renders, in page order (for the partially-verified badge, UX_SPEC
 * §5.3: the count matches the page). Keep in step with BossPageView / ClassGear / BossDrops.
 */
export function bossPageUnknowns(boss: Boss, rows: readonly DropRow[]): PageUnknown[] {
  const out: PageUnknown[] = []
  const unknown = (path: string) => getField(boss, path).status === 'unverified'
  if (unknown('stage')) out.push({ key: 'stage', label: 'Game stage' })
  if (unknown('summon.text')) out.push({ key: 'summon', label: 'How to summon' })
  if (unknown('location.biomes')) out.push({ key: 'biomes', label: 'Where it is fought' })
  if (unknown('location.time')) out.push({ key: 'time', label: 'When — time of day' })
  if (unknown('prepChecklist')) out.push({ key: 'prepChecklist', label: 'Prep checklist' })
  if (unknown('suggestedEquipment')) out.push({ key: 'suggestedEquipment', label: 'Suggested gear' })
  // Curated gear with a class left Unknown: one marker in that class's tab.
  for (const cls of GEAR_CLASSES) if (classGear(boss, cls).status === 'unknown') out.push({ key: gearClassField(cls), label: `Suggested ${CLASS_LABEL[cls].toLowerCase()} gear` })
  // An Unknown strategies field shows in the patterns panel and in each class tab.
  if (unknown('strategies')) out.push({ key: 'strategies', label: 'Survival and class tips', count: 1 + GEAR_CLASSES.length })
  if (unknown('attackPatternTags')) out.push({ key: 'attackPatternTags', label: 'Attack patterns' })
  const drops = rows.reduce((n, r) => n + dropRowUnknowns(r.drop), 0)
  if (drops > 0) out.push({ key: 'drops', label: 'Drops — chance, quantity or conditions', count: drops })
  // All-Unknown stats render as ONE line (one marker); a partial table marks each Unknown cell.
  const stats = statsView(boss, undefined)
  if (stats.kind === 'none') out.push({ key: 'stats', label: 'Stats' })
  else if (stats.unknownCells > 0) out.push({ key: 'stats', label: 'Stats', count: stats.unknownCells })
  return out
}
