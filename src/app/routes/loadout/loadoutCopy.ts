/**
 * Loadout builder UI wording (PRD P4-S2; UX_SPEC §3.5, §4(c), §5, §6, §8; SCORING_SPEC §8.4: copy
 * modules, no inline user-visible literals). The builder ranks candidates under stated, editorial
 * weights: every pick is "the highest-scoring under these weights", never "the best", and every
 * number shows how it was computed. The engine's own wording lives in src/scoring/builderCopy.ts; the
 * copy audit (src/scoring/copyAudit.ts) reads both, plus the rendered markup.
 */
import type { Difficulty, Goal, LoadoutClass } from '../../../schemas'
import type { AccessoryQuota } from '../../../scoring/constants'

export const DOC_TITLE = 'Loadout builder'
export const PAGE_TITLE = 'Loadout Builder'
export const PAGE_INTRO =
  'Pick a stage, class and goal, and get a full loadout from items verified obtainable at that point — each pick with its score, the formula behind it, and what was left out. Scores rank items under this site’s stated weights; they don’t name a single right answer.'
export const LOADING = 'Loading the loadout builder…'
export const LOAD_ERROR = 'Couldn’t load the loadout builder'

/* Steps (UX_SPEC §3.5 StepWizard) */
export const STEPS_LABEL = 'Builder steps'
/** UX_SPEC §3.5: step 4 is "Compare & Save" (P4-S4; P4-S2 shipped it as "Save", B106). */
export const STEP_NAMES = { 1: 'Inputs', 2: 'Loadout', 3: 'Why it works', 4: 'Compare & Save' } as const
export const stepOf = (n: number, total: number) => `Step ${n} of ${total}`
export const NEXT = 'Next'
export const BACK = 'Back'
export const nextTo = (name: string) => `Next: ${name}`
export const backTo = (name: string) => `Back: ${name}`

/* Step 1 — Inputs */
export const INPUTS_INTRO = 'Every field is optional: skip any of them and the builder uses its default, noted in “Why it works”.'
export const STAGE_LABEL = 'Stage'
export const STAGE_HINT = 'A hypothesis about your world: the bosses this stage implies count as defeated, with any you marked on the boss map.'
export const CLASS_LABEL = 'Class'
export const DIFFICULTY_LABEL = 'Difficulty'
export const DIFFICULTY_HINT = 'Sets the accessory slots: 5 in Classic, 6 in Expert, 7 in Master (the last one needs a Demon Heart).'
export const GOAL_LABEL = 'Goal'
export const GOAL_HINT = 'Sets how armor is weighted and which kinds of accessories fill the slots.'
export const BOSS_LABEL = 'Boss you’re preparing for'
export const BOSS_NONE = 'No particular boss'
export const BOSS_HINT = 'That boss, and the fights it opens, aren’t taken as defeated — their gear is listed apart.'
export const OWNED_LABEL = 'Gear you own'
export const OWNED_HINT = 'Items you already have can be picked even when their availability isn’t verified. Anything behind a boss outside your progress stays apart.'
export const OWNED_EMPTY = 'Nothing added.'
export const OWNED_ADD = 'Add gear you own'
export const ownedRemove = (name: string) => `Remove ${name} from the gear you own`
export const SKIP = 'Skip — use default'
export const skipFor = (field: string) => `Skip ${field.toLowerCase()} — use the default`
export const DEFAULT_TAG = 'default'
export const defaultNote = (value: string) => `Default: ${value}`
export const BUILD_CTA = 'Build my loadout'
export const STAGE_FROM_SETTINGS = 'your selected stage'
/** AMENDMENTS-016 B108(c) M4: a link that fixes an item (compare's "Open in Builder") but names no stage — never silently defaulted. */
export const stagePrompt = (item: string) => `Pick the stage you’re at — ${item} stays in your loadout either way, and the rest is built for that stage.`
export const stageAwaitingFallback = (stage: string) => `If you go on without choosing, the builder uses ${stage}.`
/** While the stage awaits: what keeps the fixed item and what doesn't (B108 H1's advance warning, M4's flow). */
export const awaitingWarning = (item: string) => `${item} stays while you choose the stage, difficulty, goal or boss; changing the class rebuilds the loadout without it.`
/** B108 H1 (Step 1): changing an input rebuilds the loadout. */
export const inputsWarning = (n: number) =>
  n === 1 ? 'Changing an input rebuilds the loadout and resets your 1 fixed pick (a swap or a saved build’s slot).' : `Changing an input rebuilds the loadout and resets your ${n} fixed picks (swaps or a saved build’s slots).`
