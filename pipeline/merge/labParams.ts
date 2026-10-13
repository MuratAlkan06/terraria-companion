/**
 * P3-S0 — Weapon Lab archetype params: classification, derivation, article screen, curated overlay,
 * per-archetype coverage (AMENDMENTS-001 A3; DATA_SCHEMA_SPEC §2.4 ArchetypeParams). Extended by the
 * B48 coverage-expansion slice (AMENDMENTS-010 B44–B49): reuse delay in the sim cadence, thrust reach
 * (B46), slight spread (B47), per-projectile damage multipliers, DoT from the infobox, modeledFields (B49).
 *
 * PARAM SEMANTICS ARE BINDING as documented in src/sim/README.md ("Param semantics" and "Cadence";
 * AMENDMENTS-008 B37): `ProjectileSpec.pierce` = extra dummies passed through AFTER the first hit
 * (0/absent = stops at the first); `projectilesPerUse` = projectiles per ACTIVATION (shot) within one
 * attack — bursts come from useTime < useAnimation, never from projectilesPerUse; an ammo projectile's
 * speed comes only from the ammo's velocityBonusTps / velocityMultiplier (bow-gun params carry no
 * speed); magic-bolt speed is `params.projectile.velocityTps`, never `weapon.shootSpeedTps`.
 *
 * FAMILY (denominator of the coverage report) = the wiki's own weapon-type category of the weapon's
 * article (FAMILY_CATEGORIES), so coverage is not defined by what the Lab happens to simulate.
 *
 * CLASSIFICATION SIGNALS (all verifiable; checked per weapon):
 * - Module:Iteminfo/data `useStyle`, quoted from the wiki's "Use Style IDs" article: 1 = Swing ("…
 *   broadswords"), 5 = Shoot ("Most ranged and magic weapons, yoyos, spears…"), 13 = Rapier
 *   ("Shortswords…"); `noMelee` (the item itself deals no contact damage), `channel` (held use),
 *   `shoot` (projectile ID), `useAmmo` (ammo class), `mana`, class flags.
 * - Module:Projectileinfo/data of the `shoot` projectile: `penetrate`, `extraUpdates`.
 * - The weapon's own item infobox (rendered article): "Internal Projectile ID" / "Internal Buff ID".
 * - Cargo Items `debuffs` (on-hit debuffs) and the tooltip (Weapon.behaviorText).
 *
 * DERIVED PARAMS (formula + inputs recorded per weapon in the coverage report). Params taken from a
 * MODELING CONVENTION (src/schemas MODELING_CONVENTIONS) are listed in `_prov.modeledFields` (B49) and
 * labeled in the Lab — never presented as game data:
 * - swing-melee `reachTiles` = √(w² + h²) × scale ÷ 16 — w×h = the item's wiki sprite (imageinfo,
 *   SHA-1 pinned), scale = Iteminfo `scale`: the drawn blade's diagonal at the item's scale.
 *   MODELING CONVENTION (AMENDMENTS-010 B44): the wiki documents no swing reach (checked: Swords, Melee
 *   weapons, Modifiers articles); the swing itself is the sim's labeled `swing-geometry` approximation.
 * - swing-melee `arcDegrees` = 180 — the wiki states "broadswords are swung over the player's head"
 *   (Swords article); the sim's swing is centered on the facing direction (README swing-geometry),
 *   and 180° is the smallest such arc that reaches straight over the head. Same convention (B44).
 * - thrust `reachTiles` = √(w² + h²) × scale ÷ 16 + 1 (tile of arm extension) — MODELING CONVENTION
 *   (AMENDMENTS-010 B46), same sprite/scale inputs as B44. A thrust weapon is a melee item with use
 *   style Rapier (13, "Shortswords") or Shoot (5, "…spears…") whose Iteminfo `shoot` projectile is the
 *   stab itself — Projectileinfo names it after the weapon (Spear → projectile 49 "Spear"); other
 *   projectiles (infobox / Iteminfo) are screen flags. Held (`channel`) stabs are not plain thrusts.
 *   B46 rests on the reach being UNDOCUMENTED, so it applies only where the article states no range.
 * - thrust `reachTiles` = N where the weapon's article states "maximum range of approximately N tiles"
 *   (AMENDMENTS-012 B56) — an EXTRACTED wiki value (normal article provenance, not in modeledFields),
 *   its sentence checked verbatim on the cached article revision. The coverage report keeps the B46
 *   convention-vs-stated table as a calibration record.
 * - bow-gun `ammoClass` = Weapon.ammoClass (Iteminfo `useAmmo`).
 * - bow-gun `spreadDegrees` = 10 for a gun whose article says it fires at a "slight" / "small" spread
 *   and states no angle — MODELING CONVENTION (AMENDMENTS-010 B47), set only by a reviewed overlay entry
 *   (`slightSpread: true`) whose quote says so. Unstated non-slight spreads stay limitations.
 * - magic-bolt `projectile.velocityTps` = Iteminfo `shootSpeed` × (1 + Projectileinfo `extraUpdates`)
 *   × 60/16 — the wiki's Velocity article: extra updates multiply the distance moved per tick;
 *   cross-checked against the item infobox "Velocity" row (the wiki's effective velocity), a
 *   disagreement → limitation.
 * - magic-bolt `projectile.pierce` = Projectileinfo `penetrate` − 1 (−1 = "infinite").
 * - single projectile, no spread, ammo fired unchanged (bow-gun / magic-bolt defaults): ONLY when the
 *   ARTICLE SCREEN is clean. The screen reads the weapon's own article revision (lead and behavior
 *   sections — not crafting / history / trivia / navigation boxes), its tooltip, its infobox and the
 *   data-module signals above, and flags any statement of behavior the archetype params cannot
 *   express (several projectiles, spread/inaccuracy, ammo conversion, homing, bouncing, piercing,
 *   on-hit effects, spawned projectiles, conditional damage, non-straight motion, charged/held or
 *   alternate use). A flagged weapon is NEVER auto-parameterized: it stays a limitation unless the
 *   curated overlay (pipeline/overlays/lab-params.json) records a reviewed decision with verbatim
 *   quotes (checked against the cached article revision) — residual params come only from there
 *   (bow-gun: projectilesPerUse, spreadDegrees or slightSpread (B47), inheritsAmmoProjectile;
 *   magic-bolt: projectilesPerUse, spreadDegrees, pierce, lifetimeTicks, damageMultiplierPct — each
 *   value must be stated by one of the entry's quotes).
 * - magic-bolt `projectile.damageMultiplierPct` (AMENDMENTS-010 B48(b)): only from a reviewed entry
 *   whose quote states "<n>% of the weapon's damage"; a quoted "(<m> base damage)" must equal
 *   ⌊damage × n / 100⌋ (the sim's rounding).
 * - `modifiers.dot` (B48(c)) from the weapon's own infobox debuff rows ("Debuff" / "Chance" /
 *   "Duration"; a duration range is AMENDMENTS-002 B5's {minTicks, maxTicks} union), when the debuff is
 *   in the buff registry with a verified damage per second, it is the weapon's only debuff and Cargo
 *   `debuffs` / the infobox buff ID agree. A damaging debuff that cannot be derived that way makes the
 *   weapon a limitation (its damage over time would be missing); a debuff without damage over time
 *   adds no modifier and stays a screen flag (reviewed, e.g. Confused).
 * - Iteminfo `reuseDelay` (Weapon.reuseDelayTicks) is part of the sim cadence since B48(a) (wiki Use
 *   time: "reuseDelay is applied after the itemAnimation counter turns to zero"); before, it forced a
 *   limitation because the simulated attack rate would have been overstated.
 *
 * GUARD CONTRACT: every candidate is run through the sim's own `assessWeapon` (src/sim, pure TS). A
 * candidate blocked by an unverified field the pipeline rule covers (`simRequiredWeaponFields`,
 * AMENDMENTS-008 B36) keeps its params here so the validate stage's §2.1-3 downgrade applies (visible
 * as W_LAB_DOWNGRADE); any other refusal becomes a limitation now, so no emitted weapon reaches the
 * Lab as a generic refusal.
 */
