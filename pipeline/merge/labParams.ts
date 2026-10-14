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
 * REMAINING-ARCHETYPE FAMILIES (P3-S0 extension): returning, whip, minion-sentry, explosive-aoe and
 * piercing-beam are derived by merge/labFamilies.ts (its header = their rules: stated values from
 * infobox rows, overview list tables, tooltips and verbatim sentences; derived values from data modules
 * + quoted family rules; reviewed overlay residuals; the AMENDMENTS-013 B63 modeling conventions — whip
 * arc P-1, summon attack rate P-2 / P-3, square blast area P-5 — recorded in `modeled` like B44/B46/B47;
 * a param no stated value or ratified convention supplies stays MISSING; the B63 P-6 AI-class taxonomy
 * is defined there). While an archetype is not in src/sim IMPLEMENTED_ARCHETYPES, complete params are
 * recorded on the decision (coverage report) and the weapon is emitted as a limitation whose reason
 * names what the Lab does not model (no forward promise); reviewed / flagged / incomplete reasons lead
 * with the same family sentence. The original four families are unchanged.
 *
 * NO FAMILY (no weapon-type category and no held-beam signal — e.g. consumable or ammo-driven uniques):
 * the weapon keeps the P2 default limitation card, unless the overlay records a reviewed `limitation`
 * entry for it — evidence-checked to the same standard as every entry (verbatim quotes on the cached
 * revision, the weapon's own article among them) — whose plain reason is then emitted (editorial).
 * Such a weapon takes no `archetype` entry (no family to parameterize) and no recorded extras (they
 * live on a family decision); it adds no coverage decision (the report counts it outside the families).
 *
 * LIMITATION CARD TEXT ("What it does in-game", UX_SPEC §8: verified BEHAVIOR text): the tooltip's
 * behavior lines — never its flavor-text quote line (src/schemas `tooltipBehavior`; validate
 * labDowngrade `limitation`) — else, for a card whose tooltip is flavor only, a reviewed overlay
 * `inGameBehavior` sentence of the weapon's own article (quote-checked, `withBehaviorSentences`), else
 * the wiki pointer (the card says "No verified description yet.").
 *
 * GUARD CONTRACT: every candidate is run through the sim's own `assessWeapon` (src/sim, pure TS). A
 * candidate blocked by an unverified field the pipeline rule covers (`simRequiredWeaponFields`,
 * AMENDMENTS-008 B36) keeps its params here so the validate stage's §2.1-3 downgrade applies (visible
 * as W_LAB_DOWNGRADE); any other refusal becomes a limitation now, so no emitted weapon reaches the
 * Lab as a generic refusal.
 */
import { assessWeapon, IMPLEMENTED_ARCHETYPES, type WeaponAssessment } from '../../src/sim'
import { ArchetypeParams, getField, modelingConventionFor, tooltipBehavior, type Archetype, type Buff, type LabBehavior, type LabModifiers, type ProvSource, type SpriteManifestFile, type Weapon } from '../../src/schemas'
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
import {
  deriveFamily,
  familyTables,
  isPendingFamily,
  missingSentence,
  pendingReason,
  recordedExtras,
  returningVariantOf,
  VARIANT_NOUN,
  type FamilyContext,
  type FamilyVariant,
  type PendingFamily,
  type RecordedExtras,
} from './labFamilies'
import type { LabParamsEntry, LabParamsOverlay } from './overlays'
import { isoDate, moduleSource } from './prov'
import { OverlayError } from './registry'

/**
 * Families P3-S0 parameterizes: every archetype of DATA_SCHEMA_SPEC §2.4. The first four are
 * implemented by the sim; the remaining-archetype slice (P3-S0 extension) adds returning, whip,
 * minion-sentry, explosive-aoe and piercing-beam, whose interpreters ship with the Lab (P3-S6–S11) —
 * see "PENDING INTERPRETERS" in the header. Order matters only for weapons in several family
 * categories (the first family wins; the four original families keep their weapons).
 */
export const LAB_FAMILIES = ['swing-melee', 'thrust', 'bow-gun', 'magic-bolt', 'returning', 'whip', 'minion-sentry', 'explosive-aoe', 'piercing-beam'] as const
export type LabFamily = (typeof LAB_FAMILIES)[number]

