/**
 * P3-S0 extension — the REMAINING-ARCHETYPE families: returning (boomerang / flail / yoyo), whip,
 * minion-sentry, explosive-aoe, piercing-beam (DATA_SCHEMA_SPEC §2.4; evidentiary standards
 * AMENDMENTS-010 B45 and AMENDMENTS-012 B56 "stated values beat conventions"). Orchestrated by
 * merge/labParams.ts (classification, article screen, DoT, overlay, guard contract); this module holds
 * the per-family derivations, the overview-table extraction, the residual quote checks and the
 * family-specific limitation reasons.
 *
 * PENDING INTERPRETERS: these archetypes are simulated by the Lab's P3-S6–S11 interpreters. Until an
 * archetype is in src/sim IMPLEMENTED_ARCHETYPES, a weapon whose params are complete is RECORDED (its
 * decision + the coverage report) and emitted as a limitation whose reason names what the Lab does not
 * model (no forward promise) — the build's guard contract (every emitted archetype weapon passes
 * assessWeapon) holds, and the same offline build emits the params the moment the interpreter
 * registers (no pipeline change).
 *
 * Every param is STATED (an infobox row, an overview-table cell, a verbatim-checked sentence, or a
 * reviewed overlay quote that states the value — all on the cached revision), DERIVED (a data-module
 * value + a quoted rule), or MODELED by a ratified convention (AMENDMENTS-013 B63 P-1 / P-2 / P-3 / P-5;
 * src/schemas MODELING_CONVENTIONS — recorded in the decision's `modeled` list, emitted as
 * `_prov.modeledFields` and labeled by the sim's approximations registry once the archetype is
 * simulated). A param no stated value and no ratified convention supplies stays MISSING (B63 P-4,
 * Manhattan-distance sentry ranges, is rejected: those stay missing).
 *
 * returning — family = Category:Boomerangs / Flails / Yoyos; variant = that category.
 * - yoyo: Iteminfo `channel` (held) + use style 5 (Use Style IDs: "Shoot … yoyos"). throwRangeTiles =
 *   the item infobox "Reach" row ("8.125 tiles"), cross-checked against the Yoyos article's list table
 *   "Reach (tiles)" (a disagreement withholds it). returnMode "tethered" + control "cursor-follow": the
 *   Yoyos article (thrown, "seeking the player's cursor", "attached to the player via string").
 * - boomerang: not held. throwRangeTiles = the range its article states ("maximum range of roughly N
 *   tiles" — the B56 extraction, sentence checked verbatim) or a reviewed overlay quote stating N tiles.
 *   returnMode "auto-return" + control "fire-and-forget": the Boomerangs article ("thrown when used,
 *   returning to the player after a short amount of time"); steering / homing is a screen flag.
 * - flail: held (`channel`) = a THROWN flail (Flails article: holding the attack swings it around the
 *   player) — the returning params cannot express the spin → limitation. Not held = a LAUNCHED flail:
 *   auto-return + fire-and-forget (Flails: it extends "until it strikes a block or enemy or reaches its
 *   maximum length, and then retract[s]"); range as for boomerangs.
 * whip — Category:Whips; the whip projectile is the weapon itself (Projectileinfo name = weapon name).
 *   rangeTiles = the Whips article list table "Range (tiles)"; tagDamageFlat = the tooltip (game text)
 *   "N summon tag damage", cross-checked against the table "Tag damage" (no tooltip line → the table
 *   value); tagCritPct = the tooltip "N% summon tag critical strike chance", cross-checked against the
 *   table's "N% tag critical chance"; falloffPerTarget = the table "Multihit penalty" (Whips: damage is
 *   "reduced by a fixed percentage on each consecutive hit"). arcDegrees is stated NOWHERE on the wiki
 *   ("swing in an arcing motion", no angle) → 180° forward, MODELED (AMENDMENTS-013 B63 P-1: the same
 *   "swung overhead" basis as B44's broadsword arc; every whip lists it).
 * minion-sentry — Category:Minion summon items / Sentry summon items. variant = Iteminfo `sentry`, else
 *   Projectileinfo `minion` of the summoned projectile. slotCost: minion = Projectileinfo `minionSlots`
 *   (> 0) of the summoned projectile ("a player can only have a single minion summoned at once" by
 *   default = one slot); sentry = 1 (same rule for sentries). aiClass (the B63 P-6 taxonomy below,
 *   assigned only with a reviewed quote matching AI_CLASS_EVIDENCE). attackRateTicks, in order:
 *   1. a reviewed overlay quote stating an exact interval;
 *   2. the own article's one base-rate sentence ("once every N seconds" / "once per second" / "a cooldown
 *      of N seconds after attacking"; not conditioned on gear, not a hit cap, one value) — quote-checked.
 *      N × 60 whole ticks and not qualified as an average / random = STATED; otherwise MODELED by B63 P-2
 *      (`summon-average-rate`): N × 60 rounded half-to-even to whole ticks (roundHalfEvenTicks);
 *   3. a contact minion (aiClass melee-contact / ground-melee / hover-strike) whose article states only
 *      its immunity frames ("N ticks of local/static invincibility/immunity frames", one value) — MODELED
 *      by B63 P-3 (`summon-hit-cap`): attack once per N ticks, an UPPER BOUND ("maximum rate; actual
 *      depends on minion AI pathing"). Not applied where the article says the frames do not come into
 *      play (another limit governs) — the param stays missing.
 *   sentryRangeTiles only from a reviewed quote stating a radius (a Manhattan distance is not one; B63
 *   P-4 rejected).
 * explosive-aoe — Category:Explosives / Launchers. A weapon that fires ammunition (Iteminfo `useAmmo`:
 *   every launcher) is not expressible — the blast comes from the ammunition. Thrown explosives: trigger
 *   "timed" + fuseTicks from the sentence "explodes N seconds after …" (verbatim-checked) or a reviewed
 *   quote; blastRadiusTiles (a quote stating "N tile(s)" with "radius") and falloff (a quote stating it
 *   deals N damage "to all" in the radius / within N tiles = "none") only from reviewed quotes. Where no
 *   radius is stated, a square damage area ("within N tiles horizontally and vertically", the own
 *   article or a reviewed quote; one value) → radius N = half the square's side, the inscribed circle,
 *   MODELED (AMENDMENTS-013 B63 P-5 `square-blast-radius`: conservative, never overstates the area).
 * piercing-beam — no wiki category: the held-beam signal family (labParams.isHeldBeamSignal). mode
 *   "channel-beam" when the held projectile is the weapon itself (Projectileinfo name = weapon name);
 *   tickRateTicks only from a reviewed quote stating it (e.g. the beam's invincibility frames).
 *
 * AI-CLASS TAXONOMY (BINDING — AMENDMENTS-013 B63 P-6; DATA_SCHEMA_SPEC §2.4 names the four classes,
 * this defines them; P3-S9's minion-sentry interpreter reads them). A class is assigned only by a
 * reviewed overlay entry whose quote shows the class's evidence (AI_CLASS_EVIDENCE `re`):
 * - ranged-shot   — it damages enemies with projectiles it shoots, fires, spits or throws.
 * - ground-melee  — it moves along the ground (walks, runs, hops, bounces, jumps) and hits enemies up
 *                   close (contact, sword, slam, bite).
 * - melee-contact — it flies, charges or dashes at enemies, damaging them by contact.
 * - hover-strike  — it flies or hovers next to enemies and strikes them repeatedly at close range (stab,
 *                   slash, swing).
 * ground-melee / melee-contact / hover-strike damage by the minion's own hits — the CONTACT classes
 * (CONTACT_AI_CLASSES) to which B63 P-3 applies. Assigned classes are recorded on every decision and
 * emitted with the params once the weapon is complete and its archetype is simulated.
 */
