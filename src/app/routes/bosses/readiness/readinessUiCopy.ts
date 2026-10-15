/**
 * Readiness checker UI wording (PRD P5-S6/S7 + §9 Feature A AC3; UX_SPEC §3.8, §5, §6, §8; SCORING_SPEC
 * §8.4: copy modules, no inline user-visible literals). The page explains factors — what makes the
 * fight easier or harder and why — and never forecasts the fight. The engine's line wording lives in
 * src/scoring/readinessCopy.ts; the copy audit (src/scoring/copyAudit.ts) reads both.
 */

export const DOC_TITLE = 'Boss readiness'
export const PAGE_TITLE = 'Boss Readiness Checker'
export const PAGE_INTRO =
  'Pick a boss and enter the gear you use. Each factor says what in your loadout makes this fight easier or harder, and why. Nothing here is a forecast of the fight itself.'

/* Setup */
export const SETUP_TITLE = 'Your setup'
export const BOSS_LABEL = 'Boss'
export const BOSS_PLACEHOLDER = 'Choose a boss'
export const STAGE_LABEL = 'Stage'
export const DIFFICULTY_LABEL = 'Difficulty'
export const CLASS_LABEL = 'Class'
export const DIFFICULTY_NAMES = { classic: 'Classic', expert: 'Expert', master: 'Master' } as const
export const CLASS_NAMES = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summon', hybrid: 'Hybrid' } as const
export const HYBRID_NOTE = 'Hybrid: every class’s bonuses count as matching.'

export const trackingContext = (marked: number): string =>
  marked === 0
    ? 'No bosses are marked defeated on the boss map, so only items with no boss gate count as available.'
    : `Availability follows the ${marked} ${marked === 1 ? 'boss' : 'bosses'} marked defeated on the boss map.`
/** "Both" (no world evil chosen): either evil boss counts once marked (AMENDMENTS-015 B96a) — said in its own sentence. */
export const worldContext = (world: string | null): string =>
  world ? `World evil: ${world}.` : 'World evil: Both (the map’s setting), so items that need the Eater of Worlds or the Brain of Cthulhu count once that boss is marked defeated.'