import { assessWeapon } from '../../src/sim'
import { ArchetypeParams, getField, modelingConventionFor, type Buff, type LabBehavior, type LabModifiers, type ProvSource, type SpriteManifestFile, type Weapon } from '../../src/schemas'
import { articleText, normalizeQuote, type Article } from '../fetch/articles'
import { itemTypeIncludes, type CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import { wikiPageUrl } from '../fetch/config'
import { findAll, hasClass, parseHtml, rawText, type HNode } from '../parse/html'
import { infoboxForItem, parseItemInfoboxes, type BuffIdRow, type ItemInfobox } from '../parse/infobox'
import type { Iteminfo } from '../parse/iteminfo'
import type { Projectileinfo } from '../parse/projectileinfo'
import { slugify, stripMarkup } from '../parse/text'
import { blockingUnverifiedFields, limitation } from '../validate/labDowngrade'
import { Evidence } from './evidence'
import type { LabParamsEntry, LabParamsOverlay } from './overlays'
import { isoDate, moduleSource } from './prov'
import { OverlayError } from './registry'

/** Archetypes the sim implements (src/sim IMPLEMENTED_ARCHETYPES) that P3-S0 parameterizes. */
export const LAB_FAMILIES = ['swing-melee', 'thrust', 'bow-gun', 'magic-bolt'] as const
export type LabFamily = (typeof LAB_FAMILIES)[number]

/**
 * Family = the wiki's own weapon-type categories (independent of what the Lab can simulate, so the
 * coverage percentage is not circular). Verified 2026-10-13 (prop=categorymembers): Broadswords 75,
 * Shortswords 12, Spears 20, Bows 34, Repeaters 10, Guns 26, Wands 42, Magic guns 13, Spell books 10.
 */
export const FAMILY_CATEGORIES: Record<LabFamily, readonly string[]> = {
  'swing-melee': ['Category:Broadswords'],
  thrust: ['Category:Shortswords', 'Category:Spears'],
  'bow-gun': ['Category:Bows', 'Category:Repeaters', 'Category:Guns'],
  'magic-bolt': ['Category:Wands', 'Category:Magic guns', 'Category:Spell books'],
}

/** Family of a weapon from its category tags (Weapon.tags = slugs of its article's categories). */
export function familyOf(tags: readonly string[]): LabFamily | undefined {
  for (const family of LAB_FAMILIES) {
    if (FAMILY_CATEGORIES[family].some((c) => tags.includes(slugify(c.replace(/^Category:/, ''))))) return family
  }
  return undefined
}

/**
 * Rule quotes: verbatim excerpts of mechanics articles, checked against the cached revision on every
 * build (merge/evidence.ts) — the derivation rules above cite them.
 */
export const RULE_QUOTES = {
  useStyleSwing: { page: 'Use Style IDs', quote: 'Swing Most usable items, including blocks, background walls and broadswords' },
  useStyleShoot: { page: 'Use Style IDs', quote: 'Shoot Most ranged and magic weapons, yoyos, spears, launched flails' },
  useStyleRapier: { page: 'Use Style IDs', quote: 'Rapier Shortswords, Starlight' },
  swingOverHead: { page: 'Broadswords', quote: "broadswords are swung over the player's head" },
  extraUpdates: { page: 'Velocity', quote: 'It determines how many times the projectile moves by its listed velocity in each tick.' },
  tilesPerSecond: { page: 'Velocity', quote: 'this is equivalent to a speed of 3.75 tiles/second' },
  reuseDelay: { page: 'Use time', quote: 'reuseDelay is applied after the itemAnimation counter turns to zero.' },
} as const

/** Mechanics articles the derivation rules quote (fetched with the family articles). */
export const LAB_RULE_PAGES = [...new Set(Object.values(RULE_QUOTES).map((q) => q.page))]

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** Articles of every Cargo weapon row whose page is in a family category (evidence for the screen + overlay). */
export function labFamilyPages(tree: CategoryTree, itemRows: readonly CargoRow[]): string[] {
  const familyPages = new Set(Object.values(FAMILY_CATEGORIES).flatMap((cats) => cats.flatMap((c) => tree.categories.get(c)?.pages ?? [])))
  const weaponPages = new Set(itemRows.filter((r) => itemTypeIncludes(r, 'weapon')).map((r) => str(r._page)))
  return [...familyPages].filter((p) => weaponPages.has(p)).sort()
}

// ---------------------------------------------------------------------------------------------
// Article screen
// ---------------------------------------------------------------------------------------------

/** Sections that describe acquisition, history or unrelated items — not the weapon's current behavior. */
const SKIPPED_SECTIONS = /^(?:contents|crafting|recipes|used in|obtained from|sold by|drops?|trivia|history|references|footnotes|gallery|see also|achievements?|immune npcs|sounds|bugs|glitches|others?|related items?)$/i

/** Plain text of the weapon-behavior parts of an article: the lead and every section not skipped (p / lists only). */
export function behaviorText(html: string): string {
  const out: string[] = []
  let skipping = false
  const visit = (nodes: readonly HNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'el') continue
      if (/^h[2-6]$/.test(n.tag)) {
        if (n.tag === 'h2') skipping = SKIPPED_SECTIONS.test(stripMarkup(rawText(findAll(n.children, (c) => hasClass(c, 'mw-headline')))))
        continue
      }
      if (hasClass(n, 'mw-parser-output')) {
        visit(n.children)
        continue
      }
      if (skipping || !['p', 'ul', 'ol', 'dl'].includes(n.tag)) continue
      const keep = (list: readonly HNode[]): HNode[] =>
        list.flatMap((c): HNode[] => {
          if (c.type !== 'el') return [c]
          if (c.tag === 'table' || c.tag === 'sup' || hasClass(c, 'reference')) return []
          return [{ ...c, children: keep(c.children) }]
        })
      const text = articleText(rawText(keep([n])).replace(/\n/g, ' '))
      if (text !== '') out.push(text)
    }
  }
  visit(parseHtml(html))
  return normalizeQuote(out.join(' '))
}

export interface ScreenRule {
  id: string
  /** Plain-language label (limitation reasons, report). */
  label: string
  re: RegExp
  families: readonly LabFamily[]
}

const ALL: readonly LabFamily[] = LAB_FAMILIES
const PROJECTILE_FAMILIES: readonly LabFamily[] = ['bow-gun', 'magic-bolt']