import { MODELING_CONVENTIONS, modeledEntry, type ArchetypeParams, type ModelingConvention, type ProvSource, type Weapon } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import { wikiPageUrl } from '../fetch/config'
import { parseItemTable, type ItemInfobox } from '../parse/infobox'
import type { Projectile } from '../parse/projectileinfo'
import type { Evidence } from './evidence'
import type { LabParamsEntry } from './overlays'
import { isoDate } from './prov'
import { OverlayError } from './registry'

export const PENDING_FAMILIES = ['returning', 'whip', 'minion-sentry', 'explosive-aoe', 'piercing-beam'] as const
export type PendingFamily = (typeof PENDING_FAMILIES)[number]
export const isPendingFamily = (f: string): f is PendingFamily => (PENDING_FAMILIES as readonly string[]).includes(f)

export type FamilyVariant = 'boomerang' | 'flail' | 'yoyo' | 'whip' | 'minion' | 'sentry' | 'explosive' | 'beam'

/**
 * What the Lab does not model, per variant — the family part of a limitation reason while the
 * archetype has no interpreter (plain statements, no forward promises).
 */
export const FAMILY_REASON: Record<FamilyVariant, string> = {
  yoyo: "The Lab doesn't model tethered yoyo control.",
  boomerang: "The Lab doesn't model thrown weapons that fly out and return to the player.",
  flail: "The Lab doesn't model flails launched on a chain.",
  whip: "The Lab doesn't model whip swings or the tag bonus they give to minion damage.",
  minion: "The Lab doesn't model summoned minions.",
  sentry: "The Lab doesn't model stationary sentries.",
  explosive: "The Lab doesn't model explosions.",
  beam: "The Lab doesn't model held, continuous beams.",
}

export const VARIANT_NOUN: Record<FamilyVariant, string> = {
  yoyo: 'yoyo',
  boomerang: 'boomerang',
  flail: 'launched flail',
  whip: 'whip',
  minion: 'minion',
  sentry: 'sentry',
  explosive: 'thrown explosive',
  beam: 'held beam',
}

/**
 * Why a required param is missing (limitation reasons; report): a noun the wiki states nowhere
 * ("the wiki states no X for it") or a sentence of its own.
 */
export const MISSING_PHRASE: Record<string, { noun: string } | { text: string }> = {
  throwRangeTiles: { noun: 'throw range' },
  rangeTiles: { noun: 'whip range' },
  tagDamageFlat: { noun: 'tag damage' },
  tagCritPct: { noun: 'tag critical strike chance' },
  slotCost: { text: 'the game data gives no slot cost for it' },
  aiClass: { text: 'its attack style is not classified from the wiki' },
  attackRateTicks: { noun: 'exact attack rate' },
  sentryRangeTiles: { noun: 'targeting radius' },
  blastRadiusTiles: { noun: 'circular blast radius' },
  trigger: { noun: 'trigger for its explosion' },
  falloff: { text: 'the wiki does not state how its damage spreads over the blast' },
  tickRateTicks: { noun: 'hit rate for its beam' },
}

/**
 * ["attackRateTicks", "sentryRangeTiles"] → "The wiki states no exact attack rate or targeting radius for it."
 * A param in `conflicts` is stated, but by sources that disagree: "the wiki sources disagree on its …".
 */
