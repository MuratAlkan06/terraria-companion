import type { NodeState } from '../../../components/nodeMap/graph'

/**
 * Progress wording shared by the map's focus card and the boss pages (P5-S4 defeat tracking). Plain
 * statements of what was marked and what it opened — no forward promises, no outcome claims (the
 * "defeat" vocabulary is the tracking term, SCORING_SPEC §8.4 exemption).
 */

/** The tracked states, as the three-state control names them. */
export const STATE_LABEL: Readonly<Record<'not-attempted' | NodeState, string>> = {
  'not-attempted': 'Not attempted',
  defeated: 'Defeated',
  skipped: 'Skipped',
}

/** The control's label (its legend). */
export const PROGRESS_LEGEND = 'Your progress'

/** Under the control when the browser couldn't save (the change still applies for this visit). */
export const UNSAVED_NOTE = 'Not saved in this browser — kept until you reload or close this tab.'

/** A locked boss: which gates the map is still waiting for. */
export const lockedNote = (gates: readonly string[]) => `Locked on the map: needs ${listNames(gates)} first.`

/** Milestones and events aren't marked: they follow the bosses that gate them. */
export const MARKER_NOTE = 'Milestones and events follow the bosses you mark.'

/** Polite announcement after a change: the new state, and what it opened on the map. */
export function stateAnnouncement(name: string, state: NodeState | null, opened: readonly string[], saved: boolean): string {
  const parts = [`${name} marked ${STATE_LABEL[state ?? 'not-attempted'].toLowerCase()}.`]
  if (opened.length > 0) parts.push(`Now open: ${listNames(opened)}.`)
  if (!saved) parts.push(UNSAVED_NOTE)
  return parts.join(' ')
}

/** The focus card closed so the map could show what a mark opened (design review P5-S4 H1). */
export const CARD_CLOSED_FOR_CASCADE = 'Details closed to show the map.'

/**
 * Polite announcement when the card closes for the unlock cascade: the card's own announcement goes
 * with it, so this repeats it (`marked`: the card's node changed) or says what opened, then why the
 * card closed.
 */
export function cascadeUncoverAnnouncement(marked: { name: string; state: NodeState | null } | null, opened: readonly string[], saved: boolean): string {
  const lead = marked ? stateAnnouncement(marked.name, marked.state, opened, saved) : opened.length > 0 ? `Now open: ${listNames(opened)}.` : ''
  return [lead, CARD_CLOSED_FOR_CASCADE].filter(Boolean).join(' ')
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The focus card's link to a boss page ("Open The Twins page", never "the The Twins"). */
export const OPEN_PAGE_LABEL = (name: string) => (/^the /i.test(name) ? `Open ${name} page` : `Open the ${name} page`)

/* Reset (UX_SPEC §6, P5-S4 AC3) ------------------------------------------------------------- */

export const RESET_MENU_LABEL = 'Reset progress…'
export const RESET_NOTHING_TRACKED = 'No defeats tracked'
export const RESET_TITLE = 'Reset boss progress?'
const bosses = (count: number) => `${count} ${count === 1 ? 'boss' : 'bosses'}`
export const resetDescription = (count: number) => `This clears defeat tracking for ${bosses(count)}. Saved builds and plans are not affected.`
export const RESET_KEPT_NOTE = 'Your world evil choice and checklists stay as they are.'
export const RESET_CONFIRM = 'Reset progress'
export const RESET_CANCEL = 'Cancel'
export const resetDone = (count: number) => `Defeat tracking cleared for ${bosses(count)}.`
export const UNDO_LABEL = 'Undo'
export const RESTORED = 'Boss progress restored.'
/** UX_SPEC §6: the post-reset toast offers a one-shot Undo for 6s. */
export const UNDO_WINDOW_MS = 6000
