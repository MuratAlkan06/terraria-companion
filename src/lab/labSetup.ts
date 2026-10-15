/**
 * What the Lab hands the engine besides the weapon (src/sim README "LabSimOptions"): ammo for bows
 * and guns (PRD P3-S4), the buff registry for damage-over-time weapons (AMENDMENTS-012 follow-up:
 * Stylish Scissors, Brand of the Inferno, Frost Staff), and where the target stands. Pure (no DOM,
 * no renderer): Node-tested against the committed data. Nothing here is per weapon — every decision
 * reads the records, so a weapon or ammo that gains data lights up with no UI change.
 *
 * Ammo (PRD P3-S4 AC2): the picker lists ONLY ammo whose `ammoStats.ammoClass` is the weapon's, and
 * of those only what the engine itself fires — each candidate is checked with `createLabSim`, so ammo
 * without verified damage (e.g. Gel) is refused by the engine, never assumed. Order: damage, then id.
 *
 * Default ammo (documented choice): the ammo class's NAMESAKE item — the pipeline names every class
 * after its representative item (src/data-access `ItemNames.bySlug`), and that item is the class's
 * basic tier: Wooden Arrow for arrows, Musket Ball for bullets. If the namesake can't be fired, the
 * weakest usable ammo (the list's first) stands in.
 *
 * Target placement (Lab choice, labeled `target-distance` in src/lab/labAssumptions.ts): melee
 * archetypes keep the engine's point-blank dummy (README "Units and coordinates"); weapons that fire
 * projectiles face the same Infinite Dummy RANGED_TARGET_X_TILES away, so a shot visibly travels
 * before it lands (PRD P3-S4 AC1) — at point-blank a shot crosses the 1-tile gap within its first
 * tick and is never seen. Spread shots can miss at this range, as they would in-game from there.
 * Multiple Dummies (P3-S6, `target-row`): the engine's row starting at that same spot.
 */
import type { Archetype, Buff, Item, Weapon } from '../schemas'
import { createLabSim, DEFAULT_DUMMY, DEFAULT_DUMMY_HEIGHT_TILES, DEFAULT_DUMMY_WIDTH_TILES, dummyRow, GROUND_Y_TILES, type DummyMotionAxis, type DummySpec, type SimRefusal } from '../sim'

export interface LabSetup {
  /** Every ammo item in the data (Item records that carry `ammoStats`). */
  readonly ammo: readonly Item[]
  /** The buff registry (resolves `modifiers.dot.buffId` → damage per second). */
  readonly buffs: readonly Buff[]
}

/** No ammo, no buffs: weapons that need either can't be equipped (their card says why). */
export const EMPTY_LAB_SETUP: LabSetup = Object.freeze({ ammo: [], buffs: [] })

export function labSetup(items: Iterable<Item>, buffs: readonly Buff[]): LabSetup {
  return { ammo: [...items].filter((item) => item.ammoStats !== undefined), buffs }
}

/** The ammo class a weapon fires (its bow-gun params), or null for weapons that use no ammo. */
export function ammoClassOf(weapon: Weapon): string | null {
  const lab = weapon.labBehavior
  return lab.kind === 'archetype' && lab.params.archetype === 'bow-gun' ? lab.params.ammoClass : null
}

export interface AmmoChoices {
  ammoClass: string
  /** Compatible ammo the engine fires from this weapon, by damage then id. */
  usable: readonly Item[]
  /** Compatible ammo the engine refuses (data it needs isn't verified), with its reason. */
  refused: readonly { item: Item; refusal: SimRefusal }[]
  /** The namesake (basic tier) when usable, else the weakest usable ammo; null when none is. */
  defaultAmmo: Item | null
}

/** Ammo the engine accepts is about the ammo and the weapon's firing data — not its debuff. */
function withoutModifiers(weapon: Weapon): Weapon {
  const lab = weapon.labBehavior
  if (lab.kind !== 'archetype' || lab.modifiers === undefined) return weapon
  return { ...weapon, labBehavior: { kind: 'archetype', params: lab.params } }
}

const ammoCache = new WeakMap<LabSetup, WeakMap<Weapon, AmmoChoices | null>>()