export const missingSentence = (missing: readonly string[], conflicts: readonly string[] = []): string => {
  const phrase = (m: string) => MISSING_PHRASE[m] ?? { text: `${m} is missing` }
  const nounOf = (m: string) => {
    const p = phrase(m)
    return 'noun' in p ? p.noun : m
  }
  const absent = [...new Set(missing)].filter((m) => !conflicts.includes(m))
  const nouns = absent.flatMap((m) => ('noun' in phrase(m) ? [nounOf(m)] : []))
  const list = (xs: string[], word: string) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${word} ${xs.at(-1)}`)
  const disputed = [...new Set(conflicts)].map(nounOf)
  const parts = [
    ...(nouns.length > 0 ? [`the wiki states no ${list(nouns, 'or')} for it`] : []),
    ...(disputed.length > 0 ? [`the wiki sources disagree on its ${list(disputed, 'and')}`] : []),
    ...absent.flatMap((m) => {
      const p = phrase(m)
      return 'text' in p ? [p.text] : []
    }),
  ]
  const s = parts.join('; ')
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

export const THROWN_FLAIL_REASON = "The Lab doesn't model thrown flails, which spin around the player while the attack is held before being thrown."

/**
 * A launcher (an explosive-family weapon that fires ammunition): the blast is the ammo's, in plain
 * words (design review P3-S4/S5 M5 — no pipeline terms). Rocket classes name the rockets; any other
 * ammo (Stynger bolts, nails, explosive jack 'o lanterns) is "the ammo it fires".
 */
export const ammoExplosiveReason = (ammoClass: string | undefined): string =>
  ammoClass !== undefined && /^rocket-/.test(ammoClass)
    ? "Launchers get their explosion from the rocket ammo, which the Lab doesn't model."
    : "This launcher gets its explosion from the ammo it fires, which the Lab doesn't model."

// ---------------------------------------------------------------------------------------------
// Overview tables (Whips / Yoyos list tables): stated per-item values
// ---------------------------------------------------------------------------------------------

export const WHIPS_PAGE = 'Whips'
export const YOYOS_PAGE = 'Yoyos'

export interface FamilyTable {
  /** Item ID → header → cell text. */
  rows: Map<number, Record<string, string>>
  source?: ProvSource
}

export interface FamilyTables {
  whips: FamilyTable
  yoyos: FamilyTable
}

function table(article: Article | undefined, header: string): FamilyTable {
  if (!article) return { rows: new Map() }
  const rows = new Map<number, Record<string, string>>()
  for (const r of parseItemTable(article.html, header)) for (const id of r.itemIds) if (!rows.has(id)) rows.set(id, r.cells)
  return { rows, source: { kind: 'wiki-article', url: wikiPageUrl(article.resolvedTitle), rev: article.revid, fetchedAt: isoDate(article.fetchedAt) } }
}

export const familyTables = (articles: ReadonlyMap<string, Article>): FamilyTables => ({
  whips: table(articles.get(WHIPS_PAGE), 'Range (tiles)'),
  yoyos: table(articles.get(YOYOS_PAGE), 'Reach (tiles)'),
})

const decimal = (s: string | undefined): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)$/.exec((s ?? '').trim())
  return m ? Number(m[1]) : undefined
}

// ---------------------------------------------------------------------------------------------
// Residual quote checks (a reviewed overlay value must be STATED by one of the entry's quotes)
// ---------------------------------------------------------------------------------------------

const numRe = (n: number) => String(n).replace('.', '\\.')

/** A quote stating N tiles ("9.4 tiles", "12 tiles", "a 4-tile radius"). */
export const statesTiles = (quote: string, n: number): boolean => new RegExp(`(?:^|[^\\d.])${numRe(n)}(?![\\d.])\\s*-?\\s*tiles?\\b`, 'i').test(quote)

/**
 * The interval (ticks) between attacks a quote states — "once every N seconds", "once per second",
 * "every N ticks", "N times per second" — in whole ticks only. `average` = the quote qualifies it as an
 * average / approximation (not the schema's fixed rate: needs a ruling).
 */
export function statedIntervalTicks(quote: string): { ticks: number; average: boolean } | undefined {
  const whole = (t: number) => (Math.abs(t - Math.round(t)) < 1e-9 && t > 0 ? Math.round(t) : undefined)
  const average = /\baverage\b|\bapproximately\b|\babout\b|\broughly\b/i.test(quote)
  let m = /\bonce (?:every|per) (?:(\d+(?:\.\d+)?) )?seconds?\b/i.exec(quote)
  if (m) {
    const t = whole(Number(m[1] ?? 1) * 60)
    return t === undefined ? undefined : { ticks: t, average }
  }
  m = /\bevery (\d+) ticks?\b/i.exec(quote)
  if (m) return { ticks: Number(m[1]), average }
  m = /\b(\d+(?:\.\d+)?) times per second\b/i.exec(quote)
  if (m) {
    const t = whole(60 / Number(m[1]))
    return t === undefined ? undefined : { ticks: t, average }
  }
  return undefined
}

/** A quote stating a beam's hit interval: "N ticks of … invincibility frames" or an interval as above. */
export function statesTickRate(quote: string, ticks: number): boolean {
  const iframes = [...quote.matchAll(/\b(\d+) ticks? of (?:\w+ )*?invincibility frames\b/gi)].some((m) => Number(m[1]) === ticks)
  const interval = statedIntervalTicks(quote)
  return iframes || (interval !== undefined && !interval.average && interval.ticks === ticks)
}

/** A quote stating a fuse: "explodes N seconds after …" / "after N seconds". */
export const statesFuse = (quote: string, ticks: number): boolean =>
  [...quote.matchAll(/(\d+(?:\.\d+)?) seconds?\b/gi)].some((m) => Math.round(Number(m[1]) * 60) === ticks && Math.abs(Number(m[1]) * 60 - ticks) < 1e-9) && /\bexplo\w*/i.test(quote)

/** The fuse sentence of an explosive article ("The Bomb is an explosive that explodes 3 seconds after being thrown."). */
export function statedFuse(text: string): { ticks: number; quote: string } | undefined {
  const m = /[^.]*\bexplodes? (\d+(?:\.\d+)?) seconds? after\b[^.]*/i.exec(text)
  if (!m) return undefined
  const ticks = Number(m[1]) * 60
  return Number.isInteger(ticks) && ticks > 0 ? { ticks, quote: m[0].trim() } : undefined
}

export type AiClass = Extract<ArchetypeParams, { archetype: 'minion-sentry' }>['aiClass']

/**
 * aiClass taxonomy (DATA_SCHEMA_SPEC §2.4 enum) — the evidence a reviewed quote must show for each
 * class. BINDING definitions (AMENDMENTS-013 B63 P-6; the header's AI-CLASS TAXONOMY block).
 */
export const AI_CLASS_EVIDENCE: Record<AiClass, { rule: string; re: RegExp }> = {
  'ranged-shot': { rule: 'it damages enemies with projectiles it shoots, fires, spits or throws', re: /\b(?:shoot\w*|fir(?:e|es|ing)|spit\w*|throw\w*|launch\w*)\b/i },
  'ground-melee': {
    rule: 'it moves along the ground (walks, runs, hops, bounces, jumps) and hits enemies up close (contact, sword, slam, bite)',
    re: /\b(?:walk|run|hop|bounc|jump|leap)\w*\b[^.]*\b(?:contact|sword|slam\w*|bit(?:e|es|ing)|up close)\b/i,
  },
  'melee-contact': { rule: 'it flies, charges or dashes at enemies, damaging them by contact', re: /\b(?:fl(?:y|ies|ying)|charg\w*|dash\w*|swoop\w*)\b[^.]*\b(?:contact|into|through)\b/i },
  'hover-strike': { rule: 'it flies or hovers next to enemies and strikes them repeatedly at close range (stab, slash, swing)', re: /\b(?:hover\w*|fl(?:y|ies|ying))\b[^.]*\b(?:stab\w*|slash\w*|swing\w*|strik\w*)\b/i },
}

/** The classes whose damage is the minion's own hits — B63 P-3 (immunity-frame upper bound) applies to these. */
export const CONTACT_AI_CLASSES: readonly AiClass[] = ['melee-contact', 'ground-melee', 'hover-strike']

// ---------------------------------------------------------------------------------------------
// AMENDMENTS-013 B63 conventions (P-1 whip arc, P-2 average rate, P-3 hit cap, P-5 square blast)
// ---------------------------------------------------------------------------------------------

/** B63 P-1: a whip sweeps 180° forward (the B44 "swung overhead" basis; the wiki states no angle). */
export const WHIP_ARC_DEGREES = 180

const conventionById = (id: ModelingConvention['id']): ModelingConvention => {
  const c = MODELING_CONVENTIONS.find((x) => x.id === id)
  if (!c) throw new Error(`unreachable: modeling convention ${id} is not registered`)
  return c
}

/** The `_prov.modeledFields` entry of a param a B63 convention supplies (qualified where the path is shared). */
export const modeledBy = (id: ModelingConvention['id'], param: string): string => modeledEntry(conventionById(id), `labBehavior.params.${param}`)

/**
 * B63 P-2 rounding rule: a time in decimal seconds → ticks (× 60), rounded half-to-even to a whole tick.
 * Exact decimal arithmetic on the stated digits ("1.13" → 6780/100 = 67.8 → 68; "0.125" → 7.5 → 8;
 * "0.375" → 22.5 → 22), so no binary-float error decides a rounding. `exact` = already whole ticks.
 */
export function roundHalfEvenTicks(seconds: string): { ticks: number; exact: boolean } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(seconds.trim())
  if (!m) throw new Error(`not a decimal number of seconds: "${seconds}"`)
  const frac = m[2] ?? ''
  const scale = 10 ** frac.length
  const scaledTicks = Number(`${m[1]}${frac}`) * 60 // = ticks × scale (an integer)
  const whole = Math.floor(scaledTicks / scale)
  const rest = scaledTicks - whole * scale
  const ticks = rest * 2 < scale ? whole : rest * 2 > scale ? whole + 1 : whole % 2 === 0 ? whole : whole + 1
  return { ticks, exact: rest === 0 }
}

const RATE_FORMS = [/\bonce every (\d+(?:\.\d+)?) seconds?\b/gi, /\bonce per (second)\b/gi, /\ba cooldown of (\d+(?:\.\d+)?) seconds? after attacking\b/gi] as const
/** A sentence that bounds or conditions the rate rather than stating it (a hit cap, gear / buff setups). */
const NOT_BASE_RATE = /\binvincibility\b|\bimmunity\b|\bup to\b|\bhit cooldown\b/i
const CONDITIONED = /^(?:if|with|while|when)\b/i
const AVERAGED = /\baverage\b|\brandom\b|\bapproximately\b|\babout\b|\broughly\b/i

export interface StatedRate {
  /** The interval as stated, in seconds (decimal text). */
  seconds: string
  ticks: number
  /** true = whole ticks and not qualified as an average / random: a stated value (not modeled). */
  exact: boolean
  quote: string
}

/**
 * The summon's base attack rate stated by its article (see the header, attackRateTicks step 2): the one
 * interval its rate sentences state — undefined when none, or when they state several (variants, tiers).
 */
export function statedSummonRate(text: string): StatedRate | 'ambiguous' | undefined {
  const found: { seconds: string; averaged: boolean; quote: string }[] = []
  for (const s of sentencesOf(text)) {
    if (CONDITIONED.test(s.trim()) || NOT_BASE_RATE.test(s)) continue
    const values = RATE_FORMS.flatMap((re) => [...s.matchAll(re)].map((m) => (m[1].toLowerCase() === 'second' ? '1' : m[1])))
    if (values.length === 0) continue
    if (new Set(values).size > 1) return 'ambiguous'
    found.push({ seconds: values[0], averaged: AVERAGED.test(s), quote: s.trim() })
  }
  if (found.length === 0) return undefined
  if (new Set(found.map((f) => f.seconds)).size > 1) return 'ambiguous'
  const { ticks, exact } = roundHalfEvenTicks(found[0].seconds)
  return { seconds: found[0].seconds, ticks, exact: exact && !found.some((f) => f.averaged), quote: found[0].quote }
}

/** "N ticks of local / static invincibility / immunity frames" (never a negative "-1 tick"). */
const HIT_CAP = /(?<![-−\d.])\b(\d+) ticks? of (?:\w+ )*?(?:invincibility|immunity) frames\b/i
const CAP_NOT_BINDING = /\bnot come into play\b|\bdoes not apply\b|\bhas no effect\b/i

/**
 * The hit cap a contact minion's article states (header step 3): the one immunity-frame count of its
 * sentences, or `not-binding` when the article says the frames do not limit its hits.
 */
export function statedHitCap(text: string): { ticks: number; quote: string } | { notBinding: string } | 'ambiguous' | undefined {
  const found: { ticks: number; quote: string }[] = []
  for (const s of sentencesOf(text)) {
    if (CONDITIONED.test(s.trim())) continue
    const m = HIT_CAP.exec(s)
    if (!m) continue
    if (CAP_NOT_BINDING.test(s)) return { notBinding: s.trim() }
    found.push({ ticks: Number(m[1]), quote: s.trim() })
  }
  if (found.length === 0) return undefined
  return new Set(found.map((f) => f.ticks)).size > 1 ? 'ambiguous' : found[0]
}

/** A square damage area: "within N tiles horizontally and vertically" (B63 P-5 input). */
const SQUARE_AREA = /\bwithin (\d+(?:\.\d+)?) tiles horizontally and vertically\b/i

/** A quote stating a bounce count ("can bounce off blocks up to five times", "ricochet up to four times"). */
export const statesBounce = (quote: string, count: number, statesNumber: (q: string, n: number) => boolean): boolean => /\b(?:bounc|ricochet)\w*/i.test(quote) && statesNumber(quote, count)

// ---------------------------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------------------------

export type FamilyRuleKey =
  | 'yoyoThrown'
  | 'yoyoString'
  | 'boomerangReturn'
  | 'flailThrown'
  | 'flailLaunched'
  | 'whipArc'
  | 'whipMultihit'
  | 'whipTag'
  | 'minionSlot'
  | 'sentrySlot'
  | 'sentryStationary'
  | 'explosiveDelay'
  | 'launcherAmmo'
  | 'useStyleShoot'

type ArchetypeEntry = Extract<LabParamsEntry, { decision: 'archetype' }>

export interface FamilyContext {
  w: Weapon
  family: PendingFamily
  stats: Readonly<Record<string, unknown>>
  shoot: number
  shootProjectile?: Projectile
  box?: ItemInfobox
  /** The weapon's own article title (quote checks). */
  page: string
  /** Lead + behavior sections of the own article (labParams.behaviorText). */
  text: string
  /** "maximum range of … N tiles" in the own article (labParams.statedRangeTiles), if any. */
  statedRange?: { tiles: number; quote: string }
  tables: FamilyTables
  /** A reviewed archetype entry (its quotes are verbatim-checked by the caller). */
  entry?: ArchetypeEntry
  evidence: Evidence
  projSrc: ProvSource
  /** Provenance source of a family rule quote (labParams.RULE_QUOTES). */
  rule: (key: FamilyRuleKey) => ProvSource
  ruleQuote: (key: FamilyRuleKey) => string
}

export type FamilyOutcome =
  /** The game data does not describe this family's behavior: a specific limitation (no family prefix). */
  | { kind: 'not-member'; key: string; reason: string }
  | {
      kind: 'member'
      variant: FamilyVariant
      /** Complete, schema-shaped params (absent when `missing` is non-empty). */
      params?: ArchetypeParams
      /** Every param obtained so far (report; recorded even when incomplete). */
      partial: Record<string, unknown>
      missing: string[]
      derivation: string[]
      sources: ProvSource[]
      /** Param names supplied by the reviewed overlay entry (the entry is needed for them). */
      residuals: string[]
      /** `_prov.modeledFields` entries of params a ratified B63 convention supplied (labeled, never game data). */
      modeled: string[]
      /**
       * Values the article states that no ratified convention turns into a missing param (a Manhattan
       * range — B63 P-4 rejected —, a rate sentence that is ambiguous or not a base rate, an immunity cap
       * that is not binding or not a contact minion's) — report only, never used.
       */
      candidates: Record<string, string>
      /** Params withheld because two wiki sources disagree (also listed in `missing`). */
      conflicts: string[]
    }

const RETURNING_VARIANT_TAGS: readonly [string, FamilyVariant][] = [
  ['yoyos', 'yoyo'],
  ['boomerangs', 'boomerang'],
  ['flails', 'flail'],
]

/** Returning variant from the weapon's category tags (Category:Yoyos / Boomerangs / Flails). */
export const returningVariantOf = (tags: readonly string[]): FamilyVariant | undefined => RETURNING_VARIANT_TAGS.find(([t]) => tags.includes(t))?.[1]

const where = (w: Weapon) => `overlay lab-params/i:${w.id}`

/** Residual param names an archetype entry may carry, per pending family. */
const FAMILY_RESIDUALS: Record<PendingFamily, readonly (keyof ArchetypeEntry)[]> = {
  returning: ['throwRangeTiles'],
  whip: [],
  'minion-sentry': ['aiClass', 'attackRateTicks', 'sentryRangeTiles'],
  'explosive-aoe': ['blastRadiusTiles', 'trigger', 'fuseTicks', 'falloff'],
  'piercing-beam': ['tickRateTicks'],
}
const ALL_RESIDUALS = [...new Set(Object.values(FAMILY_RESIDUALS).flat())]
const OLD_FAMILY_RESIDUALS: readonly (keyof ArchetypeEntry)[] = ['projectilesPerUse', 'spreadDegrees', 'inheritsAmmoProjectile', 'pierce', 'lifetimeTicks', 'slightSpread', 'damageMultiplierPct']

/** Overlay residuals that do not belong to the weapon's family are build errors. */
function checkResidualKeys(c: FamilyContext): void {
  const e = c.entry
  if (!e) return
  const allowed = FAMILY_RESIDUALS[c.family]
  const wrong = [...ALL_RESIDUALS, ...OLD_FAMILY_RESIDUALS].filter((k) => e[k] !== undefined && !allowed.includes(k))
  if (wrong.length > 0) throw new OverlayError(`[E_SCHEMA] ${where(c.w)}: ${c.family} takes no ${wrong.join(', ')}`)
}

export function deriveFamily(c: FamilyContext): FamilyOutcome {
  checkResidualKeys(c)
  switch (c.family) {
    case 'returning':
      return deriveReturning(c)
    case 'whip':
      return deriveWhip(c)
    case 'minion-sentry':
      return deriveMinionSentry(c)
    case 'explosive-aoe':
      return deriveExplosive(c)
    case 'piercing-beam':
      return deriveBeam(c)
  }
}

const quotes = (c: FamilyContext) => (c.entry?.evidence ?? []).map((x) => x.quote)
const stated = (c: FamilyContext, test: (q: string) => boolean, what: string) => {
  if (!quotes(c).some(test)) throw new OverlayError(`[E_SCHEMA] ${where(c.w)}: no quote states ${what}`)
}
const member = (
  variant: FamilyVariant,
  partial: Record<string, unknown>,
  missing: string[],
  derivation: string[],
  sources: ProvSource[],
  residuals: string[],
  complete: () => ArchetypeParams,
  extra: { candidates?: Record<string, string>; conflicts?: string[]; modeled?: string[] } = {},
): FamilyOutcome => ({ kind: 'member', variant, ...(missing.length === 0 ? { params: complete() } : {}), partial, missing, derivation, sources, residuals, modeled: extra.modeled ?? [], candidates: extra.candidates ?? {}, conflicts: extra.conflicts ?? [] })

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/)
const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s)

/** Convention-dependent attack-rate / range statements of a summon article (see FamilyOutcome.candidates). */
function summonCandidates(text: string, missing: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (missing.includes('attackRateTicks')) {
    // the base rate only: sentences conditioned on armor / buffs / accessories ("If the player is wearing …") are other setups
    const rates = sentencesOf(text).filter((s) => /\b(?:once (?:every|per)|times per second|cooldown)\b/i.test(s) && !/\binvincibility\b|\bimmunity\b/i.test(s) && !/^(?:if|with|while|when)\b/i.test(s.trim()))
    const iframes = sentencesOf(text).map((s) => [s, HIT_CAP.exec(s)?.[1]] as const).find(([, n]) => n !== undefined)
    if (rates.length > 0) out.attackRateTicks = `rate stated only as "${clip(rates[0])}"`
    else if (iframes) out.attackRateTicks = `only the hit cap is stated: ${iframes[1]}-tick immunity frames ("${clip(iframes[0])}")`
  }
  if (missing.includes('sentryRangeTiles')) {
    const m = /[^.]*\bManhattan distance of (\d+(?:\.\d+)?) tiles\b[^.]*/i.exec(text)
    if (m) out.sentryRangeTiles = `Manhattan distance ${m[1]} tiles ("${clip(m[0].trim())}")`
  }
  return out
}

function deriveReturning(c: FamilyContext): FamilyOutcome {
  const { w, stats } = c
  const variant = returningVariantOf(w.tags)
  if (!variant) return { kind: 'not-member', key: 'not-returning', reason: 'Not simulated: the game data does not describe a plain boomerang, flail or yoyo for this weapon, so the returning-weapon parameters would not represent it.' }
  const held = stats.channel === true
  if (variant === 'flail' && held) return { kind: 'not-member', key: 'thrown-flail', reason: THROWN_FLAIL_REASON }
  const why: string[] = []
  if (w.damageClass !== 'melee') why.push('not a melee weapon')
  if (stats.noMelee !== true) why.push('the item itself deals contact damage')
  if (!c.shootProjectile) why.push('no thrown projectile')
  if (variant === 'yoyo' && !held) why.push('not held')
  if (variant === 'yoyo' && stats.useStyle !== 5) why.push(`use style ${String(stats.useStyle ?? 'Unknown')}`)
  if (variant === 'boomerang' && held) why.push('held use')
  if (why.length > 0) return { kind: 'not-member', key: 'not-returning', reason: `Not simulated: the game data does not describe a plain ${VARIANT_NOUN[variant]} for this weapon (${why.join(', ')}), so the returning-weapon parameters would not represent it.` }

  const derivation: string[] = []
  const sources: ProvSource[] = [c.projSrc]
  const residuals: string[] = []
  const missing: string[] = []
  const conflicts: string[] = []
  let throwRangeTiles: number | undefined
  if (variant === 'yoyo') {
    if (c.entry?.throwRangeTiles !== undefined) throw new OverlayError(`[E_SCHEMA] ${where(w)}: a yoyo's reach comes from its infobox "Reach" row, never from the overlay`)
    const row = c.box?.rows.find((r) => r.label === 'Reach')?.value
    const infobox = /^(\d+(?:\.\d+)?) tiles$/.exec(row ?? '')?.[1]
    const tableValue = decimal(c.tables.yoyos.rows.get(w.id)?.['Reach (tiles)'])
    if (infobox === undefined) missing.push('throwRangeTiles')
    else if (tableValue !== undefined && tableValue !== Number(infobox)) {
      missing.push('throwRangeTiles')
      conflicts.push('throwRangeTiles')
      derivation.push(`throw range withheld: the infobox "Reach" ${infobox} tiles and the Yoyos table ${tableValue} tiles disagree`)
    } else {
      throwRangeTiles = Number(infobox)
      derivation.push(`throwRange ${throwRangeTiles} tiles = the item infobox "Reach" row${tableValue !== undefined ? ` (Yoyos list table agrees: ${tableValue})` : ' (not in the Yoyos list table)'}`)
      if (tableValue !== undefined && c.tables.yoyos.source) sources.push(c.tables.yoyos.source)
    }
    derivation.push(`returnMode tethered + control cursor-follow (rule: "${c.ruleQuote('yoyoThrown')}" / "${c.ruleQuote('yoyoString')}")`)
    sources.push(c.rule('yoyoThrown'), c.rule('yoyoString'), c.rule('useStyleShoot'))
  } else {
    const fromEntry = c.entry?.throwRangeTiles
    if (c.statedRange) {
      c.evidence.quote(c.page, c.statedRange.quote, `lab-params ${w.name}: stated throw range`)
      if (fromEntry !== undefined && fromEntry !== c.statedRange.tiles) throw new OverlayError(`[E_SCHEMA] ${where(w)}: the article states a range of ${c.statedRange.tiles} tiles; the overlay may not override it`)
      throwRangeTiles = c.statedRange.tiles
      derivation.push(`throwRange ${throwRangeTiles} tiles = the range the article states: "${c.statedRange.quote}" (AMENDMENTS-012 B56 extraction; quote checked)`)
    } else if (fromEntry !== undefined) {
      stated(c, (q) => statesTiles(q, fromEntry), `a range of ${fromEntry} tiles`)
      throwRangeTiles = fromEntry
      residuals.push('throwRangeTiles')
      derivation.push(`throwRange ${fromEntry} tiles (reviewed overlay quote states it)`)
    } else missing.push('throwRangeTiles')
    const key: FamilyRuleKey = variant === 'boomerang' ? 'boomerangReturn' : 'flailLaunched'
    derivation.push(`returnMode auto-return + control fire-and-forget (rule: "${c.ruleQuote(key)}"${variant === 'flail' ? `; not held = launched: "${c.ruleQuote('flailThrown')}"` : ''})`)
    sources.push(c.rule(key), ...(variant === 'flail' ? [c.rule('flailThrown')] : []))
  }
  const returnMode = variant === 'yoyo' ? 'tethered' : 'auto-return'
  const control = variant === 'yoyo' ? 'cursor-follow' : 'fire-and-forget'
  const v = variant as 'yoyo' | 'boomerang' | 'flail'
  return member(variant, { variant: v, ...(throwRangeTiles !== undefined ? { throwRangeTiles } : {}), returnMode, control }, missing, derivation, sources, residuals, () => ({
    archetype: 'returning',
    variant: v,
    throwRangeTiles: throwRangeTiles as number,
    returnMode,
    control,
  }), { conflicts })
}