/**
 * High-recall screen: a match only routes the weapon to curation; it never assigns a value. Terms are
 * matched on the behavior text + tooltip (case-insensitive).
 */
export const SCREEN_RULES: readonly ScreenRule[] = [
  {
    id: 'projectile',
    label: 'fires or creates projectiles',
    re: /\b(?:projectiles?|beams?|bolts?|shoots?|shooting|fires?|firing|throws?|launch\w*)\b/i,
    families: ['swing-melee', 'thrust'],
  },
  {
    id: 'multi-projectile',
    label: 'several projectiles per shot',
    re: /\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|multiple|several|burst|volleys?|at once|at a time|split\w*|clones?|copies)\b|\b\d+\s+(?:\w+\s+)?(?:arrows|bullets|projectiles|bolts|shots|stars|beams|lasers|darts|bees|bats|leaves|needles|bubbles|feathers|skulls|flames|blasts)\b/i,
    families: PROJECTILE_FAMILIES,
  },
  { id: 'spread', label: 'spread or randomized aim', re: /\b(?:spread\w*|inaccura\w*|accura\w*|random\w*|deviat\w*|scatter\w*|cone)\b/i, families: PROJECTILE_FAMILIES },
  { id: 'conversion', label: 'converts or replaces its ammunition', re: /\b(?:convert\w*|transform\w*|replac\w*|instead of|turns? \w+ (?:\w+ )?into)\b/i, families: PROJECTILE_FAMILIES },
  { id: 'homing', label: 'homing', re: /\bhom(?:e|es|ing)\b|\bseek\w*|\btrack\w*/i, families: PROJECTILE_FAMILIES },
  { id: 'bounce', label: 'bouncing', re: /\b(?:bounc\w*|ricochet\w*|rebound\w*)\b/i, families: PROJECTILE_FAMILIES },
  { id: 'pierce', label: 'piercing', re: /\b(?:pierc\w*|penetrat\w*|pass(?:es)? through)\b/i, families: PROJECTILE_FAMILIES },
  {
    id: 'on-hit',
    label: 'extra effects on hit',
    re: /\b(?:explo\w*|inflict\w*|debuffs?|heal(?:s|ed|ing)?|life ?steal\w*|restor\w*|stick\w*|stack\w*|chain\w*|on hit|upon hit|on contact|hitting|struck)\b/i,
    families: ALL,
  },
  { id: 'spawns', label: 'creates other projectiles or entities', re: /\b(?:spawn\w*|summon\w*|releas\w*|creat\w*|emit\w*|trails?|fragment\w*|shards?|sparks?)\b/i, families: ALL },
  {
    id: 'conditional-damage',
    label: 'damage that depends on conditions',
    // damage changes stated near the word "damage" (critical hits are modeled by the sim: not a flag)
    re: /\b(?:bonus|increas\w*|decreas\w*|reduc\w*|doubl\w*|tripl\w*|multipl\w*|scal\w*|boost\w*)\b(?:\W+\w+){0,5}?\W+damage\b|\bdamage\b(?:\W+\w+){0,5}?\W+(?:bonus|increas\w*|decreas\w*|reduc\w*|doubl\w*|tripl\w*|multipl\w*|scal\w*|boost\w*)\b|\b(?:more|less|extra|additional|bonus|double|triple) damage\b/i,
    families: ALL,
  },
  {
    id: 'motion',
    label: 'non-straight projectile motion',
    re: /\b(?:gravity|falls?|falling|arcs?|arcing|curv\w*|accelerat\w*|decelerat\w*|slows? down|speeds? up|from the sky|from above|orbit\w*|spins?|spinning|returns?|returning|boomerang\w*|wav\w*|zigzag\w*|spiral\w*)\b/i,
    families: PROJECTILE_FAMILIES,
  },
  {
    id: 'special-use',
    label: 'charged, held or alternate use',
    re: /\b(?:charg\w*|channel\w*|hold\w*|held|right[- ]click\w*|(?:alternat\w*|secondary) (?:attack|fire|firing|use|function|mode|ability)|stealth)\b/i,
    families: ALL,
  },
]

export interface ScreenFlag {
  id: string
  /** What triggered it: the matched text, or the data signal. */
  evidence: string
}

export function screenText(family: LabFamily, text: string): ScreenFlag[] {
  const flags: ScreenFlag[] = []
  for (const rule of SCREEN_RULES) {
    if (!rule.families.includes(family)) continue
    const m = rule.re.exec(text)
    if (m) flags.push({ id: rule.id, evidence: `"${m[0]}"` })
  }
  return flags
}

export const SCREEN_LABEL: Record<string, string> = Object.fromEntries([
  ...SCREEN_RULES.map((r) => [r.id, r.label]),
  ['shoots-projectile', 'fires or creates projectiles'],
  ['infobox-projectile', 'fires or creates projectiles'],
  ['inflicts-debuff', 'extra effects on hit'],
  ['burst', 'several shots per use'],
])

// ---------------------------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------------------------

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round3 = (n: number) => Math.round(n * 1e3) / 1e3

/** Swing arc convention (see header): 180° = the smallest facing-centered arc reaching over the head. */
export const SWING_ARC_DEGREES = 180

/** swing-melee reach (tiles) from the wiki sprite and the Iteminfo scale (see header; AMENDMENTS-010 B44). */
export const swingReachTiles = (widthPx: number, heightPx: number, scale: number): number => round3((Math.hypot(widthPx, heightPx) * scale) / 16)

/** AMENDMENTS-010 B46: tiles of arm extension added to the thrust's sprite reach. */
export const THRUST_ARM_EXTENSION_TILES = 1

/** thrust reach (tiles): sprite diagonal × scale ÷ 16 + the arm extension (see header; AMENDMENTS-010 B46). */
export const thrustReachTiles = (widthPx: number, heightPx: number, scale: number): number =>
  round3((Math.hypot(widthPx, heightPx) * scale) / 16 + THRUST_ARM_EXTENSION_TILES)

/**
 * A range the article states in tiles ("The Spear has a maximum range of approximately 5.05 tiles.").
 * AMENDMENTS-012 B56: it is the thrust reach (quote-checked); B46 applies only where none is stated.
 */
export function statedRangeTiles(text: string): { tiles: number; quote: string } | undefined {
  const m = /[^.]*\b(?:maximum )?range of (?:approximately |about |roughly |around )?(\d+(?:\.\d+)?) tiles\b[^.]*/i.exec(text)
  return m ? { tiles: Number(m[1]), quote: m[0].trim() } : undefined
}

/** AMENDMENTS-010 B47: spread (degrees) of a gun whose article says "slight spread" without an angle. */
export const SLIGHT_SPREAD_DEGREES = 10

/** A quote saying the weapon fires at a slight / small spread and stating no angle (B47). */
export const statesSlightSpread = (quote: string): boolean => /\b(?:slight|small)\s+spread\b/i.test(quote) && !/\d\s*(?:°|degrees?\b)/i.test(quote)

/** A quote stating a per-projectile damage percentage ("deals 50% of the weapon's damage"). */
export const statesDamagePct = (quote: string, pct: number): boolean =>
  new RegExp(`(?:^|[^\\d.])${pct}% of (?:the weapon's |its |the )?(?:base )?damage`, 'i').test(quote)

// ---------------------------------------------------------------------------------------------
// Damage over time from the item infobox (AMENDMENTS-010 B48(c))
// ---------------------------------------------------------------------------------------------