/**
 * Family = the wiki's own weapon-type categories (independent of what the Lab can simulate, so the
 * coverage percentage is not circular). Verified 2026-10-13 (prop=categorymembers): Broadswords 75,
 * Shortswords 12, Spears 20, Bows 34, Repeaters 10, Guns 26, Wands 42, Magic guns 13, Spell books 10;
 * Boomerangs 16, Flails 16, Yoyos 22, Whips 19, Minion summon items 27, Sentry summon items 11,
 * Explosives 19, Launchers 11 (article counts incl. each category's overview article).
 * piercing-beam has NO wiki category (the weapon-type tree has no beam / laser category): its family is
 * the data signal `isHeldBeamSignal` on weapons outside every category family (see there).
 */
export const FAMILY_CATEGORIES: Record<LabFamily, readonly string[]> = {
  'swing-melee': ['Category:Broadswords'],
  thrust: ['Category:Shortswords', 'Category:Spears'],
  'bow-gun': ['Category:Bows', 'Category:Repeaters', 'Category:Guns'],
  'magic-bolt': ['Category:Wands', 'Category:Magic guns', 'Category:Spell books'],
  returning: ['Category:Boomerangs', 'Category:Flails', 'Category:Yoyos'],
  whip: ['Category:Whips'],
  'minion-sentry': ['Category:Minion summon items', 'Category:Sentry summon items'],
  'explosive-aoe': ['Category:Explosives', 'Category:Launchers'],
  'piercing-beam': [],
}

/**
 * piercing-beam family signal (no wiki category exists): a magic or ranged weapon whose Iteminfo use
 * is held (`channel`) and that no weapon-type category places in another family — the channel-beam
 * identification signal. Membership is not simulability: each member still passes the beam checks
 * (held projectile + quoted beam behavior) or gets a specific limitation.
 */
export const isHeldBeamSignal = (stats: Readonly<Record<string, unknown>> | undefined): boolean =>
  stats !== undefined && stats.channel === true && (stats.magic === true || stats.ranged === true)

const categoryFamily = (tags: readonly string[]): LabFamily | undefined =>
  LAB_FAMILIES.find((family) => FAMILY_CATEGORIES[family].some((c) => tags.includes(slugify(c.replace(/^Category:/, '')))))

/**
 * Family of a weapon: its category tags (Weapon.tags = slugs of its article's categories); else the
 * piercing-beam data signal when the weapon's Iteminfo stats are given.
 */
export function familyOf(tags: readonly string[], stats?: Readonly<Record<string, unknown>>): LabFamily | undefined {
  return categoryFamily(tags) ?? (isHeldBeamSignal(stats) ? 'piercing-beam' : undefined)
}

/** Family overview articles (one per family category): the family rules quote them. */
export const LAB_FAMILY_PAGES = ['Boomerangs', 'Flails', 'Yoyos', 'Whips', 'Minion-summoning weapons', 'Sentry-summoning weapons', 'Explosives (class)', 'Launchers'] as const

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
  // remaining-archetype families (merge/labFamilies.ts header)
  yoyoThrown: { page: 'Yoyos', quote: "Yoyos are melee weapons that are thrown when used, seeking the player's cursor for a certain amount of time." },
  yoyoString: { page: 'Yoyos', quote: 'Yoyos normally have a limited range, being visually attached to the player via string.' },
  boomerangReturn: { page: 'Boomerangs', quote: 'Boomerangs are melee weapons that are thrown when used, returning to the player after a short amount of time.' },
  flailThrown: { page: 'Flails', quote: 'Launched flails lack the physics of thrown flails and cannot be swung around by holding the attack button.' },
  flailLaunched: { page: 'Flails', quote: 'a launched flail will extend at a fixed speed until it strikes a block or enemy or reaches its maximum length, and then retract at a slightly faster, fixed speed' },
  whipArc: { page: 'Whips', quote: 'Whips are summon weapons that swing in an arcing motion instead of summoning a secondary character.' },
  whipMultihit: { page: 'Whips', quote: 'The damage dealt will be reduced by a fixed percentage on each consecutive hit' },
  whipTag: { page: 'Whips', quote: "Tag damage: When minions or sentries attack tagged enemies, the whip's tag damage is added to the damage dealt." },
  minionSlot: { page: 'Minion-summoning weapons', quote: 'By default, a player can only have a single minion summoned at once.' },
  sentrySlot: { page: 'Sentry-summoning weapons', quote: 'By default, a player can only have a single sentry summoned at once.' },
  sentryStationary: { page: 'Sentry-summoning weapons', quote: 'Sentries are stationary and have a close-range or projectile attack.' },
  explosiveDelay: { page: 'Explosives (class)', quote: 'When used, they are thrown a short distance away from the player and explode after a delay.' },
  launcherAmmo: { page: 'Launchers', quote: 'Launchers are Hardmode, post-Plantera ranged weapons that either use rockets as ammunition, or their projectiles explode on impact' },
} as const satisfies Record<string, { page: string; quote: string }>

