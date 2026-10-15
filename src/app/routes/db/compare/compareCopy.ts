/**
 * Every user-visible string of the weapon comparison (PRD P4-S1; UX_SPEC §3.6, §5, §8). One module so
 * the copy audit (compare.test.ts) covers all of it: SCORING_SPEC §8.4's banned outcome words and
 * forward promises, plus the comparison's own rule — differences are shown, the judgment is the
 * user's: no winner, no "better", no ranking words.
 */

export const PAGE_TITLE = 'Compare weapons'
export const PAGE_INTRO =
  'Two or three weapons side by side, from their verified wiki data. The differences are laid out here; which one suits you is your call.'
export const PAGE_LINK_NOTE = 'This page’s link restores the comparison, so you can share it.'

// --- toolbar / selection ------------------------------------------------------------------------

export const ADD_WEAPON = 'Add a weapon'
export const countLine = (n: number, max: number) => `${n} of ${max} weapons`
export const CHANGE = 'Change'
export const REMOVE = 'Remove'
export const changeSr = (name: string) => `Change ${name} to another weapon`
export const removeSr = (name: string) => `Remove ${name} from the comparison`
export const OPEN_PAGE_SR = 'open its weapon page'

export const announceAdded = (name: string, n: number) => `Added ${name}. ${n === 1 ? 'One weapon' : `${n} weapons`} in the comparison.`
export const announceRemoved = (name: string, n: number) =>
  `Removed ${name}. ${n === 0 ? 'No weapons' : n === 1 ? 'One weapon' : `${n} weapons`} in the comparison.`
export const announceSwapped = (from: string, to: string) => `Changed ${from} to ${to}.`

// --- states ----------------------------------------------------------------------------------------

export const EMPTY_TITLE = 'Pick weapons to compare'
export const EMPTY_BODY =
  'Choose two or three weapons to see their stats side by side: damage, speed, costs, how to get them, and an estimated damage rate with the assumptions behind it.'
export const EMPTY_HINT = 'Every weapon page has a Compare button too.'
export const BROWSE_WEAPONS = 'Browse weapons'

export const ONE_TITLE = 'Add a second weapon'
export const ONE_BODY = 'One weapon is in the comparison. Add another to see the two side by side.'

export const MIXED_CLASS_TITLE = 'Different damage classes'
export const mixedClassBody = (classes: string) =>
  `These weapons deal ${classes} damage. Armor, accessories and potions usually boost one class, so your gear can shift these numbers — the figures here leave gear out.`

export const unknownHeavy = (name: string, count: number) =>
  `${name} has ${count} values that aren’t verified for this version. Those cells say Unknown — nothing is filled in for them.`

export const missingIds = (ids: readonly number[]) =>
  ids.length === 1
    ? `The link names a weapon ID that isn’t in the dataset (${ids[0]}), so it is left out.`
    : `The link names weapon IDs that aren’t in the dataset (${ids.join(', ')}), so they are left out.`
export const overflowIds = (max: number) => `The link names more than ${max} weapons; the first ${max} are compared.`
export const MALFORMED_IDS = 'Parts of the link that aren’t weapon IDs were ignored.'
export const DUPLICATE_IDS = 'A weapon listed twice in the link is compared once.'

export const LOADING = 'Loading the comparison…'
export const LOAD_ERROR_TITLE = 'Couldn’t load the comparison'

export const swipeHint = (n: number) => `Swipe sideways to see all ${n} weapons.`

// --- table -------------------------------------------------------------------------------------------

export const TABLE_CAPTION = 'Weapon comparison'
export const STAT_COLUMN = 'Stat'

export const GROUP_STATS = 'Stats'
export const GROUP_ESTIMATE = 'Estimated damage rate'
export const GROUP_COSTS = 'Costs'
export const GROUP_PROGRESS = 'Getting it'
export const GROUP_BEHAVIOR = 'In-game'
export const GROUP_NOTES = 'From the data'

export const ROW_LABELS = {
  class: 'Class',
  damage: 'Damage',
  crit: 'Critical chance',
  useTime: 'Use time',
  knockback: 'Knockback',
  autoReuse: 'Auto-reuse',
  dpp: 'Damage per second',
  mana: 'Mana cost',
  ammo: 'Ammo',
  consumable: 'Consumable',
  stage: 'Game stage',
  rarity: 'Rarity',
  gating: 'Required progress',
  acquisition: 'How to obtain',
  tooltip: 'Item tooltip',
  lab: 'Weapon Lab',
  builder: 'Loadout Builder',
  pros: 'Pros',
  cons: 'Cons',
  source: 'Source',
} as const

