/**
 * Bosses whose pages ship (`/bosses/:id`): the seven pre-Hardmode bosses (PRD P5-S2) and the Wall of
 * Flesh + the ten Hardmode bosses (P5-S3; AMENDMENTS-015 B79 assigns the Wall of Flesh, the Hardmode
 * gateway, to this list) — every boss of the registry. Events and milestones stay map markers without
 * pages (AMENDMENTS-001 A3). One list for both sides of the contract:
 * - pipeline: the emitted dataset's manifest declares these as `bossPages`, and validate runs the P5
 *   gate `E_BOSS_CURATION{bossId,field}` (AMENDMENTS-001 A1) for each of them;
 * - app: the boss map opens these nodes as pages (the rest keep the focus card) and search rows for
 *   them navigate in-app.
 * Zod-free on purpose: the shell imports it.
 */
export const BOSS_PAGE_IDS = [
  'king-slime',
  'eye-of-cthulhu',
  'eater-of-worlds',
  'brain-of-cthulhu',
  'queen-bee',
  'skeletron',
  'deerclops',
  'wall-of-flesh',
  'queen-slime',
  'the-twins',
  'the-destroyer',
  'skeletron-prime',
  'plantera',
  'golem',
  'empress-of-light',
  'duke-fishron',
  'lunatic-cultist',
  'moon-lord',
] as const

export type BossPageId = (typeof BOSS_PAGE_IDS)[number]

export function hasBossPage(id: string): id is BossPageId {
  return (BOSS_PAGE_IDS as readonly string[]).includes(id)
}