/** Owned gear: what the builder's progress makes of each item once added. */
export const OWNED_STATUS = {
  yes: 'Verified obtainable at this stage.',
  unknown: 'Counted as obtainable because you own it.',
  gated: 'Stays apart until then, though you own it.',
} as const

export const CLASS_NAMES: Readonly<Record<LoadoutClass, string>> = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summon', hybrid: 'Hybrid' }
export const HYBRID_NOTE = 'Hybrid: weapons and armor of every class are candidates, and every class’s bonuses count.'
export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = { classic: 'Classic', expert: 'Expert', master: 'Master' }
export const GOAL_NAMES: Readonly<Record<Goal, string>> = {
  boss: 'Boss fight',
  'max-damage': 'Max damage',
  exploration: 'Exploration',
  survivability: 'Survivability',
  mobility: 'Mobility',
  balanced: 'Balanced',
}
export const GOAL_DESCRIPTIONS: Readonly<Record<Goal, string>> = {
  boss: 'Damage first, then survivability and mobility.',
  'max-damage': 'Damage above everything else.',
  exploration: 'Mobility first, with some damage and defense.',
  survivability: 'Defense and survivability first.',
  mobility: 'Movement and flight first.',
  balanced: 'A little of everything.',
}

/* Regenerate bar (Step 2) */
export const REGENERATE_TITLE = 'Change and rebuild'
export const regenerated = (swaps: number) =>
  swaps > 0 ? `Loadout rebuilt for your new inputs; your ${swaps === 1 ? 'fixed pick was' : `${swaps} fixed picks were`} reset to the recommendation.` : 'Loadout rebuilt for your new inputs.'
/** B108 H1: said BEFORE the change, beside the stage and class fields, whenever a slot holds a fixed pick. */
export const rebuildWarning = (n: number) =>
  n === 1 ? 'Changing the stage or class rebuilds every slot: your 1 fixed pick (a swap or a saved build’s slot) will be reset.' : `Changing the stage or class rebuilds every slot: your ${n} fixed picks (swaps or a saved build’s slots) will be reset.`
export const REBUILT_DISMISS = 'Dismiss'