export const ROW_NOTES = {
  dpp: 'An estimate from base stats only — open “est.” for the assumptions',
  gating: 'Checked against the bosses you’ve marked defeated',
} as const

export const YES = 'Yes'
export const NO = 'No'
export const NONE = 'None'
export const ticks = (n: number) => `${n} ticks`
export const critPercent = (pct: number) => `${pct}%`
export const consumableYes = (stack: number) => `Yes — stacks to ${stack}`
export const NOT_APPLICABLE = 'Not applicable'
export const CRIT_NA_CLASSLESS = 'Classless damage never deals critical hits.'
export const CRIT_NA_SUMMON = 'Summon damage doesn’t crit by the weapon’s own chance.'
export const NO_TOOLTIP = 'No tooltip text'

// DPP (SCORING_SPEC §2.2)
export const perSecondUnit = 'per second'
export const DPP_NOT_ESTIMATED = 'Not estimated'
export const DPP_SUMMON_REASON = 'A minion’s attack rate comes from its own behavior, not from the staff’s use time, so no rate is estimated.'
/** "a and b" / "a, b and c". */
export const andList = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
export const dppMissingReason = (fields: readonly string[]) =>
  `Needs ${andList(fields.map((f) => f.charAt(0).toLowerCase() + f.slice(1)))}, which ${fields.length > 1 ? 'are' : 'is'} Unknown for this weapon.`
export const dppContext = (name: string) => `damage per second of ${name}`

export const ASSUMPTION_BASE_TITLE = 'Same formula for every weapon'
export const ASSUMPTION_FORMULA_TITLE = 'This weapon’s numbers'
/** `critFactor` is the bare multiplier ("1.04"): the template supplies the "×" (AMENDMENTS-016 B101d). */
export const assumptionFormula = (perHit: string, hitsPerSec: string, critFactor: string, total: string) =>
  `${perHit} damage per hit × ${hitsPerSec} hits per second × ${critFactor} for critical hits ≈ ${total} per second.`
export const ASSUMPTION_RATE_TITLE = 'Hits per second'
export const assumptionRate = (cadence: string, cadenceTicks: number, shots: number, hitsPerSec: string) =>
  shots > 1
    ? `${shots} shots per use, one use every ${cadence}: ${shots} × 60 ÷ ${cadenceTicks} = ${hitsPerSec}.`
    : `One hit per use, one use every ${cadence}: 60 ÷ ${cadenceTicks} = ${hitsPerSec}.`
export const cadenceText = (useAnimation: number, autoswing: boolean, delay: number) =>
  `${useAnimation} ticks${autoswing ? ' − 1 (melee auto-reuse swings a tick sooner)' : ''}${delay > 0 ? ` + ${delay} reuse delay` : ''}`
export const ASSUMPTION_CRIT_TITLE = 'Critical hits'
export const assumptionCrit = (pct: number) =>
  `Taken as an average: ${pct}% chance (the universal 4% plus the weapon’s own) of double damage.`
export const ASSUMPTION_CRIT_CLASSLESS = 'Classless damage never deals critical hits, so none are added.'
export const ASSUMPTION_CRIT_SUMMON = 'Summon damage doesn’t crit by the weapon’s own chance, so none are added.'
export const ASSUMPTION_AMMO_TITLE = 'Scored without ammo'
export const ASSUMPTION_AMMO =
  'No ammo is chosen here, so only the weapon’s own damage counts. In-game, each shot adds the damage of the ammo it fires.'
// The held-attack / used-up caveats (AMENDMENTS-016 B101a): an in-cell line under the estimate, and a tip each.
export const QUALIFIER_CLICK_THROW = 'one click per throw'
export const QUALIFIER_CLICK_ATTACK = 'one click per attack'
export const qualifierUsage = (perSecond: string) => `uses ${perSecond}/s`
export const QUALIFIER_EXPLOSIVE = 'blast and fuse not counted'
/** "One click per throw · uses 1.5/s · blast and fuse not counted". */
export const dppQualifier = (parts: readonly string[]) => {
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}
export const ASSUMPTION_CLICKS_TITLE = 'No auto-reuse'
export const assumptionClicks = (cadenceTicks: number) =>
  `Assumes a click every ${cadenceTicks} ticks — it has no auto-reuse, so holding attack doesn’t repeat it.`
