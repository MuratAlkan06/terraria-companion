/**
 * The Armored Dummy's boss quick picks (PRD P3-S12 AC3): verified boss defense values, quoted from the
 * bosses dataset with each boss's wiki page as the source — never a guessed stat. Pure (no DOM), so it
 * is Node-tested against the committed data.
 *
 * A boss is offered only when its normal-mode (`classic`) defense is VERIFIED (getField: present and
 * not listed unverified) and every other verified difficulty states the same value — the wiki's
 * Defense page: enemy defense has no difficulty scaling, so differing values would mean a reading the
 * Lab can't vouch for (none in the data today). The value is the boss's BASE stat — its first form's for
 * a boss that changes form mid-fight (the dataset's stat rule, the boss pages' "first form" caption):
 * `multiForm` makes the panel say so. Everything else about the boss (its hitbox, phases, damage
 * reduction, movement) is not part of the Armored Dummy; the panel and the `target-armored` assumption say
 * that too. Ordered by defense, then name.
 */
import type { Boss } from '../schemas'
import { getField } from '../schemas/getField'
import { ARMORED_DEFENSE_RANGE } from './labSetup'

export interface BossDefense {
  id: string
  name: string
  defense: number
  /** The boss's wiki page (the NPC data the defense came from). */
  sourceUrl: string
  /** The boss changes form mid-fight (curated `multi-phase` attack pattern): the value is its first form's. */
  multiForm: boolean
}

const DIFFICULTIES = ['classic', 'expert', 'master'] as const

function verifiedInt(boss: Boss, path: string): number | null {
  const view = getField(boss, path)
  return view.status === 'verified' && typeof view.value === 'number' && Number.isInteger(view.value) ? view.value : null
}

/** The bosses whose verified defense the Armored Dummy can take (see the header). */
export function bossDefenses(bosses: readonly Boss[]): BossDefense[] {
  const out: BossDefense[] = []
  for (const boss of bosses) {
    const classic = verifiedInt(boss, 'statsByDifficulty.classic.defense')
    if (classic === null || classic < ARMORED_DEFENSE_RANGE.min || classic > ARMORED_DEFENSE_RANGE.max) continue
    const others = DIFFICULTIES.slice(1).map((d) => verifiedInt(boss, `statsByDifficulty.${d}.defense`))
    if (others.some((v) => v !== null && v !== classic)) continue
    const tags = getField(boss, 'attackPatternTags')
    const multiForm = (tags.status === 'verified' || tags.status === 'editorial') && Array.isArray(tags.value) && tags.value.includes('multi-phase')
    out.push({ id: boss.id, name: boss.name, defense: classic, sourceUrl: boss.wikiUrl, multiForm })
  }
  return out.sort((a, b) => a.defense - b.defense || a.name.localeCompare(b.name, 'en'))
}

/** The boss an Armored Dummy target names, while its defense is still that boss's (else null). */
export function namedBoss(target: { defense: number; bossId: string | null }, picks: readonly BossDefense[]): BossDefense | null {
  if (target.bossId === null) return null
  const boss = picks.find((b) => b.id === target.bossId)
  return boss && boss.defense === target.defense ? boss : null
}
