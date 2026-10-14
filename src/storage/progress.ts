/**
 * `tc.v1.progress` domain (DATA_SCHEMA_SPEC §8a `ProgressV1`): the world's evil (Corruption or
 * Crimson; null = not chosen) and per-node progression states (absent = not attempted).
 *
 * Hand-written strict validator (same pattern as ./settings.ts and ./recent.ts) so the storage
 * module never pulls Zod into a bundle; progress.test.ts asserts parity with the Zod `ProgressV1`.
 * P5-S1 writes `worldEvil` (the map's world-evil toggle); `nodeStates` is read and preserved as
 * stored — this slice offers no way to change it.
 */
import type { DomainDef } from './types'

export type WorldEvil = 'corruption' | 'crimson'
export type NodeState = 'defeated' | 'skipped'

export interface ProgressData {
  worldEvil: WorldEvil | null
  nodeStates: Record<string, NodeState>
}

export const EMPTY_PROGRESS: ProgressData = { worldEvil: null, nodeStates: {} }

const WORLD_EVILS: readonly string[] = ['corruption', 'crimson']
const NODE_STATES: readonly string[] = ['defeated', 'skipped']
/** Mirrors `Slug` in src/schemas/common.ts. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProgress(input: unknown): ProgressData {
  if (!isRecord(input)) throw new TypeError('progress: expected an object')
  const unexpected = Object.keys(input).filter((k) => k !== 'worldEvil' && k !== 'nodeStates')
  if (unexpected.length > 0) throw new TypeError(`progress: unexpected keys ${unexpected.join(', ')}`)
  const { worldEvil, nodeStates } = input
  if (worldEvil !== null && !(typeof worldEvil === 'string' && WORLD_EVILS.includes(worldEvil))) {
    throw new TypeError('progress.worldEvil: expected "corruption", "crimson" or null')
  }
  if (!isRecord(nodeStates)) throw new TypeError('progress.nodeStates: expected an object')
  const states: Record<string, NodeState> = {}
  for (const [key, value] of Object.entries(nodeStates)) {
    if (!SLUG.test(key)) throw new TypeError(`progress.nodeStates: "${key}" is not a node slug`)
    if (typeof value !== 'string' || !NODE_STATES.includes(value)) {
      throw new TypeError(`progress.nodeStates.${key}: expected "defeated" or "skipped"`)
    }
    states[key] = value as NodeState
  }
  return { worldEvil: worldEvil as WorldEvil | null, nodeStates: states }
}

export const progressDomain: DomainDef<ProgressData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseProgress,
}