/* Step 2 — Loadout */
export const LOADOUT_TITLE = 'Your loadout'
export const loadoutMeta = (cls: string, stage: string, difficulty: string, goal: string, boss?: string) => [cls, stage, `${difficulty} Mode`, goal, ...(boss ? [preparingFor(boss)] : [])].join(' · ')
/** B108 M2: the target boss in the Step 2–4 summary. */
export const preparingFor = (boss: string) => `Preparing for ${boss}`
export const OVERVIEW_LABEL = 'Equipment overview'
export const OVERVIEW_HINT = 'Tap a slot to jump to its pick.'
/** B108 M6: short slot names inside the overview's squares (empty ones name their slot). */
export const OVERVIEW_SHORT = { main: 'Main', alt: 'Alt', head: 'Head', body: 'Body', legs: 'Legs', summon: 'Staff' } as const
export const accessoryShort = (n: number) => `Acc ${n}`
export const ammoShort = (n: number) => `Ammo ${n}`
export const buffShort = (n: number) => `Pot ${n}`
export const ARMOR_PIECE_LABELS = { head: 'Helmet', body: 'Chest', legs: 'Legs' } as const
export const overviewFilled = (slot: string, item: string) => `${slot}: ${item}`
export const overviewEmpty = (slot: string) => `${slot}: empty — show its card`
export const overviewLocked = (slot: string) => `${slot}: locked — show its card`
export const GROUPS = { weapons: 'Weapons', armor: 'Armor', accessories: 'Accessories', ammo: 'Ammo', buffs: 'Potions', summon: 'Summon' } as const
export const SLOT_LABELS = { main: 'Main weapon', alt: 'Alt weapon', armor: 'Armor set', summon: 'Minion staff' } as const
export const accessoryLabel = (n: number) => `Accessory ${n}`
export const ammoLabel = (n: number) => `Ammo ${n}`
export const buffLabel = (n: number) => `Potion ${n}`
export const DEMON_HEART_SLOT = 'Demon Heart slot'
export const DEMON_HEART_CHIP = 'assumes Demon Heart'
export const QUOTA_CHIP: Readonly<Record<AccessoryQuota, string>> = { off: 'offense', def: 'defense', mob: 'mobility', util: 'utility' }
export const quotaTag = (quota: string) => `${quota} slot`
export const FALLBACK_TAG = 'any category'
export const YOUR_PICK = 'your pick'
export const OWNED_TAG = 'you own this'
/** B108(a): a pick adding 0 counted points — its effects aren't scored for any class, so never "for your class". */
export const ZERO_POINTS_TAG = 'not scored'
/** B108(e) M9: an ammo weapon whose estimate has no ammo in it. */
export const NO_AMMO = 'Scored without ammo'
export const AVAILABILITY = 'Availability:'
export const SCORE_FOR = 'Score:'
export const PIECES = 'Pieces:'
export const HOW_SCORED = 'How was this scored?'
export const HIDE_SCORE = 'Hide the breakdown'
export const FORMULA = 'Formula'
export const PARTS = 'Parts'
export const EFFECTS = 'Effects'
export const effectStatus = { counted: 'counted', mismatch: 'not your class', 'uncounted-kind': 'no weight in this version', special: 'not scored', 'special-mismatch': 'not your class' } as const
export const weightTerm = (weight: string, contribution: string) => `× ${weight} = ${contribution}`
export const ALTERNATIVES = 'Next-highest candidates'
/** B108 H2: under a pinned pick the list may score above it. */
export const ALTERNATIVES_PINNED = 'Other candidates, highest first'
export const TIED = 'same score'
export const HIGHER = 'scores higher'
export const USE_THIS = 'Use this'
export const useThisSr = (name: string, slot: string) => `Use ${name} in ${slot.toLowerCase()}`
export const NO_ALTERNATIVES = 'No other candidate scored for this slot.'
export const POOL = 'Candidates'
export const SWAP = 'Swap'
export const swapSr = (slot: string) => `Swap ${slot.toLowerCase()}`
export const RESET_PICK = 'Back to the recommendation'
export const resetPickSr = (slot: string) => `Put the recommendation back in ${slot.toLowerCase()}`
export const NOT_SCORED_PIN = (fields: string) => `Not scored: its ${fields} isn’t verified.`
export const CLEAR_PICKS = 'Recommend every slot again'
export const swapsCount = (n: number) => (n === 1 ? '1 slot holds a fixed pick (a swap or a saved build).' : `${n} slots hold fixed picks (swaps or a saved build).`)
export const OPEN_DETAILS_SR = 'open its page'
export const NOTICES_TITLE = 'Not applied'

