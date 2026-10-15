/**
 * Build text export / import wording (P7-S2b; ADR D6 export/import; UX_SPEC §4(f), §5.7, §9; AMENDMENTS-016
 * B123(a)). Its own copy module, so the copy audit (src/scoring/copyAudit.ts — no outcome promises, no
 * forward promises) runs over every sentence, the text block's lines included.
 */
import type { BuildCodeError } from '../../../storage/transfer'
import { plainFailure } from '../../dataDomains'

/* The text block (src/app/routes/loadout/buildText.ts) */
export const TEXT_TITLE = 'Terraria Companion build'
export const textLine = (label: string, value: string) => `${label}: ${value}`
export const TEXT_LABELS = {
  name: 'Name',
  class: 'Class',
  stage: 'Stage',
  difficulty: 'Difficulty',
  goal: 'Goal',
  boss: 'Made for',
  exported: 'Exported',
  slots: 'Slots',
  helmet: 'Helmet',
  chest: 'Chest',
  legs: 'Legs',
  ammo: 'Ammo',
  potions: 'Potions',
  owned: 'Gear you own',
  notes: 'Notes',
} as const
export const difficultyMode = (difficulty: string) => `${difficulty} Mode`
/** A build saved without a goal (v1) opens with the builder's default. */
export const goalDefault = (goal: string) => `${goal} (none saved; the builder’s default)`
export const exportedLine = (date: string, app: string, appVersion: string, gameVersion: string, platform: string) => `${date} from ${app} ${appVersion} · game data ${gameVersion} (${platform})`
export const NONE = 'none'
export const EMPTY_EMPTIED = 'empty — emptied by you'
export const EMPTY_UNFILLED = 'empty — left empty by the recommendation'
/** Ammo and potions are lists: their emptied positions are named after the items. */
export const listEmptied = (labels: string) => `(emptied by you: ${labels})`
/** An accessory saved past the difficulty's slots (the builder doesn't place it). */
export const beyondSlots = (item: string) => `${item} — no such slot at this difficulty`
export const unknownItem = (id: number) => `Unknown item (id ${id})`
export const bossNotInData = (slug: string) => `${slug} (not a boss in this site’s data)`
export const CODE_NOTE = 'Only the #code: line below is read when this build is imported; the lines above are for reading.'

/* Export (the saved-builds list, Step 4) */
export const EXPORT = 'Export'
export const exportSr = (name: string) => `Export ${name} as text`
export const EXPORT_DRAFT = 'Export as text'
export const EXPORT_DRAFT_HINT = 'Export as text copies this loadout, with the name above — saved or not — to keep, share or move to another browser.'
export const exportTitle = (name: string) => `Export “${name}”`
export const EXPORT_DESCRIPTION =
  'Copy this text, then paste it into “Import a build” on the saved-builds list — in this browser or another one. Only its #code: line is read; the lines above it are for people.'
export const TEXT_LABEL = 'Build text'
export const COPY = 'Copy text'
export const COPIED = 'Copied ✓'
export const COPIED_STATUS = 'Copied to the clipboard.'
export const COPY_FAILED = 'Couldn’t copy automatically. The text is selected: copy it with Ctrl+C (⌘C on a Mac).'
export const CLOSE = 'Close'
/** The footer's way out (named apart from the corner Close, so no two controls share a name). */
export const DONE = 'Done'

/* Import (the saved-builds list) */
export const IMPORT_OPEN = 'Import a build'
export const IMPORT_TITLE = 'Import a build'
export const IMPORT_INTRO = 'Paste a build text exported from this site — the whole text, or just its #code: line. You see the build before anything is saved.'
export const IMPORT_LABEL = 'Build text'
export const IMPORT_READ = 'Read the build'
export const IMPORT_CANCEL = 'Cancel'

/** UX_SPEC §4(f): an honest, field-level error for each way a paste can't be read. */
export function importError(error: BuildCodeError): string {
  switch (error.kind) {
    case 'empty':
      return 'Paste a build text first.'
    case 'no-code':
      return 'This isn’t a build text from this site: it has no “#code:” line.'
    case 'several-codes':
      return `This text holds ${error.count} different build codes. Paste one build at a time.`
    case 'damaged':
      return 'This build code is damaged — it may have been cut short or changed on the way. Copy the whole text again from where it came from. Nothing was imported.'
    case 'future-version':
      return `This build was exported by a newer version of the site (build format ${error.version}; this version reads up to format ${error.supported}). Nothing was imported. Reload the site to get its newest version, then try again.`
    case 'invalid':
      return `This build code reads, but the build in it doesn’t pass this site’s checks, so it can’t be imported. ${plainFailure(error.failure)}`
  }
}
export const TECHNICAL = 'Details:'

export const previewTitle = (name: string) => `In this text: “${name}”`
export const PREVIEW_LEAD = 'Nothing is saved until you add it.'
export const previewGame = (codeGame: string, siteGame: string) =>
  `Exported with game data ${codeGame}; this site now uses ${siteGame}. Items are stored by their game ids, which stay the same; a few details about them may differ.`
export const previewBossMissing = (slug: string) => `Made for “${slug}”, which isn’t a boss in this site’s data: the build opens without a target boss.`
export const itemsCount = (n: number) => (n === 0 ? 'Every slot is empty.' : n === 1 ? 'Its slots hold 1 item.' : `Its slots hold ${n} items.`)
export const ownedCount = (n: number) => (n === 0 ? 'No gear marked as owned.' : n === 1 ? '1 item marked as owned.' : `${n} items marked as owned.`)
/** "Unknown items listed by id with the count kept": every id the data doesn't know, and where it sits. */
export const unknownTitle = (n: number, gameVersion: string) =>
  n === 1 ? `1 item isn’t in this site’s data (game data ${gameVersion}):` : `${n} items aren’t in this site’s data (game data ${gameVersion}):`
export const unknownRow = (id: number, where: string) => `${unknownItem(id)} — ${where}`
export const UNKNOWN_WHERE_OWNED = 'gear you own'
export const UNKNOWN_KEPT = 'Adding the build keeps them as they are, by their ids, and counts them with the rest. Opening it in the builder lists any item it can’t place.'
export const alreadySaved = (name: string) => `This browser already has this build, saved as “${name}”. Adding it makes a second copy.`
export const ADD = 'Add to my builds'
export const added = (name: string) => `Added “${name}” to your saved builds.`