function deriveWhip(c: FamilyContext): FamilyOutcome {
  const { w } = c
  const why: string[] = []
  if (w.damageClass !== 'summon') why.push('not a summon weapon')
  if (!c.shootProjectile || c.shootProjectile.name !== w.name) why.push('its projectile is not the whip itself')
  if (why.length > 0) return { kind: 'not-member', key: 'not-whip', reason: `Not simulated: the game data does not describe a plain whip for this weapon (${why.join(', ')}), so the whip parameters would not represent it.` }
  const derivation: string[] = []
  const sources: ProvSource[] = [c.projSrc, c.rule('whipArc'), c.rule('whipTag')]
  const missing: string[] = []
  const conflicts: string[] = []
  const row = c.tables.whips.rows.get(w.id)
  if (row && c.tables.whips.source) sources.push(c.tables.whips.source)
  const tip = (w.behaviorText ?? '').split('\n')
  const rangeTiles = decimal(row?.['Range (tiles)'])
  if (rangeTiles === undefined || !(rangeTiles > 0)) missing.push('rangeTiles')
  else derivation.push(`range ${rangeTiles} tiles = the Whips list table "Range (tiles)"`)
  // tag damage: the tooltip (game text) vs the table
  const tipTag = tip.map((l) => /^(\d+) summon tag damage$/.exec(l.trim())?.[1]).find(Boolean)
  const tableTag = decimal(row?.['Tag damage'])
  let tagDamageFlat: number | undefined
  if (tipTag !== undefined && tableTag !== undefined && Number(tipTag) !== tableTag) {
    missing.push('tagDamageFlat')
    conflicts.push('tagDamageFlat')
    derivation.push(`tag damage withheld: tooltip ${tipTag} vs Whips table ${tableTag}`)
  } else if (tipTag !== undefined || tableTag !== undefined) {
    tagDamageFlat = Number(tipTag ?? tableTag)
    derivation.push(`tag damage ${tagDamageFlat} = ${tipTag !== undefined ? `the tooltip "${tipTag} summon tag damage"${tableTag !== undefined ? ' (Whips table agrees)' : ''}` : 'the Whips table "Tag damage" (no tooltip line)'}`)
  } else missing.push('tagDamageFlat')
  const tipCrit = tip.map((l) => /^(\d+)% summon tag critical strike chance$/.exec(l.trim())?.[1]).find(Boolean)
  const tableCrit = /(\d+)% tag critical chance/.exec(row?.['On-hit effect'] ?? '')?.[1]
  let tagCritPct: number | undefined
  if (tipCrit !== undefined && tableCrit !== undefined && tipCrit !== tableCrit) {
    missing.push('tagCritPct')
    conflicts.push('tagCritPct')
    derivation.push(`tag crit withheld: tooltip ${tipCrit}% vs Whips table ${tableCrit}%`)
  } else if (tipCrit !== undefined || tableCrit !== undefined) {
    tagCritPct = Number(tipCrit ?? tableCrit)
    derivation.push(`tag crit ${tagCritPct}% = ${tipCrit !== undefined ? 'the tooltip' : 'the Whips table'}${tipCrit !== undefined && tableCrit !== undefined ? ' (Whips table agrees)' : ''}`)
  }
  const penalty = /^(\d+(?:\.\d+)?)%$/.exec((row?.['Multihit penalty'] ?? '').trim())?.[1]
  const falloffPerTarget = penalty !== undefined && Number(penalty) < 100 ? Math.round(Number(penalty) * 1e4) / 1e6 : undefined
  if (falloffPerTarget !== undefined) {
    derivation.push(`falloff ${falloffPerTarget} per target = the Whips table "Multihit penalty" ${penalty}% (rule: "${c.ruleQuote('whipMultihit')}")`)
    sources.push(c.rule('whipMultihit'))
  }
  // the wiki states no swing angle anywhere: AMENDMENTS-013 B63 P-1 models it (labeled)
  const arcDegrees = WHIP_ARC_DEGREES
  derivation.push(`arc ${arcDegrees}° forward (modeling convention AMENDMENTS-013 B63 P-1, the B44 "swung overhead" basis; rule: "${c.ruleQuote('whipArc')}" — the wiki states no angle)`)
  const partial = { arcDegrees, ...(rangeTiles !== undefined ? { rangeTiles } : {}), ...(tagDamageFlat !== undefined ? { tagDamageFlat } : {}), ...(tagCritPct !== undefined ? { tagCritPct } : {}), ...(falloffPerTarget !== undefined ? { falloffPerTarget } : {}) }
  return member('whip', partial, [...new Set(missing)], derivation, sources, [], () => ({
    archetype: 'whip',
    arcDegrees,
    rangeTiles: rangeTiles as number,
    tagDamageFlat: tagDamageFlat as number,
    ...(tagCritPct !== undefined ? { tagCritPct } : {}),
    ...(falloffPerTarget !== undefined ? { falloffPerTarget } : {}),
  }), { conflicts, modeled: [modeledBy('whip-arc', 'arcDegrees')] })
}

