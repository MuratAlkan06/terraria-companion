/**
 * Game-stage vocabulary (DATA_SCHEMA_SPEC §2.0 `Stage`, REQUIREMENTS §1).
 * IDs match the schema enum exactly so persisted settings stay valid when the
 * P2 Zod schemas (`src/schemas/common.ts`) take over this definition.
 */
export const STAGE_IDS = ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame'] as const

export type Stage = (typeof STAGE_IDS)[number]

export interface StageInfo {
  id: Stage
  /** Full label used in menus and pages. */
  label: string
  /** Compact label for the header chip at 375px. */
  shortLabel: string
}

export const STAGES: readonly StageInfo[] = [
  { id: 'early-prehm', label: 'Early Pre-Hardmode', shortLabel: 'Early Pre-HM' },
  { id: 'late-prehm', label: 'Late Pre-Hardmode', shortLabel: 'Late Pre-HM' },
  { id: 'early-hm', label: 'Early Hardmode', shortLabel: 'Early HM' },
  { id: 'mid-hm', label: 'Mid-Hardmode', shortLabel: 'Mid-HM' },
  { id: 'endgame', label: 'Endgame', shortLabel: 'Endgame' },
]

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGE_IDS as readonly string[]).includes(value)
}

export function getStageInfo(id: Stage): StageInfo {
  const info = STAGES.find((s) => s.id === id)
  if (!info) throw new Error(`Unknown stage: ${id}`)
  return info
}