export interface InfoboxDebuff {
  name: string
  chance?: string
  duration?: string
}

/** The infobox's debuff sections: a "Debuff" row followed by its "Debuff tooltip" / "Chance" / "Duration" rows. */
export function infoboxDebuffs(box: ItemInfobox | undefined): InfoboxDebuff[] {
  const out: InfoboxDebuff[] = []
  let current: InfoboxDebuff | undefined
  for (const r of box?.rows ?? []) {
    if (r.label === 'Debuff') {
      current = { name: r.value }
      out.push(current)
    } else if (current && r.label === 'Chance' && current.chance === undefined) current.chance = r.value
    else if (current && r.label === 'Duration' && current.duration === undefined) current.duration = r.value
    else if (r.label !== 'Debuff tooltip') current = undefined // the next infobox section starts
  }
  return out
}

/** "100%" → 100; anything else (fractions, ranges, words) → undefined. */
export function chancePctOf(value: string | undefined): number | undefined {
  const m = /^(\d+)%$/.exec((value ?? '').trim())
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined
}

/** "7 seconds" → 420; "1−4 seconds" / "4–5 seconds" → {minTicks, maxTicks} (B5); not whole ticks / other text → undefined. */
export function durationTicksOf(value: string | undefined): number | { minTicks: number; maxTicks: number } | undefined {
  const m = /^(\d+(?:\.\d+)?)(?:\s*[−–-]\s*(\d+(?:\.\d+)?))?\s*seconds?$/.exec((value ?? '').trim())
  if (!m) return undefined
  const ticks = (s: string): number | undefined => {
    const t = Math.round(Number(s) * 60)
    return t > 0 && Math.abs(t - Number(s) * 60) < 1e-9 ? t : undefined
  }
  const lo = ticks(m[1])
  if (lo === undefined) return undefined
  if (m[2] === undefined) return lo
  const hi = ticks(m[2])
  return hi === undefined || hi < lo ? undefined : hi === lo ? lo : { minTicks: lo, maxTicks: hi }
}

export type DotDerivation =
  | { kind: 'none' }
  | { kind: 'dot'; dot: NonNullable<LabModifiers['dot']>; text: string }
  /** The weapon's debuffs deal no damage over time (registry: no dot) — nothing to model, still a screen flag. */
  | { kind: 'no-dot'; names: string[] }
  | { kind: 'fail'; reason: string }

/**
 * DoT modifier from the weapon's infobox debuff rows, cross-checked with Cargo `debuffs` and the
 * infobox buff IDs, resolved through the buff registry (buffs.json). See the header for the rule.
 */
export function deriveDot(
  box: ItemInfobox | undefined,
  cargoDebuffs: readonly string[],
  buffs: readonly Buff[],
  buffTable: readonly Pick<BuffIdRow, 'id' | 'name' | 'isDebuff'>[],
): DotDerivation {
  const rows = infoboxDebuffs(box)
  // infobox buff IDs the wiki's Buff IDs table types "Buff" are granted to the player (e.g. Striking Moment), not inflicted
  const tableById = new Map(buffTable.map((r) => [r.id, r]))
  const ids = (box?.buffIds ?? []).filter((id) => tableById.get(id)?.isDebuff !== false)
  const byName = new Map(buffs.map((b) => [b.name, b]))
  const named = [...new Set([...rows.map((r) => r.name), ...cargoDebuffs])].map((name) => ({ name, buff: byName.get(name) }))
  const byId = ids.filter((id) => !named.some((n) => n.buff?.gameBuffId === id)).map((id) => {
    const buff = buffs.find((b) => b.gameBuffId === id)
    return { name: buff?.name ?? tableById.get(id)?.name ?? `buff ID ${id}`, buff }
  })
  const inflicted = [...named, ...byId]
  if (inflicted.length === 0) return { kind: 'none' }
  const damaging = inflicted.filter((x) => x.buff && getField(x.buff, 'dot.dps').status === 'verified')
  const unknown = inflicted.filter((x) => !x.buff || getField(x.buff, 'dot.dps').status === 'unverified')
  const list = inflicted.map((x) => x.name).join(', ')
  if (damaging.length === 0) {
    if (unknown.length > 0) return { kind: 'fail', reason: `whether ${unknown.map((x) => x.name).join(', ')} deals damage over time is not known (${unknown.some((x) => !x.buff) ? 'not in the buff registry' : 'its damage per second is unverified'})` }
    return { kind: 'no-dot', names: inflicted.map((x) => x.name) }
  }
  if (inflicted.length > 1) return { kind: 'fail', reason: `it inflicts several debuffs (${list}); the Lab models one damage-over-time debuff per weapon` }
  const buff = damaging[0].buff as Buff
  const row = rows.find((r) => r.name === buff.name)
  if (!row) return { kind: 'fail', reason: `the wiki infobox lists no chance and duration for ${buff.name}` }
  if (cargoDebuffs.length > 0 && (cargoDebuffs.length !== 1 || cargoDebuffs[0] !== buff.name)) return { kind: 'fail', reason: `the wiki infobox (${buff.name}) and the item data (${cargoDebuffs.join(', ')}) disagree about the debuff` }
  if (ids.length > 0 && (ids.length !== 1 || ids[0] !== buff.gameBuffId)) return { kind: 'fail', reason: `the infobox buff ID ${ids.join(', ')} is not ${buff.name}'s` }
  const chancePct = chancePctOf(row.chance)
  const durationTicks = durationTicksOf(row.duration)
  if (chancePct === undefined) return { kind: 'fail', reason: `the ${buff.name} chance "${row.chance ?? 'not stated'}" is not a whole percentage` }
  if (durationTicks === undefined) return { kind: 'fail', reason: `the ${buff.name} duration "${row.duration ?? 'not stated'}" is not a whole number of ticks` }
  const ticks = typeof durationTicks === 'number' ? `${durationTicks}` : `${durationTicks.minTicks}–${durationTicks.maxTicks}`
  return {
    kind: 'dot',
    dot: { buffId: buff.id, chancePct, durationTicks },
    text: `dot ${buff.name} (${buff.id}, ${buff.dot?.dps} HP/s): chance ${chancePct}%, duration "${row.duration}" = ${ticks} ticks (infobox debuff rows; Cargo debuffs / infobox buff ID agree)`,
  }
}

/** Effective projectile speed (tiles/s): shootSpeed px/tick × (1 + extraUpdates) × 60/16. */
export const projectileVelocityTps = (shootSpeedPxPerTick: number, extraUpdates: number): number => round6(shootSpeedPxPerTick * (1 + extraUpdates) * 3.75)

/** Projectileinfo `penetrate` → ProjectileSpec.pierce (B37: extra targets after the first). */
export function pierceFromPenetrate(penetrate: unknown): number | 'infinite' | undefined {
  if (penetrate === -1) return 'infinite'
  return typeof penetrate === 'number' && Number.isInteger(penetrate) && penetrate >= 1 ? penetrate - 1 : undefined
}

export type LabMethod = 'derived' | 'overlay' | 'limitation'