/** The weapon's ammo picker (null for weapons that use no ammo). Cached per setup and weapon. */
export function ammoChoices(weapon: Weapon, setup: LabSetup): AmmoChoices | null {
  let perSetup = ammoCache.get(setup)
  if (!perSetup) ammoCache.set(setup, (perSetup = new WeakMap()))
  if (perSetup.has(weapon)) return perSetup.get(weapon) ?? null
  const ammoClass = ammoClassOf(weapon)
  let choices: AmmoChoices | null = null
  if (ammoClass !== null) {
    const firing = withoutModifiers(weapon)
    const usable: Item[] = []
    const refused: { item: Item; refusal: SimRefusal }[] = []
    for (const item of setup.ammo) {
      if (item.ammoStats?.ammoClass !== ammoClass) continue
      const created = createLabSim({ weapon: firing, ammo: item })
      if (created.ok) usable.push(item)
      else refused.push({ item, refusal: created.refusal })
    }
    usable.sort((a, b) => (a.ammoStats?.damage ?? 0) - (b.ammoStats?.damage ?? 0) || a.id - b.id)
    refused.sort((a, b) => a.item.name.localeCompare(b.item.name, 'en') || a.item.id - b.item.id)
    const namesake = usable.find((item) => item.slug === ammoClass)
    choices = { ammoClass, usable, refused, defaultAmmo: namesake ?? usable[0] ?? null }
  }
  perSetup.set(weapon, choices)
  return choices
}

/** An ammo class's display name: its namesake item's name (the class is named after it), else the slug in words. */
export function ammoClassName(choices: AmmoChoices): string {
  const namesake = [...choices.usable, ...choices.refused.map((r) => r.item)].find((item) => item.slug === choices.ammoClass)
  if (namesake) return namesake.name
  const words = choices.ammoClass.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The ammo to load: the user's choice when it is one of the weapon's usable ammo, else the default. */
export function resolveAmmo(weapon: Weapon, setup: LabSetup, chosenId?: number | null): Item | null {
  const choices = ammoChoices(weapon, setup)
  if (!choices) return null
  return choices.usable.find((item) => item.id === chosenId) ?? choices.defaultAmmo
}

/** Archetypes that attack with the weapon itself (blade pose); everything else fires projectiles. */
const POINT_BLANK_ARCHETYPES: readonly Archetype[] = ['swing-melee', 'thrust']

/** Ranged target: the Infinite Dummy's centre this many tiles in front of the player (face at 5). */
export const RANGED_TARGET_X_TILES = 6

/**
 * Weapons that send something out (projectiles, a thrown returning weapon, a beam) — everything but a
 * blade held in the hand. They face the ranged dummy, and the arena draws what they send.
 */
export const firesProjectiles = (archetype: Archetype): boolean => !POINT_BLANK_ARCHETYPES.includes(archetype)

/**
 * The Lab's target (UX_SPEC §3.4 target picker: Infinite / Boss-Sized / Moving / Multiple / Armored /
 * Debuff; PRD P3-S6 AC1, P3-S11 AC3, P3-S12):
 * - `single`: the Infinite Dummy (the engine's Target Dummy, 2 × 3 tiles, defense 0).
 * - `boss`: the Boss-Sized Dummy — the Infinite Dummy scaled up `scale` times (a bigger hitbox, its near
 *   face and its feet where the Infinite Dummy's are). A Lab test size, not any boss's hitbox.
 * - `moving`: the Moving Dummy — the Infinite Dummy on a back-and-forth path (the engine's `DummyMotion`)
 *   along `axis`, MOVING_PATH_TILES long, at `speedTps`.
 * - `row`: Multiple Dummies — a row of `count` dummies (the engine's `dummyRow`), the first one where the
 *   single dummy stands; the first is the PRIMARY target: the one Space and the timed tests aim at,
 *   whose stats the HUD reports apart from the all-dummy totals (AC4).
 * - `armored`: the Armored Dummy — the Infinite Dummy with `defense` (the engine's verified defense
 *   formula). A test value the player picks — or a boss's verified first-form defense (`bossId`, from the
 *   bosses data with its wiki source; ./labBossDefense.ts), named only while the value is that boss's.
 * - `debuff`: the Debuff Dummy — the single dummy, whose active debuffs and their time left the HUD lists.
 */
export type LabTarget =
  | { kind: 'single' }
  | { kind: 'boss'; scale: number }
  | { kind: 'moving'; axis: DummyMotionAxis; speedTps: number }
  | { kind: 'row'; count: number }
  | { kind: 'armored'; defense: number; bossId: string | null }
  | { kind: 'debuff' }

export type LabTargetKind = LabTarget['kind']

/** The picker's order (UX_SPEC §3.4). */
export const LAB_TARGET_KINDS: readonly LabTargetKind[] = ['single', 'boss', 'moving', 'row', 'armored', 'debuff']

export const DEFAULT_LAB_TARGET: LabTarget = Object.freeze({ kind: 'single' })
/** Multiple Dummies: how many the row may hold, and how many it starts with. */
export const ROW_COUNTS = [2, 3, 4, 5] as const
export const DEFAULT_ROW_COUNT = 3
/**
 * Boss-Sized Dummy: how many times the Infinite Dummy's size it may be (whole multiples keep the pixel
 * art crisp: 4 × 6, 6 × 9 or 8 × 12 tiles), and the size it starts at. Lab test sizes.
 */
export const BOSS_SCALES = [2, 3, 4] as const
export const DEFAULT_BOSS_SCALE = 3
/** Moving Dummy: the axes, its speed range (tiles per second, whole steps; Lab test values) and start. */
export const MOVING_AXES: readonly DummyMotionAxis[] = ['horizontal', 'vertical']
export const MOVING_SPEED_RANGE = { min: 1, max: 16, step: 1 } as const
export const DEFAULT_MOVING_SPEED = 4
/** How far the Moving Dummy travels from where it starts, by axis (tiles; Lab choice): away and back, or up and back. */
export const MOVING_PATH_TILES: Readonly<Record<DummyMotionAxis, number>> = { horizontal: 8, vertical: 5 }
/** Armored Dummy: the defense range (whole numbers; player-chosen test values) and the value it starts at. */
export const ARMORED_DEFENSE_RANGE = { min: 0, max: 100, step: 1 } as const
export const DEFAULT_ARMORED_DEFENSE = 20

const inRange = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max

/** A target the Lab offers: a known kind with values from its own ranges. */
export function isLabTarget(target: LabTarget): boolean {
  switch (target.kind) {
    case 'single':
    case 'debuff':
      return true
    case 'row':
      return (ROW_COUNTS as readonly number[]).includes(target.count)
    case 'boss':
      return (BOSS_SCALES as readonly number[]).includes(target.scale)
    case 'moving':
      return MOVING_AXES.includes(target.axis) && inRange(target.speedTps, MOVING_SPEED_RANGE)
    case 'armored':
      return inRange(target.defense, ARMORED_DEFENSE_RANGE) && (target.bossId === null || typeof target.bossId === 'string')
    default:
      return false
  }
}

/** Same kind and the same values (a changed value is a new target: the stats restart). */
export function sameTarget(a: LabTarget, b: LabTarget): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'row':
      return b.kind === 'row' && a.count === b.count
    case 'boss':
      return b.kind === 'boss' && a.scale === b.scale
    case 'moving':
      return b.kind === 'moving' && a.axis === b.axis && a.speedTps === b.speedTps
    case 'armored':
      return b.kind === 'armored' && a.defense === b.defense && a.bossId === b.bossId
    default:
      return true
  }
}

