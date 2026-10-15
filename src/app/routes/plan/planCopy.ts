/**
 * Feature B wording (PRD P6-S5/S6, §9 Feature B AC3; UX_SPEC §3.9, §5, §6, §8; SCORING_SPEC §8.4 copy modules —
 * no inline user-visible literals). Honesty rules held by plan.test's copy audit: quantities and sources come
 * from the data only — no time or effort estimates, no farming advice, no "easy / best / fastest" ranking of
 * ways to get something (the planner lists the data's ways; it never ranks them), Unknown said as Unknown.
 */
import type { StepStatus } from './planModel'

export const DOC_TITLE = 'Grind plans'
export const PAGE_TITLE = 'What Should I Grind For?'
export const PAGE_INTRO =
  'Pick any item and see everything it takes: every material, recipe, crafting station, drop source and boss, with quantities multiplied through each recipe. It all comes from the dataset — drop chances only where verified, Unknown where not, nothing guessed. Check steps off as you go; plans stay in this browser.'
export const NEW_PLAN = 'New plan'
export const LIST_TITLE = 'Your plans'
export const EMPTY_TITLE = 'No saved plans'
export const EMPTY_BODY = 'Choose an item to plan for: search for it on the next screen, or use “What Should I Grind For?” on any item or weapon page.'
export const EMPTY_CTA = 'Choose an item'
/** ADR D6 sets the whole stored key aside when any plan in it fails, so the copy says so (B118(i)). */
export const QUARANTINE = 'Your saved plans couldn’t be read, so the whole saved set was set aside (not deleted) — including any plans in it that were fine. Plans you make now are saved as usual.'
export const PERSIST_ERROR = 'This browser couldn’t save your last change. It’s kept until you close this tab.'
export const LOADING = 'Loading the planner…'
export const LOAD_ERROR = 'Couldn’t load the planner’s data'
export const BACK_TO_PLANS = 'All plans'
export const ITEM_PAGE = 'Item page'
/** Screen-reader completion of the "Item page" button's name ("Item page for Night’s Edge" — not a doubled "page"). */
export const itemPageFor = (name: string) => ` for ${name}`

/* plan list — the same "N of M complete" as the plan page (B118(a)) */
export const planCardTitle = (name: string, amount: number) => (amount > 1 ? `${name} × ${amount.toLocaleString('en-US')}` : name)
export const STATUS_DONE = 'Done'
export const STATUS_ACTIVE = 'In progress'
export const COUNTING = 'Counting steps…'
export const COUNT_UNAVAILABLE = 'Progress couldn’t be counted right now.'
export const TARGET_GONE = 'Its item isn’t in today’s data'
export const madeOn = (date: string) => `Made ${date}`
export const MISSING_TARGET_NAME = (id: number) => `Item #${id}`
export const deletedNotice = (name: string) => `Deleted the plan for ${name}.`

/* new plan / goal picker */
export const NEW_DOC_TITLE = 'New grind plan'
export const NEW_TITLE = 'Plan for an item'
export const NEW_INTRO = 'Search any item, weapon, armor piece or accessory in the database. You’ll see its whole plan before saving it.'
export const PICKER_LABEL = 'Search for the item you want'
export const PICKER_PLACEHOLDER = 'Search items, weapons, armor…'
export const PICKER_LOADING = 'Loading search…'
export const PICKER_ERROR = 'Search couldn’t load.'
export const PICKER_RETRY = 'Retry search'
export const pickerNone = (q: string) => `Nothing in the database matches “${q}”.`
export const pickerCount = (n: number) => (n === 1 ? '1 match' : `${n} matches`)
export const PICKER_LIST = 'Matching items'
export const PICKER_RECENT = 'Recently viewed'
export const PICKER_START = 'Type a name — for example “Night’s Edge”, “Ankh Shield” or “Zenith”.'
export const TYPE_LABEL: Record<string, string> = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory', item: 'Item' }
export const AMOUNT_LABEL = 'How many'
export const amountLabels = (name: string) => ({ input: `How many ${name} to plan for`, less: `Plan for one fewer ${name}`, more: `Plan for one more ${name}` })
export const MAKE_PLAN = 'Make My Plan'
export const MAKE_PLAN_NOTE = 'Saves this plan in this browser so you can check steps off and record what you own.'
export const previewSummary = (steps: number, bosses: number) =>
  `This plan has ${steps} ${steps === 1 ? 'step' : 'steps'}${bosses > 0 ? `, ${bosses} of them ${bosses === 1 ? 'a boss' : 'bosses'} to defeat` : ''}.`