export interface LabDecision {
  id: number
  name: string
  family: LabFamily
  method: LabMethod
  /** Emitted archetype (method derived/overlay). */
  archetype?: LabFamily
  params?: ArchetypeParams
  /** Emitted modifiers (B48(c): damage over time from the infobox). */
  modifiers?: LabModifiers
  /** Param paths taken from a modeling convention (emitted as `_prov.modeledFields`, B49). */
  modeled?: string[]
  /** Screen + data flags (why a weapon needed curation). */
  flags: ScreenFlag[]
  /** How each param was obtained (report). */
  derivation: string[]
  /** Limitation reason (method limitation) — emitted. */
  reason?: string
  /** Short machine key for the limitation tally. */
  reasonKey?: string
  /** Fields the validate stage will downgrade on (pipeline rule incl. B36), when params were kept for it. */
  pipelineBlocked?: string[]
  /** thrust: the B46 convention reach vs the range the article states, if any (report: B56 calibration record). */
  thrustReach?: { conventionTiles: number; statedTiles?: number; quote?: string }
}

export interface LabBuildInput {
  weapons: readonly Weapon[]
  iteminfo: Iteminfo
  projectileinfo: Projectileinfo
  articles: ReadonlyMap<string, Article>
  evidence: Evidence
  /** Weapon item ID → its article (Cargo `_page`). */
  pageOf: ReadonlyMap<number, string>
  /** Weapon item ID → its Cargo Items row (debuffs column). */
  rows: ReadonlyMap<number, CargoRow>
  /** Weapon item ID → its sprite manifest entry (imageinfo width/height). */
  sprites: ReadonlyMap<number, SpriteManifestFile>
  /** The buff registry (buffs.json records): debuff names, game buff IDs, verified dot.dps (B48(c)). */
  buffs: readonly Buff[]
  /** The wiki's Buff IDs table (id → name, Buff/Debuff): tells inflicted debuffs from granted buffs in an infobox. */
  buffTable: readonly Pick<BuffIdRow, 'id' | 'name' | 'isDebuff'>[]
  overlay: LabParamsOverlay
}

export interface LabBuild {
  weapons: Weapon[]
  decisions: LabDecision[]
}

const isLabFamily = (a: string): a is LabFamily => (LAB_FAMILIES as readonly string[]).includes(a)

/** Number words a quote may use for a projectile count. */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const statesNumber = (quote: string, n: number) => new RegExp(`(?:^|[^\\d.])${n}(?![\\d.])`).test(quote) || new RegExp(`\\b${NUMBER_WORDS[n] ?? '\\u0000'}\\b`, 'i').test(quote)

