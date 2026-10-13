/**
 * Rendered wiki article HTML → armor-set infobox + wing table data (P2-S8). Shapes verified on the
 * 2026-10-13 sync:
 *
 * 1. SET infobox (`div.infobox.item` whose Type row carries the "Set" tag; the first infobox of an
 *    armor set article): "Defense" = per-helmet totals ("<img alt=Hallowed Headgear>: 31 / … (set)")
 *    or one number; "Set Bonus" = game-text lines (`span.gameText`, <br>-separated) that apply to every
 *    helmet, optionally followed — after a top-level <br> — by "<img alt=PIECE>: <gameText>" segments
 *    that apply to that piece only (Hallowed: default "Become immune after striking an enemy", Hallowed
 *    Hood: the same + "Increases your max number of minions by 2").
 * 2. WING list table (the "Wings" article, transcluded from Wings/List): one row per wing — icon, name
 *    with "Internal Item ID: N", equipped image, source, "Flight time" ("1.67 s"), then the two
 *    "Horizontal speed stats" cells (speed, acceleration multiplier) whose lines are "normal" and — for
 *    wings that can hover — a second "hovering" line ("36 mph<br>36 mph"), the two "Vertical speed stats"
 *    cells (multiplier, acceleration; second line = upwards boost), rarity, notes.
 *
 * All text is plain (A15: markup stripped, entities decoded).
 */
import { findAll, hasClass, parseHtml, rawText, type HNode } from './html'
import { parseIdList } from './infobox'
import { stripMarkup } from './text'

const kids = (n: HNode | undefined): HNode[] => (n && n.type === 'el' ? n.children : [])
const text = (nodes: readonly HNode[]): string => stripMarkup(rawText(nodes))
const lines = (nodes: readonly HNode[]): string[] =>
  rawText(nodes)
    .split('\n')
    .map((l) => stripMarkup(l))
    .filter((l) => l !== '')

export interface SetBonusSegment {
  /** Pieces the segment is restricted to (icon alt texts); empty = every helmet without its own segment. */
  pieces: string[]
  /** Game-text lines of the bonus. */
  lines: string[]
}

export interface SetInfobox {
  title: string
  /** "Defense" row: per-piece totals ("Hallowed Headgear" → 31) or one total under "". */
  defense: Map<string, number>
  /** Raw plain text of the Defense row (report evidence). */
  defenseText?: string
  /** "Set Bonus" row segments; undefined when the infobox has no such row. */
  bonus?: SetBonusSegment[]
  /** Plain text of the Set Bonus row (evidence). */
  bonusText?: string
}

/** Splits a "Set Bonus" cell into its default segment and per-piece segments (see header). */
export function parseSetBonusCell(cell: readonly HNode[]): SetBonusSegment[] {
  const segments: SetBonusSegment[] = []
  let current: SetBonusSegment = { pieces: [], lines: [] }
  const flush = () => {
    if (current.lines.length > 0 || current.pieces.length > 0) segments.push(current)
    current = { pieces: [], lines: [] }
  }
  for (const n of cell) {
    if (n.type === 'br') {
      flush()
      continue
    }
    if (n.type === 'text') {
      // separators between icon and text: thin space, colon, nbsp — anything else is unexpected loose text
      const loose = stripMarkup(n.text).replace(/[:\s ]/g, '')
      if (loose !== '') current.lines.push(stripMarkup(n.text))
      continue
    }
    if (hasClass(n, 'i')) {
      // a piece icon starts a piece-specific segment (several icons may share one segment)
      if (current.lines.length > 0) flush()
      const alt = findAll(n.children, (x) => x.type === 'el' && x.tag === 'img')
        .map((img) => (img.type === 'el' ? img.attrs.alt : undefined))
        .find((a) => a !== undefined && a !== '')
      if (alt) current.pieces.push(stripMarkup(alt))
      continue
    }
    current.lines.push(...lines(n.type === 'el' ? n.children : []))
  }
  flush()
  return segments
}