export const existingPlans = (n: number) => (n === 1 ? 'You already have a plan for this item.' : `You already have ${n} plans for this item.`)
export const OPEN_EXISTING = 'Open it'
export const PREVIEW_TITLE = 'Preview'
export const NOT_FOUND_TITLE = 'No such item'
export const notFoundBody = (id: string) => `There’s no item with ID ${id} in the dataset, so there’s nothing to plan. Search for the item instead.`
export const PLAN_NOT_FOUND_TITLE = 'No such plan'
export const PLAN_NOT_FOUND_BODY = 'This plan isn’t saved in this browser. It may have been deleted, or saved in another browser.'

/* header */
export const planFor = (name: string) => `Plan: ${name}`
export const AVAILABLE_NOW = 'Obtainable now'
export const AVAILABILITY_WORD = 'availability'
export const AVAILABLE_TIP = 'At least one of its ways to get it is open at your progress (verified gating).'
export const progressLine = (complete: number, total: number) => `${complete} of ${total} ${total === 1 ? 'step' : 'steps'} complete`
export const progressBreakdown = (checked: number, owned: number, covered: number, progress: number) => {
  const parts = [
    checked > 0 ? `${checked} checked` : '',
    owned > 0 ? `${owned} covered by what you own` : '',
    covered > 0 ? `${covered} no longer needed` : '',
    progress > 0 ? `${progress} ${progress === 1 ? 'boss' : 'bosses'} already counted as defeated` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `(${parts.join(', ')})` : ''
}
export const DONE_TITLE = 'Plan complete'
export const DONE_BODY = 'Every step is complete. Un-check a step to reopen the plan.'

/* announcements (one polite live region per plan page, B118(b)(g)) */
export const DONE_ANNOUNCE = 'Plan complete: every step is complete.'
export const reopenedAnnounce = (complete: number, total: number) => `Plan reopened: ${progressLine(complete, total)}.`
export const updatedAnnounce = (complete: number, total: number) => `Saved steps updated to today’s data. ${progressLine(complete, total)}.`
export const routeAnnounce = (name: string, way: string, complete: number, total: number) => `${name} now uses: ${way}. ${progressLine(complete, total)}.`
export const memberAnnounce = (group: string, member: string, complete: number, total: number) => `${group} now uses ${member}. ${progressLine(complete, total)}.`
export const laterAnnounce = (name: string, complete: number, total: number) => `${name} is a choice again: its step lists every way. ${progressLine(complete, total)}.`
export const defaultAnnounce = (name: string, way: string, complete: number, total: number) => `${name} is back to its listed way: ${way}. ${progressLine(complete, total)}.`
export const DELETE = 'Delete plan'
export const deleteTitle = (name: string) => `Delete the plan for ${name}?`
export const DELETE_BODY = 'Its check marks and owned quantities are deleted with it. Your boss progress, saved builds and other plans aren’t affected.'
export const DELETE_CONFIRM = 'Delete plan'
export const COMPARE_ROUTES = 'Compare routes'
export const compareRoutesCount = (n: number) => `${n} ${n === 1 ? 'item has' : 'items have'} more than one way to get ${n === 1 ? 'it' : 'them'}`

/* progress basis (PRD §9 Feature B AC2) */
export const BASIS_TITLE = 'What “obtainable now” is based on'
export function basisText(stageLabel: string | null, virtual: readonly string[], tracked: number): string {
  const marked = tracked === 0 ? 'No bosses are marked defeated on the boss map.' : tracked === 1 ? '1 boss is marked defeated on the boss map.' : `${tracked} bosses are marked defeated on the boss map.`
  if (stageLabel === null) return `No stage is selected, so only bosses marked defeated count. ${marked}`
  return virtual.length > 0
    ? `Your stage (${stageLabel}) counts the bosses it implies as defeated: ${virtual.join(', ')}. ${marked} Optional bosses and the world-evil bosses are never assumed.`
    : `Your stage (${stageLabel}) implies no defeated bosses on its own. ${marked}`
}
export const unknownCountLine = (unknown: number, total: number) =>
  `${unknown} of the ${total} items in this plan ${unknown === 1 ? 'has' : 'have'} Unknown availability: the dataset can’t confirm whether ${unknown === 1 ? 'it is' : 'they are'} obtainable at your progress. ${unknown === 1 ? 'Its step and sources still come' : 'Their steps and sources still come'} from the data.`
export const UNKNOWN_HEAVY_TITLE = 'Mostly Unknown availability'
/** The notice shows from half the items up (B120): exactly half isn't "mostly". */
export const UNKNOWN_HALF_TITLE = 'Unknown availability for half the items'
export const unknownHeavyTitle = (unknown: number, total: number) => (unknown * 2 === total ? UNKNOWN_HALF_TITLE : UNKNOWN_HEAVY_TITLE)
export const noSourceTitle = (name: string) => `No known source for ${name}`
export const noSourceBody = (name: string) =>
  `The dataset lists no verified way to get ${name}, so this plan can’t say how — and won’t guess. You can still keep it as a reminder; its wiki page may describe a way.`

/* notices */
export const driftTitle = 'This plan was made from different data'
export const driftBody = (added: number, removed: number, versionChanged: boolean, saved: string, current: string) => {
  const parts: string[] = []
  if (versionChanged) parts.push(`It was saved for Terraria ${saved}; the data is now ${current}.`)
  if (added > 0 || removed > 0) parts.push(`Today’s data gives ${added} new ${added === 1 ? 'step' : 'steps'} and drops ${removed} saved ${removed === 1 ? 'step' : 'steps'}.`)
  parts.push('The plan below is built from today’s data; check marks on steps that no longer exist are kept until you update it.')
  return parts.join(' ')
}
export const UPDATE_PLAN = 'Update the saved steps'
export const CHOICE_ERROR = 'Couldn’t load the data for that way to get it, so the plan is unchanged. Check your connection, then choose again.'
export const STALE_CHOICES = 'Some ways you picked no longer exist in the data, so those items are back to their listed ways.'
export const TRUNCATED_TITLE = 'This plan stops early'
export const TRUNCATED_BODY = 'Part of this plan goes deeper than the planner draws. Where it stops, the step says so and offers that item’s own plan.'
export const TARGET_MISSING_TITLE = 'This item isn’t in the current dataset'
export const targetMissingBody = (id: number) => `The plan was made for item ID ${id}, which today’s data doesn’t have. Its saved steps are listed as they were; delete the plan if you no longer need it.`
export const SAVED_STEPS = 'Saved steps'

/* views */
export const TAB_TREE = 'Tree'
export const TAB_CHECKLIST = 'Checklist'
export const TREE_TITLE = 'What it takes'
export const TREE_NOTE = 'Each item is drawn once, where it’s first needed; quantities add up every use and every recipe’s yield.'
export const CHECKLIST_TITLE = 'Checklist'
export const VIEWS_LABEL = 'Plan views'
export const EXPAND_ALL = 'Expand all'
export const COLLAPSE_ALL = 'Collapse all'
/** The tree toggle's name: static — aria-expanded alone says open or closed (one announcement, B118(j)). */
export const toggleLabel = (name: string) => `What goes into ${name}`
/** One note for a subtree that's no longer needed, collapsed (B118(h)); the toggle still opens it. */
export function coveredBeneath(status: 'checked' | 'owned' | 'covered', n: number): string {
  const rest = `${n === 1 ? 'the 1 item' : `the ${n.toLocaleString('en-US')} items`} beneath it ${n === 1 ? 'isn’t' : 'aren’t'} needed now`
  return status === 'checked' ? `Checked, so ${rest}.` : status === 'owned' ? `Covered by what you own, so ${rest}.` : `Not needed now, and neither ${n === 1 ? 'is the 1 item' : `are the ${n.toLocaleString('en-US')} items`} beneath it.`
}

/* node summaries */
export const quantity = (n: number) => `× ${n.toLocaleString('en-US')}`
export const inAll = (n: number, uses: number) => `${n.toLocaleString('en-US')} in all (${uses} uses)`
export const CRAFT_AT = 'Craft at'
export const craftAt = (stations: string) => `${CRAFT_AT} ${stations}`
export const BY_HAND = 'Craft by hand'
export const makesPerCraft = (n: number) => `makes ${n} per craft`
export const crafts = (n: number, makes: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'craft' : 'crafts'} → ${makes.toLocaleString('en-US')}`
export const recipeOf = (i: number, n: number) => `recipe ${i} of ${n}`
export const YOUR_CHOICE = 'your choice'
export const severalWays = (n: number, canChoose = true) => (canChoose ? `${n} ways to get it — choose one` : `${n} ways to get it — choose one once the plan is saved`)
export const anyOf = (members: readonly string[]) => `Any of: ${members.join(', ')}`
export const usingMember = (name: string) => `Using ${name}`
export const NO_SOURCE = 'How to get it:'
export const NO_SOURCE_NOTE = 'The dataset lists no verified way to get this, so none is shown rather than a guessed one. The wiki page may describe it.'
export const NOT_IN_DATASET = 'This item isn’t in the dataset.'
export const dropFrom = (source: string) => `Drops from ${source}`
export const dropSources = (n: number) => `Drops from ${n} sources`
export const soldBy = (npc: string) => `Sold by ${npc}`
export const foundIn = (containers: string) => `Found in ${containers}`
export const fishedIn = (biomes: string) => `Fished up: ${biomes}`
export const OTHER_WAY = 'Another way, described by the wiki'
export const FROM_THE_WIKI = 'How to get it, from the wiki:'
/** `needed`: the ingredient already being planned on this path; `item`: the item whose way needs it (B118(d)). */
export const circular = (needed: string, item: string) =>
  needed === item ? `Circular here: this way to get ${item} needs ${item} itself.` : `Circular here: ${item} needs ${needed}, and this plan is making ${item} on the way to ${needed}.`
/** The tree's inline note when "recipe N of M" skipped earlier recipes the planner doesn't pick (B118(j)). */
export const skippedNote = (parts: readonly string[]) => `Not picked for you: ${parts.join('; ')}.`
export const skippedReversal = (n: number, via: string, name: string) => `recipe ${n} turns ${via} back into ${name}`
export const skippedCircular = (n: number, needed: string) => `recipe ${n} needs ${needed}, which this plan already uses it to make`
export const skippedShimmer = (n: number) => `recipe ${n} is a Shimmer transmutation`
export const listedUnder = (name: string) => `Listed under ${name}`
export const listedAbove = 'Listed above'
export const stopsHere = (name: string) => `The plan stops here — ${name} goes deeper than the planner draws.`
export const planOnItsOwn = (name: string) => `Plan ${name} on its own`
export const CHOOSE = 'Choose a way'
export const CHANGE = 'Change'
/** Screen-reader completions of the visible "Choose a way" / "Change" (one name, not a doubled one — B118(j)). */
export const chooseFor = (name: string) => ` to get ${name}`
export const changeFor = (name: string) => ` how to get ${name}`
export const LOADING_MORE = 'Loading the records for this part of the plan…'
export const SHIMMER_NOTE = 'Shimmer transmutation: turns another item you hold into this one.'
/** A node whose only listed way is one the planner won't pick for the user (said why; still choosable). */
export const ONE_WAY_HELD = 'The dataset lists one way, and the planner doesn’t pick it for you:'
export const reversal = (via: string, name: string) => `It turns ${via} back into ${name} — and ${via} is made from ${name}.`
export const NOT_PICKED_NOTE = 'Not picked for you'

/* route chooser */
export const chooserTitle = (name: string) => `Ways to get ${name}`
export const CHOOSER_INTRO = 'These are the ways the dataset lists, in its order. The planner doesn’t rank them — compare what each one needs.'
export const USE_THIS = 'Use this way'
export const IN_USE = 'In use'
export const DECIDE_LATER = 'Decide later'
export const DECIDE_LATER_NOTE = 'Leaves the item as a choice: its step says “Get” and lists every way.'
/** "Decide later" on an item the planner has a listed way for (one way, or recipes only): it goes back to that. */
export const decideLaterDefault = (way: string) => `Goes back to the way the planner lists when nothing is chosen: ${way}.`
export const CLOSE = 'Close'
export const RECIPE_INGREDIENTS = 'Needs'
/** The chooser's quantities are this plan's (the tree's numbers for the way in use — B118(f)). */
export const needsFor = (amount: number, name: string, crafts: number) =>
  `Needs, for ${amount.toLocaleString('en-US')} ${name} (${crafts.toLocaleString('en-US')} ${crafts === 1 ? 'craft' : 'crafts'})`
export const ROUTE_CONDITIONS = 'Requires'
/** Per-way gating at the player's progress (B118(f)). */
export const ROUTE_GATE = 'At your progress'
/** The item is open by its verified gating while every way is Unknown on its own (B120's Stinger case). */
export const WAYS_UNKNOWN_NOTE =
  'The plan shows this item as obtainable now because its verified requirements are met at your progress. The data can’t confirm which of these ways is open, so each one says Unknown.'
export const ONE_OF = 'one of'
export const OR = 'or'
export const MEMBER_GATE = 'Availability'
export const PRICE = 'Price'
export const CHANCE = 'Chance'
export const chanceVaries = 'varies by difficulty — see “Where do I find this?”'
export const moreSources = (n: number) => `and ${n} more ${n === 1 ? 'source' : 'sources'}`
export const LOCATIONS = 'Where'
export const ROUTE_KIND: Record<string, string> = { craft: 'Craft', drop: 'Drop', purchase: 'Buy', loot: 'Loot', fishing: 'Fishing', other: 'Other' }
export const MEMBERS_INTRO = 'A recipe that takes any of these. Pick the one you’ll use, or leave it open.'
export const useMember = (name: string) => `Use ${name}`

/* checklist */
export const GROUP_TITLE: Record<string, string> = {
  bosses: 'Bosses to defeat',
  choose: 'Choose how to get these',
  drops: 'Drops from several sources',
  vendor: 'Buy from a vendor',
  loot: 'Found in chests and containers',
  fishing: 'Fishing',
  other: 'Other ways (see each item)',
  craft: 'Craft, in this order',
  stops: 'Where this plan stops',
  unknown: 'No known source',
}
export function groupTitle(key: string, bossName: (id: string) => string): string {
  if (key.startsWith('boss:')) return `From ${bossName(key.slice(5))}`
  if (key.startsWith('source:')) return `From ${key.slice(7)}`
  if (key.startsWith('vendor:')) return `Buy from ${key.slice(7)}`
  return GROUP_TITLE[key] ?? key
}
export const toGet = (n: number) => `${n.toLocaleString('en-US')} to get`
export const OWNED_LABEL = 'Own'
export const ownedFor = (name: string) => `How many ${name} you own`
export const decrease = (name: string) => `One fewer ${name}`
export const increase = (name: string) => `One more ${name}`
export const WHERE = 'Where do I find this?'
export const STATUS_TEXT: Record<StepStatus, string> = {
  open: '',
  checked: 'Checked',
  owned: 'Covered by what you own',
  covered: 'Not needed now: what it goes into is checked or owned',
  progress: '',
}
export const BOSS_TRACKED = 'Marked defeated on the boss map'
export const BOSS_STAGE = 'Counted as defeated by your stage'
export const BOSS_COVERED = 'Not needed now: nothing still to get needs it'
export const MARK_ON_MAP = 'Mark it on the boss map'
/** The basis a boss step was derived from: the plan's items its verified gating names (B118(e)). */
export const bossFor = (items: readonly string[], more = 0) => `Needed first for: ${items.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
/** Screen-reader prefix of a step complete by cause (owned, no longer needed, boss counted): not a check box (B118(c)). */
export const COMPLETE_SR = 'Complete: '
export const checkLabel = (text: string) => text
export const groupMembers = (members: readonly string[]) => `Any one of: ${members.join(', ')}`
export const MEMBER_CHOOSE_HINT = 'Choose which one in the tree, or just gather any of them.'

/* entry points (item / weapon pages, builder, readiness) */
export const GRIND_CTA = 'What Should I Grind For?'
export const grindContext = (name: string) => ` — plan ${name}`
export const PLAN_IT = 'Plan it'
export const planItContext = (name: string) => ` — a grind plan for ${name}`
/** A "Plan it" link whose visible text is the item's name (the builder's per-piece links): no second name (B120). */
export const PLAN_IT_NAMED = ' — its grind plan'
export const PLAN_PIECES = 'Plan a piece:'