/** Mechanics articles the derivation rules quote (fetched with the family articles). */
export const LAB_RULE_PAGES = [...new Set([...Object.values(RULE_QUOTES).map((q) => q.page), ...LAB_FAMILY_PAGES])]

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/**
 * Articles of every Cargo weapon row whose page is in a family category, plus (given Iteminfo) the
 * pages of weapon rows in the piercing-beam signal family (evidence for the screen + overlay).
 */
export function labFamilyPages(tree: CategoryTree, itemRows: readonly CargoRow[], iteminfo?: Pick<Iteminfo, 'items'>): string[] {
  const familyPages = new Set(Object.values(FAMILY_CATEGORIES).flatMap((cats) => cats.flatMap((c) => tree.categories.get(c)?.pages ?? [])))
  const weaponRows = itemRows.filter((r) => itemTypeIncludes(r, 'weapon'))
  const weaponPages = new Set(weaponRows.map((r) => str(r._page)))
  const signalPages = iteminfo ? weaponRows.filter((r) => !familyPages.has(str(r._page)) && isHeldBeamSignal(iteminfo.items.get(Number(str(r.itemid)))?.stats)).map((r) => str(r._page)) : []
  return [...new Set([...[...familyPages].filter((p) => weaponPages.has(p)), ...signalPages])].filter(Boolean).sort()
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
/** Every family except those whose own archetype is the matched behavior (e.g. minions are summoned). */
const ALL_BUT = (...except: LabFamily[]): readonly LabFamily[] => LAB_FAMILIES.filter((f) => !except.includes(f))

/**
 * High-recall screen: a match only routes the weapon to curation; it never assigns a value. Terms are
 * matched on the behavior text + tooltip (case-insensitive). A rule skips the families whose archetype
 * IS that behavior (a yoyo is held and follows the cursor, a minion is summoned, a beam is held).
 */
export const SCREEN_RULES: readonly ScreenRule[] = [
  {
    id: 'projectile',
    label: 'fires or creates projectiles',
    re: /\b(?:projectiles?|beams?|bolts?|shoots?|shooting|fires?|firing|throws?|launch\w*)\b/i,
    families: ['swing-melee', 'thrust'],
  },
  {
    // returning / whip / explosive: thrown or launched by nature, so only extra projectiles count
    id: 'extra-projectile',
    label: 'fires or creates projectiles',
    re: /\b(?:projectiles?|beams?|bolts?|shoots?|shooting)\b/i,
    families: ['returning', 'whip', 'explosive-aoe'],
  },
  {
    id: 'multi-projectile',
    label: 'several projectiles per shot',
    re: /\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|multiple|several|burst|volleys?|at once|at a time|split\w*|clones?|copies)\b|\b\d+\s+(?:\w+\s+)?(?:arrows|bullets|projectiles|bolts|shots|stars|beams|lasers|darts|bees|bats|leaves|needles|bubbles|feathers|skulls|flames|blasts)\b/i,
    families: [...PROJECTILE_FAMILIES, 'returning'],
  },
  { id: 'spread', label: 'spread or randomized aim', re: /\b(?:spread\w*|inaccura\w*|accura\w*|random\w*|deviat\w*|scatter\w*|cone)\b/i, families: PROJECTILE_FAMILIES },
  { id: 'conversion', label: 'converts or replaces its ammunition', re: /\b(?:convert\w*|transform\w*|replac\w*|instead of|turns? \w+ (?:\w+ )?into)\b/i, families: PROJECTILE_FAMILIES },
  { id: 'homing', label: 'homing', re: /\bhom(?:e|es|ing)\b|\bseek\w*|\btrack\w*/i, families: [...PROJECTILE_FAMILIES, 'returning', 'whip', 'explosive-aoe', 'piercing-beam'] },
  { id: 'bounce', label: 'bouncing', re: /\b(?:bounc\w*|ricochet\w*|rebound\w*)\b/i, families: [...PROJECTILE_FAMILIES, 'returning', 'explosive-aoe'] },
  { id: 'pierce', label: 'piercing', re: /\b(?:pierc\w*|penetrat\w*|pass(?:es)? through)\b/i, families: PROJECTILE_FAMILIES },
  // returning: steering after the throw (a yoyo follows the cursor by nature: not flagged for yoyos)
  { id: 'cursor', label: 'steered toward the cursor', re: /\bcursor\b/i, families: ['returning'] },
  {
    id: 'on-hit',
    label: 'extra effects on hit',
    re: /\b(?:explo\w*|inflict\w*|debuffs?|heal(?:s|ed|ing)?|life ?steal\w*|restor\w*|stick\w*|stack\w*|chain\w*|on hit|upon hit|on contact|hitting|struck)\b/i,
    families: ALL,
  },
  { id: 'spawns', label: 'creates other projectiles or entities', re: /\b(?:spawn\w*|summon\w*|releas\w*|creat\w*|emit\w*|trails?|fragment\w*|shards?|sparks?)\b/i, families: ALL_BUT('minion-sentry') },
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
    families: ALL_BUT('returning', 'piercing-beam'),
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
  /**
   * `_prov.modeledFields` entries of params taken from a modeling convention (emitted with the params,
   * B49); on a limitation decision, the recorded partial values a convention supplied (report only).
   */
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
  /** Remaining-archetype families (merge/labFamilies.ts): yoyo, boomerang, flail, whip, minion, sentry, explosive, beam. */
  variant?: FamilyVariant
  /**
   * Params complete, but the sim has no interpreter for the archetype (src/sim IMPLEMENTED_ARCHETYPES):
   * the params are RECORDED here and the weapon is emitted as a limitation (labFamilies header).
   */
  pending?: boolean
  /** Required params still missing (labFamilies MISSING_PHRASE keys): the weapon stays a limitation. */
  missing?: string[]
  /** Params obtained so far, recorded for the report even when incomplete or a reviewed limitation. */
  partial?: Record<string, unknown>
  /** Quote-checked values recorded for later (bounce / chain counts, a beam's hit rate). */
  recorded?: RecordedExtras
  /** Article statements only a convention ruling could turn into a missing param (report: proposals). */
  candidates?: Record<string, string>
  /** Params withheld because two wiki sources disagree (also in `missing`). */
  conflicts?: string[]
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
  /** Archetypes the sim simulates (default src/sim IMPLEMENTED_ARCHETYPES); others are recorded, not emitted. */
  implemented?: readonly Archetype[]
  /** The sim guard (default src/sim assessWeapon). */
  assess?: (weapon: Weapon) => WeaponAssessment
}

