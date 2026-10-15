/**
 * The homepage saved-builds rail's wording (PRD P4-S4 AC4; UX_SPEC §3.2, §5.6). Its own small module:
 * the rail is in the eager bundle, so it never imports the builder's copy (the class / difficulty /
 * goal names are repeated here — the readiness checker's copy does the same).
 */
import type { BuildGoal, SavedBuild } from '../../../storage/builds'
import type { ReadinessClass, ReadinessDifficulty } from '../../../storage/readiness'
import { getStageInfo } from '../../stages'

export const RAIL_TITLE = 'Your saved builds'
export const RAIL_ALL = 'All saved builds'
export const RAIL_QUARANTINE = 'Some saved builds couldn’t be read and were set aside (not deleted).'
export const RAIL_EMPTY_BUILD = 'Every slot is empty.'
export const railItems = (n: number): string => (n === 1 ? '1 item' : `${n} items`)
export const railSaved = (when: string): string => `Saved ${when}`
export const railPreview = (name: string): string => `${name}: its equipment`
const CLASS_NAMES: Readonly<Record<ReadinessClass, string>> = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summon', hybrid: 'Hybrid' }
const DIFFICULTY_NAMES: Readonly<Record<ReadinessDifficulty, string>> = { classic: 'Classic Mode', expert: 'Expert Mode', master: 'Master Mode' }
const GOAL_NAMES: Readonly<Record<BuildGoal, string>> = { boss: 'Boss fight', 'max-damage': 'Max damage', exploration: 'Exploration', survivability: 'Survivability', mobility: 'Mobility', balanced: 'Balanced' }
export const railMeta = (b: Pick<SavedBuild, 'class' | 'stage' | 'difficulty' | 'goal'>): string =>
  [CLASS_NAMES[b.class], getStageInfo(b.stage).label, DIFFICULTY_NAMES[b.difficulty], ...(b.goal ? [GOAL_NAMES[b.goal]] : [])].join(' · ')
