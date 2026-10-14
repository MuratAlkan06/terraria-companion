/**
 * Labeled approximations (TASK_CONTRACT "Simulation honesty"; UX_SPEC §8 AssumptionsTip).
 *
 * Every modeling choice the engine makes that is not a verified in-game fact is listed here with
 * plain-language copy. `LabSim.approximations` returns the subset relevant to the equipped weapon
 * so the HUD can render it verbatim next to each EstimateLabel. `sourceUrl` points at the wiki page
 * the underlying rule came from when there is one; its absence means the value is a Lab choice.
 *
 * Modeling conventions (AMENDMENTS-010 B46 / B47, AMENDMENTS-013 B63 P-1 / P-2 / P-3 / P-5; record
 * marker B49): a weapon whose params came from a convention lists those paths in `_prov.modeledFields`;
 * the guard maps each listed entry to its convention (src/schemas MODELING_CONVENTIONS — a path two
 * conventions share is qualified `<path>#<convention id>`) and adds the entry below that carries the
 * same `ruling`. B44 (swing arc/reach) is labeled by the Lab UI's own `swing-reach-arc` assumption
 * (src/lab), so the engine does not add a second copy of it. The B63 whip / summon-rate labels surface
 * with the whip and minion-sentry interpreters (P3-S9 / P3-S10); `square-blast-radius` once the
 * explosive-aoe interpreter ships (until then those weapons are limitations).
 */
import type { ModelingConvention } from '../schemas'

export type ApproximationId =
  | 'fixed-tick'
  | 'crit-base'
  | 'defense'
  | 'damage-variance'
  | 'no-equipment'
  | 'cadence'
  | 'reuse-delay'
  | 'auto-reuse'
  | 'melee-once-per-use'
  | 'swing-geometry'
  | 'thrust-geometry'
  | 'thrust-reach'
  | 'projectile-point'
  | 'projectile-damage'
  | 'spread'
  | 'slight-spread'
  | 'gravity'
  | 'projectile-lifetime'
  | 'no-shared-immunity'
  | 'ammo'
  | 'mana-cost'
  | 'mana-regen'
  | 'insufficient-mana'
  | 'slow-cast-cooldown'
  | 'cooldown-mana-regen'
  | 'homing'
  | 'dot'
  | 'multi-hit'
  | 'knockback'
  | 'dummy-hitbox'
  | 'boomerang-flight'
  | 'flail-launch'
  | 'yoyo-control'
  | 'beam-geometry'
  | 'whip-arc'
  | 'summon-average-rate'
  | 'summon-hit-cap'
  | 'square-blast-radius'
  | 'whip-swing'
  | 'whip-tag'
  | 'summon-slots'
  | 'summon-attack'
  | 'summon-target'
  | 'minion-melee-contact'
  | 'minion-ground-melee'
  | 'minion-hover-strike'
  | 'minion-ranged-shot'
  | 'sentry-placement'

export interface Approximation {
  id: ApproximationId
  title: string
  detail: string
  sourceUrl?: string
  /** Modeling conventions only: the ruling that ratified the convention (e.g. "AMENDMENTS-010 B46"). */
  ruling?: ModelingConvention['ruling']
}

const WIKI = 'https://terraria.wiki.gg/wiki/'