export interface LabBuild {
  weapons: Weapon[]
  decisions: LabDecision[]
}

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
  const implemented = input.implemented ?? IMPLEMENTED_ARCHETYPES
  const assess = input.assess ?? assessWeapon
  // remaining-archetype families: the stated per-item values of the Whips / Yoyos list tables
  const tables = familyTables(input.articles)

  const decisions: LabDecision[] = []
  const weapons = input.weapons.map((w): Weapon => {
    const item = info.items.get(w.id)
    const family = familyOf(w.tags, item?.stats)
    const entry = overlayById.get(w.id)
    if (entry && entry.name !== w.name) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: name "${entry.name}" ≠ weapon name "${w.name}"`)
    const page = input.pageOf.get(w.id) ?? ''
    const articleOf = (): { article: Article; articleSrc: ProvSource } => {
      const a = input.articles.get(page)
      if (!a) throw new OverlayError(`[E_SCHEMA] lab-params: article "${page}" of ${w.name} was not fetched by the sync plan (run npm run pipeline:fetch)`)
      return { article: a, articleSrc: { kind: 'wiki-article', url: wikiPageUrl(a.resolvedTitle), rev: a.revid, fetchedAt: isoDate(a.fetchedAt) } }
    }
    // ---- no family (no weapon-type category, no beam signal): the default card, or a reviewed limitation ----
    if (!family) {
      if (!entry) return w
      if (entry.decision !== 'limitation') throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id} (${w.name}): a weapon in no Lab family takes only a limitation entry`)
      const extras = (['bounceCount', 'chainTargets', 'tickRateTicks'] as const).filter((k) => entry[k] !== undefined)
      if (extras.length > 0) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id} (${w.name}): ${extras.join(', ')} are recorded on a family decision — a weapon in no Lab family has none`)
      const { articleSrc } = articleOf()
      const pages = checkEntryEvidence(entry, evidence, page)
      return withLab(w, limitation(w, entry.reason), [articleSrc, ...pages.map((p) => Evidence.source('lab-params', p))], true)
    }
    const s = (item?.stats ?? {}) as Record<string, unknown>
    const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined)
    const { article, articleSrc } = articleOf()
    const decision: LabDecision = { id: w.id, name: w.name, family, method: 'limitation', flags: [], derivation: [] }
    decisions.push(decision)

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
    const rawFlags: ScreenFlag[] = []
    if (family === 'swing-melee' || family === 'thrust') {
      if (shoot > 0 && shoot !== stabId) rawFlags.push({ id: 'shoots-projectile', evidence: `Iteminfo shoot ${shoot}` })
      const extra = (box?.projectileIds ?? []).filter((id) => id !== stabId)
      if (extra.length > 0) rawFlags.push({ id: 'infobox-projectile', evidence: `infobox projectile ${extra.join(', ')}` })
    }
    // returning / whip / explosive: the thrown or swung projectile is the weapon; any other infobox projectile is extra
    if (family === 'returning' || family === 'whip' || family === 'explosive-aoe') {
      const extra = (box?.projectileIds ?? []).filter((id) => id !== shoot)
      if (extra.length > 0) rawFlags.push({ id: 'infobox-projectile', evidence: `infobox projectile ${extra.join(', ')}` })
    }
    const cargoDebuffs = str(input.rows.get(w.id)?.debuffs).split('^').map((d) => stripMarkup(d).trim()).filter(Boolean)
    if (cargoDebuffs.length > 0) rawFlags.push({ id: 'inflicts-debuff', evidence: `Cargo debuffs "${cargoDebuffs.join('^')}"` })
    else if (box && box.buffIds.length > 0) rawFlags.push({ id: 'inflicts-debuff', evidence: `infobox buff ${box.buffIds.join(', ')}` })
    if (!NO_BURST_FLAG.includes(family) && w.useTimeTicks !== undefined && w.useAnimationTicks !== undefined && w.useTimeTicks < w.useAnimationTicks) {
      rawFlags.push({ id: 'burst', evidence: `useTime ${w.useTimeTicks} < useAnimation ${w.useAnimationTicks}` })
    }
    const text = behaviorText(article.html)
    rawFlags.push(...screenText(family, text))
    if (w.behaviorText) for (const f of screenText(family, w.behaviorText.replace(/\n/g, ' '))) if (!rawFlags.some((x) => x.id === f.id)) rawFlags.push({ id: f.id, evidence: `tooltip ${f.evidence}` })
    // a yoyo follows the cursor by nature (its archetype control), so the steering flag does not apply
    const returningVariant = family === 'returning' ? returningVariantOf(w.tags) : undefined
    const flags = returningVariant === 'yoyo' ? rawFlags.filter((f) => f.id !== 'cursor') : rawFlags
    decision.flags = flags
    const spriteOf = () => {
      const sprite = input.sprites.get(w.id)
      const scale = num('scale')
      return sprite && scale !== undefined && scale > 0 ? { sprite, scale } : undefined
    }
    // thrust family: the B46 reach vs any range the article states (report: calibration record, every thrust weapon)
    const thrustGeo = family === 'thrust' ? spriteOf() : undefined
    // returning (boomerang / launched flail): only a "maximum range" statement is the throw range (other ranges: homing, despawn…)
    const anyRange = family === 'thrust' || family === 'returning' ? statedRangeTiles(text) : undefined
    const statedRange = family === 'returning' && anyRange && !/\bmaximum range\b/i.test(anyRange.quote) ? undefined : anyRange
    if (thrustGeo) {
      const conventionTiles = thrustReachTiles(thrustGeo.sprite.width, thrustGeo.sprite.height, thrustGeo.scale)
      decision.thrustReach = { conventionTiles, ...(statedRange ? { statedTiles: statedRange.tiles, quote: statedRange.quote } : {}) }
    }

    // ---- remaining-archetype families (merge/labFamilies.ts) ----
    const pendingFamily = isPendingFamily(family) ? family : undefined
    const archImplemented = implemented.includes(family)
    const familyCtx = (archEntry?: Extract<LabParamsEntry, { decision: 'archetype' }>): FamilyContext => ({
      w,
      family: pendingFamily as PendingFamily,
      stats: s,
      shoot,
      ...(shootProjectile ? { shootProjectile } : {}),
      ...(box ? { box } : {}),
      page,
      text,
      ...(statedRange ? { statedRange } : {}),
      tables,
      ...(archEntry ? { entry: archEntry } : {}),
      evidence,
      projSrc,
      rule: (k) => ruleSource(rules[k]),
      ruleQuote: (k) => RULE_QUOTES[k].quote,
    })

    // ---- overlay limitation decisions win (reviewed) ----
    if (entry?.decision === 'limitation') {
      const pages = checkEntryEvidence(entry, evidence, page)
      const recorded = recordedExtras(entry, w, statesNumber)
      if (Object.keys(recorded).length > 0) decision.recorded = recorded
      let reason = entry.reason
      if (pendingFamily) {
        // the params the data + rules still give are recorded (report); the family reason leads while unmodeled
        const out = deriveFamily(familyCtx())
        if (out.kind === 'member') {
          Object.assign(decision, { variant: out.variant, partial: out.partial, missing: out.missing, derivation: out.derivation })
          if (out.modeled.length > 0) decision.modeled = [...out.modeled].sort() // which partial values a B63 convention supplied (report)
          if (Object.keys(out.candidates).length > 0) decision.candidates = out.candidates
          reason = pendingReason(out.variant, archImplemented, entry.reason)
        }
      }
      return asLimitation('overlay', reason, pages.map((p) => Evidence.source('lab-params', p)), true)
    }

    // ---- hard requirements per family (never overridable: the data must carry them) ----
    const archetype: LabFamily = entry?.decision === 'archetype' ? entry.archetype : family
    if (archetype !== family && (isPendingFamily(archetype) || pendingFamily)) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: a ${family}-family weapon cannot be assigned the ${archetype} archetype`)
    const fail = (key: string, reason: string) => asLimitation(key, reason)
    const derivation: string[] = []
    const modeled: string[] = []
    let params: ArchetypeParams | undefined
    let missing: string[] = []
    let residuals: string[] = []
    let variant: FamilyVariant | undefined
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
      case 'returning':
      case 'whip':
      case 'minion-sentry':
      case 'explosive-aoe':
      case 'piercing-beam': {
        const archEntry = entry?.decision === 'archetype' ? entry : undefined
        if (archEntry) {
          checkEntryEvidence(archEntry, evidence, page) // residual quotes are trusted only once verbatim on the revision
          if (archEntry.bounceCount !== undefined || archEntry.chainTargets !== undefined) {
            throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: a weapon that needs bounce / chain (sim stubs) is a limitation entry that records them`)
          }
        }
        const out = deriveFamily(familyCtx(archEntry))
        if (out.kind === 'not-member') return fail(out.key, out.reason)
        variant = out.variant
        residuals = out.residuals
        decision.variant = out.variant
        decision.partial = out.partial
        decision.derivation = derivation // recorded even when the weapon ends as a limitation (report)
        if (Object.keys(out.candidates).length > 0) decision.candidates = out.candidates
        if (out.conflicts.length > 0) decision.conflicts = out.conflicts
        derivation.push(...out.derivation)
        sources.push(...out.sources)
        modeled.push(...out.modeled) // AMENDMENTS-013 B63 conventions (whip arc, summon rate, square blast)
        if (out.params) params = out.params
        else missing = out.missing
        break
      }
    }
    // (a summon weapon's use is the summoning cast, not its attack cadence: no cadence note for minions / sentries)
    if (w.reuseDelayTicks !== undefined && family !== 'minion-sentry') {
      derivation.push(`cadence includes the reuse delay: ${w.useAnimationTicks ?? '?'} + ${w.reuseDelayTicks} ticks (Iteminfo reuseDelay; rule: "${RULE_QUOTES.reuseDelay.quote}")`)
      sources.push(ruleSource(rules.reuseDelay))
    }

    // ---- damage over time from the infobox debuff rows (B48(c)) ----
    // a remaining-archetype member keeps its family reason first while the Lab has no interpreter for it
    const familyFirst = (specific: string) => (variant ? pendingReason(variant, archImplemented, specific) : specific)
    const dot = deriveDot(box, cargoDebuffs, input.buffs, input.buffTable)
    if (dot.kind === 'fail') {
      return fail('dot-underivable', variant && !archImplemented ? familyFirst(`It inflicts a debuff, but ${dot.reason}, so its damage over time cannot be modeled.`) : `Not simulated: this weapon inflicts a debuff, but ${dot.reason}, so its damage over time cannot be modeled.`)
    }
    const modifiers: LabModifiers | undefined = dot.kind === 'dot' ? { dot: dot.dot } : undefined
    if (dot.kind === 'dot') derivation.push(dot.text)
    // a derived DoT modifier expresses the data flag; text flags still need a reviewer (B45: a human read)
    const open = dot.kind === 'dot' ? flags.filter((f) => f.id !== 'inflicts-debuff') : flags

    // ---- flagged → overlay decision required ----
    let editorial = false
    const reviewed = (e: LabParamsEntry) => {
      const pages = checkEntryEvidence(e, evidence, page)
      derivation.push(`overlay: ${e.why}`)
      sources.push(...pages.map((pg) => Evidence.source('lab-params', pg)))
      editorial = true
    }
    if (open.length > 0) {
      if (entry?.decision !== 'archetype') {
        const labels = [...new Set(open.map((f) => SCREEN_LABEL[f.id]))].join('; ')
        return asLimitation(
          'flagged',
          !variant
            ? `Not simulated: the wiki describes behavior beyond a plain ${FAMILY_NOUN[family]} (${labels}) that has not been reviewed for the Lab.`
            : archImplemented
              ? `Not simulated: the wiki describes behavior beyond a plain ${VARIANT_NOUN[variant]} (${labels}) that has not been reviewed for the Lab.`
              : familyFirst(`The wiki also describes behavior beyond a plain ${VARIANT_NOUN[variant]} (${labels}) that has not been reviewed.`),
          variant ? sources : [],
        )
      }
      if (!pendingFamily) {
        rejectForeignResiduals(entry, w)
        const residual = applyResidual(params as ArchetypeParams, entry, w)
        params = residual.params
        modeled.push(...residual.modeled)
        derivation.push(...residual.derivation)
      }
      reviewed(entry)
    } else if (entry && pendingFamily && residuals.length > 0) {
      reviewed(entry) // the entry supplies values only a reviewed quote states (e.g. a minion's AI class)
    } else if (entry) {
      throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id} (${w.name}): the article screen is clean — the entry is not needed (residuals only)`)
    }

    // ---- remaining-archetype member with params still missing: recorded, limitation ----
    if (!params) {
      const v = variant as FamilyVariant
      decision.missing = missing
      if (modeled.length > 0) decision.modeled = [...modeled].sort() // which partial values a B63 convention supplied (report)
      const why = missingSentence(missing, decision.conflicts)
      return asLimitation('incomplete', archImplemented ? `Not simulated: ${lowerFirst(why)}` : pendingReason(v, false, why), sources, editorial)
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

    // ---- PENDING INTERPRETER: complete params are recorded; the weapon is emitted as a limitation ----
    if (pendingFamily && !archImplemented) {
      const blocked = blockingUnverifiedFields(archetype, w._prov.unverifiedFields)
      if (blocked.length > 0) decision.pipelineBlocked = blocked // the validate downgrade would follow once modeled
      const reason = pendingReason(variant as FamilyVariant, false, blocked.length > 0 ? unverifiedSentence(blocked) : undefined)
      decision.pending = true
      decision.reason = reason
      decision.reasonKey = 'pending-interpreter'
      return withLab(w, limitation(w, reason), sources, editorial)
    }
    const candidate = withLab(w, lab, sources, editorial, modeled)

    // ---- guard contract ----
    const pipelineBlocked = blockingUnverifiedFields(archetype, candidate._prov.unverifiedFields)
    if (pipelineBlocked.length > 0) {
      decision.pipelineBlocked = pipelineBlocked
      return candidate // validate's §2.1-3 downgrade (B36 incl.) turns it into a limitation, visibly
    }
    const verdict = assess(candidate)
    if (!verdict.simulable) {
      decision.params = undefined
      decision.modifiers = undefined
      decision.modeled = undefined
      decision.archetype = undefined
      return asLimitation(`guard:${verdict.refusal.reason}`, `required simulation parameter unverified: ${(verdict.refusal.fields ?? []).join(', ') || verdict.refusal.message}`)
    }
    return candidate
  })
  return { weapons: withBehaviorSentences(weapons, input), decisions }
}