function deriveMinionSentry(c: FamilyContext): FamilyOutcome {
  const { w, stats, entry } = c
  const p = c.shootProjectile
  const variant: FamilyVariant | undefined = stats.sentry === true ? 'sentry' : p?.stats.minion === true ? 'minion' : undefined
  if (w.damageClass !== 'summon' || !variant) {
    return { kind: 'not-member', key: 'not-minion-sentry', reason: `Not simulated: the game data does not describe a minion or sentry for this weapon (${w.damageClass !== 'summon' ? 'not a summon weapon' : 'the summoned projectile is neither a minion nor a sentry'}), so the summon parameters would not represent it.` }
  }
  const derivation: string[] = []
  const sources: ProvSource[] = [c.projSrc]
  const residuals: string[] = []
  const missing: string[] = []
  let slotCost: number | undefined
  if (variant === 'sentry') {
    slotCost = 1
    derivation.push(`slotCost 1 sentry slot (Iteminfo sentry; rule: "${c.ruleQuote('sentrySlot')}")`)
    sources.push(c.rule('sentrySlot'), c.rule('sentryStationary'))
  } else {
    const slots = p?.stats.minionSlots
    if (typeof slots === 'number' && slots > 0) {
      slotCost = slots
      derivation.push(`slotCost ${slots} = Projectileinfo minionSlots of ${p?.name ?? p?.internalName} #${c.shoot} (rule: "${c.ruleQuote('minionSlot')}")`)
      sources.push(c.rule('minionSlot'))
    } else {
      missing.push('slotCost')
      derivation.push(`slot cost: Projectileinfo minionSlots of ${p?.name ?? p?.internalName} #${c.shoot} is ${String(slots)} (the slot is held elsewhere) → missing`)
    }
  }
  const aiClass = entry?.aiClass
  if (aiClass !== undefined) {
    stated(c, (q) => AI_CLASS_EVIDENCE[aiClass].re.test(q), `the ${aiClass} behavior (${AI_CLASS_EVIDENCE[aiClass].rule})`)
    residuals.push('aiClass')
    derivation.push(`aiClass ${aiClass} (reviewed quote: ${AI_CLASS_EVIDENCE[aiClass].rule})`)
  } else missing.push('aiClass')
  const modeled: string[] = []
  const rateCandidates: Record<string, string> = {}
  let rate = entry?.attackRateTicks
  if (rate !== undefined) {
    const r = rate
    const found = quotes(c).map(statedIntervalTicks).filter((x) => x?.ticks === r)
    if (found.length === 0) throw new OverlayError(`[E_SCHEMA] ${where(w)}: no quote states an attack rate of ${rate} ticks`)
    if (found.every((x) => x?.average)) throw new OverlayError(`[E_SCHEMA] ${where(w)}: the quoted attack rate of ${rate} ticks is an average — an average is modeled (AMENDMENTS-013 B63 P-2) only from the article's own rate sentence, never set by the overlay`)
    residuals.push('attackRateTicks')
    derivation.push(`attack rate every ${rate} ticks (reviewed quote states it)`)
  } else {
    // the article's own base-rate sentence (stated, or modeled by B63 P-2), else a contact minion's hit cap (B63 P-3)
    const statedRate = statedSummonRate(c.text)
    const cap = statedRate === undefined ? statedHitCap(c.text) : undefined
    if (statedRate !== undefined && statedRate !== 'ambiguous') {
      c.evidence.sentence(c.page, statedRate.quote, `lab-params ${w.name}: stated attack rate`)
      rate = statedRate.ticks
      if (statedRate.exact) derivation.push(`attack rate every ${rate} ticks = ${statedRate.seconds} s × 60, the article: "${statedRate.quote}" (quote checked)`)
      else {
        modeled.push(modeledBy('summon-average-rate', 'attackRateTicks'))
        derivation.push(`attack rate every ${rate} ticks = ${statedRate.seconds} s × 60 rounded half-to-even (modeling convention AMENDMENTS-013 B63 P-2: an average / random cooldown or a time that is not whole ticks): "${statedRate.quote}" (quote checked)`)
      }
    } else if (cap !== undefined && cap !== 'ambiguous' && 'ticks' in cap && variant === 'minion' && aiClass !== undefined && CONTACT_AI_CLASSES.includes(aiClass)) {
      c.evidence.sentence(c.page, cap.quote, `lab-params ${w.name}: stated immunity frames`)
      rate = cap.ticks
      modeled.push(modeledBy('summon-hit-cap', 'attackRateTicks'))
      derivation.push(`attack rate every ${rate} ticks = the stated ${cap.ticks}-tick immunity-frame hit cap, an UPPER BOUND — maximum rate; actual depends on minion AI pathing (modeling convention AMENDMENTS-013 B63 P-3; contact class ${aiClass}): "${cap.quote}" (quote checked)`)
    } else {
      missing.push('attackRateTicks')
      if (statedRate === 'ambiguous') rateCandidates.attackRateTicks = 'the article states several different base rates (per variant / tier) — no single rate'
      else if (cap === 'ambiguous') rateCandidates.attackRateTicks = 'the article states several different immunity-frame counts — no single hit cap'
      else if (cap !== undefined && 'notBinding' in cap) {
        rateCandidates.attackRateTicks = `the article says its immunity frames do not limit its hits ("${clip(cap.notBinding)}") — B63 P-3 not applied`
        derivation.push(`attack rate: the stated immunity frames are not the limit — "${clip(cap.notBinding)}" → B63 P-3 not applied → missing`)
      } else if (cap !== undefined) rateCandidates.attackRateTicks = `only the hit cap is stated: ${cap.ticks}-tick immunity frames ("${clip(cap.quote)}") — B63 P-3 applies to contact minions only (${variant === 'sentry' ? 'a sentry' : aiClass === undefined ? 'its attack style is not classified' : `class ${aiClass}`})`
    }
  }
  const range = entry?.sentryRangeTiles
  if (variant === 'minion' && range !== undefined) throw new OverlayError(`[E_SCHEMA] ${where(w)}: sentryRangeTiles is for sentries only`)
  if (variant === 'sentry') {
    if (range !== undefined) {
      stated(c, (q) => statesTiles(q, range) && !/manhattan/i.test(q), `a targeting radius of ${range} tiles (a Manhattan distance is not a radius)`)
      residuals.push('sentryRangeTiles')
      derivation.push(`sentry range ${range} tiles (reviewed quote states it)`)
    } else missing.push('sentryRangeTiles')
  }
  const v = variant as 'minion' | 'sentry'
  const partial = { variant: v, ...(slotCost !== undefined ? { slotCost } : {}), ...(aiClass ? { aiClass } : {}), ...(rate !== undefined ? { attackRateTicks: rate } : {}), ...(range !== undefined ? { sentryRangeTiles: range } : {}) }
  return member(
    variant,
    partial,
    missing,
    derivation,
    sources,
    residuals,
    () => ({
      archetype: 'minion-sentry',
      variant: v,
      slotCost: slotCost as number,
      aiClass: aiClass as AiClass,
      attackRateTicks: rate as number,
      ...(v === 'sentry' ? { sentryRangeTiles: range as number } : {}),
    }),
    { candidates: { ...summonCandidates(c.text, missing), ...rateCandidates }, modeled },
  )
}

