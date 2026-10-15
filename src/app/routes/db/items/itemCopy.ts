/**
 * Item encyclopedia copy (P6, AMENDMENTS-016). One module so the copy audit (no forward promises, no
 * outcome / "best" wording — src/scoring/copyAudit.ts) covers every string the pages render.
 */
export const ITEMS_TITLE = 'Items'

export const listIntro = (version: string): string =>
  `Every item in Terraria ${version} that isn’t a weapon, armor piece or accessory — materials, potions, tools, mounts, furniture and more — from the Official Terraria Wiki. Browse a category or filter by game stage and name; open an item for its stats, how to get it and what it’s used for.`

export const WEAPONS_POINTER = 'Weapons have their own list.'
export const CATEGORY_HEADING = 'Browse by category'
export const ALL_ITEMS_HEADING = 'All items'
export const NAME_FILTER_LABEL = 'Filter by name'
export const NAME_FILTER_PLACEHOLDER = 'e.g. pickaxe, bar, potion'
export const CLEAR_NAME = 'Clear name filter'
export const UNKNOWN_LEGEND = '= not verified against the wiki; we never guess values.'
export const stageLegend = (unknownStage: number, total: number): string =>
  `${unknownStage.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} items have no verified game stage (it comes from verified gating), so they sit under “Stage unknown”.`

export const resultCount = (shown: number, total: number): string =>
  shown === total ? `${total.toLocaleString('en-US')} items` : `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} items`

export const EMPTY_TITLE = 'No items match'
export const emptyBody = (active: number): string =>
  active === 1 ? 'Nothing in this chest — no item matches this filter.' : `Nothing in this chest — no item matches all ${active} active filters together.`
export const EMPTY_HINT = 'Remove a filter below, or clear them all.'
export const CLEAR_ALL = 'Clear all filters'
export const LIST_ERROR = 'Couldn’t load the item list'
export const LIST_LOADING = 'Loading items…'

// --- detail page ---------------------------------------------------------------------------------

export const BACK_TO_ITEMS = 'All items'
export const DETAIL_LOADING = 'Loading item…'
export const DETAIL_ERROR = 'Couldn’t load this item'
export const NOT_FOUND_TITLE = 'No such item'
/** B113(e) M5: an id that is a weapon / armor piece / accessory says so and links its page. */
export const KIND_PHRASE = { weapon: 'a weapon', armor: 'an armor piece', accessory: 'an accessory', other: 'not an item in the encyclopedia' } as const
export const HAS_OWN_PAGE = 'it has its own page.'
export const HAS_WIKI_PAGE = 'its article is on the wiki:'
export const wikiArticle = (name: string): string => `${name} on the wiki`
export const openPage = (name: string): string => `Open ${name}`
export const STATS_HEADING = 'Stats'
export const NO_STATS = 'The wiki data for this item carries no stats beyond the ones above.'
export const BUFFS_LABEL = 'Buffs granted'
export const SUMMONS_LABEL = 'Summons'
export const STATION_LABEL = 'Crafting station'
export const stationUses = (n: number): string => `Used as the station in ${n.toLocaleString('en-US')} ${n === 1 ? 'recipe' : 'recipes'} (listed under “Used in”)`
export const TICKS_NOTE = 'Durations come from the game data in ticks (60 ticks = 1 second).'
export const UNKNOWN_HEAVY =
  'Several values for this item couldn’t be verified against the wiki data, so they show as Unknown instead of a guess. Its wiki page may say more.'

export const USED_IN_HEADING = 'Used in'
export const usedInSummary = (ingredient: number, station: number): string => {
  const parts: string[] = []
  if (ingredient > 0) parts.push(`an ingredient in ${ingredient.toLocaleString('en-US')} ${ingredient === 1 ? 'recipe' : 'recipes'}`)
  if (station > 0) parts.push(`the crafting station for ${station.toLocaleString('en-US')} ${station === 1 ? 'recipe' : 'recipes'}`)
  return `It is ${parts.join(' and ')}.`
}
/** B113(e): why "Show all 288" follows "297 recipes" — one row per item made, its alternative recipes merged. */
export const usedInMerged = (items: number, recipes: number): string =>
  `Listed by the item each recipe makes: ${items.toLocaleString('en-US')} ${items === 1 ? 'item' : 'items'} from ${recipes.toLocaleString('en-US')} recipes — an item with alternative recipes gets one row.`
/** B113(e) M2: the amount this item a recipe consumes, in the "How to obtain" form ("uses 2 × Flarefin Koi"). */
export const usesAmount = (amount: number, name: string): string => `uses ${amount.toLocaleString('en-US')} × ${name}`
export const USED_AS_STATION = 'crafting station'
export const asGroup = (group: string): string => `(as ${group})`
export const USED_IN_NONE = 'No recipe in the wiki data uses this item as an ingredient or a crafting station.'
export const USED_IN_LOADING = 'Loading recipes…'
export const USED_IN_ERROR = 'Couldn’t load the recipes that use this item'
export const showAll = (n: number): string => `Show all ${n.toLocaleString('en-US')}`
export const SHOW_FEWER = 'Show fewer'
export const ACQ_LOADING = 'Loading recipes and drops…'
export const ACQ_ERROR = 'Couldn’t load how to obtain this item'

export const SOURCES_SUMMARY = 'Where this data comes from'
export const SPRITE_CREDIT = 'Sprite © Re-Logic'
export const SPRITE_FILE = 'Wiki file page'
export const NO_SPRITE = 'No wiki sprite for this item — original placeholder art is shown.'
/**
 * B113(d) M1: said on the page, beside the header, whenever the grey placeholder stands in for the sprite
 * (not only inside the collapsed sources) — including a listed sprite whose file failed to load.
 */
export const SPRITE_FALLBACK = {
  'no-sprite': 'No wiki sprite for this item — the grey silhouette is placeholder art.',
  unlisted: 'This item’s sprite isn’t available here — the grey silhouette is placeholder art.',
  failed: 'This item’s sprite file couldn’t load — the grey silhouette is placeholder art.',
  'placeholder-mode': 'Sprites are off — the grey silhouette is placeholder art.',
} as const
/** B113(e): a placeable's "consumed on use" (placing one uses it up) — not "Yes" alone on an anvil. */
export const CONSUMED_PLACEABLE = 'Yes — placing one uses it up'