/**
 * Reviewed "What it does in-game" texts (overlay `inGameBehavior`): for a limitation card whose tooltip
 * has no behavior line — only its flavor-text quote, or nothing — a verbatim sentence of the weapon's
 * own article, quote-checked on the cached revision, replaces the wiki pointer. An entry the build
 * doesn't need (a simulated weapon, a tooltip that describes the behavior) is an error, like any
 * unneeded overlay entry.
 */
function withBehaviorSentences(weapons: Weapon[], input: LabBuildInput): Weapon[] {
  const sentences = new Map((input.overlay.inGameBehavior ?? []).map((e) => [e.itemId, e]))
  if (sentences.size === 0) return weapons
  const emitted = new Set(weapons.map((w) => w.id))
  for (const id of sentences.keys()) if (!emitted.has(id)) throw new OverlayError(`[E_SCHEMA] overlay lab-params inGameBehavior/i:${id}: no emitted weapon has this item ID`)
  return weapons.map((w) => {
    const e = sentences.get(w.id)
    if (!e) return w
    const where = `overlay lab-params inGameBehavior/i:${w.id} (${w.name})`
    if (e.name !== w.name) throw new OverlayError(`[E_SCHEMA] ${where}: name "${e.name}" ≠ weapon name "${w.name}"`)
    const own = input.pageOf.get(w.id) ?? ''
    if (e.page !== own) throw new OverlayError(`[E_SCHEMA] ${where}: the sentence must come from the weapon's own article "${own}", not "${e.page}"`)
    if (w.labBehavior.kind !== 'limitation') throw new OverlayError(`[E_SCHEMA] ${where}: not needed — the weapon has no limitation card (${w.labBehavior.kind})`)
    if (tooltipBehavior(w.behaviorText) !== undefined) throw new OverlayError(`[E_SCHEMA] ${where}: not needed — its tooltip describes its behavior`)
    const page = input.evidence.quote(e.page, e.quote, where)
    return withLab(w, limitation(w, w.labBehavior.reason, e.quote), [Evidence.source('lab-params', page)], true)
  })
}