export function buildLabParams(input: LabBuildInput): LabBuild {
  const { iteminfo: info, projectileinfo: proj, evidence } = input
  const projSrc = moduleSource('wiki-module', { title: proj.title, rev: proj.rev, fetchedAt: proj.fetchedAt })
  const overlayById = new Map(input.overlay.entries.map((e) => [e.itemId, e]))
  const weaponIds = new Set(input.weapons.map((w) => w.id))
  for (const e of input.overlay.entries) {
    if (!weaponIds.has(e.itemId)) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${e.itemId}: no emitted weapon has this item ID`)
  }
  // rule quotes: every derivation rule is backed by its quote on the cached article revision
  const rulePage = (key: keyof typeof RULE_QUOTES) => evidence.quote(RULE_QUOTES[key].page, RULE_QUOTES[key].quote, `lab-params rule ${key}`)
  const rules = Object.fromEntries((Object.keys(RULE_QUOTES) as (keyof typeof RULE_QUOTES)[]).map((k) => [k, rulePage(k)])) as Record<keyof typeof RULE_QUOTES, ReturnType<Evidence['page']>>
  const ruleSource = (p: ReturnType<Evidence['page']>): ProvSource => ({ kind: 'wiki-article', url: p.url, rev: p.rev, fetchedAt: isoDate(p.fetchedAt) })

  const decisions: LabDecision[] = []
  const weapons = input.weapons.map((w): Weapon => {
    const family = familyOf(w.tags)
    if (!family) return w
    const item = info.items.get(w.id)
    const s = (item?.stats ?? {}) as Record<string, unknown>
    const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined)
    const page = input.pageOf.get(w.id) ?? ''
    const article = input.articles.get(page)
    if (!article) throw new OverlayError(`[E_SCHEMA] lab-params: article "${page}" of ${w.name} was not fetched by the sync plan (run npm run pipeline:fetch)`)
    const articleSrc: ProvSource = { kind: 'wiki-article', url: wikiPageUrl(article.resolvedTitle), rev: article.revid, fetchedAt: isoDate(article.fetchedAt) }
    const decision: LabDecision = { id: w.id, name: w.name, family, method: 'limitation', flags: [], derivation: [] }
    decisions.push(decision)
    const entry = overlayById.get(w.id)
    if (entry && entry.name !== w.name) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: name "${entry.name}" ≠ weapon name "${w.name}"`)

    const asLimitation = (reasonKey: string, reason: string, extraSources: ProvSource[] = [], editorial = false): Weapon => {
      decision.method = 'limitation'
      decision.reason = reason
      decision.reasonKey = reasonKey
      return withLab(w, limitation(w, reason), [articleSrc, ...extraSources], editorial)
    }

    // ---- data signals + screen ----
    const useStyle = num('useStyle')
    const shoot = num('shoot') ?? 0
    const boxes = parseItemInfoboxes(article.html)
    const box = infoboxForItem(boxes, w.id)
    // thrust: the stab is the weapon's own projectile (Projectileinfo names it after the weapon), not an extra one
    const shootProjectile = shoot > 0 ? proj.projectiles.get(shoot) : undefined
    const stabId = family === 'thrust' && shootProjectile?.name === w.name ? shoot : undefined
    const flags: ScreenFlag[] = []
    if (family === 'swing-melee' || family === 'thrust') {
      if (shoot > 0 && shoot !== stabId) flags.push({ id: 'shoots-projectile', evidence: `Iteminfo shoot ${shoot}` })
      const extra = (box?.projectileIds ?? []).filter((id) => id !== stabId)
      if (extra.length > 0) flags.push({ id: 'infobox-projectile', evidence: `infobox projectile ${extra.join(', ')}` })
    }
    const cargoDebuffs = str(input.rows.get(w.id)?.debuffs).split('^').map((d) => stripMarkup(d).trim()).filter(Boolean)
    if (cargoDebuffs.length > 0) flags.push({ id: 'inflicts-debuff', evidence: `Cargo debuffs "${cargoDebuffs.join('^')}"` })
    else if (box && box.buffIds.length > 0) flags.push({ id: 'inflicts-debuff', evidence: `infobox buff ${box.buffIds.join(', ')}` })
    if (family !== 'swing-melee' && w.useTimeTicks !== undefined && w.useAnimationTicks !== undefined && w.useTimeTicks < w.useAnimationTicks) {
      flags.push({ id: 'burst', evidence: `useTime ${w.useTimeTicks} < useAnimation ${w.useAnimationTicks}` })
    }
    const text = behaviorText(article.html)
    flags.push(...screenText(family, text))
    if (w.behaviorText) for (const f of screenText(family, w.behaviorText.replace(/\n/g, ' '))) if (!flags.some((x) => x.id === f.id)) flags.push({ id: f.id, evidence: `tooltip ${f.evidence}` })
    decision.flags = flags
    const spriteOf = () => {
      const sprite = input.sprites.get(w.id)
      const scale = num('scale')
      return sprite && scale !== undefined && scale > 0 ? { sprite, scale } : undefined
    }
    // thrust family: the B46 reach vs any range the article states (report: calibration record, every thrust weapon)
    const thrustGeo = family === 'thrust' ? spriteOf() : undefined
    const statedRange = family === 'thrust' ? statedRangeTiles(text) : undefined
    if (thrustGeo) {
      const conventionTiles = thrustReachTiles(thrustGeo.sprite.width, thrustGeo.sprite.height, thrustGeo.scale)
      decision.thrustReach = { conventionTiles, ...(statedRange ? { statedTiles: statedRange.tiles, quote: statedRange.quote } : {}) }
    }

    // ---- overlay limitation decisions win (reviewed) ----
    if (entry?.decision === 'limitation') {
      const pages = checkEntryEvidence(entry, evidence, page)
      return asLimitation('overlay', entry.reason, pages.map((p) => Evidence.source('lab-params', p)), true)
    }

    // ---- hard requirements per family (never overridable: the data must carry them) ----
    const archetype: LabFamily = entry?.decision === 'archetype' ? entry.archetype : family
    if (archetype !== family && !isLabFamily(archetype)) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: unknown archetype`)
    const fail = (key: string, reason: string) => asLimitation(key, reason)
    const derivation: string[] = []
    const modeled: string[] = []
    let params: ArchetypeParams
    const sources: ProvSource[] = [articleSrc]
    switch (archetype) {
      case 'swing-melee': {
        if (useStyle !== 1 || s.noMelee === true || s.channel === true || w.damageClass !== 'melee') {
          return fail('not-swing', `Not simulated: the game data does not describe a plain swing for this weapon (use style ${useStyle ?? 'Unknown'}${s.noMelee === true ? ', the item itself deals no contact damage' : ''}${s.channel === true ? ', held use' : ''}), so the swing parameters would not represent it.`)
        }
        const geo = spriteOf()
        if (!geo) return fail('no-sprite', 'Not simulated: the swing reach is derived from the item sprite and scale, and the wiki has no sprite file or the game data no scale for this weapon.')
        const reachTiles = swingReachTiles(geo.sprite.width, geo.sprite.height, geo.scale)
        params = { archetype: 'swing-melee', arcDegrees: SWING_ARC_DEGREES, reachTiles }
        modeled.push('labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles')
        derivation.push(
          `reach √(${geo.sprite.width}²+${geo.sprite.height}²)×${geo.scale}÷16 = ${reachTiles} tiles (modeling convention AMENDMENTS-010 B44; sprite ${geo.sprite.wikiFileUrl}, Iteminfo scale)`,
          `arc ${SWING_ARC_DEGREES}° (modeling convention AMENDMENTS-010 B44; rule: "${RULE_QUOTES.swingOverHead.quote}")`,
        )
        sources.push({ kind: 'cargo:Imageinfo', url: geo.sprite.wikiFileUrl, fetchedAt: articleSrc.fetchedAt }, ruleSource(rules.useStyleSwing), ruleSource(rules.swingOverHead))
        break
      }
      case 'thrust': {
        if (w.damageClass !== 'melee' || (useStyle !== 13 && useStyle !== 5) || s.channel === true || stabId === undefined) {
          const why = s.channel === true ? 'held use' : useStyle !== 13 && useStyle !== 5 ? `use style ${useStyle ?? 'Unknown'}` : w.damageClass !== 'melee' ? 'not a melee weapon' : 'its projectile is not the stab itself'
          return fail('not-thrust', `Not simulated: the game data does not describe a plain stab for this weapon (${why}), so the thrust parameters would not represent it.`)
        }
        // AMENDMENTS-012 B56: a range the article states IS the reach — extracted wiki data, its sentence checked verbatim
        if (statedRange !== undefined) {
          evidence.quote(page, statedRange.quote, `lab-params ${w.name}: stated thrust range`)
          params = { archetype: 'thrust', reachTiles: statedRange.tiles }
          derivation.push(`reach ${statedRange.tiles} tiles = the range the article states: "${statedRange.quote}" (AMENDMENTS-012 B56; quote checked on rev ${article.revid}; stab = projectile #${shoot} "${shootProjectile?.name}")`)
          sources.push(projSrc, ruleSource(useStyle === 13 ? rules.useStyleRapier : rules.useStyleShoot))
          break
        }
        // B46 models the reach only where it is undocumented
        const geo = spriteOf()
        if (!geo) return fail('no-sprite', 'Not simulated: the thrust reach is derived from the item sprite and scale, and the wiki has no sprite file or the game data no scale for this weapon.')
        const reachTiles = thrustReachTiles(geo.sprite.width, geo.sprite.height, geo.scale)
        params = { archetype: 'thrust', reachTiles }
        modeled.push('labBehavior.params.reachTiles')
        derivation.push(
          `reach √(${geo.sprite.width}²+${geo.sprite.height}²)×${geo.scale}÷16 + ${THRUST_ARM_EXTENSION_TILES} = ${reachTiles} tiles (modeling convention AMENDMENTS-010 B46; sprite ${geo.sprite.wikiFileUrl}, Iteminfo scale; stab = projectile #${shoot} "${shootProjectile?.name}")`,
        )
        sources.push({ kind: 'cargo:Imageinfo', url: geo.sprite.wikiFileUrl, fetchedAt: articleSrc.fetchedAt }, projSrc, ruleSource(useStyle === 13 ? rules.useStyleRapier : rules.useStyleShoot))
        break
      }
      case 'bow-gun': {
        if (w.ammoClass === undefined || w.damageClass !== 'ranged' || useStyle !== 5 || s.channel === true || w.shootSpeedTps === undefined) {
          return fail('not-bow-gun', `Not simulated: the game data does not describe a plain ammo-firing weapon (${w.ammoClass === undefined ? 'no ammo class' : s.channel === true ? 'held use' : useStyle !== 5 ? `use style ${useStyle}` : 'no shoot speed'}), so the bow/gun parameters would not represent it.`)
        }
        params = { archetype: 'bow-gun', ammoClass: w.ammoClass, projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true }
        derivation.push(`ammoClass ${w.ammoClass} (Iteminfo useAmmo)`)
        sources.push(ruleSource(rules.useStyleShoot))
        break
      }
      case 'magic-bolt': {
        const p = shootProjectile
        const xu = p ? p.stats.extraUpdates : undefined
        const shootSpeed = num('shootSpeed')
        if (w.damageClass !== 'magic' || w.manaCost === undefined || s.channel === true || !p || typeof xu !== 'number' || shootSpeed === undefined || !(shootSpeed > 0)) {
          return fail('not-magic-bolt', `Not simulated: the game data does not describe a plain magic projectile for this weapon (${s.channel === true ? 'held use' : !p ? 'no projectile' : w.manaCost === undefined ? 'no mana cost' : 'no projectile speed'}), so the magic bolt parameters would not represent it.`)
        }
        const velocityTps = projectileVelocityTps(shootSpeed, xu)
        // cross-check: the item infobox "Velocity" row is the effective velocity (px/tick; "(effective)" when extra updates apply — Velocity article)
        const wikiVelocity = box?.rows.find((r) => r.label === 'Velocity')?.value
        const stated = wikiVelocity !== undefined ? Number(/^[\d,]+(?:\.\d+)?/.exec(wikiVelocity)?.[0]?.replaceAll(',', '')) : undefined
        if (stated !== undefined && Number.isFinite(stated) && Math.abs(stated - shootSpeed * (1 + xu)) > 1e-6) {
          return fail('velocity-mismatch', `Not simulated: the wiki states a projectile velocity of ${wikiVelocity}, while the game data gives ${shootSpeed} × ${1 + xu} — the sources disagree, so no speed is used.`)
        }
        const pierce = pierceFromPenetrate(p.stats.penetrate)
        params = { archetype: 'magic-bolt', projectilesPerUse: 1, spreadDegrees: 0, projectile: { velocityTps, ...(pierce !== undefined ? { pierce } : {}) } }
        derivation.push(
          `velocity ${shootSpeed}×(1+${xu})×3.75 = ${velocityTps} tiles/s (Iteminfo shootSpeed, Projectileinfo extraUpdates of ${p.name ?? p.internalName} #${shoot}; wiki infobox velocity ${wikiVelocity ?? 'not shown'})`,
          `pierce ${pierce ?? 'n/a'} (Projectileinfo penetrate ${String(p.stats.penetrate)})`,
        )
        sources.push(projSrc, ruleSource(rules.useStyleShoot), ruleSource(rules.extraUpdates), ruleSource(rules.tilesPerSecond))
        break
      }
    }
    if (w.reuseDelayTicks !== undefined) {
      derivation.push(`cadence includes the reuse delay: ${w.useAnimationTicks ?? '?'} + ${w.reuseDelayTicks} ticks (Iteminfo reuseDelay; rule: "${RULE_QUOTES.reuseDelay.quote}")`)
      sources.push(ruleSource(rules.reuseDelay))
    }

    // ---- damage over time from the infobox debuff rows (B48(c)) ----
    const dot = deriveDot(box, cargoDebuffs, input.buffs, input.buffTable)
    if (dot.kind === 'fail') return fail('dot-underivable', `Not simulated: this weapon inflicts a debuff, but ${dot.reason}, so its damage over time cannot be modeled.`)
    const modifiers: LabModifiers | undefined = dot.kind === 'dot' ? { dot: dot.dot } : undefined
    if (dot.kind === 'dot') derivation.push(dot.text)
    // a derived DoT modifier expresses the data flag; text flags still need a reviewer (B45: a human read)
    const open = dot.kind === 'dot' ? flags.filter((f) => f.id !== 'inflicts-debuff') : flags

    // ---- flagged → overlay decision required ----
    let editorial = false
    if (open.length > 0) {
      if (entry?.decision !== 'archetype') {
        return asLimitation(
          'flagged',
          `Not simulated yet: the wiki describes behavior beyond a plain ${FAMILY_NOUN[family]} (${[...new Set(open.map((f) => SCREEN_LABEL[f.id]))].join('; ')}) that has not been reviewed for the Lab.`,
        )
      }
      const pages = checkEntryEvidence(entry, evidence, page)
      const residual = applyResidual(params, entry, w)
      params = residual.params
      modeled.push(...residual.modeled)
      derivation.push(...residual.derivation, `overlay: ${entry.why}`)
      sources.push(...pages.map((pg) => Evidence.source('lab-params', pg)))
      editorial = true
    } else if (entry) {
      throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id} (${w.name}): the article screen is clean — the entry is not needed (residuals only)`)
    }
    const checked = ArchetypeParams.safeParse(params)
    if (!checked.success) throw new OverlayError(`[E_SCHEMA] lab-params ${w.name}: params fail the archetype schema: ${checked.error.issues.map((i) => i.message).join('; ')}`)
    for (const path of modeled) {
      if (!modelingConventionFor(archetype, path)) throw new OverlayError(`[E_SCHEMA] lab-params ${w.name}: modeled path ${path} has no ratified convention for ${archetype} (B49)`)
    }
    const lab: LabBehavior = { kind: 'archetype', params: checked.data, ...(modifiers ? { modifiers } : {}) }
    decision.params = checked.data
    decision.modifiers = modifiers
    decision.modeled = [...modeled].sort()
    decision.archetype = archetype
    decision.derivation = derivation
    decision.method = editorial ? 'overlay' : 'derived'
    const candidate = withLab(w, lab, sources, editorial, modeled)

    // ---- guard contract ----
    const pipelineBlocked = blockingUnverifiedFields(archetype, candidate._prov.unverifiedFields)
    if (pipelineBlocked.length > 0) {
      decision.pipelineBlocked = pipelineBlocked
      return candidate // validate's §2.1-3 downgrade (B36 incl.) turns it into a limitation, visibly
    }
    const verdict = assessWeapon(candidate)
    if (!verdict.simulable) {
      decision.params = undefined
      decision.modifiers = undefined
      decision.modeled = undefined
      decision.archetype = undefined
      return asLimitation(`guard:${verdict.refusal.reason}`, `required simulation parameter unverified: ${(verdict.refusal.fields ?? []).join(', ') || verdict.refusal.message}`)
    }
    return candidate
  })
  return { weapons, decisions }
}

const FAMILY_NOUN: Record<LabFamily, string> = { 'swing-melee': 'broadsword swing', thrust: 'stab', 'bow-gun': 'bow or gun shot', 'magic-bolt': 'magic bolt' }

/** Overlay quotes: verbatim on their page; the weapon's own article must be among them. */
function checkEntryEvidence(entry: LabParamsEntry, evidence: Evidence, ownPage: string) {
  const where = `overlay lab-params/i:${entry.itemId}`
  const pages = entry.evidence.map((x, i) => evidence.quote(x.page, x.quote, `${where} evidence ${i}`))
  if (!entry.evidence.some((x) => x.page === ownPage)) throw new OverlayError(`[E_SCHEMA] ${where}: no quote from the weapon's own article "${ownPage}"`)
  return pages
}