/* Swap sheet */
export const swapTitle = (slot: string) => `Swap: ${slot}`
export const SWAP_DESCRIPTION = 'Candidates verified obtainable at your progress (and gear you marked owned), ranked by this slot’s score. Picking one keeps it here and rebuilds the rest around it.'
export const SWAP_FILTER = 'Filter by name'
export const SWAP_EMPTY_OPTION = 'Leave this slot empty'
export const SWAP_CURRENT = 'current'
export const SWAP_BLOCKED = { 'in-use': 'in another slot', wings: 'a second pair of wings', linked: 'combines with an equipped accessory', buff: 'its buff is already in this loadout' } as const
/** B108 H3: owned gear with Unknown availability is counted apart from the verified obtainable. */
export const swapCount = (shown: number, total: number, owned = 0) =>
  shown !== total
    ? owned > 0
      ? `${shown} of ${total} candidates shown (${total - owned} verified obtainable + ${owned} owned, unverified) — filter to find more.`
      : `${shown} of ${total} candidates shown — filter to find more.`
    : owned > 0
      ? `${total} ${total === 1 ? 'candidate' : 'candidates'}: ${total - owned} verified obtainable + ${owned} owned (unverified).`
      : `${total} ${total === 1 ? 'candidate' : 'candidates'}.`
export const SWAP_NONE = 'No candidate matches that name.'
export const SWAP_NO_POOL = 'No candidate is verified obtainable for this slot at your progress.'
export const SWAP_CLOSE = 'Close'
export const swapped = (name: string, slot: string) => `${name} is now in ${slot.toLowerCase()}; the loadout was rebuilt around it.`
export const emptied = (slot: string) => `${slot} is now empty.`
export const resetDone = (slot: string) => `${slot} is back to the recommendation.`
export const allReset = 'Every slot is back to the recommendation.'

/* Step 3 — Why it works */
export const WHY_TITLE = 'Why it works'
export const WHY_INTRO = 'The profile of this loadout, the gear that waits behind a boss, and every assumption the scores rest on.'
export const PROFILE_TITLE = 'Loadout profile'
export const PROFILE_NOTE =
  'Each figure stands on its own. The goal’s weights rank armor and choose the accessory slots; they aren’t used to fold this loadout into one number.'
export const goalWeight = (goal: string, pct: number) => `${goal} weighs this at ${pct}%`
export const EXCLUDED = 'Not computed'
export const SYNERGY_TITLE = 'How the pieces fit'
export const setBonusActive = (name: string) => `${name} set bonus is active:`
export const NO_SET = 'No armor set bonus is active.'
export const mismatchesTitle = (cls: string) => `Not counted for your ${cls} class`
export const NO_MISMATCH = 'Every counted effect applies to your class, and every pick adds counted points.'
/** B108(a): a 0-point pick in Step 3's list (after its linked name). */
export const zeroPointLine = (slot: string) => `(${slot.toLowerCase()}): 0 counted points — its effects aren’t scored.`
export const ZERO_POINT_EFFECTS = 'Its effects:'
export const SPECIALS_TITLE = 'Effects named, not scored'
export const notScoredFrom = (item: string) => `Not scored — ${item}:`
export const SPECIALS_NOTE = 'Real effects this site doesn’t model; they add nothing to a score.'
export const GATED_TITLE = 'After a boss: gear that would score higher'
export const GATED_INTRO = 'Candidates that would outrank a pick but need a boss outside your progress, grouped by what to defeat. Each lists the item you can get now instead.'
export const GATED_NONE = 'No gated candidate outranks a pick in this loadout.'
export const gatedSlot = { main: 'Main weapon', armor: 'Armor set', summon: 'Minion staff', off: 'Offense accessory', def: 'Defense accessory', mob: 'Mobility accessory', util: 'Utility accessory' } as const
export const POOLS_TITLE = 'What each slot was scored from'
export const ASSUMPTIONS_TITLE = 'Assumptions behind these scores'
export const INPUTS_USED = 'Inputs used'
export const inputUsed = (field: string, value: string, skipped: boolean) => (skipped ? `${field}: ${value} (default — skipped)` : `${field}: ${value}`)
export const ownedCount = (n: number) => (n === 0 ? 'Gear you own: none added' : `Gear you own: ${n} ${n === 1 ? 'item' : 'items'}`)

