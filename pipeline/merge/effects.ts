/**
 * Game-text effect lines → StatEffect[] (P2-S8, DATA_SCHEMA_SPEC §2.3). Shared by armor pieces,
 * accessories and armor-set bonuses.
 *
 * SOURCE. The in-game tooltip (Cargo Items `tooltip`, the wiki's transcription of the game text) for
 * pieces and accessories; the set infobox "Set Bonus" game text (fetched article revision) for sets.
 * Each line is classified by exactly one explicit rule below:
 * - STAT rules: the line's shape maps onto the CLOSED StatKind enum; every emitted |value| must occur
 *   in the line (the line is the verbatim quote — checked), a negative value needs a reduction word.
 * - SPECIAL rules: a real effect the enum cannot express (no number, or a mechanic) → {kind:"special",
 *   text: the verbatim line, simulated:false, sourceUrl}. Rules that WOULD be stats under a proposed
 *   StatKind extension name it (`proposed`) — reported as amendment candidates, never emitted as stats.
 * - FLAVOR rules: quoted flavor text / lore lines / explanations of the previous line — no effect.
 * A line no rule matches FAILS the build (closed enum: an explicit rule or enum extension is required,
 * never silent text). Platform-variant lines (Old-gen console / NDS / 3DS) are dropped; a trailing
 * "(Desktop, Console and Mobile versions)" note is removed; a line ending with "," continues on the next.
 *
 * CATEGORIES (Accessory.categories): each StatKind and each special rule names the categories it
 * contributes (mobility / defense / offense / utility); an accessory's categories are the union over its
 * classified effects — a documented site taxonomy, so the pipeline lists `categories` in editorialFields.
 *
 * CROSS-CHECK. Cargo Equipinfo is the wiki's machine transcription of each item's UpdateEquip code
 * (meleeDamage "+0.1", meleeCrit "+10", statManaMax2 "+40", …; class-less damage = all four class
 * damage fields, class-less crit = melee/ranged/magic crit). The per-field sum of the tooltip-derived
 * stats must equal the Equipinfo field; a disagreement withholds the item's effects (Unknown +
 * source-mismatch gap). Set bonuses have no Equipinfo counterpart (UpdateArmorSet is not transcribed).
 */
import type { DamageClass, StatEffect, StatKind } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { OverlayError } from './registry'
import { tooltipText } from './weapons'

export type EffectCategory = 'mobility' | 'defense' | 'offense' | 'utility'
export const EFFECT_CATEGORIES: readonly EffectCategory[] = ['mobility', 'defense', 'offense', 'utility']

/** Category contributed by each StatKind (the Loadout taxonomy). */
export const STAT_CATEGORY: Record<StatKind, EffectCategory> = {
  'damage-pct': 'offense',
  'damage-flat': 'offense',
  'crit-pct': 'offense',
  'melee-speed-pct': 'offense',
  'attack-speed-pct': 'offense',
  'defense-flat': 'defense',
  'damage-reduction-pct': 'defense',
  'move-speed-pct': 'mobility',
  'jump-boost': 'mobility',
  'flight-time-ticks': 'mobility',
  'max-mana-flat': 'offense',
  'mana-cost-pct': 'offense',
  'mana-regen': 'offense',
  'minion-slots': 'offense',
  'sentry-slots': 'offense',
  'whip-range-pct': 'offense',
  'life-regen': 'defense',
  'max-life-flat': 'defense',
  'mining-speed-pct': 'utility',
  'aggro-flat': 'defense',
  // AMENDMENTS-011 B54 kinds — each takes the category its former special rule contributed
  'fishing-power-flat': 'utility',
  'ammo-save-pct': 'offense',
  'knockback-pct': 'offense',
  'tag-effect-slots': 'offense',
  'lava-immunity-ticks': 'defense',
  'melee-scale-pct': 'offense',
  'tile-reach-flat': 'utility',
  'potion-cooldown-pct': 'defense',
  'armor-penetration-flat': 'offense',
  'minion-knockback': 'offense',
  'whip-speed-pct': 'offense',
}

/**
 * `stated` = the number as the line states it when the emitted value is a unit conversion of it
 * (§2 units: "7 seconds" → 420 ticks); the classifier checks the LINE states `stated ?? |value|`.
 */
type Stat = { stat: StatKind; value: number; scope?: DamageClass; stated?: number }
type Groups = Record<string, string>

interface RuleBase {
  id: string
  re: RegExp
}
export interface StatRule extends RuleBase {
  kind: 'stat'
  stats: (g: Groups) => Stat[]
  /** The line also states an unmodeled part: it is ALSO emitted as a special (verbatim line). */
  remainder?: { categories: EffectCategory[]; proposed?: string }
}
export interface SpecialRule extends RuleBase {
  kind: 'special'
  categories: EffectCategory[]
  /** Proposed StatKind extension that would make this line a stat (amendment candidate). */
  proposed?: string
}
export interface FlavorRule extends RuleBase {
  kind: 'flavor'
}
export type EffectRule = StatRule | SpecialRule | FlavorRule