/** A quote stating the projectile's pierce in B37 terms (extra targets after the first). */
export function statesPierce(quote: string, pierce: number | 'infinite'): boolean {
  if (pierce === 'infinite') return /pierc\w* (?:an )?infinite(?:ly)?|pierc\w* (?:through )?(?:all|any number of)/i.test(quote)
  if (pierce === 0) return /\b(?:does not|do not|doesn't|don't|cannot|can't|not) pierce|\bnon-?piercing\b/i.test(quote)
  return /pierc/i.test(quote) && (statesNumber(quote, pierce) || (pierce === 1 && /\bonce\b/i.test(quote)) || (pierce === 2 && /\btwice\b/i.test(quote)))
}

/** A quote stating a lifetime in seconds (× 60) or ticks. */
export const statesLifetime = (quote: string, ticks: number): boolean =>
  [...quote.matchAll(/(\d+(?:\.\d+)?)\s*(seconds?|ticks?)\b/gi)].some((m) => (/^s/i.test(m[2]) ? Math.round(Number(m[1]) * 60) : Number(m[1])) === ticks)

/**
 * Residual params from a reviewed overlay entry. Every value must be stated by one of its quotes:
 * a count > 1 (number or number word), a spread > 0 (degrees) or a slight/small spread without an
 * angle (B47 convention → modeled), a pierce (B37 semantics), a lifetime, a damage percentage.
 */
function applyResidual(
  params: ArchetypeParams,
  entry: Extract<LabParamsEntry, { decision: 'archetype' }>,
  w: Weapon,
): { params: ArchetypeParams; modeled: string[]; derivation: string[] } {
  const where = `overlay lab-params/i:${w.id}`
  const quotes = entry.evidence.map((x) => x.quote)
  const stated = (test: (q: string) => boolean, what: string) => {
    if (!quotes.some(test)) throw new OverlayError(`[E_SCHEMA] ${where}: no quote states ${what}`)
  }
  const { projectilesPerUse: n, spreadDegrees: spread, slightSpread, inheritsAmmoProjectile: inherits, pierce, lifetimeTicks, damageMultiplierPct: pct } = entry
  const any = [n, spread, slightSpread, inherits, pierce, lifetimeTicks, pct].some((v) => v !== undefined)
  if (params.archetype !== 'bow-gun' && params.archetype !== 'magic-bolt') {
    if (any) throw new OverlayError(`[E_SCHEMA] ${where}: ${params.archetype} takes no residual params`)
    return { params, modeled: [], derivation: [] }
  }
  if (slightSpread && spread !== undefined) throw new OverlayError(`[E_SCHEMA] ${where}: slightSpread (B47) and spreadDegrees are exclusive`)
  if (n !== undefined && n > 1) stated((q) => statesNumber(q, n), `the projectile count ${n}`)
  if (spread !== undefined && spread > 0) stated((q) => statesNumber(q, spread) && /degree|°/i.test(q), `a spread of ${spread}°`)
  if (params.archetype === 'bow-gun') {
    if (pierce !== undefined || lifetimeTicks !== undefined || pct !== undefined) throw new OverlayError(`[E_SCHEMA] ${where}: bow-gun projectile shape and damage come from the ammo (B37)`)
    const modeled: string[] = []
    const derivation: string[] = []
    let spreadDegrees = spread
    if (slightSpread) {
      // AMENDMENTS-010 B47: guns only; the article says "slight" / "small" spread and states no angle
      if (!w.tags.includes('guns')) throw new OverlayError(`[E_SCHEMA] ${where}: the B47 slight-spread convention applies to guns (Category:Guns) only`)
      stated(statesSlightSpread, 'a slight or small spread without an angle (B47)')
      spreadDegrees = SLIGHT_SPREAD_DEGREES
      modeled.push('labBehavior.params.spreadDegrees')
      derivation.push(`spread ${SLIGHT_SPREAD_DEGREES}° (modeling convention AMENDMENTS-010 B47: the article says slight/small spread and states no angle)`)
    }
    return {
      params: { ...params, ...(n !== undefined ? { projectilesPerUse: n } : {}), ...(spreadDegrees !== undefined ? { spreadDegrees } : {}), ...(inherits !== undefined ? { inheritsAmmoProjectile: inherits } : {}) },
      modeled,
      derivation,
    }
  }
  if (inherits !== undefined) throw new OverlayError(`[E_SCHEMA] ${where}: magic-bolt has no ammo`)
  if (slightSpread) throw new OverlayError(`[E_SCHEMA] ${where}: the B47 slight-spread convention applies to guns only`)
  if (pierce !== undefined) stated((q) => statesPierce(q, pierce), `a pierce of ${pierce}`)
  if (lifetimeTicks !== undefined) stated((q) => statesLifetime(q, lifetimeTicks), `a lifetime of ${lifetimeTicks} ticks`)
  const derivation: string[] = []
  if (pct !== undefined) {
    // AMENDMENTS-010 B48(b): "<pct>% of the weapon's damage"; a quoted "(<m> base damage)" must match the sim's rounding
    stated((q) => statesDamagePct(q, pct), `that the projectile deals ${pct}% of the weapon's damage`)
    const base = Math.floor(((w.damage ?? 0) * pct) / 100)
    for (const q of quotes) {
      for (const m of q.matchAll(/\((\d+) base damage\)/g)) {
        if (Number(m[1]) !== base) throw new OverlayError(`[E_SCHEMA] ${where}: the quote states ${m[1]} base damage, but ⌊${w.damage} × ${pct}%⌋ = ${base}`)
      }
    }
    derivation.push(`projectile damage ${pct}% of ${w.damage} = ${base} (rounded down; quoted)`)
  }
  const projectile = { ...params.projectile, ...(pierce !== undefined ? { pierce } : {}), ...(lifetimeTicks !== undefined ? { lifetimeTicks } : {}), ...(pct !== undefined ? { damageMultiplierPct: pct } : {}) }
  return { params: { ...params, ...(n !== undefined ? { projectilesPerUse: n } : {}), ...(spread !== undefined ? { spreadDegrees: spread } : {}), projectile }, modeled: [], derivation }
}

/**
 * Replace labBehavior and add provenance (editorial = reviewed overlay decision, DATA_SCHEMA_SPEC §2.1
 * rule 4; modeled = params from a modeling convention, AMENDMENTS-010 B49).
 */
function withLab(w: Weapon, lab: LabBehavior, sources: readonly ProvSource[], editorial: boolean, modeled: readonly string[] = []): Weapon {
  const unique = new Map([...w._prov.sources, ...sources].map((s) => [`${s.kind}|${s.url}`, s]))
  const editorialFields = editorial ? [...new Set([...w._prov.editorialFields, 'labBehavior'])].sort() : w._prov.editorialFields
  const { modeledFields: previous, ...prov } = w._prov
  const modeledFields = [...new Set([...(previous ?? []).filter((p) => p !== 'labBehavior' && !p.startsWith('labBehavior.')), ...modeled])].sort()
  return { ...w, labBehavior: lab, _prov: { ...prov, sources: [...unique.values()], editorialFields, ...(modeledFields.length > 0 ? { modeledFields } : {}) } }
}

// ---------------------------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------------------------

export interface FamilyCoverage {
  family: LabFamily
  total: number
  derived: number
  overlay: number
  /** Kept params but the validate stage downgrades them (unverified core field; B36 incl.). */
  downgraded: number
  limitation: number
  simulable: number
  byReason: Map<string, number>
}

/** Per-family coverage after validation: `simulable` = emitted archetype weapons in the family. */
export function coverageByFamily(decisions: readonly LabDecision[], emitted: ReadonlyMap<number, Weapon>): FamilyCoverage[] {
  return LAB_FAMILIES.map((family) => {
    const ds = decisions.filter((d) => d.family === family)
    const byReason = new Map<string, number>()
    let downgraded = 0
    for (const d of ds) {
      const final = emitted.get(d.id)
      if (d.method !== 'limitation' && final?.labBehavior.kind !== 'archetype') downgraded += 1
      if (d.method === 'limitation') byReason.set(d.reasonKey ?? '?', (byReason.get(d.reasonKey ?? '?') ?? 0) + 1)
    }
    const simulable = ds.filter((d) => emitted.get(d.id)?.labBehavior.kind === 'archetype').length
    return {
      family,
      total: ds.length,
      derived: ds.filter((d) => d.method === 'derived').length,
      overlay: ds.filter((d) => d.method === 'overlay').length,
      downgraded,
      limitation: ds.filter((d) => d.method === 'limitation').length,
      simulable,
      byReason,
    }
  })
}