function deriveExplosive(c: FamilyContext): FamilyOutcome {
  const { w, stats, entry } = c
  const useAmmo = typeof stats.useAmmo === 'number' ? stats.useAmmo : 0
  if (useAmmo > 0 || w.ammoClass !== undefined) {
    return { kind: 'not-member', key: 'ammo-explosive', reason: ammoExplosiveReason(w.ammoClass) }
  }
  if (!c.shootProjectile) return { kind: 'not-member', key: 'not-explosive', reason: 'Not simulated: the game data gives this weapon no thrown projectile, so the explosive parameters would not represent it.' }
  const derivation: string[] = []
  const sources: ProvSource[] = [c.projSrc, c.rule('explosiveDelay')]
  const residuals: string[] = []
  const missing: string[] = []
  // trigger + fuse: the article's own fuse sentence, else a reviewed quote
  const fuse = statedFuse(c.text)
  let trigger = entry?.trigger
  let fuseTicks = entry?.fuseTicks
  if (fuse) {
    c.evidence.quote(c.page, fuse.quote, `lab-params ${w.name}: stated fuse`)
    if ((trigger !== undefined && trigger !== 'timed') || (fuseTicks !== undefined && fuseTicks !== fuse.ticks)) throw new OverlayError(`[E_SCHEMA] ${where(w)}: the article states a ${fuse.ticks}-tick fuse; the overlay may not override it`)
    trigger = 'timed'
    fuseTicks = fuse.ticks
    derivation.push(`trigger timed, fuse ${fuse.ticks} ticks = the article: "${fuse.quote}" (quote checked)`)
  } else if (trigger !== undefined) {
    if (trigger === 'timed') {
      if (fuseTicks === undefined) throw new OverlayError(`[E_SCHEMA] ${where(w)}: a timed trigger needs fuseTicks`)
      const ft = fuseTicks
      stated(c, (q) => statesFuse(q, ft), `a fuse of ${ft} ticks`)
      residuals.push('trigger', 'fuseTicks')
    } else {
      if (fuseTicks !== undefined) throw new OverlayError(`[E_SCHEMA] ${where(w)}: an impact trigger has no fuse`)
      stated(c, (q) => /\bexplod\w* (?:on|upon) (?:impact|contact)\b|\bon impact\b/i.test(q), 'an explosion on impact')
      residuals.push('trigger')
    }
    derivation.push(`trigger ${trigger}${fuseTicks !== undefined ? `, fuse ${fuseTicks} ticks` : ''} (reviewed quote states it)`)
  } else missing.push('trigger')
  const modeled: string[] = []
  const candidates: Record<string, string> = {}
  let radius = entry?.blastRadiusTiles
  if (radius !== undefined) {
    const r = radius
    stated(c, (q) => statesTiles(q, r) && /\bradius\b/i.test(q), `a blast radius of ${radius} tiles`)
    residuals.push('blastRadiusTiles')
    derivation.push(`blast radius ${radius} tiles (reviewed quote states it)`)
  } else {
    // AMENDMENTS-013 B63 P-5: a stated square damage area → its inscribed circle (own article first, then reviewed quotes)
    const squares = [{ text: c.text, own: true }, ...quotes(c).map((q) => ({ text: q, own: false }))].flatMap(({ text, own }) =>
      sentencesOf(text).flatMap((s) => {
        const m = SQUARE_AREA.exec(s)
        return m ? [{ half: Number(m[1]), quote: s.trim(), own }] : []
      }),
    )
    const halves = [...new Set(squares.map((x) => x.half))]
    if (halves.length === 1) {
      const sq = squares[0]
      if (sq.own) c.evidence.sentence(c.page, sq.quote, `lab-params ${w.name}: stated square damage area`)
      else residuals.push('blastRadiusTiles') // the reviewed entry's quote supplies it
      radius = sq.half
      modeled.push(modeledBy('square-blast-radius', 'blastRadiusTiles'))
      derivation.push(
        `blast radius ${radius} tiles = half the side of the stated square damage area (${radius} tiles each way → a ${radius * 2}-tile square; its inscribed circle — modeling convention AMENDMENTS-013 B63 P-5, conservative: never overstates the area): "${clip(sq.quote)}" (${sq.own ? 'quote checked' : 'reviewed overlay quote'})`,
      )
    } else {
      missing.push('blastRadiusTiles')
      if (halves.length > 1) candidates.blastRadiusTiles = `the sources state different square areas (${halves.join(' / ')} tiles each way) — no single radius`
    }
  }
  const falloff = entry?.falloff
  if (falloff !== undefined) {
    if (falloff === 'none') stated(c, (q) => /\bdeals? \d+ (?:\w+ )?damage to all\b/i.test(q) && /\b(?:radius|within)\b/i.test(q), 'the same damage to every enemy in the blast area (falloff none)')
    else stated(c, (q) => /\bdistance\b/i.test(q) && /\b(?:less|decreas\w*|reduc\w*)\b/i.test(q), 'damage decreasing with distance (falloff linear)')
    residuals.push('falloff')
    derivation.push(`falloff ${falloff} (reviewed quote states it)`)
  } else missing.push('falloff')
  const partial = { ...(radius !== undefined ? { blastRadiusTiles: radius } : {}), ...(trigger ? { trigger } : {}), ...(fuseTicks !== undefined ? { fuseTicks } : {}), ...(falloff ? { falloff } : {}) }
  return member(
    'explosive',
    partial,
    missing,
    derivation,
    sources,
    residuals,
    () => ({
      archetype: 'explosive-aoe',
      blastRadiusTiles: radius as number,
      trigger: trigger as 'impact' | 'timed',
      ...(fuseTicks !== undefined ? { fuseTicks } : {}),
      falloff: falloff as 'none' | 'linear',
    }),
    { candidates, modeled },
  )
}

