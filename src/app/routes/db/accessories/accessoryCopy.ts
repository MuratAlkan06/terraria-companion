/**
 * Accessory page copy (PRD P6-S2). One module so the copy audit (no forward promise, no outcome / "best" wording —
 * src/scoring/copyAudit.ts) covers every string the pages render besides wiki quotes.
 */
export const ACCESSORIES_TITLE = 'Accessories'

export const listIntro = (version: string): string =>
  `Every accessory in Terraria ${version}, from the Official Terraria Wiki. Filter by category, game stage and name; open one for its exact effects, which classes they count for, what it combines into and how to get it.`

export const NAME_FILTER_LABEL = 'Filter by name'
export const NAME_FILTER_PLACEHOLDER = 'e.g. boots, shield, emblem'
export const CLEAR_NAME = 'Clear name filter'
export const UNKNOWN_LEGEND = '= not verified against the wiki; we never guess values.'
export const stageLegend = (unknown: number, total: number): string =>
  `${unknown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} accessories have no verified game stage (it comes from verified gating), so they sit under “Stage unknown”.`
export const resultCount = (shown: number, total: number): string =>
  shown === total ? `${total.toLocaleString('en-US')} accessories` : `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} accessories`
export const EMPTY_TITLE = 'No accessories match'
export const emptyBody = (active: number): string =>
  active === 1 ? 'Nothing in this chest — no accessory matches this filter.' : `Nothing in this chest — no accessory matches all ${active} active filters together.`
export const EMPTY_HINT = 'Remove a filter below, or clear them all.'
export const CLEAR_ALL = 'Clear all filters'
export const LIST_ERROR = 'Couldn’t load the accessory list'
export const LIST_LOADING = 'Loading accessories…'
export const ALL_HEADING = 'All accessories'

// --- detail page -------------------------------------------------------------------------------------

export const BACK_TO_ACCESSORIES = 'All accessories'
export const DETAIL_LOADING = 'Loading accessory…'
export const DETAIL_ERROR = 'Couldn’t load this accessory'
export const NOT_FOUND_TITLE = 'No such accessory'
export const notFoundBody = 'There’s no accessory with that ID in the encyclopedia. It may have been mistyped — browse the accessory list instead.'
export const BADGE = 'Accessory'
export const CATEGORY_LABEL = 'Category'
export const RARITY_LABEL = 'Rarity'
export const STAGE_LABEL = 'Game stage'
export const UNKNOWN_HEAVY =
  'Several values for this accessory couldn’t be verified against the wiki data, so they show as Unknown instead of a guess. Its wiki page may say more.'

export const EFFECTS_HEADING = 'Effects'
export const EFFECTS_INTRO = 'Exactly as the game data states them; effects kept as wiki text are quoted with their source.'
export const NO_EFFECTS = 'The wiki data states no effect for it.'
export const FLIGHT_TIME = 'Flight time'
export const VERTICAL_SPEED = 'Vertical speed'
export const HOVER = 'Can hover'
export const flightTime = (ticks: number): string => `${ticks.toLocaleString('en-US')} ticks (${(ticks / 60).toLocaleString('en-US', { maximumFractionDigits: 2 })} seconds)`
export const verticalSpeed = (tps: number): string => `${tps.toLocaleString('en-US', { maximumFractionDigits: 2 })} tiles per second`
export const TICKS_NOTE = 'Durations come from the game data in ticks (60 ticks = 1 second).'

export const FIT_HEADING = 'Which classes its effects count for'
export const FIT_INTRO = 'How the Loadout Builder reads its effects: a stat counts for the class it names or implies (mana for magic, minions for summon); anything else counts for every class.'
export const FIT_ALL = 'Every class'
export const fitClass = (cls: string): string => `${cls} only`
export const FIT_UNKNOWN = 'Its effects are Unknown, so no class can be named.'
export const FIT_NONE = 'It states no effect, so nothing here counts for any class.'
export const FIT_CURATED = 'Tied to the class by a curated keyword match on its wiki text (the builder’s keyword list).'
export const LOADOUT_LINK = 'Try it in the Loadout Builder'
export const loadoutLinkSr = (name: string): string => ` — opens the builder with ${name} marked as gear you own; it is scored with everything else`

export const TREE_HEADING = 'Combination tree'
export const TREE_INTRO = 'Combined at the Tinkerer’s Workshop from other accessories. Every accessory in the tree opens its page; alternatives are marked “or”.'
export const UP_HEADING = 'Combines into'
export const UP_INTRO = 'Accessories it is an ingredient of, and what those combine into in turn:'
export const TREE_LOADING = 'Loading recipes…'
export const TREE_ERROR = 'Couldn’t load the combination tree'
export const THIS_ONE = '(this accessory)'
export const recipeOf = (i: number, n: number): string => `Recipe ${i} of ${n}`
export const OR = 'or'
export const anyOf = (group: string): string => `${group}:`
export const REPEAT = '(already in this branch)'
export const expandLabel = (name: string): string => `What ${name} is combined from`
export const PLAN_POINTER = 'Every material down to ores and drops, with where to get them:'

export const ACQ_LOADING = 'Loading recipes and drops…'
export const ACQ_ERROR = 'Couldn’t load how to obtain this accessory'
export const SOURCES_SUMMARY = 'Where this data comes from'
export const SPRITE_CREDIT = 'Sprite © Re-Logic'