export const APPROXIMATIONS: Readonly<Record<ApproximationId, Approximation>> = {
  'fixed-tick': {
    id: 'fixed-tick',
    title: 'Fixed 60 Hz simulation',
    detail:
      'The Lab advances in fixed 1/60 s ticks like the game, independent of your frame rate. It is a browser approximation, not the Terraria engine.',
  },
  'crit-base': {
    id: 'crit-base',
    title: 'Crit chance = 4% + weapon bonus',
    detail:
      'Melee, ranged and magic hits crit at 4% base plus the weapon crit bonus; crits deal double damage after defense. Summon and classless damage never crit — except minion and sentry hits on a dummy tagged by a whip with a tag critical strike chance. No other crit sources are applied.',
    sourceUrl: `${WIKI}Critical_hit`,
  },
  defense: {
    id: 'defense',
    title: 'Defense: half, rounded down, minimum 1',
    detail:
      'Each hit is reduced by half the dummy defense, rounded down, never below 1 (enemy formula; no difficulty scaling). Armor penetration is not modeled.',
    sourceUrl: `${WIKI}Defense`,
  },
  'damage-variance': {
    id: 'damage-variance',
    title: '±15% damage variance',
    detail:
      'Each hit is scaled by a random 85–115% (whole-percent steps) and rounded half-to-even before defense, using a seeded generator so runs are repeatable. Can be turned off.',
    sourceUrl: `${WIKI}Damage`,
  },
  'no-equipment': {
    id: 'no-equipment',
    title: 'Base weapon only',
    detail:
      'No prefixes, armor, accessories, potions or class bonuses are applied — base weapon stats only.',
  },
  cadence: {
    id: 'cadence',
    title: 'Attack rate = 60 ÷ use time',
    detail:
      "One attack every 'use time' ticks (the wiki's use time — how long the attack animation lasts); auto-swing melee weapons attack one tick sooner, as the wiki documents. A weapon that fires several shots per attack fires them at its per-shot interval within that time.",
    sourceUrl: `${WIKI}Use_time`,
  },
  'reuse-delay': {
    id: 'reuse-delay',
    title: 'Cooldown after each attack',
    detail:
      'This weapon waits a fixed number of extra ticks after each attack before it can attack again, as the wiki documents; the Lab adds that cooldown to the time between attacks.',
    sourceUrl: `${WIKI}Use_time`,
  },
  'auto-reuse': {
    id: 'auto-reuse',
    title: 'Held attack repeats',
    detail:
      'Holding attack repeats every weapon at its full rate, as if it had auto-reuse. In-game, weapons without auto-reuse need a new click each time.',
  },
  'melee-once-per-use': {
    id: 'melee-once-per-use',
    title: 'One melee hit per swing',
    detail: 'A swing or thrust damages each dummy at most once unless the weapon is flagged multi-hit.',
  },
  'swing-geometry': {
    id: 'swing-geometry',
    title: 'Swing hitbox is a sweeping line',
    detail:
      "The swing is modeled as a line of the weapon's reach sweeping its arc, centered on the facing direction. Real sprite hitboxes differ.",
  },
  'thrust-geometry': {
    id: 'thrust-geometry',
    title: 'Thrust hitbox is an extending line',
    detail: 'A thrust is a line that extends to full reach toward the aim point and retracts over one attack.',
  },
  'thrust-reach': {
    id: 'thrust-reach',
    title: 'Thrust reach is modeled',
    detail:
      "The wiki gives no thrust reach for this weapon. The Lab's thrust reaches the length of the weapon sprite's diagonal × the item's scale, plus 1 tile for the arm. This is a Lab modeling choice, not game data.",
    ruling: 'AMENDMENTS-010 B46',
  },
  'projectile-point': {
    id: 'projectile-point',
    title: 'Point projectiles, no tile collision',
    detail:
      'Projectiles are points with swept collision against dummies. Per-projectile hitbox sizes and terrain collision are not modeled.',
  },
  'projectile-damage': {
    id: 'projectile-damage',
    title: 'Projectile damage = weapon damage',
    detail:
      "Projectiles deal the weapon's damage (plus ammo damage for bows and guns). Where the wiki states that a projectile deals a percentage of the weapon's damage, the Lab applies it, rounded down as in the wiki's own numbers; no other per-projectile damage changes are modeled.",
    sourceUrl: `${WIKI}Damage`,
  },
  spread: {
    id: 'spread',
    title: 'Even spread fan',
    detail:
      'Multi-projectile attacks fan out evenly across the spread angle; single projectiles with spread get seeded random inaccuracy. The game randomizes many of these per pellet.',
  },
  'slight-spread': {
    id: 'slight-spread',
    title: "'Slight spread' modeled as 10°",
    detail:
      'The wiki says this gun fires at a slight spread but gives no angle. The Lab uses a 10° spread for it. This is a Lab modeling choice, not game data.',
    ruling: 'AMENDMENTS-010 B47',
  },
  gravity: {
    id: 'gravity',
    title: 'Generic arcing gravity',
    detail: 'Arcing projectiles share one generic gravity curve chosen to look right; it is not each projectile\'s in-game AI.',
  },
  'projectile-lifetime': {
    id: 'projectile-lifetime',
    title: 'Projectile lifetime cap',
    detail: 'Projectiles without a listed lifetime vanish after 10 s or when they leave the arena.',
  },
  'no-shared-immunity': {
    id: 'no-shared-immunity',
    title: 'Simplified enemy immunity',
    detail:
      "Separate projectiles never block each other's hits on a dummy; the game's shared and static immunity-frame rules are not modeled.",
  },
  ammo: {
    id: 'ammo',
    title: 'One ammo per shot',
    detail:
      'Each shot uses one ammo regardless of projectile count; ammo-saving effects are not modeled (chances to not use ammo, or bursts where only the first shot uses ammo). Speed = (weapon speed + ammo bonus) × ammo multiplier; damage = weapon + ammo damage.',
    sourceUrl: `${WIKI}Damage`,
  },
  'mana-cost': {
    id: 'mana-cost',
    title: 'Mana paid once per attack',
    detail: 'The mana cost is paid when each attack starts.',
  },
  'mana-regen': {
    id: 'mana-regen',
    title: 'Mana regeneration (1.4.5.7+ formula)',
    detail:
      'Uses the wiki formula with the standing-still bonus and the 5% rate while casting; no regeneration bonuses (bands, potions, armor).',
    sourceUrl: `${WIKI}Mana`,
  },
  'insufficient-mana': {
    id: 'insufficient-mana',
    title: 'Out-of-mana behavior',
    detail:
      'Without enough mana, casting continues at 40% attack speed, as the game does since 1.4.5.7 (paying no mana on such casts is an assumption). A "stop at zero" test setting instead stops casting until mana covers the cost.',
    sourceUrl: `${WIKI}Mana`,
  },
  // AMENDMENTS-012 B57(e): the two undocumented interactions of a cooldown with mana (weapons with both)
  'slow-cast-cooldown': {
    id: 'slow-cast-cooldown',
    title: 'Low-mana casts keep the normal cooldown',
    detail:
      'When this weapon casts without enough mana, the cast itself takes 2.5 times as long, but the cooldown after it keeps its normal length. The wiki does not say whether the slowdown also lengthens the cooldown; this is a Lab choice.',
  },
  'cooldown-mana-regen': {
    id: 'cooldown-mana-regen',
    title: 'Full mana regeneration during the cooldown',
    detail:
      'During the cooldown after each attack, mana regenerates at the full rate, as when not casting, instead of the reduced rate while casting. The wiki does not say which rate applies then; this is a Lab choice.',
  },
  homing: {
    id: 'homing',
    title: 'Generic homing',
    detail:
      'Homing projectiles steer toward the nearest dummy in range with a generic turn model, not each projectile\'s in-game AI.',
  },
  dot: {
    id: 'dot',
    title: 'Damage over time',
    detail:
      'Debuffs deal their listed damage per second. The Lab assumes they ignore defense, never crit, and refresh (not stack) when reapplied — the wiki does not document these details.',
    sourceUrl: `${WIKI}Debuffs`,
  },
  'multi-hit': {
    id: 'multi-hit',
    title: 'Multi-hit cooldown',
    detail: 'Multi-hit sources can strike the same dummy again after their listed local immunity ticks.',
  },
  knockback: {
    id: 'knockback',
    title: 'Knockback ignored',
    detail: 'Dummies never move; the Target Dummy is unaffected by knockback.',
    sourceUrl: `${WIKI}Target_Dummy`,
  },
  'dummy-hitbox': {
    id: 'dummy-hitbox',
    title: 'Dummy hitbox 2×3 tiles',
    detail:
      "The standard dummy's hitbox uses the Target Dummy's placed size (2×3 tiles); its exact in-game hitbox is not documented.",
    sourceUrl: `${WIKI}Target_Dummy`,
  },
  // P3-S6 / P3-S7: the returning (boomerang / flail / yoyo variants) and piercing-beam archetypes
  'boomerang-flight': {
    id: 'boomerang-flight',
    title: 'Boomerang: out until it hits, then back',
    detail:
      "The boomerang flies straight toward the aim at the weapon's velocity and turns back at its first hit, as the wiki says most boomerangs do, or at the end of its throw range; it returns straight to you at the speed it was thrown (in-game it slows before turning and flies back faster). It can hit dummies on the way back too, but not the one that turned it. The next throw waits until it is back in hand.",
    sourceUrl: `${WIKI}Combat_Wrench`,
  },
  'flail-launch': {
    id: 'flail-launch',
    title: 'Launched flail: out until it strikes, then back',
    detail:
      "As the wiki describes, a launched flail extends at a fixed speed until it strikes an enemy or reaches its maximum length, then retracts. The Lab extends it at the weapon's velocity and retracts it at the same speed (the wiki says slightly faster, without a number); the dummy it struck is not hit again as it retracts. The next launch waits until it is back.",
    sourceUrl: `${WIKI}Flails`,
  },
  'yoyo-control': {
    id: 'yoyo-control',
    title: 'Yoyo follows the aim point',
    detail:
      "The yoyo moves toward the aim point at the weapon's velocity, never farther than its reach, and stays out while the attack is held; let go and it comes back. It hits each dummy at most once every 10 ticks, the wiki's invincibility frames per yoyo hit (about 6 hits per second). Not modeled: the limited spin time after which most yoyos return on their own, bouncing off enemies on hit, and the yoyo's own acceleration.",
    sourceUrl: `${WIKI}Yoyos`,
  },
  'beam-geometry': {
    id: 'beam-geometry',
    title: 'Held beam is a straight line',
    detail:
      "The beam is a line from you toward the aim that reaches to the edge of the arena and passes through every dummy on it. Each dummy takes a hit once per the beam's hit interval while the attack is held; during a cooldown between attacks the beam is off. Beam width and any build-up over time are not modeled.",
  },
  // AMENDMENTS-013 B63: the remaining-archetype modeling conventions (labels for the P3-S7+ interpreters)
  'whip-arc': {
    id: 'whip-arc',
    title: 'Whip arc is modeled',
    detail:
      "The wiki says whips swing in an arcing motion but gives no angle. The Lab's whip sweeps 180° in front of the player, the same basis as a broadsword swung over the head. This is a Lab modeling choice, not game data.",
    sourceUrl: `${WIKI}Whips`,
    ruling: 'AMENDMENTS-013 B63 P-1',
  },
  'summon-average-rate': {
    id: 'summon-average-rate',
    title: 'Average attack rate used as a fixed rate',
    detail:
      'The wiki states how often this summon attacks only as an average, a random cooldown, or a time that is not a whole number of ticks. The Lab attacks at that one fixed interval, rounded to the nearest tick (exact halves to the even tick); in-game the timing varies. This is a Lab modeling choice, not game data.',
    ruling: 'AMENDMENTS-013 B63 P-2',
  },
  'summon-hit-cap': {
    id: 'summon-hit-cap',
    title: 'Attack rate is an upper bound',
    detail:
      'The wiki states only how often this minion can hit an enemy (its immunity frames), not how often it attacks. The Lab attacks at that cap: maximum rate; actual depends on minion AI pathing. This is a Lab modeling choice, not game data.',
    ruling: 'AMENDMENTS-013 B63 P-3',
  },
  'square-blast-radius': {
    id: 'square-blast-radius',
    title: 'Square blast area modeled as a circle',
    detail:
      'The wiki states this explosive damages a square area (the same distance horizontally and vertically). The Lab uses the circle that fits inside that square (radius = half the side), so it never overstates the area: enemies in the corners of the square are not hit. This is a Lab modeling choice, not game data.',
    ruling: 'AMENDMENTS-013 B63 P-5',
  },
  // P3-S10: whips
  'whip-swing': {
    id: 'whip-swing',
    title: 'Whip swing: a sweeping line, one hit per dummy',
    detail:
      "The whip is modeled as a line as long as its range (the wiki's whip range) sweeping its arc once per swing, hitting each dummy at most once per swing. Each further dummy hit in the same swing takes the wiki's multihit penalty off the previous hit's damage, rounded down — a dummy it would deal no damage to is not hit. Whip hits never crit (summon damage). The real whip's curved, segmented hitbox is not modeled.",
    sourceUrl: `${WIKI}Whips`,
  },
  'whip-tag': {
    id: 'whip-tag',
    title: 'Whip tag: 4 seconds of bonus damage for your summons',
    detail:
      "Each dummy the whip strikes is tagged for 4 seconds, as the wiki states — a new strike restarts the 4 seconds — and your minions and sentries switch to the dummy struck last. While a dummy is tagged, every minion or sentry hit on it deals the whip's tag damage on top and, for a whip with a tag critical strike chance, crits at that chance: the only way summon damage crits. The Lab adds the tag damage before the ±15% variance and defense (the wiki says only that it is added); the tag bonus it shows is what the tag added to each hit. Not modeled: several whips' tags at once (whip stacking), minion-specific tag multipliers, and whip effects beyond tag damage and crit chance.",
    sourceUrl: `${WIKI}Whips`,
  },
  // P3-S9: minions and sentries (the AI-class models follow the AMENDMENTS-013 B63 P-6 definitions)
  'summon-slots': {
    id: 'summon-slots',
    title: 'Summon slots: 1 minion and 1 sentry by default',
    detail:
      'By default you can have one minion and one sentry out, as the wiki states; the slot settings stand in for gear that adds more (up to 11 minion and 6 sentry slots). Each summon takes its slot cost. Summoning with the slots full replaces the oldest summon (the wiki says a new summon replaces one; which one is a Lab choice). Holding attack keeps summoning only while slots are free — press again to replace one.',
    sourceUrl: `${WIKI}Minion-summoning_weapons`,
  },
  'summon-attack': {
    id: 'summon-attack',
    title: 'Summons attack on a fixed rhythm',
    detail:
      'A minion appears where you click (with Space or in a timed test, beside you). Each minion or sentry attacks once per its attack interval and every attack lands — no misses, no chasing. Its first attack comes one interval after it appears, and it keeps its rhythm when it switches targets. How it moves is drawn, not simulated: no speed, no pathing.',
  },
  'summon-target': {
    id: 'summon-target',
    title: 'Summons attack the dummy your whip struck last',
    detail:
      'Minions and sentries attack the dummy your whip struck last — the wiki: the last enemy hit by a whip is targeted by your minions and sentries — otherwise the dummy nearest to you (for a sentry, the one nearest to it within its range).',
    sourceUrl: `${WIKI}Whips`,
  },
  'minion-melee-contact': {
    id: 'minion-melee-contact',
    title: 'Flying contact minion (Lab model)',
    detail:
      'This minion flies, charges or dashes into enemies, damaging them by contact. The Lab loops it above the dummy and through it, hitting once per attack interval as it passes.',
  },
  'minion-ground-melee': {
    id: 'minion-ground-melee',
    title: 'Ground minion (Lab model)',
    detail:
      'This minion moves along the ground and hits enemies up close. The Lab keeps it on the ground beside the dummy, hopping into it once per attack interval.',
  },
  'minion-hover-strike': {
    id: 'minion-hover-strike',
    title: 'Hovering striker (Lab model)',
    detail:
      'This minion flies or hovers next to enemies and strikes them at close range. The Lab holds it beside the dummy, lunging in to strike once per attack interval.',
  },
  'minion-ranged-shot': {
    id: 'minion-ranged-shot',
    title: 'Shooting summon (Lab model)',
    detail:
      "This summon damages enemies with projectiles it shoots. The Lab fires once per attack interval — a minion from where it hovers near you, a sentry from where it stands — and the shot lands the moment it is fired (the wiki gives no shot speed for it), unless the weapon's data gives its projectile a speed.",
  },
  'sentry-placement': {
    id: 'sentry-placement',
    title: 'Sentry: stays where you place it',
    detail:
      'A sentry appears exactly where you click (with Space or in a timed test, 2 tiles in front of you) and never moves — in-game most sentries settle on the ground. It attacks only dummies whose centre is within its range. The 10-minute sentry lifetime is not modeled.',
    sourceUrl: `${WIKI}Sentry-summoning_weapons`,
  },
}

/** Approximations that apply to every simulation regardless of archetype. */
export const COMMON_APPROXIMATIONS: readonly ApproximationId[] = [
  'fixed-tick',
  'crit-base',
  'defense',
  'damage-variance',
  'no-equipment',
  'cadence',
  'auto-reuse',
  'knockback',
  'dummy-hitbox',
]

/**
 * B49: the engine label of each modeling convention, added when the weapon lists the convention's
 * paths in `_prov.modeledFields` (each entry carries the convention's ruling). `swing-geometry` (B44)
 * has none here: the Lab UI labels it (see header).
 */
export const CONVENTION_APPROXIMATIONS: Readonly<Partial<Record<ModelingConvention['id'], ApproximationId>>> = {
  'thrust-reach': 'thrust-reach',
  'slight-spread': 'slight-spread',
  'whip-arc': 'whip-arc',
  'summon-average-rate': 'summon-average-rate',
  'summon-hit-cap': 'summon-hit-cap',
  'square-blast-radius': 'square-blast-radius',
}

export const PROJECTILE_APPROXIMATIONS: readonly ApproximationId[] = [
  'projectile-point',
  'projectile-damage',
  'projectile-lifetime',
  'no-shared-immunity',
]