const FAMILY_NOUN: Record<LabFamily, string> = {
  'swing-melee': 'broadsword swing',
  thrust: 'stab',
  'bow-gun': 'bow or gun shot',
  'magic-bolt': 'magic bolt',
  returning: 'returning weapon',
  whip: 'whip',
  'minion-sentry': 'minion or sentry',
  'explosive-aoe': 'explosive',
  'piercing-beam': 'held beam',
}

/** Families whose cadence is not a burst signal (a swing; a summon's attack rate; a thrown explosive). */
const NO_BURST_FLAG: readonly LabFamily[] = ['swing-melee', 'minion-sentry', 'explosive-aoe']

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

/** Plain words for the weapon fields a limitation reason may name. */
const FIELD_WORD: Record<string, string> = {
  damageClass: 'damage class',
  damage: 'damage',
  critPct: 'critical strike chance',
  useTimeTicks: 'use time',
  useAnimationTicks: 'use time',
  reuseDelayTicks: 'reuse delay',
  knockback: 'knockback',
  manaCost: 'mana cost',
  autoReuse: 'auto-reuse',
  ammoClass: 'ammunition',
  shootSpeedTps: 'velocity',
}

/** "Its damage, critical strike chance and knockback are unverified in the wiki data." */
export function unverifiedSentence(fields: readonly string[]): string {
  const words = [...new Set(fields.map((f) => FIELD_WORD[f.split('.')[0]] ?? f))]
  const list = words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
  return `Its ${list} ${words.length > 1 ? 'are' : 'is'} unverified in the wiki data.`
}

