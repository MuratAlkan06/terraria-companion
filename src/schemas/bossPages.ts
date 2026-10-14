/**
 * Bosses whose pages ship (`/bosses/:id`; PRD P5-S2 — the seven pre-Hardmode bosses). One list for
 * both sides of the contract:
 * - pipeline: the emitted dataset's manifest declares these as `bossPages`, and validate runs the P5
 *   gate `E_BOSS_CURATION{bossId,field}` (AMENDMENTS-001 A1) for each of them;
 * - app: the boss map opens these nodes as pages (the rest keep the focus card) and search rows for
 *   them navigate in-app.
 * Extend it as boss-page slices ship (P5-S3). Zod-free on purpose: the shell imports it.
 */
export const BOSS_PAGE_IDS = [
  'king-slime',
  'eye-of-cthulhu',
  'eater-of-worlds',
  'brain-of-cthulhu',
  'queen-bee',
  'skeletron',
  'deerclops',
] as const

export type BossPageId = (typeof BOSS_PAGE_IDS)[number]

export function hasBossPage(id: string): id is BossPageId {
  return (BOSS_PAGE_IDS as readonly string[]).includes(id)
}