const n = (g: Groups, k = 'n') => Number(g[k])
const cls = (s: string | undefined): DamageClass | undefined => {
  const c = s?.toLowerCase()
  return c === 'melee' || c === 'ranged' || c === 'magic' || c === 'summon' ? c : undefined
}
const CLASS = '(?:melee|ranged|magic|summon)'
const dmg = (value: number, scope?: string): Stat => ({ stat: 'damage-pct', value, ...(cls(scope) ? { scope: cls(scope) } : {}) })
const crit = (value: number, scope?: string): Stat => ({ stat: 'crit-pct', value, ...(cls(scope) ? { scope: cls(scope) } : {}) })
const stat = (s: StatKind, value: number): Stat => ({ stat: s, value })
const sp = (id: string, re: RegExp, categories: EffectCategory[], proposed?: string): SpecialRule => ({ id, kind: 'special', re, categories, ...(proposed ? { proposed } : {}) })
const st = (id: string, re: RegExp, stats: (g: Groups) => Stat[], remainder?: StatRule['remainder']): StatRule => ({ id, kind: 'stat', re, stats, ...(remainder ? { remainder } : {}) })

/**
 * The rule table. Order matters only for readability: a line must match exactly ONE rule (checked), so
 * overlapping shapes are a build error. Stat rules are anchored, exact sentence shapes.
 */