/** Marks a chosen world evil leaves out (the other world's evil boss): counted above, explained here — never silently dropped. */
export const offWorldMarks = (names: readonly string[], world: string): string =>
  names.length === 1
    ? `${names[0]} is marked defeated but isn’t your chosen world evil (${world}), so items that need it stay gated.`
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are marked defeated but aren’t your chosen world evil (${world}), so items that need them stay gated.`
export const OPEN_MAP = 'Mark bosses on the boss map'
export const stageNote = (selected: string, progress: string, relation: 'ahead' | 'behind'): string =>
  relation === 'ahead'
    ? `Your stage is set to ${selected}, ahead of the bosses marked on the map (${progress}). Availability here follows the marked bosses.`
    : `Your stage is set to ${selected}; the bosses marked on the map already reach ${progress}.`

/* Loadout */
export const LOADOUT_TITLE = 'Your loadout'
export const LOADOUT_HINT = 'Add the gear you use. Each slot searches the item database.'
export const GROUP_WEAPONS = 'Weapons'
export const GROUP_ARMOR = 'Armor'
export const GROUP_ACCESSORIES = 'Accessories'
export const GROUP_AMMO = 'Ammo'
export const GROUP_POTIONS = 'Potions'
export const GROUP_SUMMON = 'Summon'
export const SLOT_LABELS = { mainWeapon: 'Main weapon', altWeapon: 'Alt weapon', helmet: 'Helmet', chest: 'Chest', legs: 'Legs', summon: 'Summon item' } as const
export const accessoryLabel = (n: number): string => `Accessory ${n}`
export const DEMON_HEART_SLOT = 'Demon Heart slot'
export const DEMON_HEART_CHIP = 'assumes Demon Heart'
/** "Opens once the {Wall of Flesh} is marked defeated." — the boss linked in the sentence, no badge beside it (B96c). */
export const DEMON_HEART_LOCKED_LEAD = 'Opens once the '
export const DEMON_HEART_LOCKED_TAIL = ' is marked defeated.'
export const EMPTY_SLOT = 'Empty'
export const ADD = 'Add'
export const addTo = (slot: string): string => `Add ${slot.toLowerCase()}`
export const changeSlot = (slot: string, item: string): string => `${slot}: ${item}. Change`
export const emptySlot = (slot: string): string => `${slot}: empty. Add an item`
export const removeFrom = (item: string, slot: string): string => `Remove ${item} from ${slot.toLowerCase()}`
export const ADD_AMMO = 'Add ammo'
export const ADD_POTION = 'Add potion'
export const NOT_COUNTED_TAG = 'not counted'
export const AVAILABILITY = 'Availability:'
export const COUNTED_AS_YOURS = 'Counted because it’s in your loadout.'
/**
 * A gate chip: "After A, B and C" (every boss listed is needed); screen readers hear "Available after you
 * defeat …" (GateBadge's words) — the visible "After" is part of that sentence, never hidden and repeated.
 */
export const GATES_LEAD = 'After'
export const GATES_SR_LEAD = 'Available '
export const GATES_SR_TAIL = ' you defeat'
export const gateNames = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
export const inactiveSlots = (n: number, difficulty: string): string =>
  `${n} saved ${n === 1 ? 'accessory sits' : 'accessories sit'} in a slot ${difficulty} Mode doesn’t have; kept for when you switch back, not analyzed.`
export const reasonText = {
  duplicate: 'already equipped in another slot',
  'wrong-slot': 'doesn’t fit this slot',
  'missing-from-dataset': 'not in this version’s data',
  'demon-heart': 'in the Demon Heart slot, which opens once the Wall of Flesh is marked defeated',
} as const

/* Actions + validation */
export const ANALYZE = 'Analyze My Build'
export const REANALYZE = 'Re-analyze'
export const CLEAR = 'Clear setup'
export const CLEAR_TITLE = 'Clear your readiness setup?'
export const CLEAR_BODY = 'This removes the boss, loadout and analysis saved for the readiness checker.'
export const CLEAR_KEEP = 'Boss progress, checklists and favorites are not affected.'
export const ERROR_NO_BOSS = 'Choose a boss to analyze.'
export const ERROR_EMPTY = 'Add at least one item to your loadout first.'
export const QUARANTINE_NOTICE = 'Some saved data couldn’t be read and was set aside (not deleted).'
export const PERSIST_ERROR_NOTICE = 'Couldn’t save to this browser’s storage. Your setup is kept until you reload or close this tab.'
export const LOAD_ERROR = 'Couldn’t load the readiness checker'
export const LOADING = 'Loading the readiness checker…'
export const ANNOUNCE_READY = 'Analysis ready.'

/* Analysis */
export const ANALYSIS_REGION = 'Analysis'
export const analysisTitle = (boss: string): string => `${boss}: your factors`
/** Difficulty and class only: the stage is context, said in the setup pane's note (B94(6), B96c). */
export const analysisMeta = (difficulty: string, cls: string): string => `${difficulty} Mode · ${cls}`
/** The setup now names another boss than the analysis shown (arriving from that boss's page). */
export const analysisPendingTitle = (boss: string): string => `${boss}: ready to analyze`
export const previousAnalysis = (boss: string): string => `Shown below: your last analysis, for ${boss}.`
export const analyzedOn = (when: string): string => `Analyzed ${when}`
export const STALE_SETUP = 'Out of date: your setup changed since this analysis.'
export const STALE_PROGRESS = 'Out of date: the bosses marked on the map changed since this analysis.'
export const GUIDED_TITLE = 'Start with what you have'
export const GUIDED_STEPS = [
  'Choose the boss you’re preparing for.',
  'Add your main weapon, then the armor, accessories and potions you use.',
  'Press Analyze My Build to see what in your loadout makes the fight easier or harder, and why.',
] as const
export const GUIDED_ACTION = 'Add your main weapon'
export const READY_TITLE = 'Ready to analyze'
export const READY_BODY = 'Press Analyze My Build to see each factor for this setup.'
export const NOT_COUNTED_TITLE = 'Not counted'
export const notCountedIntro = (n: number): string => `${n} ${n === 1 ? 'item in your loadout isn’t' : 'items in your loadout aren’t'} counted in any factor:`
export const SUMMARY_TITLE = 'What makes this easier or harder'
export const SUMMARY_NOTE = 'Each line comes from a factor below, with its reason. It lists factors; it doesn’t forecast the fight.'
export const EASIER_TITLE = 'Makes it easier'
export const HARDER_TITLE = 'Makes it harder'
export const SUMMARY_EMPTY = 'Nothing in this column for your setup.'
export const TONE_LABEL = { easier: 'Makes it easier: ', harder: 'Makes it harder: ', info: 'Note: ', unknown: 'Unknown: ' } as const
export const computedFrom = (used: number, total: number): string => `From ${used} of ${total} ${total === 1 ? 'input' : 'inputs'}`
export const unknownInputs = (list: readonly string[]): string => `Unknown: ${list.join('; ')}`
export const CURATED_TAG = 'curated'
export const MOBILITY_CURATED =
  'Curated: the attack patterns are tagged by hand from the boss’s wiki page, and what each pattern asks of your gear is this site’s own reading, not wiki data.'
/** A line's source link, named for the article it cites (SourceIconLink adds "on terraria.wiki.gg (opens in a new tab)"). */
export const sourceArticle = (article: string): string => `Source: the article about ${article}`
export const ASSUMPTIONS_TITLE = 'Assumptions behind this analysis'
export const constantsFooter = (version: number): string => `Point weights v${version}: editorial constants.`
export const FACTOR_FOR = 'Factor:'

/* Improve My Build */
export const IMPROVE = 'Improve My Build'
export const IMPROVE_TITLE = 'Improve My Build'
export const IMPROVE_INTRO =
  'Upgrades verified obtainable with the bosses you’ve marked defeated, each compared with what it replaces on the measure named. Upgrades that need another boss are listed apart, under that boss, nearest on the boss map first.'
export const OBTAINABLE_NOW = 'Obtainable now'
export const SHOW_HOW = 'Show Me How to Get It'
export const showHowContext = (item: string): string => ` (${item})`
export const NEW_TAB = ' (opens terraria.wiki.gg in a new tab)'

/* Picker */
export const pickerTitle = (slot: string): string => `Choose: ${slot}`
export const PICKER_DESCRIPTION = 'Type to search. Use the arrow keys to move through the matches and Enter to pick one.'
export const PICKER_SEARCH = 'Search items'
export const pickerHint = (count: number, what: string): string => `Type to search ${count.toLocaleString('en-US')} ${what}.`
/** Before typing in a big pool (B96d: never a blank sheet). */
export const PICKER_START_TITLE = 'Start typing a name'
export const PICKER_START_BODY = 'A few letters are enough. Each match says whether the bosses you’ve marked defeated make it available.'
export const PICKER_RECENT = 'Recently viewed'
export const pickerRecentCount = (count: number, total: number, what: string): string =>
  `${count} recently viewed. Type to search all ${total.toLocaleString('en-US')} ${what}.`
export const PICKER_LOADING = 'Loading search…'
export const PICKER_ERROR = 'Search couldn’t load.'
export const PICKER_RETRY = 'Retry'
export const pickerNone = (query: string): string => `No matching items for “${query}”.`
export const pickerCount = (count: number): string => `${count} ${count === 1 ? 'match' : 'matches'}.`
export const PICKER_CLOSE = 'Close'
export const PICKER_LIST = 'Matching items'
/** Follows an "Unknown" marker in a picker row: "Unknown availability". */
export const PICKER_AVAILABILITY_WORD = 'availability'
export const PICKER_WHAT = {
  weapon: 'weapons',
  summon: 'summon items',
  head: 'helmets',
  chest: 'chest pieces',
  legs: 'leg pieces',
  accessory: 'accessories',
  ammo: 'ammo items',
  potion: 'potions',
} as const

/* Entry points (boss page, map card) */
export const bossCta = (boss: string): string => `Check readiness for ${boss}`
export const BOSS_CTA_NOTE = 'See what in your gear makes this fight easier or harder, factor by factor.'
export const MAP_CTA = 'Check readiness'
export const NAV_DESCRIPTION = 'Check your gear against a boss, factor by factor'
