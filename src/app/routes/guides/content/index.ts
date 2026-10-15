/**
 * The guide registry (PRD P6-S8: the pre-Hardmode path, in reading order). P6-S9's Hardmode
 * guides join as a second path.
 */
import type { Guide } from '../guideModel'
import { armorAndDefense } from './armorAndDefense'
import { betterEquipment } from './betterEquipment'
import { exploringSafely } from './exploringSafely'
import { firstBossPrep } from './firstBossPrep'
import { newWorld } from './newWorld'

export interface GuidePath {
  id: string
  title: string
  description: string
  guides: readonly Guide[]
}

export const GUIDE_PATHS: readonly GuidePath[] = [
  {
    id: 'pre-hardmode',
    title: 'Pre-Hardmode path',
    description: 'From your first day in a new world to your first boss, one step at a time.',
    guides: [newWorld, exploringSafely, betterEquipment, armorAndDefense, firstBossPrep],
  },
]

export const GUIDES: readonly Guide[] = GUIDE_PATHS.flatMap((path) => path.guides)

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug)
}

/** The guide's path and its 1-based position in it. */
export function guidePosition(guide: Guide): { path: GuidePath; index: number } {
  for (const path of GUIDE_PATHS) {
    const index = path.guides.indexOf(guide)
    if (index >= 0) return { path, index: index + 1 }
  }
  throw new Error(`Guide "${guide.slug}" is not on any path`)
}