export const EFFECT_RULES: readonly EffectRule[] = [
  // ---- damage / crit ----
  st('damage-class', new RegExp(`^(?<n>\\d+)% (?:increased|extra) (?<c>${CLASS}) damage$`, 'i'), (g) => [dmg(n(g), g.c)]),
  st('damage-all', /^(?<n>\d+)% increased damage$/, (g) => [dmg(n(g))]),
  st('damage-class-by', new RegExp(`^Increases (?:your )?(?<c>${CLASS}) damage by (?<n>\\d+)%$`, 'i'), (g) => [dmg(n(g), g.c)]),
  st('damage-two-classes', new RegExp(`^(?<n>\\d+)% increased (?<a>${CLASS}) (?:and|&) (?<b>${CLASS}) damage$`, 'i'), (g) => [dmg(n(g), g.a), dmg(n(g), g.b)]),
  st('damage-two-classes-by', new RegExp(`^Increases (?<a>${CLASS}) and (?<b>${CLASS}) damage by (?<n>\\d+)%$`, 'i'), (g) => [dmg(n(g), g.a), dmg(n(g), g.b)]),
  st('crit-class', new RegExp(`^(?<n>\\d+)% increased (?<c>melee|ranged|magic) critical strike chance$`), (g) => [crit(n(g), g.c)]),
  st('crit-all', /^(?<n>\d+)% increased critical strike chance$/, (g) => [crit(n(g))]),
  st('crit-two-classes', /^(?<n>\d+)% increased (?<a>melee|ranged|magic) and (?<b>melee|ranged|magic) critical strike chance$/, (g) => [crit(n(g), g.a), crit(n(g), g.b)]),
  st('damage-crit', new RegExp(`^(?<n>\\d+)% increased (?:(?<c>${CLASS}) )?damage (?:and|&) critical strike chance$`), (g) => [dmg(n(g), g.c), crit(n(g), g.c)]),
  st('damage-and-crit-split', /^(?<n>\d+)% increased (?<c>magic) damage and (?<m>\d+)% increased (?<d>magic) critical strike chance$/, (g) => [dmg(n(g), g.c), crit(n(g, 'm'), g.d)]),
  // ---- speeds ----
  st('melee-speed', /^(?<n>\d+)% increased melee speed$/, (g) => [stat('melee-speed-pct', n(g))]),
  st('move-speed', /^(?<n>\d+)% increased movement speed$/, (g) => [stat('move-speed-pct', n(g))]),
  st('move-and-melee-speed', /^(?<n>\d+)% increased (?:movement and melee|melee and movement) speed$/, (g) => [stat('move-speed-pct', n(g)), stat('melee-speed-pct', n(g))]),
  st('melee-damage-and-speed', /^(?<n>\d+)% increased melee damage and (?:melee )?speed$/, (g) => [dmg(n(g), 'melee'), stat('melee-speed-pct', n(g))]),
  st('move-and-damage', /^(?<n>\d+)% increased movement speed and (?<m>\d+)% increased damage$/, (g) => [stat('move-speed-pct', n(g)), dmg(n(g, 'm'))]),
  st('damage-and-move', /^(?<n>\d+)% increased damage and (?<m>\d+)% increased movement speed$/, (g) => [dmg(n(g)), stat('move-speed-pct', n(g, 'm'))]),
  // ---- mana ----
  st('max-mana', /^Increases maximum mana by (?<n>\d+)$/, (g) => [stat('max-mana-flat', n(g))]),
  st('mana-cost', /^(?<n>\d+)% reduced mana (?:cost|costs|usage)$/, (g) => [stat('mana-cost-pct', -n(g))]),
  st('max-mana-and-cost', /^Increases maximum mana by (?<n>\d+) and (?<m>\d+)% reduced mana cost$/, (g) => [stat('max-mana-flat', n(g)), stat('mana-cost-pct', -n(g, 'm'))]),
  // ---- summon ----
  st('minion-slots', /^Increases your max number of minions by (?<n>\d+)$/, (g) => [stat('minion-slots', n(g))]),
  st('sentry-slots', /^Increases? your max number of sentries by (?<n>\d+)$/, (g) => [stat('sentry-slots', n(g))]),
  st('whip-range', /^Increases whip range by (?<n>\d+)%$/, (g) => [stat('whip-range-pct', n(g))]),
  // B54: whip speed is a stat (whip-speed-pct); the line states both numbers
  st('whip-range-and-speed', /^Increases whip range by (?<n>\d+)% and speed by (?<m>\d+)%$/, (g) => [stat('whip-range-pct', n(g)), stat('whip-speed-pct', n(g, 'm'))]),
  st('summon-damage-minion-kb', /^Increases your summon damage by (?<n>\d+)% and the knockback of your minions$/, (g) => [dmg(n(g), 'summon')], { categories: ['offense'], proposed: 'minion-knockback (value)' }),
  // summoner hybrid armor (Squire / Monk / Huntress / Apprentice tiers)
  st('sentry-and-melee-speed', /^Increases your max number of sentries by (?<n>\d+) and increases melee speed by (?<m>\d+)%$/, (g) => [stat('sentry-slots', n(g)), stat('melee-speed-pct', n(g, 'm'))]),
  st('sentry-and-ranged-crit', /^Increases your max number of sentries by (?<n>\d+) and increases ranged critical strike chance by (?<m>\d+)%$/, (g) => [stat('sentry-slots', n(g)), crit(n(g, 'm'), 'ranged')]),
  st('sentry-and-two-damage', /^Increases your max number of sentries by (?<n>\d+) and increases summon (?:and|&) melee damage by (?<m>\d+)%$/, (g) => [stat('sentry-slots', n(g)), dmg(n(g, 'm'), 'summon'), dmg(n(g, 'm'), 'melee')]),
  st('sentry-magic-mana', /^Increases your max number of sentries by (?<n>\d+), (?<m>\d+)% increased magic damage and (?<k>\d+)% reduced mana cost$/, (g) => [stat('sentry-slots', n(g)), dmg(n(g, 'm'), 'magic'), stat('mana-cost-pct', -n(g, 'k'))]),
  st('sentry-and-life-regen', /^Increases your max number of sentries by (?<n>\d+) and increases your life regeneration$/, (g) => [stat('sentry-slots', n(g))], { categories: ['defense'], proposed: 'life-regen (unit)' }),
  st('summon-damage-and-x-speed', /^(?<n>\d+)% increased summon damage and (?<x>melee) speed$/, (g) => [dmg(n(g), 'summon'), stat('melee-speed-pct', n(g))]),
  st('summon-damage-and-x-crit', /^(?<n>\d+)% increased summon damage and (?<c>melee|ranged) critical strike chance$/, (g) => [dmg(n(g), 'summon'), crit(n(g), g.c)]),
  st('summon-damage-and-n-x-crit', /^(?<n>\d+)% increased summon damage and (?<m>\d+)% increased (?<c>magic|ranged) critical strike chance$/, (g) => [dmg(n(g), 'summon'), crit(n(g, 'm'), g.c)]),
  st('summon-damage-and-n-x-damage', /^(?<n>\d+)% increased summon damage and (?<m>\d+)% increased (?<c>magic) damage$/, (g) => [dmg(n(g), 'summon'), dmg(n(g, 'm'), g.c)]),
  st('summon-damage-and-n-move', /^(?<n>\d+)% increased summon damage and (?<m>\d+)% increased movement speed$/, (g) => [dmg(n(g), 'summon'), stat('move-speed-pct', n(g, 'm'))]),
  st('summon-damage-crit-and-move', /^(?<n>\d+)% increased summon damage, (?<m>\d+)% increased (?<c>melee|magic) critical strike chance and movement speed$/, (g) => [dmg(n(g), 'summon'), crit(n(g, 'm'), g.c), stat('move-speed-pct', n(g, 'm'))]),
  st('summon-damage-crit-and-n-move', /^(?<n>\d+)% increased summon damage, (?<m>\d+)% increased (?<c>melee) critical strike chance and (?<k>\d+)% increased movement speed$/, (g) => [dmg(n(g), 'summon'), crit(n(g, 'm'), g.c), stat('move-speed-pct', n(g, 'k'))]),
  st('summon-damage-and-life-regen', /^(?<n>\d+)% increased summon damage and massively increased life regeneration$/, (g) => [dmg(n(g), 'summon')], { categories: ['defense'], proposed: 'life-regen (unit)' }),
  st('two-damage-and-ammo', /^(?<n>\d+)% increased summon (?:and|&) ranged damage and (?<m>\d+)% chance to save ammo$/, (g) => [dmg(n(g), 'summon'), dmg(n(g), 'ranged'), stat('ammo-save-pct', n(g, 'm'))]),
  // ---- defense ----
  st('defense-bonus', /^(?<n>\d+) defense$/, (g) => [stat('defense-flat', n(g))]),
  st('damage-reduction', /^Reduces damage taken by (?<n>\d+)%$/, (g) => [stat('damage-reduction-pct', n(g))]),
  // ---- utility ----
  st('mining-speed', /^(?<n>\d+)% increased mining speed$/, (g) => [stat('mining-speed-pct', n(g))]),
  st('mining-speed-by', /^Increases mining speed by (?<n>\d+)%$/, (g) => [stat('mining-speed-pct', n(g))]),
  // ---- AMENDMENTS-011 B54 kinds (former specials whose line states the value) ----
  st('ammo-save', /^(?<n>\d+)% chance (?:to save ammo|not to consume ammo|to not consume ammo)$/, (g) => [stat('ammo-save-pct', n(g))]),
  st('armor-penetration', /^Increases armor penetration by (?<n>\d+)$/, (g) => [stat('armor-penetration-flat', n(g))]),
  st('tag-effect-slots', /^Increases your max number of summon tag effects by (?<n>\d+)$/, (g) => [stat('tag-effect-slots', n(g))]),
  st('fishing-power', /^Increases fishing power by (?<n>\d+)$/, (g) => [stat('fishing-power-flat', n(g))]),
  st('fishing-power-and-line', /^Fishing line will never break, decreases chance of bait consumption, increases fishing power by (?<n>\d+)$/, (g) => [stat('fishing-power-flat', n(g))], { categories: ['utility'] }),
  st('tool-range', /^Increases (?:block placement & tool range|block placement range) by (?<n>\d+)$/, (g) => [stat('tile-reach-flat', n(g))]),
  st('potion-cooldown', /^Reduces the cooldown of healing potions by (?<n>\d+)%$/, (g) => [stat('potion-cooldown-pct', -n(g))]),
  st('life-regen-and-potion-cooldown', /^Provides life regeneration and reduces the cooldown of healing potions by (?<n>\d+)%$/, (g) => [stat('potion-cooldown-pct', -n(g))], { categories: ['defense'], proposed: 'life-regen (unit)' }),
  st('lava-immunity-time', /^Provides (?<n>\d+) seconds of immunity to lava$/, (g) => [{ stat: 'lava-immunity-ticks', value: n(g) * 60, stated: n(g) }]),
  st('fire-blocks-and-lava-immunity-time', /^Grants immunity to fire blocks and (?<n>\d+) seconds of immunity to lava$/, (g) => [{ stat: 'lava-immunity-ticks', value: n(g) * 60, stated: n(g) }], { categories: ['defense'] }),
  // ---- magic set bonus: a reduction that is converted into healing (Spectre Hood) ----
  st('magic-damage-reduced-to-healing', /^Reduces Magic damage by (?<n>\d+)% and converts it to healing force$/, (g) => [dmg(-n(g), 'magic')], { categories: ['utility'] }),

  // ================= specials (no StatKind; verbatim text) =================
  // numbers present, enum has no kind → amendment candidates
  sp('ammo-save-arrows', /^\d+% chance (?:not to consume arrows|to not consume arrows)$/, ['offense'], 'ammo-save-pct with an ammo scope (arrows)'),
  sp('arrow-damage', /^Increases arrow damage by \d+% and greatly increases arrow speed$/, ['offense'], 'damage-pct with an ammo scope (arrow/bullet/rocket)'),
  sp('weapon-type-damage', /^Increases (?:gun|bow|specialist ranged) damage by \d+%$/, ['offense'], 'damage-pct with an ammo scope (arrow/bullet/rocket)'),
  sp('sentry-crit', /^\d+% increased sentry critical strike chance$/, ['offense'], 'crit-pct with a sentry scope'),
  sp('shop-discount', /^Lowers shop prices by \d+%$/, ['utility']),
  sp('trap-damage', /^\d+% reduced damage and debuff time from traps$/, ['defense']),
  sp('team-absorb', /^Absorbs \d+% of damage done to players on your team when above \d+% life$/, ['defense']),
  sp('low-life-shell', /^Puts a shell around the owner when below \d+% life that reduces damage by \d+%$/, ['defense']),
  sp('second-whip', /^Every \d+ swings, joins and attacks with your second whip$/, ['offense']),
  // no number: qualitative stat changes (would need a value from another source)
  sp('aggro', /^Enemies are (?:more|less) likely to target you$/, ['defense'], 'aggro-flat (value only in Equipinfo, not in the game text)'),
  sp('life-regen', /^(?:Slowly regenerates life|Grants minor life regeneration|Greatly increased life regen|Greatly increases life regen when not moving|Greatly increases life regeneration after striking an enemy)$/, ['defense'], 'life-regen (unit)'),
  sp('mana-regen', /^Increases mana regeneration rate$/, ['offense'], 'mana-regen (unit)'),
  sp('jump', /^(?:Increases jump height|Increases jump height and negates fall damage|Increases jump speed and allows auto-jump)$/, ['mobility'], 'jump-boost (value)'),
  sp('knockback', /^(?:Increases melee knockback|Increases whip knockback|Increases the knockback of your minions)$/, ['offense'], 'knockback-pct / minion-knockback (value)'),
  sp('melee-size', /^Increases the size of melee weapons$/, ['offense'], 'melee-scale-pct (value)'),
  sp('minor-all-stats', /^(?:(?:During daytime|During nighttime), grants minor increase to damage|Minor increase to damage), melee speed, critical strike chance, life regeneration, defense, mining speed, and minion knockback$/, ['offense', 'defense'], 'damage-pct + melee-speed-pct + crit-pct + life-regen + defense-flat + mining-speed-pct (values only in Equipinfo) + minion-knockback'),
  sp('movement-accel', /^(?:Increased movement speed and acceleration|Increases movement speed and acceleration|Slightly increases mobility)$/, ['mobility'], 'move-speed-pct (value)'),
  // mobility mechanics
  sp('flight', /^(?:Allows flight|Allows flight and slow fall|Allows flight, super fast running|Allows flight, super fast running, and extra mobility on ice|Grants infinite wing and rocket boot flight|Increases flight and jump mobility|Allows the owner to float for a few seconds|Grants slow fall in exchange for your feet)$/, ['mobility']),
  sp('hover', /^(?:Press Down to toggle hover|Press Up to deactivate hover|Hold Up to boost faster!)$/, ['mobility']),
  sp('run', /^(?:The wearer can run super fast|The wearer can run super fast, and even faster on sand|Provides extra mobility on ice|Ice will not break when you fall on it)$/, ['mobility']),
  sp('extra-jump', /^Allows the holder to (?:double jump|quadruple jump|do an improved double jump)$/, ['mobility']),
  sp('climb-dash', /^(?:Allows the ability to (?:climb walls|slide down walls|dash|climb walls and dash)|Double tap a direction|Allows the player to dash into the enemy|Improved ability if combined with (?:Shoe Spikes|Climbing Claws))$/, ['mobility']),
  sp('fall', /^(?:Negates fall damage|Increases fall resistance)$/, ['mobility', 'defense']),
  sp('liquids', /^(?:Grants the ability to swim|Grants the ability to swim and greatly extends underwater breathing|Provides the ability to walk on water & honey|Provides the ability to walk on water, honey & lava|Allows quick travel in water|Grants the ability to float in water|Turns the holder into a merfolk when entering water|Transforms the holder into merfolk when entering water|Hold Down to Phase while submerged in Shimmer)$/, ['mobility']),
  sp('gravity', /^(?:Allows the holder to reverse gravity|Press Up to change gravity)$/, ['mobility']),
  sp('slam', /^(?:Jump while holding DOWN to slam downward|Slamming into the ground will deal damage to nearby enemies)$/, ['mobility', 'offense']),
  sp('panic', /^Increases movement speed after taking damage$/, ['mobility']),
  // defense mechanics
  sp('immunity', /^Grants immunity to (?!fire blocks and \d)[^\d]+$/, ['defense']),
  sp('cannot-be', /^(?:Cannot be set on fire|Cannot be frozen or chilled)$/, ['defense']),
  sp('lava-touch', /^Reduces damage from touching lava$/, ['defense']),
  sp('invincibility', /^(?:Increases length of invincibility after taking damage|Become immune after striking an enemy)$/, ['defense']),
  sp('dodge', /^(?:Gives a chance to dodge attacks|Has a chance to create illusions and dodge an attack|Temporarily increase critical chance and minion damage after dodge|May confuse nearby enemies after being struck)$/, ['defense']),
  sp('when-damaged', /^(?:Releases bees and douses the user in honey when damaged|Releases bees, douses the user in honey and increases movement speed when damaged|Causes stars to fall after taking damage|Causes stars to fall and increases length of invincibility after taking damage|Causes stars to fall, releases bees and douses the user in honey when damaged|Restores mana when damaged)$/, ['defense']),
  sp('thorns', /^(?:Attackers take damage from the cactus spines|Attackers also take double damage)$/, ['defense']),
  sp('set-mechanic-defense', /^(?:Attacking generates a defensive barrier of titanium shards|Beetles protect you from damage|Solar shields charge over time to protect you & let you dash|A charge is used to damage enemies you touch|Consumed charges explode & damage enemies)$/, ['defense']),
  // offense mechanics
  sp('auto-swing', /^Enables auto swing for melee weapons(?: and whips)?$/, ['offense']),
  sp('on-hit-debuff', /^(?:Melee attacks inflict fire damage|Increases melee knockback and melee attacks inflict fire damage|Arrows inflict poison|Arrows inflict poison, and hits may release bees!|Lights wooden arrows ablaze|Melee and ranged attacks cause frostburn)$/, ['offense']),
  sp('yoyo', /^(?:Increases yoyo range and duration|Throws a counterweight after hitting an enemy with a yoyo|Gives the user (?:master|magic) yoyo skills|Allows the use of two yoyos at once|Allows offstring yoyo tricks)$/, ['offense']),
  sp('summoner-mechanic', /^(?:Significantly increases the duration of your summon tag effects|Minion tag hits discharge ancient power|Walk past a sentry to carry it|Increases the strength of friendly bees)$/, ['offense']),
  sp('proc', /^(?:Periodically redirects arrows towards enemies|Periodically guarantees a critical strike|Periodically recharges with faint light|Ranged hits discharge a damaging pulse|Melee and ranged hits discharge an explosive slash|Increases damage of afflictions on enemies\.|Summons spores over time that will damage enemies|Summons shadow hands to attack your foes|Shoots crossbones at enemies while you are attacking|Releases volatile gelatin periodically that damages enemies)$/, ['offense']),
  sp('mana-mechanic', /^(?:Automatically use mana potions when needed|Increases pickup range for mana stars|Stars restore mana when collected)$/, ['offense']),
  sp('gem-robe', /^(?:Enchants gem-powered magic|Diamonds shine brilliantly|Ambers carve a path|Rubies flash double|Emeralds light the night|Sapphires swirl in pairs|Topazes burst brightly|Amethysts find their path)$/, ['offense']),
  sp('scope', /^(?:Increases view range for guns(?: \(Right click to zoom out\))?|Right click to zoom out)$/, ['offense']),
  sp('ammo-cycling', /^(?:Right click to switch ammo usage modes|Weapons use ammo in rotating order|Weapons use ammo in rotating order across your entire inventory|Weapons use ammo randomly|Weapons use ammo normally!)$/, ['offense']),
  sp('set-mechanic-offense', /^(?:Summons a powerful leaf crystal to shoot at nearby enemies|Flower petals will fall on your target for extra damage|Space Gun costs 0 mana|Beetles increase your melee damage and speed|Magic damage done will hurt extra nearby enemies|Magic damage has a chance to spawn buff boosters|Pick boosters up to get stacking buffs|A stardust guardian will protect you from nearby enemies|Double tap ▼ Down to call an ancient storm to the cursor location|Not moving puts you in stealth, increasing ranged ability and reducing chance for enemies to target you|Double tap ▼ Down to toggle stealth, increasing ranged ability and reducing chance for enemies to target you but slowing movement speed|Flameburst field of view and range are dramatically increased|Greatly enhances (?:Flameburst|Ballista|Explosive Traps|Lightning Aura) effectiveness|Explosive Traps recharge faster and oil enemies|Set oiled enemies on fire for extra damage|Lightning Aura can now crit and strikes faster|Ballista pierces more targets and panics when you take damage)$/, ['offense']),
  sp('spectre-heal', /^Magic damage done to enemies heals the player with lowest health$/, ['utility']),
  // utility: information, construction, fishing, misc
  sp('info', /^(?:Displays .+|Tells the time|Shows position|Detects enemies around you|Improves vision|Improves vision and provides light when worn|Grants improved wire vision|Enables Echo Sight, showing hidden blocks|Creates measurement lines on screen for block placement|Allows wearer to see through their remote vehicle camera)$/, ['utility']),
  sp('light', /^(?:Provides light when worn|Generates a very subtle glow which becomes more vibrant underwater|Greatly extends underwater breathing|Your bobber now glows)$/, ['utility']),
  sp('construction', /^(?:Increases (?:block & wall|wall|tile|block) placement speed|Automatically paints or coats placed objects|Automatically places actuators on placed objects|Hold Up to reach higher|Allows the collection of Vine Rope from vines)$/, ['utility']),
  sp('fishing', /^(?:Fishing line will never break|Decreases chance of bait consumption|Allows fishing in lava)$/, ['utility']),
  sp('pickup', /^(?:Increases coin pickup range|Increases pickup range for items|Hitting enemies will sometimes drop extra coins)$/, ['utility']),
  sp('misc-utility', /^(?:Decreased enemy spawn rate|Can be hit with a golf club|Has a chance to record songs|Slimes become friendly|Flowers grow on the grass you walk on|Leaves a trail of flames in your wake|Continuously use some items when not moving|Not functional when inventory is open|Can be used to scoop up a small amount of liquid|Collects water in the rain|Turns the holder into a werewolf at night|Turns the holder into a werewolf at night and a merfolk when entering water)$/, ['utility']),

  // ================= flavor / explanation (no effect) =================
  { id: 'flavor-quoted', kind: 'flavor', re: /^'.*'$/ },
  {
    id: 'flavor-lore',
    kind: 'flavor',
    re: /^(?:Whatever this accessory does to you is not a bug!|The Valkyrie Satellite Barrier Platform is totally safe\. Most of the time\.|Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt\.|'Great for impersonating devs!' If you see this you should probably run away\.\.\.|These are launchers, dartguns, or anything else that doesn't shoot arrows\/bullets)$/,
  },
]

/** Lines that apply only to other platforms ("(Old-gen console version)", "(Old-gen console and 3DS versions)", …). */
const PLATFORM_DROP = /\((?:Old-gen console|3DS|NDS)(?:,? (?:and )?(?:Old-gen console|3DS|NDS))* versions?\)$/
const PLATFORM_KEEP = /\s*\(Desktop, Console and Mobile versions\)$/

/** Raw game-text lines → effect lines: platform variants dropped, desktop notes removed, ","-continuations joined. */
export function normalizeEffectLines(raw: readonly string[]): { lines: string[]; dropped: string[] } {
  const dropped: string[] = []
  const kept: string[] = []
  for (const l of raw.map((x) => x.trim()).filter(Boolean)) {
    if (PLATFORM_DROP.test(l)) dropped.push(l)
    else kept.push(l.replace(PLATFORM_KEEP, ''))
  }
  const lines: string[] = []
  for (const l of kept) {
    const prev = lines.at(-1)
    if (prev !== undefined && prev.endsWith(',')) lines[lines.length - 1] = `${prev} ${l}`
    else lines.push(l)
  }
  return { lines, dropped }
}

/** Cargo Items `tooltip` cell → effect lines (see normalizeEffectLines). */
export const tooltipEffectLines = (row: CargoRow): { lines: string[]; dropped: string[] } => normalizeEffectLines((tooltipText(String(row.tooltip ?? '')) ?? '').split('\n'))

export interface ClassifiedLine {
  line: string
  rule: EffectRule
  effects: StatEffect[]
  categories: EffectCategory[]
}

const NUMBER = /\d+(?:\.\d+)?/g

/** Per-rule usage: line count + the first line seen (report evidence). */
export type RuleUsage = Map<string, { count: number; example: { name: string; line: string; url: string } }>

export function countRule(usage: RuleUsage, c: ClassifiedLine, name: string, url: string): void {
  const u = usage.get(c.rule.id)
  if (u) u.count += 1
  else usage.set(c.rule.id, { count: 1, example: { name, line: c.line, url } })
}

/** Exactly one rule must match the line; else the build fails (closed StatKind enum). */
export function classifyLine(line: string, sourceUrl: string, where: string): ClassifiedLine {
  const matches = EFFECT_RULES.flatMap((r) => {
    const m = r.re.exec(line)
    return m ? [{ r, g: (m.groups ?? {}) as Groups }] : []
  })
  if (matches.length === 0) throw new OverlayError(`[E_SCHEMA] ${where}: effect line "${line}" matches no rule in pipeline/merge/effects.ts — classify it (stat rule, special rule, or a StatKind extension); StatKind is closed`)
  if (matches.length > 1) throw new OverlayError(`[E_SCHEMA] ${where}: effect line "${line}" matches several rules (${matches.map((x) => x.r.id).join(', ')}) — rules must not overlap`)
  const { r, g } = matches[0]
  const special = (categories: EffectCategory[]): ClassifiedLine => ({ line, rule: r, effects: [{ kind: 'special', text: line, simulated: false, sourceUrl }], categories })
  if (r.kind === 'flavor') return { line, rule: r, effects: [], categories: [] }
  if (r.kind === 'special') return special(r.categories)
  const numbers = (line.match(NUMBER) ?? []).map(Number)
  const stats = r.stats(g)
  for (const s of stats) {
    const stated = s.stated ?? Math.abs(s.value)
    if (!numbers.includes(stated)) throw new OverlayError(`[E_SCHEMA] ${where}: rule ${r.id} emits ${s.stat} ${s.value} but the line "${line}" does not state ${stated}`)
    if (s.value < 0 && !/reduc|lower|decreas/i.test(line)) throw new OverlayError(`[E_SCHEMA] ${where}: rule ${r.id} emits a negative ${s.stat} but "${line}" states no reduction`)
  }
  const effects: StatEffect[] = stats.map((s) => ({ kind: 'stat', stat: s.stat, value: s.value, ...(s.scope ? { scope: s.scope } : {}) }))
  const categories = [...new Set(stats.map((s) => STAT_CATEGORY[s.stat]))]
  if (r.remainder) {
    effects.push({ kind: 'special', text: line, simulated: false, sourceUrl })
    categories.push(...r.remainder.categories)
  }
  return { line, rule: r, effects, categories: [...new Set(categories)] }
}

// ---------------------------------------------------------------------------------------------
// Equipinfo cross-check
// ---------------------------------------------------------------------------------------------

const DAMAGE_FIELD: Record<Exclude<DamageClass, 'other'>, string> = { melee: 'meleeDamage', ranged: 'rangedDamage', magic: 'magicDamage', summon: 'minionDamage' }
const CRIT_FIELD: Record<'melee' | 'ranged' | 'magic', string> = { melee: 'meleeCrit', ranged: 'rangedCrit', magic: 'magicCrit' }

/** Equipinfo fields a stat effect contributes to (field → amount in Equipinfo units). */
export function equipFields(e: Extract<StatEffect, { kind: 'stat' }>): [string, number][] {
  const v = e.value
  switch (e.stat) {
    case 'damage-pct':
      return e.scope && e.scope !== 'other' ? [[DAMAGE_FIELD[e.scope], v / 100]] : Object.values(DAMAGE_FIELD).map((f) => [f, v / 100])
    case 'crit-pct':
      if (e.scope === 'summon' || e.scope === 'other') return []
      return e.scope ? [[CRIT_FIELD[e.scope], v]] : Object.values(CRIT_FIELD).map((f) => [f, v])
    case 'melee-speed-pct':
      return [['meleeSpeed', v / 100]]
    case 'move-speed-pct':
      return [['moveSpeed', v / 100]]
    case 'max-mana-flat':
      return [['statManaMax2', v]]
    case 'mana-cost-pct':
      return [['manaCost', v / 100]]
    case 'minion-slots':
      return [['maxMinions', v]]
    case 'sentry-slots':
      return [['maxTurrets', v]]
    case 'whip-range-pct':
      return [['whipRangeMultiplier', v / 100]]
    case 'mining-speed-pct':
      return [['pickSpeed', -v / 100]]
    case 'damage-reduction-pct':
      return [['endurance', v / 100]]
    default:
      return []
  }
}

/** Every Equipinfo field the cross-check compares (a field outside this set is not a modeled stat). */
export const CROSS_CHECKED_FIELDS = [...Object.values(DAMAGE_FIELD), ...Object.values(CRIT_FIELD), 'meleeSpeed', 'moveSpeed', 'statManaMax2', 'manaCost', 'maxMinions', 'maxTurrets', 'whipRangeMultiplier', 'pickSpeed', 'endurance']

/**
 * - `agree`: every compared field is stated by both sides with the same amount.
 * - `disagree`: both sides state a field with DIFFERENT amounts → the item's effects are withheld.
 * - `partial`: no disagreement, but a field is stated by one side only — `textOnly` (the game text
 *   states it, the item's Equipinfo row does not: effects shared by several items are transcribed in
 *   rows the wiki leaves without an item ID, e.g. the Mana Flower family's "manaCost -0.08") or
 *   `equipinfoOnly` (Equipinfo records a modeled stat the game text gives no number for: the effect
 *   stays a special / is missing from the emitted list → gap + verified:false, never filled in).
 * - `no-equipinfo-row`: nothing to compare.
 */
export interface EquipCrossCheck {
  outcome: 'agree' | 'disagree' | 'partial' | 'no-equipinfo-row'
  /** Both sides state the field with different amounts. */
  differences: string[]
  textOnly: string[]
  equipinfoOnly: string[]
}

const parseEquipNumber = (v: CargoRow[string] | undefined): number | undefined => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return undefined
  return Number(s)
}

