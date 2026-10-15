import { listNames } from './focusCardCopy'

/**
 * "What Should I Do Next?" wording (PRD P5-S5; UX_SPEC §3.7, §8). Every user-visible string of the
 * recommender lives here (SCORING_SPEC §8.4: copy modules, no inline literals), so the copy audit can
 * read it whole. Reasons say how the map's connections relate one fight to another — never how hard a
 * fight is or how it will go (no difficulty estimates, no outcome phrasing). Quoted wiki lines (edge
 * notes) are evidence beside these, not part of them. "Defeated" is the tracking term (§8.4 exemption).
 */

export const PANEL_TITLE = 'What Should I Do Next?'
/** The toggle's label where the toolbar is narrow (below lg); the panel keeps the full title. */
export const TOGGLE_SHORT = 'What next?'
export const CLOSE_PANEL = 'Close What Should I Do Next?'

export const REQUIRED_TITLE = 'Required before you can progress'
export const REQUIRED_INTRO = 'Fights the game requires before the next part of the map opens.'
export const RECOMMENDED_TITLE = 'Recommended order'
export const RECOMMENDED_INTRO = 'The usual next steps first, then optional fights open at your stage.'

/* Context: what the list is based on (world evil + marked bosses + selected stage, PRD P5-S5 AC1). */

export const FRESH_CONTEXT = 'Nothing is marked on the map, so this starts at the beginning of a new world.'
export const progressContext = (stage: string) => `Based on the bosses marked on the map, you’re at ${stage}.`
/** With no world evil chosen the map's control reads "Both": the context names that state, not "not chosen". */
export const worldContext = (world: string | null) => (world ? `World evil: ${world}.` : 'World evil: Both, so the Corruption and Crimson fights are shown.')
/** The selected stage (StageSelector) as display context: the list itself follows tracked defeats (B69/Q6). */
export function stageNote(selected: string, progress: string, relation: 'ahead' | 'behind'): string {
  return relation === 'ahead'
    ? `Your selected stage is ${selected}, ahead of the bosses marked on the map (${progress}). Mark the fights you’ve done to bring this list up to date.`
    : `Your selected stage is ${selected}; the bosses marked on the map already reach ${progress}.`
}

/* Reasons: one line each, from the edge type that places the fight here (and its stage). */

const along = (partners: readonly string[]) => (partners.length > 0 ? `, along with ${listNames(partners)}` : '')
/** A required gate of a milestone that opens many things (the Wall of Flesh → Hardmode). */
export const neededToReach = (milestone: string, partners: readonly string[]) => `Needed to reach ${milestone}${along(partners)}.`
/** A required gate of the next fight on the path (the mechanical bosses → Plantera, Golem → Lunatic Cultist). */
export const neededFor = (target: string, partners: readonly string[]) => `Needed for ${target}${along(partners)}.`
/** The final node of the required path (Moon Lord). */
export const LAST_REQUIRED = 'The last fight on the map’s required path.'
/** Appended to a required fight that the map's recommended order puts after other fights. */
export const usuallyAfterHint = (names: readonly string[]) => `Usually fought after ${listNames(names)}.`

/** recommended-next from a milestone (Pre-Hardmode → Eye of Cthulhu). */
export const firstOf = (milestone: string) => `Usually the first fight of ${milestone}.`
/** recommended-next from a fight. */
export const usuallyNext = (source: string) => `Usually fought next, after ${source}.`
/** A required-gate link from something done, with nothing else placing the fight. */
export const openedBy = (source: string) => `Opened by ${source}.`
/** A world-evil fight once the world evil is chosen. */
export const inWorld = (world: string) => `In ${world} worlds, like yours.`
/** The world-evil fork with no world evil chosen ("Both"). */
export function forkChoice(source: string, members: readonly { name: string; world: string }[]): string {
  const options = members.map((m) => `${m.name} (${m.world})`).join(' or ')
  return `Usually fought next, after ${source}. Your world has one of these: ${options}. Choose your world evil on the map to narrow this down.`
}
export const OPTIONAL = 'Optional: not needed to progress.'
export const optionalEarlier = (stage: string) => `Optional, still open from ${stage}.`
/** The status tag of a fight still open from an earlier stage (in place of its map status). */
export const OPTIONAL_TAG = 'Optional'

/* Empty and complete states. */

export const requiredDone = (goal: string) => `Nothing on the required path is left: ${goal} is marked defeated.`
export const NOTHING_ELSE = 'Nothing else to suggest: the required fights above come next.'
export const COMPLETE_TITLE = 'Nothing left to recommend'
export const COMPLETE_ALL = 'Every boss on the map is marked defeated or skipped.'
export const COMPLETE_AHEAD = 'The required path is done, and every fight from your stage on is marked.'

/* Item furniture. */

/** Screen-reader tail of a node-jump button. */
export const SHOW_ON_MAP = ' — show on the map'
export const OR = 'or'
export const sourceLabel = (name: string) => `Source for the reason about ${name}`
export const SOURCES_NOTE = 'Reasons follow the map’s connections; quoted lines are from the Terraria Wiki.'