/* Step 4 — Save */
export const SAVE_TITLE = 'Save this loadout'
export const SAVE_INTRO = 'Saved builds stay in this browser. Opening one later re-scores its items against the current data.'
export const NAME_LABEL = 'Build name'
export const SAVE = 'Save build'
export const SAVE_CHANGES = 'Save changes'
export const SAVE_COPY = 'Save as copy'
export const SAVED = 'Saved ✓'
export const savedAnnounce = (name: string) => `Saved “${name}”.`
export const copyName = (name: string) => `${name} (copy)`
export const NAME_REQUIRED = 'Give the build a name.'
export const editing = (name: string) => `Editing “${name}”.`
export const UNSAVED = 'Unsaved changes'
export const UP_TO_DATE = 'Matches the saved build.'
export const BUILD_MISSING = 'The saved build this link names isn’t in this browser, so the loadout is built from the link’s inputs.'
export const SAVED_TITLE = 'Your saved builds'
export const SAVED_EMPTY = 'No saved builds in this browser.'
export const OPEN = 'Open'
export const openSr = (name: string) => `Open ${name}`
export const DELETE = 'Delete'
export const deleteSr = (name: string) => `Delete ${name}`
export const DELETE_TITLE = (name: string) => `Delete “${name}”?`
export const DELETE_BODY = 'This removes the build from this browser.'
export const DELETE_KEEP = 'Boss progress, checklists and favorites are not affected.'
/** UX_SPEC §6 (B108 H5): leaving with unsaved changes to a saved build. */
export const LEAVE_TITLE = 'Leave without saving?'
export const leaveBody = (name: string) => `Your changes to “${name}” aren’t saved. Leaving keeps the saved build as it was.`
export const LEAVE_KEEP = 'Stay to save them on step 4 — “Save changes” or “Save as copy”.'
export const LEAVE = 'Leave without saving'
export const STAY = 'Stay'
export const deleted = (name: string) => `Deleted “${name}”.`
export const buildMeta = (cls: string, stage: string, difficulty: string, goal: string | undefined) => [cls, stage, `${difficulty} Mode`, ...(goal ? [goal] : [])].join(' · ')
export const updatedOn = (when: string) => `Saved ${when}`
export const QUARANTINE_NOTICE = 'Some saved data couldn’t be read and was set aside (not deleted).'
export const PERSIST_ERROR_NOTICE = 'Couldn’t save to this browser’s storage. Your builds are kept until you reload or close this tab.'
export const NEXT_STEPS = 'Take it further'
export const COMPARE_WEAPONS = 'Compare these weapons'
export const COMPARE_HINT = 'Side by side with their stats and estimates.'
export const ALL_BUILDS = 'All saved builds'
export const COMPARE_THIS = 'Compare'
export const compareThisSr = (name: string) => `Compare this draft with ${name}`
/** The readiness checker's import (B106 queue: loadout → readiness). */
export const ANALYZE_BUILD = 'Analyze this build'
export const ANALYZE = 'Analyze'
export const analyzeBuildSr = (name: string) => `Analyze ${name} in the readiness checker`
export const ANALYZE_HINT = 'Opens the readiness checker with the saved build’s slots, class and difficulty. It reads only the bosses marked on the map — not the build’s stage — as the checker always does.'
export const ANALYZE_SAVED_VERSION = 'It gets the saved version: save your changes first to include them.'
export const ANALYZE_SAVE_FIRST = 'Save this loadout to analyze it in the readiness checker.'

/* Step 4 — compare with a saved build (PRD P4-S4 AC1/AC2; SCORING_SPEC §5.3) */
export const COMPARE_TITLE = 'Compare with a saved build'
export const COMPARE_INTRO =
  'This draft beside one of your saved builds, both scored against the current data and the bosses marked on the map. Differences are listed, not judged: neither column is the right one.'
