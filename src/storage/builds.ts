/**
 * `tc.v1.builds` domain (DATA_SCHEMA_SPEC §8a `BuildsV1` / `SavedBuildV1`, AMENDMENTS-016 B106
 * `BuildsV2` / `SavedBuildV2`; PRD P4-S2/S4 "Save Build"; UX_SPEC §3.5 Step 4, §6 "Edit saved build"):
 * the user's named loadouts. Each holds the builder's inputs (stage, class, difficulty, goal; since v2
 * the target boss and the items marked owned) and the slots as saved, plus (v2) which empty slots the
 * user emptied — the recommendation is never stored; opening a build re-scores those slots against
 * today's data.
 *
 * Hand-written strict validator (same pattern as ./readiness.ts) so the storage module never pulls Zod
 * into a bundle; src/app/buildsStore.test.ts asserts parity with the Zod `BuildsV2` (and that v1 data
 * still reads). A payload that fails is quarantined by the storage module (set aside, never deleted —
 * ADR D6).
 */
import { isStage, type Stage } from '../app/stages'
import { exactKeys, isItemId, ISO_DATETIME, isRecord, parseLoadout, READINESS_CLASSES, READINESS_DIFFICULTIES, SLUG, type ReadinessClass, type ReadinessDifficulty, type ReadinessLoadout } from './readiness'
import type { DomainDef } from './types'

export type BuildGoal = 'max-damage' | 'survivability' | 'mobility' | 'exploration' | 'boss' | 'balanced'
export const BUILD_GOALS: readonly BuildGoal[] = ['max-damage', 'survivability', 'mobility', 'exploration', 'boss', 'balanced']

/**
 * The builder's slots (Zod `BuildSlotId`; equal to src/scoring/recommend.ts SLOT_IDS — the parity is
 * pinned in src/app/buildsStore.test.ts). Kept local so the storage module, which is in the shell
 * bundle, never pulls the scoring engine into it.
 */
export const BUILD_SLOT_IDS = ['main', 'alt', 'armor', 'acc0', 'acc1', 'acc2', 'acc3', 'acc4', 'acc5', 'acc6', 'ammo0', 'ammo1', 'buff0', 'buff1', 'buff2', 'summon'] as const
export type BuildSlotId = (typeof BUILD_SLOT_IDS)[number]

/** DATA_SCHEMA_SPEC §8a SavedBuildV1 + AMENDMENTS-016 B106 v2 fields (absent in a v1 build). */
export interface SavedBuild {
  /** ≥ 8 characters, unique in the list. */
  buildId: string
  name: string
  createdAt: string
  updatedAt: string
  stage: Stage
  class: ReadinessClass
  difficulty: ReadinessDifficulty
  goal?: BuildGoal
  slots: ReadinessLoadout
  notes?: string
  /** v2: the boss the build was made for (absent: none, or a v1 build). */
  targetBoss?: string
  /** v2: the items marked owned when it was saved (absent: a v1 build). */
  ownedIds?: number[]
  /**
   * v2: the slots the user emptied. Present = v2 semantics: a null slot NOT listed is one the
   * recommendation left unfilled. Absent = a v1 build: every stored null is deliberately empty (§8a).
   */
  emptiedSlots?: BuildSlotId[]
}

export interface BuildsData {
  builds: SavedBuild[]
}

export const EMPTY_BUILDS: BuildsData = { builds: [] }

/** A build's display-name cap (UI input maxLength; the schema only requires non-empty). */
export const BUILD_NAME_MAX = 60

const BUILD_KEYS = ['buildId', 'name', 'createdAt', 'updatedAt', 'stage', 'class', 'difficulty', 'goal', 'slots', 'notes', 'targetBoss', 'ownedIds', 'emptiedSlots'] as const
const REQUIRED = ['buildId', 'name', 'createdAt', 'updatedAt', 'stage', 'class', 'difficulty', 'slots'] as const

const isDateTime = (v: unknown): v is string => typeof v === 'string' && ISO_DATETIME.test(v) && !Number.isNaN(Date.parse(v))
const isSlotId = (v: unknown): v is BuildSlotId => typeof v === 'string' && (BUILD_SLOT_IDS as readonly string[]).includes(v)

