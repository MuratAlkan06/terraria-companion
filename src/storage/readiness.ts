/**
 * `tc.v1.readiness` domain (DATA_SCHEMA_SPEC §8a `ReadinessV1` + AMENDMENTS-001 A6; PRD §9 Feature A
 * AC4): the readiness checker's setup — boss, stage, difficulty, class, the loadout — and when it was
 * last analyzed. The analysis itself is never stored: it is recomputed deterministically from these
 * inputs (and the tracked progress) on return.
 *
 * Hand-written strict validator (same pattern as ./progress.ts) so the storage module never pulls Zod
 * into a bundle; src/app/readinessStore.test.ts asserts parity with the Zod `ReadinessV1`.
 */
import { isStage, type Stage } from '../app/stages'
import type { DomainDef } from './types'

/**
 * Accessory slots the stored loadout keeps (the most any difficulty has). Equal to the scoring
 * constant MAX_ACCESSORY_SLOTS (src/app/readinessStore.test.ts pins the parity) — kept local so the
 * storage module, which is in the shell bundle, never pulls the scoring constants table into it.
 */
export const STORED_ACCESSORY_SLOTS = 7

export type ReadinessDifficulty = 'classic' | 'expert' | 'master'
export type ReadinessClass = 'melee' | 'ranged' | 'magic' | 'summon' | 'hybrid'

/** DATA_SCHEMA_SPEC §8a LoadoutSlots: null = a deliberately empty slot (the only legal null). */
export interface ReadinessLoadout {
  mainWeapon: number | null
  altWeapon: number | null
  helmet: number | null
  chest: number | null
  legs: number | null
  /** 5–7 entries (schema); the store keeps 7 so switching difficulty never drops an accessory. */
  accessories: (number | null)[]
  ammo: number[]
  /** Buff-granting ITEMS (potions), not buff slugs. */
  buffs: number[]
  summon: number | null
}

export interface ReadinessSetup {
  bossId: string | null
  /** A6: restored as saved, never read from the (mutable) stage setting. */
  stage: Stage
  difficulty: ReadinessDifficulty
  class: ReadinessClass
  loadout: ReadinessLoadout
  /** When the current inputs were analyzed; null = not analyzed since they last changed. */
  analyzedAt: string | null
}

export const READINESS_DIFFICULTIES: readonly ReadinessDifficulty[] = ['classic', 'expert', 'master']
export const READINESS_CLASSES: readonly ReadinessClass[] = ['melee', 'ranged', 'magic', 'summon', 'hybrid']

export function emptyReadinessLoadout(): ReadinessLoadout {
  return { mainWeapon: null, altWeapon: null, helmet: null, chest: null, legs: null, accessories: Array(STORED_ACCESSORY_SLOTS).fill(null), ammo: [], buffs: [], summon: null }
}

export function defaultReadinessSetup(stage: Stage = 'early-prehm'): ReadinessSetup {
  return { bossId: null, stage, difficulty: 'classic', class: 'melee', loadout: emptyReadinessLoadout(), analyzedAt: null }
}

/** Mirrors `Slug` in src/schemas/common.ts. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Mirrors Zod 4 `z.iso.datetime()` defaults: UTC "Z" only, seconds required, any sub-second precision. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const SETUP_KEYS = ['bossId', 'stage', 'difficulty', 'class', 'loadout', 'analyzedAt'] as const
const LOADOUT_KEYS = ['mainWeapon', 'altWeapon', 'helmet', 'chest', 'legs', 'accessories', 'ammo', 'buffs', 'summon'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `ItemId` = z.int().positive(). */
const isItemId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function exactKeys(record: Record<string, unknown>, keys: readonly string[], where: string): void {
  const unexpected = Object.keys(record).filter((k) => !keys.includes(k))
  if (unexpected.length > 0) throw new TypeError(`${where}: unexpected keys ${unexpected.join(', ')}`)
  const missing = keys.filter((k) => !(k in record))
  if (missing.length > 0) throw new TypeError(`${where}: missing ${missing.join(', ')}`)
}

function slotId(value: unknown, where: string): number | null {
  if (value === null) return null
  if (!isItemId(value)) throw new TypeError(`${where}: expected an item id or null`)
  return value
}

function parseLoadout(input: unknown): ReadinessLoadout {
  if (!isRecord(input)) throw new TypeError('readiness.loadout: expected an object')
  exactKeys(input, LOADOUT_KEYS, 'readiness.loadout')
  const { accessories, ammo, buffs } = input
  if (!Array.isArray(accessories) || accessories.length < 5 || accessories.length > 7) {
    throw new TypeError('readiness.loadout.accessories: expected 5–7 slots')
  }
  if (!Array.isArray(ammo) || !ammo.every(isItemId)) throw new TypeError('readiness.loadout.ammo: expected item ids')
  if (!Array.isArray(buffs) || !buffs.every(isItemId)) throw new TypeError('readiness.loadout.buffs: expected item ids')
  return {
    mainWeapon: slotId(input.mainWeapon, 'readiness.loadout.mainWeapon'),
    altWeapon: slotId(input.altWeapon, 'readiness.loadout.altWeapon'),
    helmet: slotId(input.helmet, 'readiness.loadout.helmet'),
    chest: slotId(input.chest, 'readiness.loadout.chest'),
    legs: slotId(input.legs, 'readiness.loadout.legs'),
    accessories: accessories.map((id, i) => slotId(id, `readiness.loadout.accessories.${i}`)),
    ammo: [...ammo],
    buffs: [...buffs],
    summon: slotId(input.summon, 'readiness.loadout.summon'),
  }
}

export function parseReadiness(input: unknown): ReadinessSetup {
  if (!isRecord(input)) throw new TypeError('readiness: expected an object')
  exactKeys(input, SETUP_KEYS, 'readiness')
  const { bossId, stage, difficulty, analyzedAt } = input
  if (bossId !== null && !(typeof bossId === 'string' && SLUG.test(bossId))) throw new TypeError('readiness.bossId: expected a boss slug or null')
  if (!isStage(stage)) throw new TypeError('readiness.stage: expected a stage id')
  if (typeof difficulty !== 'string' || !(READINESS_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    throw new TypeError('readiness.difficulty: expected classic, expert or master')
  }
  if (typeof input.class !== 'string' || !(READINESS_CLASSES as readonly string[]).includes(input.class)) {
    throw new TypeError('readiness.class: expected melee, ranged, magic, summon or hybrid')
  }
  if (analyzedAt !== null && !(typeof analyzedAt === 'string' && ISO_DATETIME.test(analyzedAt) && !Number.isNaN(Date.parse(analyzedAt)))) {
    throw new TypeError('readiness.analyzedAt: expected an ISO date-time or null')
  }
  return {
    bossId: bossId as string | null,
    stage,
    difficulty: difficulty as ReadinessDifficulty,
    class: input.class as ReadinessClass,
    loadout: parseLoadout(input.loadout),
    analyzedAt: analyzedAt as string | null,
  }
}

export const readinessDomain: DomainDef<ReadinessSetup> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseReadiness,
}