export const COMPARE_PICK_LABEL = 'Saved build'
export const COMPARE_PICK_NONE = 'Choose a saved build'
export const COMPARE_SHOW = 'Show side by side'
export const COMPARE_CLEAR = 'Stop comparing'
export const COMPARE_NO_BUILDS = 'No saved builds in this browser to compare with. Save this one, and a later draft can sit beside it.'
export const COMPARE_MISSING = 'The saved build this link compares with isn’t in this browser.'
export const COMPARE_EDITING = 'This is the build you’re editing: its saved version is beside your draft.'
export const DRAFT_COLUMN = 'This draft'
export const PROFILE_COMPARE_TITLE = 'Profile'
export const PROFILE_COMPARE_NOTE =
  'Each bar runs to the higher of the two figures (class synergy: to 100), so the bars show how these two builds differ — not how far either could go.'
export const deltaLine = (text: string) => `Draft − saved: ${text}`
export const DELTA_SAME = 'same'
export const DELTA_NONE = 'not comparable'
export const SET_BONUS_ROW = 'Set bonus'
export const SET_NONE = 'None active'
export const FIT_TITLE = 'Goal fit for these two builds'
export const FIT_GOAL_LABEL = 'Weigh the figures for'
/** AMENDMENTS-016 B113b: one signed difference, never a score per build up front. */
export const FIT_NOTE =
  'A goal’s weights fold the five figures into one difference between these two builds: each figure is split between them in proportion to their values, then weighted and added up per build. It says which way the figures lean under that goal, and by how much — not which build to use.'
/** "Under Survivability weights: saved +24.4" (the "Draft − saved" grammar's sides, B113b). */
export const fitUnder = (goal: string) => `Under ${goal} weights:`
export const FIT_SIDE = { draft: 'draft', saved: 'saved' } as const
export const fitLeaning = (side: string, text: string) => `${side} +${text}`
export const FIT_SAME = 'same'
export const FIT_COLUMNS = { figure: 'Figure', scaled: 'Share of the two (%)', weight: 'Weight', adds: 'Adds' } as const
export const FIT_LEFT_OUT = 'left out'
export const fitSum = (sum: string) => `Weighted sum: ${sum}`
export const FIT_DIFFERENCE = 'The difference'
export const COMPARE_DRAFT_WHO = 'this draft'
/** A compared figure's est. chip: what it estimates, and whose. */
export const COMPARE_WHAT = { edo: 'estimated damage per second', defense: 'defense total', mobility: 'mobility points', survivability: 'survivability points', synergy: 'class synergy' } as const
export const compareContext = (what: string, who: string) => `${what} of ${who}`
export const fitDropped = (labels: string) => `Left out for both builds: ${labels} — it can’t be computed for one of them.`
export const FIT_FOOTER = (version: number) => `Weights v${version} — editorial constants.`
export const SLOTS_TITLE = 'Slot by slot'
export const slotsDiffer = (n: number) => (n === 0 ? 'Every slot holds the same item.' : n === 1 ? '1 slot differs.' : `${n} slots differ.`)
export const SLOT_STATUS = { same: 'Same', changed: 'Different', 'draft-only': 'Only in the draft', 'saved-only': 'Only in the saved build', 'both-empty': 'Empty in both' } as const
export const SIDE_EMPTY = {
  emptied: 'Emptied by you',
  unfilled: 'Left empty by the recommendation',
  locked: 'Locked: the Demon Heart slot',
  'no-slot': 'No such slot at this difficulty',
  'no-ammo': 'Its weapon fires no ammo',
} as const
export const comparing = (name: string) => `Showing this draft beside “${name}”.`
export const COMPARE_STOPPED = 'Comparison closed.'
export const comparisonRegion = (name: string) => `This draft beside ${name}`
export const SAVED_NOT_PLACED = 'Saved items that can’t be placed with the current data:'
export const OPEN_SAVED = 'Open the saved build'
export const SAVED_COLUMN_SR = 'Saved build: '