function parseBuild(input: unknown, i: number): SavedBuild {
  const where = `builds.${i}`
  if (!isRecord(input)) throw new TypeError(`${where}: expected an object`)
  const unexpected = Object.keys(input).filter((k) => !(BUILD_KEYS as readonly string[]).includes(k))
  if (unexpected.length > 0) throw new TypeError(`${where}: unexpected keys ${unexpected.join(', ')}`)
  const missing = REQUIRED.filter((k) => !(k in input))
  if (missing.length > 0) throw new TypeError(`${where}: missing ${missing.join(', ')}`)
  const { buildId, name, createdAt, updatedAt, stage, difficulty, goal, notes, targetBoss, ownedIds, emptiedSlots } = input
  if (typeof buildId !== 'string' || buildId.length < 8) throw new TypeError(`${where}.buildId: expected a string of 8+ characters`)
  if (typeof name !== 'string' || name.length < 1) throw new TypeError(`${where}.name: expected a non-empty string`)
  if (!isDateTime(createdAt)) throw new TypeError(`${where}.createdAt: expected an ISO date-time`)
  if (!isDateTime(updatedAt)) throw new TypeError(`${where}.updatedAt: expected an ISO date-time`)
  if (!isStage(stage)) throw new TypeError(`${where}.stage: expected a stage id`)
  if (typeof input.class !== 'string' || !(READINESS_CLASSES as readonly string[]).includes(input.class)) throw new TypeError(`${where}.class: expected a loadout class`)
  if (typeof difficulty !== 'string' || !(READINESS_DIFFICULTIES as readonly string[]).includes(difficulty)) throw new TypeError(`${where}.difficulty: expected a difficulty`)
  if (goal !== undefined && !(typeof goal === 'string' && (BUILD_GOALS as readonly string[]).includes(goal))) throw new TypeError(`${where}.goal: expected a goal`)
  if (notes !== undefined && typeof notes !== 'string') throw new TypeError(`${where}.notes: expected a string`)
  if (targetBoss !== undefined && !(typeof targetBoss === 'string' && SLUG.test(targetBoss))) throw new TypeError(`${where}.targetBoss: expected a boss slug`)
  if (ownedIds !== undefined && !(Array.isArray(ownedIds) && ownedIds.every(isItemId))) throw new TypeError(`${where}.ownedIds: expected item ids`)
  if (emptiedSlots !== undefined && !(Array.isArray(emptiedSlots) && emptiedSlots.every(isSlotId))) throw new TypeError(`${where}.emptiedSlots: expected builder slot ids`)
  return {
    buildId,
    name,
    createdAt,
    updatedAt,
    stage,
    class: input.class as ReadinessClass,
    difficulty: difficulty as ReadinessDifficulty,
    ...(goal !== undefined ? { goal: goal as BuildGoal } : {}),
    slots: parseLoadout(input.slots, `${where}.slots`),
    ...(notes !== undefined ? { notes } : {}),
    ...(targetBoss !== undefined ? { targetBoss: targetBoss as string } : {}),
    ...(ownedIds !== undefined ? { ownedIds: [...(ownedIds as number[])] } : {}),
    ...(emptiedSlots !== undefined ? { emptiedSlots: [...(emptiedSlots as BuildSlotId[])] } : {}),
  }
}

export function parseBuilds(input: unknown): BuildsData {
  if (!isRecord(input)) throw new TypeError('builds: expected an object')
  exactKeys(input, ['builds'], 'builds')
  if (!Array.isArray(input.builds)) throw new TypeError('builds.builds: expected a list')
  const builds = input.builds.map(parseBuild)
  const ids = new Set(builds.map((b) => b.buildId))
  if (ids.size !== builds.length) throw new TypeError('builds.builds: duplicate buildId')
  return { builds }
}

export const buildsDomain: DomainDef<BuildsData> = {
  version: 2,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 -> v2 (AMENDMENTS-016 B106) is additive:
  // every v2 field is optional and absent in v1 data, so the data reads as-is — a v1 build keeps its
  // meaning (no target boss, no owned items, every stored null deliberately empty).
  migrations: [(v1) => v1],
  parse: parseBuilds,
}