/** "<img alt=X>: 31 / <img alt=Y>: 35 (set)" or "43 (set)" → piece → total. */
function parseSetDefense(cell: readonly HNode[]): Map<string, number> {
  const out = new Map<string, number>()
  let piece = ''
  for (const n of cell) {
    if (n.type === 'el' && hasClass(n, 'i')) {
      const img = findAll(n.children, (x) => x.type === 'el' && x.tag === 'img')[0]
      piece = img && img.type === 'el' ? stripMarkup(img.attrs.alt ?? '') : ''
      continue
    }
    if (n.type === 'el' && hasClass(n, 'note-text')) continue
    const t = stripMarkup(n.type === 'text' ? n.text : n.type === 'el' ? rawText(n.children) : '')
    for (const m of t.matchAll(/(\d+)/g)) {
      if (out.has(piece)) return new Map() // two numbers for one key: not the expected shape
      out.set(piece, Number(m[1]))
    }
  }
  return out
}

export function parseSetInfoboxes(html: string): SetInfobox[] {
  const out: SetInfobox[] = []
  for (const box of findAll(parseHtml(html), (n) => hasClass(n, 'infobox') && hasClass(n, 'item'))) {
    const title = text(kids(findAll(kids(box), (n) => hasClass(n, 'title'))[0]))
    const rows = new Map<string, HNode[]>()
    for (const tr of findAll(kids(box), (n) => n.type === 'el' && n.tag === 'tr')) {
      const cells = kids(tr).filter((c) => c.type === 'el' && (c.tag === 'th' || c.tag === 'td'))
      if (cells.length !== 2 || cells[0].type !== 'el' || cells[0].tag !== 'th') continue
      const label = text(kids(cells[0]))
      if (label !== '' && !rows.has(label)) rows.set(label, kids(cells[1]))
    }
    const tags = findAll(rows.get('Type') ?? [], (n) => hasClass(n, 'tag')).map((t) => text(kids(t)))
    if (!tags.includes('Set')) continue
    const def = rows.get('Defense')
    const bonus = rows.get('Set Bonus')
    out.push({
      title,
      defense: def ? parseSetDefense(def) : new Map(),
      ...(def ? { defenseText: text(def) } : {}),
      ...(bonus ? { bonus: parseSetBonusCell(bonus), bonusText: text(bonus) } : {}),
    })
  }
  return out
}

export interface WingRow {
  name: string
  itemIds: number[]
  /** Flight time cell, plain text ("1.67 s"). */
  flightTime: string
  /** Horizontal speed cell lines: [normal] or [normal, hovering] ("32 mph"). */
  horizontalSpeed: string[]
  /** Notes cell, plain text. */
  notes: string
  /** Number of cells in the row (shape check: 11). */
  cells: number
}

/** The wing list table of the "Wings" article (the table whose header has "Flight time"). */
export function parseWingTable(html: string): WingRow[] {
  const nodes = parseHtml(html)
  const table = findAll(nodes, (n) => n.type === 'el' && n.tag === 'table' && hasClass(n, 'terraria')).find((t) => findAll(kids(t), (n) => n.type === 'el' && n.tag === 'th').some((th) => text(kids(th)).startsWith('Flight time')))
  if (!table) return []
  const out: WingRow[] = []
  for (const tr of findAll(kids(table), (n) => n.type === 'el' && n.tag === 'tr')) {
    const cells = kids(tr).filter((c) => c.type === 'el' && c.tag === 'td')
    if (cells.length < 7) continue
    const idText = findAll(kids(cells[1]), (n) => hasClass(n, 'id')).map((n) => text(kids(n)))[0] ?? ''
    const m = /^Internal Item IDs?\s*:\s*(.+)$/.exec(idText)
    const itemIds = m ? parseIdList(m[1]) : undefined
    const nameEl = findAll(kids(cells[1]), (n) => n.type === 'el' && (n.tag === 'a' || n.tag === 'span') && !hasClass(n, 'id') && !hasClass(n, 'i') && n.children.every((c) => c.type === 'text'))[0]
    out.push({
      name: nameEl ? text(kids(nameEl)) : text(kids(cells[1])).replace(idText, '').trim(),
      itemIds: itemIds ?? [],
      flightTime: text(kids(cells[4])),
      horizontalSpeed: lines(kids(cells[5])),
      notes: text(kids(cells[cells.length - 1])),
      cells: cells.length,
    })
  }
  return out
}