function deriveBeam(c: FamilyContext): FamilyOutcome {
  const { w, stats, entry } = c
  const p = c.shootProjectile
  if (stats.channel !== true || (w.damageClass !== 'magic' && w.damageClass !== 'ranged') || !p || p.name !== w.name) {
    const why = stats.channel !== true ? 'not held' : !p ? 'no projectile' : `its projectile "${p.name ?? p.internalName}" is not the held weapon`
    return { kind: 'not-member', key: 'not-beam', reason: `Not simulated: the game data does not describe a held beam for this weapon (${why}), so the beam parameters would not represent it.` }
  }
  const derivation = [`mode channel-beam: held use (Iteminfo channel) of a held projectile named after the weapon (Projectileinfo #${c.shoot} "${p.name}")`]
  const sources: ProvSource[] = [c.projSrc]
  const residuals: string[] = []
  const missing: string[] = []
  const tick = entry?.tickRateTicks
  if (tick !== undefined) {
    stated(c, (q) => statesTickRate(q, tick), `a hit rate of every ${tick} ticks`)
    residuals.push('tickRateTicks')
    derivation.push(`tick rate every ${tick} ticks (reviewed quote states it)`)
  } else missing.push('tickRateTicks')
  return member('beam', { mode: 'channel-beam', ...(tick !== undefined ? { tickRateTicks: tick } : {}) }, missing, derivation, sources, residuals, () => ({ archetype: 'piercing-beam', mode: 'channel-beam', tickRateTicks: tick as number }))
}

