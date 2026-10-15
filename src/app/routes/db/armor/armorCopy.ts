/**
 * Armor page copy (PRD P6-S1). One module so the copy audit (no forward promise, no outcome / "best" wording —
 * src/scoring/copyAudit.ts) covers every string the pages render besides wiki quotes.
 */
export const ARMOR_TITLE = 'Armor'

export const listIntro = (version: string): string =>
  `Every armor set in Terraria ${version}, with what the full set adds up to — its set bonus included — and the armor pieces outside the recorded sets, from the Official Terraria Wiki. Filter sets by class and game stage; open a set for its pieces, set bonus and how to get each piece.`

export const SETS_HEADING = 'Armor sets'
export const LOOSE_HEADING = 'Pieces outside the recorded sets'
export const LOOSE_NOTE = 'Not part of any set recorded in this dataset. Where the wiki ties a piece to a set this dataset can’t record, its set shows as Unknown.'
export const looseHiddenByClass = (n: number): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? 'piece is' : 'pieces are'} outside the recorded sets and so ${n === 1 ? 'has' : 'have'} no set class — the class filter leaves ${n === 1 ? 'it' : 'them'} out.`
/** The sets list is empty but the name filter matches pieces outside the sets (shown below). */
export const noSetsButPieces = (n: number): string => `No set matches — ${n.toLocaleString('en-US')} ${n === 1 ? 'piece' : 'pieces'} outside the recorded sets ${n === 1 ? 'matches' : 'match'}, below.`
export const NAME_FILTER_LABEL = 'Filter by name'
export const NAME_FILTER_PLACEHOLDER = 'e.g. hallowed, frost, wizard'
export const CLEAR_NAME = 'Clear name filter'
export const UNKNOWN_LEGEND = '= not verified against the wiki; we never guess values.'
export const stageLegend = (unknown: number, total: number): string =>
  `${unknown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} sets have no verified game stage (it comes from verified gating), so they sit under “Stage unknown”.`
export const resultCount = (shown: number, total: number): string =>
  shown === total ? `${total.toLocaleString('en-US')} sets` : `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} sets`
export const pieceCount = (shown: number): string => `${shown.toLocaleString('en-US')} ${shown === 1 ? 'piece' : 'pieces'}`
export const EMPTY_TITLE = 'No armor matches'
export const emptyBody = (active: number): string =>
  active === 1 ? 'Nothing in this chest — no set or piece matches this filter.' : `Nothing in this chest — no set or piece matches all ${active} active filters together.`
export const EMPTY_HINT = 'Remove a filter below, or clear them all.'
export const CLEAR_ALL = 'Clear all filters'
export const LIST_ERROR = 'Couldn’t load the armor list'
export const LIST_LOADING = 'Loading armor…'
export const helmets = (n: number): string => `${n} helmets`
export const chestPieces = (n: number): string => `${n} chest pieces`
export const NO_LEGS_PIECE = 'no legs piece'
export const FULL_SET_DEFENSE = 'Full-set defense'

// --- set / piece page ---------------------------------------------------------------------------------

export const BACK_TO_ARMOR = 'All armor'
export const DETAIL_LOADING = 'Loading armor…'
export const DETAIL_ERROR = 'Couldn’t load this armor'
export const NOT_FOUND_TITLE = 'No such armor'
export const notFoundBody = 'There’s no armor set or armor piece with that ID in the encyclopedia. It may have been mistyped — browse the armor list instead.'
export const SET_BADGE = 'Armor set'
export const PIECE_BADGE = 'Armor piece'
export const CLASSES_LABEL = 'Classes'
export const CLASS_LABEL = 'Class'
export const STAGE_LABEL = 'Game stage'
export const PIECES_LABEL = 'Pieces'
export const piecesValue = (pieces: number, helmetCount: number, chestCount = 1): string => {
  const choices = [helmetCount > 1 ? `${helmetCount} helmets` : '', chestCount > 1 ? `${chestCount} chest pieces` : ''].filter(Boolean)
  return choices.length > 0 ? `${pieces} (${choices.join(' and ')} to choose from)` : String(pieces)
}
/** A set beyond "helmet + chest + legs": its alternative chests (keyed bonus or not) and a missing legs piece. */
export const shapeNote = (chests: number, chestKeyed: boolean, legsAny: boolean): string =>
  [
    chests > 1 ? (chestKeyed ? `Any one of its ${chests} chest pieces completes the set, and the chest decides which set bonus you get.` : `Any one of its ${chests} chest pieces completes the set.`) : '',
    legsAny ? 'It has no legs piece: any legs can be worn and the set bonus still applies.' : '',
  ]
    .filter(Boolean)
    .join(' ')
export const HYBRID_NOTE = 'A hybrid set: its bonus counts for more than one class.'
export const UNKNOWN_HEAVY = 'Several values on this page couldn’t be verified against the wiki data, so they show as Unknown instead of a guess. The wiki pages may say more.'
export const SPRITE_NOTE = 'Some pieces have no wiki sprite here — the grey silhouettes are placeholder art.'

export const BONUS_HEADING = 'Set bonus'
export const bonusFor = (pieceNames: string): string => `With ${pieceNames}`
export const anyChest = (chests: number): string => `With any of its ${chests} chest pieces.`
export const BONUS_INTRO = 'What wearing the whole set adds, as the game’s tooltip states it:'
export const BONUS_NUMBERS = 'Counted in the totals below as:'
export const BONUS_TEXT_ONLY = 'Kept as text — not a number the totals can add up.'

export const TOTALS_HEADING = 'Full set, set bonus included'
export const TOTALS_INTRO =
  'Each stat adds the pieces’ stated values and the set bonus once — not the pieces on their own. Effects the data keeps as text are listed apart, never turned into numbers.'
export const totalsFor = (combination: string, classes: string): string => `With the ${combination} (${classes})`
export const totalsPickLabel = (n: number): string => `Combination (${n} to choose from)`
export const TOTALS_LEGS_ANY = 'This set has no legs piece: the totals count its helmet and chest piece, not whatever legs are worn with them.'
export const DEFENSE_LABEL = 'Defense'
/** Where a total comes from, each part with its own sign ("16 from pieces, +4 from the set bonus") — never a sum to work out; no pieces part when they add none. */
export const breakdown = (pieces: string | undefined, bonus: string): string => (pieces === undefined ? `${bonus} from the set bonus` : `${pieces} from pieces, ${bonus} from the set bonus`)
export const NO_STAT_LINES = 'No other stats — its effects are the ones kept as text below.'
export const SPECIALS_LABEL = 'Effects kept as text'
export const FROM_BONUS = 'set bonus'
export const effectsUnknown = (names: string): string => `The effects of ${names} are Unknown, so these totals leave them out.`

export const PIECES_HEADING = 'Pieces and how to get them'
export const SLOT_LABEL = { head: 'Head', chest: 'Body', legs: 'Legs' } as const
/** The classes the set bonus counts for, on the piece it comes with (a helmet; a chest when the bonus is keyed by the chest). */
export const PIECE_FOR = { head: 'Helmet for', chest: 'Chest piece for', legs: 'Legs for' } as const
export const DEFENSE_ROW = 'Defense'
export const EFFECTS_ROW = 'Effects'
export const NO_EFFECTS = 'None besides its defense'
export const RARITY_ROW = 'Rarity'
export const HOW_TO_OBTAIN = 'How to obtain'
export const ACQ_LOADING = 'Loading recipes and drops…'
export const ACQ_ERROR = 'Couldn’t load how to obtain these pieces'
export const PIECE_ACQ_ERROR = 'Couldn’t load how to obtain this piece'
export const NOT_IN_SET = 'Not part of any set recorded in this dataset.'
export const SET_ROW = 'Set'
export const SET_NONE_RECORDED = 'None recorded'
/** The piece's set membership is Unknown: the wiki ties it to a set this dataset can't record. */
export const SET_UNKNOWN_NOTE = 'The wiki ties this piece to a set this dataset can’t record, so its set — and any set bonus — shows as Unknown rather than “none”. Its wiki page has the details.'
export const PIECE_STATS_HEADING = 'Stats'

export const COMPARE_HEADING = 'Compare with another set'
export const COMPARE_INTRO =
  'Side by side, each set counted as a full set: pieces plus its set bonus. A set bonus can change which set gives more — a sum of pieces alone would miss that.'
export const COMPARE_PICK_LABEL = 'Compare with'
export const COMPARE_PICK_NONE = 'Choose a set…'
export const HELMET_PICK_LABEL = (setName: string, noun: 'helmet' | 'chest piece' | 'combination' = 'helmet'): string => `${setName} ${noun}`
export const COMPARE_CLEAR = 'Clear comparison'
export const STAT_COLUMN = 'Stat'
export const NONE_CELL = 'None'
export const compareCaption = (a: string, b: string): string => `${a} and ${b}, full sets with their set bonuses`
export const bonusChanges = (stat: string, more: string, piecesMore: string | undefined): string =>
  piecesMore === undefined
    ? `${stat}: the pieces alone are even; with the set bonuses, ${more} gives more.`
    : `${stat}: the pieces alone give ${piecesMore} more; with the set bonuses, ${more} gives more.`
export const bonusEvens = (stat: string, piecesMore: string): string => `${stat}: the pieces alone give ${piecesMore} more; with the set bonuses, both give the same.`
export const SPECIALS_ROW = 'Pieces’ effects kept as text'
export const specialsCount = (n: number): string => (n === 0 ? 'None' : `${n} (listed on each set’s page)`)
export const UNKNOWN_COMPARE = 'Unknown values are never counted as 0 — that row can’t be compared.'

export const PEERS_HEADING = 'Comparable sets at this stage'
export const peersIntro = (stage: string): string => `Other sets whose verified game stage is ${stage}:`
export const PEERS_NONE = 'No other set has this verified game stage.'
export const PEERS_UNKNOWN = 'This set’s game stage isn’t verified, so no set is matched to it by stage — any set can still be compared above.'
export const COMPARE_LINK = 'Compare'
export const compareWithSr = (a: string, b: string): string => ` ${a} with ${b}`

export const LOADOUT_LINK = 'Try it in the Loadout Builder'
export const loadoutLinkSr = (name: string): string => ` — opens the builder with ${name} marked as gear you own; it is scored with everything else`
export const SOURCES_SUMMARY = 'Where this data comes from'
export const SPRITE_CREDIT = 'Sprites © Re-Logic'
export const SPRITE_FILE = (name: string): string => `${name} sprite`