/* Surprise Me (PRD P4-S4 AC3; SCORING_SPEC §4.8) */
export const SURPRISE_TITLE = 'Surprise Me'
export const SURPRISE_INTRO =
  'Draws a random loadout for your inputs: each slot gets an item drawn at random from the ones verified obtainable at your progress, under the same rules as the recommendation (class, slots, no duplicates). Random, not ranked — every slot still shows its score.'
export const SURPRISE = 'Surprise Me'
export const SURPRISE_AGAIN = 'Draw again'
export const surpriseWarning = (n: number) =>
  n === 1 ? 'Drawing replaces your 1 fixed pick (a swap or a saved build’s slot) with a random one.' : `Drawing replaces your ${n} fixed picks (swaps or a saved build’s slots) with random ones.`
export const surpriseDrawn = (reset: number) =>
  reset === 0 ? 'A random loadout was drawn for your inputs.' : `A random loadout was drawn for your inputs; your ${reset === 1 ? 'fixed pick was' : `${reset} fixed picks were`} replaced.`
export const SURPRISE_SEE = 'See it in step 2'
/**
 * AMENDMENTS-016 B113(e) M3: agrees with "your N fixed picks were replaced" — a draw fills every slot (fixed
 * picks included); only a slot you swap AFTER the draw keeps your pick.
 */
export const SURPRISE_BANNER =
  'Surprise Me: this loadout was drawn at random from items verified obtainable at your progress — a random loadout, not a ranked one. A slot you swap after the draw keeps your pick.'
export const SURPRISE_BACK = 'Back to the recommendation'
export const surpriseCleared = 'The recommendation is back in every slot you haven’t fixed.'
export const RANDOM_TAG = 'random draw'

/* Step 3 — profile bars (PRD P4-S3 AC2; AMENDMENTS-016 B113a) and what each piece adds (AC1) */
export const PROFILE_BARS_NOTE =
  'Each bar runs to the highest figure the builder finds for it among gear verified obtainable at your stage, for your class and difficulty — whatever your goal or your picks. The tick marks that figure: a full bar means this loadout reaches it. Class synergy runs to 100.'
/** The tick's figure, then what it is. */
export const BAR_TICK_LEAD = 'Tick:'
export const BAR_TICK_BASIS = {
  estDamage: ' — the highest damage estimate found among weapons and gear verified obtainable at your stage.',
  defense: ' — the most defense found among gear verified obtainable at your stage.',
  mobility: ' — the most mobility found among gear verified obtainable at your stage.',
  survivability: ' — the most survivability found among gear verified obtainable at your stage.',
} as const
export const BAR_OF_100 = 'Scale: 0 to 100'
/** The reference figure's est. chip: what it estimates (screen readers; the tip's heading). */
export const REFERENCE_WHAT = { estDamage: 'estimated damage per second', defense: 'defense total', mobility: 'mobility points', survivability: 'survivability points' } as const
export const referenceContext = (what: string) => `${what}: the highest found among gear verified obtainable at your stage`
/** Earned: the loadout reaches its reference (the bar is full because of the picks, not by default). */
export const BAR_REACHED = 'This loadout reaches the tick.'
export const BAR_PAST_END = 'Past the tick: this loadout goes beyond the highest found among verified-obtainable gear (gear you own or fixed counts here; the tick leaves it out).'
export const BAR_NONE_WORD = { estDamage: 'damage', defense: 'defense', mobility: 'mobility', survivability: 'survivability' } as const
export const barNoReference = (word: string) => `No bar: nothing verified obtainable at your stage gives a ${word} figure to measure against.`
export const barZeroReference = (word: string) => `No bar: no gear verified obtainable at your stage adds any ${word}.`
export const CONTRIB_TITLE = 'What each piece of gear adds'
export const CONTRIB_NOTE = 'Counted points for your class under this site’s weights, each armor piece’s own defense, and what isn’t counted. The damage estimate starts from the main weapon; this gear adds to it.'
export const CONTRIB_KIND = { armor: 'Armor piece', set: 'Set bonus', accessory: 'Accessory', potion: 'Potion' } as const
export const CONTRIB_NONE = 'No armor, accessories or potions in this loadout.'