export const ASSUMPTION_USAGE_TITLE = 'Used up as you use it'
export const assumptionUsage = (perSecond: string) => `Each use spends one from the stack, so attacking at this rate uses ${perSecond} per second.`
export const ASSUMPTION_EXPLOSIVE_TITLE = 'Blast and fuse not counted'
export const ASSUMPTION_EXPLOSIVE =
  'Counted as one hit on one target when it’s used. The blast hitting every enemy in its area, and the fuse’s delay before it goes off, aren’t in this estimate.'
export const ASSUMPTION_PROXY_TITLE = 'A proxy, not a simulation'
export const ASSUMPTION_PROXY =
  'Computed from verified stats alone, so every weapon gets the same treatment. The Weapon Lab’s browser simulation measures differently and can show other figures.'

// Gating (tracked progress, SCORING_SPEC §2.4; UX_SPEC §8)
export const GATE_NONE = 'No boss gate'
export const gateMet = (names: string) => `You marked ${names} defeated`
export const GATE_MAP_LINK = 'Mark bosses on the map'

// Acquisition
export const ACQUISITION_NONE = 'No way to obtain it is listed in the dataset.'
export const ACQUISITION_DETAILS = 'Details on its page'

// Loadout Builder (UX_SPEC §3.6 ActionRow "Open in Builder"; AMENDMENTS-016 B99f, landed with P4-S2)
export const OPEN_IN_BUILDER = 'Open in Builder'

// Lab
export const LAB_TEST = 'Test in Weapon Lab'
export const LAB_NOT_SIMULATED = 'Not simulated in the Weapon Lab'

// Pros / cons (data-derived, each weapon on its own — never against the others)
export const PRO_AUTO_REUSE = 'Auto-reuse: hold to keep attacking'
export const PRO_NO_RESOURCE = 'Needs no mana or ammo'
export const PRO_EXPLOSIVE = 'Explodes, hitting every enemy in the blast'
export const CON_NO_AUTO_REUSE = 'No auto-reuse: one click per attack'
export const conMana = (n: number) => `Costs ${n} mana per use`
export const conAmmo = (type: string) => `Needs ammo: ${type}`
export const conConsumable = (stack: number) => `Used up as you use it (stacks to ${stack})`
export const CON_CLASSLESS = 'Classless damage: never deals critical hits'
export const CON_UNOBTAINABLE = 'Listed as unobtainable on the wiki'
export const PROS_CONS_NONE = 'None from the data'
export const PROS_CONS_NOTE = 'Pros and cons are read from each weapon’s own verified data by fixed rules. They describe that weapon alone, not how it stacks up against the others.'

// Source
export const SOURCE_SR = (name: string) => `for ${name}`

// Footnotes
export const NOTE_TICKS = 'Use time is in game ticks (60 ticks = 1 second), as on the wiki.'
export const NOTE_CRIT = 'Critical chance includes the universal 4% base.'
export const NOTE_NOT_COMPARED =
  'Not compared here: range, ease of use, reforge modifiers, and single- vs multi-target hits beyond explosives. The weapon data doesn’t record them; the Weapon Lab shows how simulated weapons reach and hit.'

// Picker (UX_SPEC §3.6 PickerRow: the shell's search index, weapons only)
export const pickerTitle = (mode: 'add' | 'swap', name?: string) => (mode === 'swap' && name ? `Change ${name}` : 'Add a weapon')
export const PICKER_DESCRIPTION = 'Type to search weapons. Use the arrow keys to move through the matches and Enter to pick one.'
export const PICKER_SEARCH = 'Search weapons'
export const PICKER_START_TITLE = 'Start typing a weapon name'
export const PICKER_START_BODY = 'A few letters are enough. Each match says whether the bosses you’ve marked defeated open it.'
export const PICKER_RECENT = 'Recently viewed weapons'
export const PICKER_LIST = 'Matching weapons'
export const PICKER_LOADING = 'Loading search…'
export const PICKER_ERROR = 'Search couldn’t load.'
export const PICKER_RETRY = 'Retry'
export const PICKER_CLOSE = 'Close'
export const PICKER_ALREADY = 'Already in the comparison'
export const PICKER_AVAILABILITY_WORD = 'availability'
export const pickerCount = (n: number) => (n === 1 ? '1 match' : `${n} matches`)
export const pickerNone = (q: string) => `No weapons match “${q}”.`
export const pickerRecentCount = (n: number) => (n === 1 ? '1 recently viewed weapon' : `${n} recently viewed weapons`)