/** Residual fields of the remaining-archetype families / recorded extras never apply to the original four. */
function rejectForeignResiduals(entry: Extract<LabParamsEntry, { decision: 'archetype' }>, w: Weapon): void {
  const foreign = (['throwRangeTiles', 'aiClass', 'attackRateTicks', 'sentryRangeTiles', 'blastRadiusTiles', 'trigger', 'fuseTicks', 'falloff', 'tickRateTicks', 'bounceCount', 'chainTargets'] as const).filter((k) => entry[k] !== undefined)
  if (foreign.length > 0) throw new OverlayError(`[E_SCHEMA] overlay lab-params/i:${w.id}: ${entry.archetype} takes no ${foreign.join(', ')}`)
}

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
  /** Params complete from the data + rules alone / with a reviewed overlay entry. */
  derived: number
  overlay: number
  /** Params complete, the archetype has no sim interpreter yet: recorded, emitted as a limitation. */
  pending: number
  /** …of which a core weapon field the sim needs is unverified (the validate downgrade would follow). */
  pendingBlocked: number
  /** Kept params but the validate stage downgrades them (unverified core field; B36 incl.). */
  downgraded: number
  limitation: number
  /** Limitations whose only blocker is a missing (unstated) param. */
  incomplete: number
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
      if (d.method !== 'limitation' && !d.pending && final?.labBehavior.kind !== 'archetype') downgraded += 1
      if (d.method === 'limitation') byReason.set(d.reasonKey ?? '?', (byReason.get(d.reasonKey ?? '?') ?? 0) + 1)
    }
    const simulable = ds.filter((d) => emitted.get(d.id)?.labBehavior.kind === 'archetype').length
    return {
      family,
      total: ds.length,
      derived: ds.filter((d) => d.method === 'derived').length,
      overlay: ds.filter((d) => d.method === 'overlay').length,
      pending: ds.filter((d) => d.pending).length,
      pendingBlocked: ds.filter((d) => d.pending && (d.pipelineBlocked?.length ?? 0) > 0).length,
      downgraded,
      limitation: ds.filter((d) => d.method === 'limitation').length,
      incomplete: ds.filter((d) => d.reasonKey === 'incomplete').length,
      simulable,
      byReason,
    }
  })
}