/** Compares the per-field sums of the game-text stats with the item's Equipinfo row over CROSS_CHECKED_FIELDS. */
export function crossCheckEquipinfo(effects: readonly StatEffect[], row: CargoRow | undefined): EquipCrossCheck {
  const none = { differences: [], textOnly: [], equipinfoOnly: [] }
  if (!row) return { outcome: 'no-equipinfo-row', ...none }
  const expected = new Map<string, number>()
  for (const e of effects) if (e.kind === 'stat') for (const [f, v] of equipFields(e)) expected.set(f, (expected.get(f) ?? 0) + v)
  const differences: string[] = []
  const textOnly: string[] = []
  const equipinfoOnly: string[] = []
  const fmt = (v: number) => String(Number(v.toFixed(6)))
  for (const f of CROSS_CHECKED_FIELDS) {
    const want = expected.get(f)
    const have = parseEquipNumber(row[f])
    if (want === undefined && have === undefined) continue
    if (have === undefined) textOnly.push(`${f} ${fmt(want as number)}`)
    else if (want === undefined) equipinfoOnly.push(`${f} ${fmt(have)}`)
    else if (Math.abs(want - have) > 1e-9) differences.push(`${f}: game text ${fmt(want)} vs Equipinfo ${fmt(have)}`)
  }
  const outcome = differences.length > 0 ? 'disagree' : textOnly.length > 0 || equipinfoOnly.length > 0 ? 'partial' : 'agree'
  return { outcome, differences, textOnly, equipinfoOnly }
}