/* The saved-builds list (P4-S4; UX_SPEC §1 /builds as a builder sub-view) */
export const BUILDS_DOC_TITLE = 'Saved builds'
export const BUILDS_TITLE = 'Saved builds'
export const BUILDS_INTRO = 'Every loadout saved in this browser. Opening one re-scores its items against the current data.'
export const BUILDS_BACK = 'Back to the builder'
export const BUILDS_BACKUP = 'Back up or restore your builds'
export const BUILDS_EMPTY = 'No saved builds in this browser.'
export const BUILDS_EMPTY_CTA = 'Build my loadout'
export const buildsCount = (n: number) => (n === 1 ? '1 saved build' : `${n} saved builds`)
export const madeFor = (boss: string) => `Made for ${boss}`
export const previewLabel = (name: string) => `${name}: its equipment`
export const PREVIEW_EMPTY = 'Every slot is empty.'

/* Owned picker */
export const OWNED_PICKER_TITLE = 'Add gear you own'
export const OWNED_PICKER_DESCRIPTION = 'Type to search weapons, armor, accessories, ammo and potions. Use the arrow keys to move through the matches and Enter to add one.'
export const OWNED_PICKER_SEARCH = 'Search gear'
export const OWNED_PICKER_START = 'Start typing a name'
export const OWNED_PICKER_START_BODY = 'Each match says whether it’s verified obtainable at your progress.'
export const OWNED_PICKER_LOADING = 'Loading search…'
export const OWNED_PICKER_ERROR = 'Search couldn’t load.'
export const OWNED_PICKER_RETRY = 'Retry'
export const OWNED_PICKER_LIST = 'Matching gear'
export const OWNED_PICKER_ADDED = 'added'
/** A match verified obtainable at the builder's progress (gated ones show their gate chip, Unknown ones the Unknown marker). */
export const OWNED_PICKER_YES = 'Verified obtainable at your progress'
export const ownedPickerCount = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}.`
export const ownedPickerNone = (q: string) => `No matching gear for “${q}”.`
export const ownedAdded = (name: string) => `Added ${name} to the gear you own.`
export const ownedRemoved = (name: string) => `Removed ${name} from the gear you own.`
export const AVAILABILITY_WORD = 'availability'

/* Link notices */
export const linkIgnored = (what: string) => `Part of the link was ignored: ${what}.`
export const LINK_BOSS = 'a boss that isn’t in the data'
export const LINK_ITEMS = 'item IDs that aren’t numbers'
export const LINK_VALUES = 'values that aren’t valid choices'

/* Item tooltips (PRD P4-S2 AC5) */
export const tooltip = {
  unknown: 'Unknown',
  effectsUnknown: 'Effects: Unknown',
  damage: (n: number, cls: string) => `${n} ${cls} damage`,
  damageUnknown: 'Damage: Unknown',
  crit: (pct: number) => `${pct}% critical strike chance`,
  useTime: (ticks: number) => `Use time ${ticks} ticks`,
  useTimeUnknown: 'Use time: Unknown',
  defense: (n: number) => `${n} defense`,
  defenseUnknown: 'Defense: Unknown',
  flight: (secs: string) => `Flight time ${secs} s`,
  ammoDamage: (n: number) => `${n} ammo damage`,
  ammoDamageUnknown: 'Ammo damage: Unknown',
  heals: (n: number) => `Restores ${n} health`,
  grants: (buff: string) => `Grants ${buff}`,
  source: 'Source: terraria.wiki.gg',
}

/* Score figures */
export const SCORE_UNIT = { dpp: 'per second', armor: '', accessory: 'points', buff: 'points', damage: 'base damage', ammo: 'damage' } as const
export const RULE_SOURCE = 'Rule source, on the wiki'