/** Where the (first) dummy stands for an archetype: point-blank for blades, else the ranged distance. */
export const targetX = (archetype: Archetype): number => (firesProjectiles(archetype) ? RANGED_TARGET_X_TILES : DEFAULT_DUMMY.x)

/**
 * The dummies the Lab places for an archetype and target. The Debuff, Moving and Armored Dummies stand
 * where the single dummy does (a Moving Dummy starts there); the Boss-Sized Dummy keeps the Infinite
 * Dummy's near face and feet, growing away from you and upward.
 */
export function labDummiesFor(archetype: Archetype, target: LabTarget = DEFAULT_LAB_TARGET): DummySpec[] {
  const x = targetX(archetype)
  switch (target.kind) {
    case 'row':
      return dummyRow(target.count, x)
    case 'boss': {
      const width = DEFAULT_DUMMY_WIDTH_TILES * target.scale
      const height = DEFAULT_DUMMY_HEIGHT_TILES * target.scale
      return [{ id: DEFAULT_DUMMY.id, x: x - DEFAULT_DUMMY_WIDTH_TILES / 2 + width / 2, y: GROUND_Y_TILES - height / 2, widthTiles: width, heightTiles: height }]
    }
    case 'moving':
      return [{ ...DEFAULT_DUMMY, x, motion: { axis: target.axis, speedTps: target.speedTps, rangeTiles: MOVING_PATH_TILES[target.axis] } }]
    case 'armored':
      return [{ ...DEFAULT_DUMMY, x, defense: target.defense }]
    default:
      return [{ ...DEFAULT_DUMMY, x }]
  }
}