/** Values recorded from a reviewed entry for later (sim stubs: bounce / chain; a beam's hit rate on a limitation). */
export interface RecordedExtras {
  bounceCount?: number
  chainTargets?: number
  tickRateTicks?: number
}

/** Quote-checks and returns the recorded extras of an entry (both decisions). */
export function recordedExtras(entry: LabParamsEntry, w: Weapon, statesNumber: (q: string, n: number) => boolean): RecordedExtras {
  const qs = entry.evidence.map((x) => x.quote)
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new OverlayError(`[E_SCHEMA] ${where(w)}: no quote states ${what}`)
  }
  const out: RecordedExtras = {}
  if (entry.bounceCount !== undefined) {
    const n = entry.bounceCount
    check(qs.some((q) => statesBounce(q, n, statesNumber)), `a bounce count of ${n}`)
    out.bounceCount = n
  }
  if (entry.chainTargets !== undefined) {
    const n = entry.chainTargets
    check(qs.some((q) => /\b(?:chain\w*|jump\w*|arc\w*)\b/i.test(q) && statesNumber(q, n)), `${n} chain targets`)
    out.chainTargets = n
  }
  if (entry.decision === 'limitation' && entry.tickRateTicks !== undefined) {
    const n = entry.tickRateTicks
    check(qs.some((q) => statesTickRate(q, n)), `a hit rate of every ${n} ticks`)
    out.tickRateTicks = n
  }
  return out
}

/** The family-specific limitation reason while the archetype has no interpreter (see the header). */
export function pendingReason(variant: FamilyVariant, implemented: boolean, specific?: string): string {
  if (implemented) return specific ?? FAMILY_REASON[variant]
  return specific ? `${FAMILY_REASON[variant]} ${specific}` : FAMILY_REASON[variant]
}
