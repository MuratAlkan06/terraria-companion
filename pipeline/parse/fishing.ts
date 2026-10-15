/**
 * The wiki's "Fishing catches" article (AMENDMENTS-004 B20: the structured fishing source) → its
 * condition definitions and its catch-table rows. Pure: rendered HTML in.
 *
 * Verified article shape (rev of the 2026-10-15 sync):
 * - Four definition tables, captioned "1. Generic fishing conditions", "2. Bobber location",
 *   "3. Biome", "4. World status": one row per condition, the first cell holding the condition's
 *   anchor (`<span id="hardmode">`) and its label, the next cell(s) its requirements.
 * - "List of fishing catches": one h3 per catch category (Truffle Worm, Lava, Honey, Water), then
 *   one table per catch group: a caption ("Corruption", "Crate", "Rare items", …), a
 *   "General condition:" row (a link to a definition anchor, or "n/a"), a header row starting
 *   "Fishing catch", and 5-cell rows: the catch (items with "Internal Item ID: N", or NPCs with
 *   "Internal NPC ID: N"), the chance, the catch quality, the Heights list and the Other conditions
 *   list (links to definition anchors, or "n/a").
 */
import { findAll, hasClass, parseHtml, rawText, type HNode } from './html'
import { decodeEntities, stripMarkup } from './text'

export type FishingConditionGroup = 'generic' | 'bobber' | 'biome' | 'world'

export interface FishingConditionDef {
  anchor: string
  label: string
  group: FishingConditionGroup
  /** The requirement cell(s), plain text (report evidence). */
  requirement: string
}

export interface FishingConditionRef {
  /** Definition anchor the link points at ("hardmode"); absent for plain text. */
  anchor?: string
  label: string
}

export interface FishingCatchRow {
  /** The h3 catch category the table sits under ("Water", "Lava", "Honey", "Truffle Worm"). */
  category: string
  /** The table caption ("Corruption", "Crate", "Rare items", …). */
  table: string
  /** The table's General condition; undefined = "n/a". */
  general?: FishingConditionRef
  itemIds: number[]
  npcIds: number[]
  chance: string
  quality: string
  /** Heights list ("Any", "Surface", "Underground", "Cavern", "Underworld", "Space"). */
  heights: string[]
  conditions: FishingConditionRef[]
}

export interface FishingCatches {
  definitions: Map<string, FishingConditionDef>
  rows: FishingCatchRow[]
}

const DEFINITION_CAPTIONS: Record<string, FishingConditionGroup> = {
  '1. Generic fishing conditions': 'generic',
  '2. Bobber location': 'bobber',
  '3. Biome': 'biome',
  '4. World status': 'world',
}

const el = (n: HNode | undefined): Extract<HNode, { type: 'el' }> | undefined => (n && n.type === 'el' ? n : undefined)
const kids = (n: HNode | undefined): HNode[] => el(n)?.children ?? []
const children = (n: HNode, tag: string): Extract<HNode, { type: 'el' }>[] => kids(n).flatMap((c) => (c.type === 'el' && c.tag === tag ? [c] : []))
/** Plain text without footnote markers (`<sup class="reference">`). */
const textOf = (nodes: readonly HNode[]): string => stripMarkup(rawText(stripRefs(nodes))).replace(/\s+/g, ' ').trim()
const stripRefs = (nodes: readonly HNode[]): HNode[] =>
  nodes.flatMap((n): HNode[] => {
    if (n.type !== 'el') return [n]
    if (n.tag === 'sup' || hasClass(n, 'reference')) return []
    return [{ ...n, children: stripRefs(n.children) }]
  })

/** Rows of a table (tbody or direct), in order. */
function rowsOf(table: HNode): Extract<HNode, { type: 'el' }>[] {
  const bodies = children(table, 'tbody')
  return (bodies.length > 0 ? bodies : [table as Extract<HNode, { type: 'el' }>]).flatMap((b) => children(b, 'tr'))
}

/** The anchor + label of a condition link (`<a href="#hardmode">Hardmode</a>`), else the plain text. */
function conditionRef(nodes: readonly HNode[]): FishingConditionRef | undefined {
  const label = textOf(nodes)
  if (label === '' || label === 'n/a') return undefined
  const link = findAll(nodes, (n) => n.type === 'el' && n.tag === 'a' && (n.attrs.href ?? '').startsWith('#'))
  const anchor = link.length > 0 ? decodeEntities(el(link[0])?.attrs.href ?? '').slice(1) : undefined
  return anchor ? { anchor, label } : { label }
}

/** Document-order walk yielding h3 headings and tables (tables are not descended into). */
function walk(nodes: readonly HNode[], visit: (n: Extract<HNode, { type: 'el' }>) => void) {
  for (const n of nodes) {
    if (n.type !== 'el') continue
    if (n.tag === 'h3' || n.tag === 'table') visit(n)
    else walk(n.children, visit)
  }
}

const ID_PATTERN = /Internal (Item|NPC) ID: (\d+)/g

export function parseFishingCatches(html: string): FishingCatches {
  const definitions = new Map<string, FishingConditionDef>()
  const rows: FishingCatchRow[] = []
  let category = ''
  walk(parseHtml(html), (node) => {
    if (node.tag === 'h3') {
      const headline = findAll(node.children, (n) => hasClass(n, 'mw-headline'))[0]
      category = textOf(headline ? kids(headline) : node.children)
      return
    }
    const caption = children(node, 'caption')[0]
    // the caption repeats its label in a hidden h4 headline: read the visible text after it
    const captionText = caption ? textOf(kids(caption).flatMap((c) => (c.type === 'el' && c.tag === 'div' ? c.children.filter((x) => !(x.type === 'el' && x.tag === 'h4')) : [c]))) : ''
    const trs = rowsOf(node)
    const group = DEFINITION_CAPTIONS[captionText]
    if (group) {
      for (const tr of trs) {
        const tds = children(tr, 'td')
        if (tds.length < 2) continue
        const anchorEl = findAll(tds[0].children, (n) => n.type === 'el' && n.tag === 'span' && typeof n.attrs.id === 'string' && n.attrs.id !== '')[0]
        const anchor = el(anchorEl)?.attrs.id
        if (!anchor) continue
        definitions.set(anchor, { anchor, label: textOf(tds[0].children), group, requirement: tds.slice(1).map((td) => textOf(td.children)).join(' | ') })
      }
      return
    }
    const header = trs.find((tr) => children(tr, 'th').some((th) => textOf(th.children) === 'Fishing catch'))
    if (!header) return
    let general: FishingConditionRef | undefined
    for (const tr of trs) {
      const th = children(tr, 'th')
      if (th.length === 1 && textOf(th[0].children).startsWith('General condition:')) {
        const nodes = th[0].children
        const ref = conditionRef(nodes)
        general = ref ? { ...ref, label: ref.label.replace(/^General condition:\s*/, '') } : undefined
        if (general?.label === 'n/a') general = undefined
      }
    }
    for (const tr of trs) {
      const tds = children(tr, 'td')
      if (tds.length !== 5) continue
      const ids = [...rawText(tds[0].children).matchAll(ID_PATTERN)]
      const items = (li: Extract<HNode, { type: 'el' }>) => findAll(li.children, (n) => n.type === 'el' && n.tag === 'li')
      const listOf = (td: Extract<HNode, { type: 'el' }>) => findAll(td.children, (n) => n.type === 'el' && n.tag === 'li').map((li) => el(li) as Extract<HNode, { type: 'el' }>).filter((li) => items(li).length === 0)
      rows.push({
        category,
        table: captionText,
        ...(general ? { general } : {}),
        itemIds: ids.filter((m) => m[1] === 'Item').map((m) => Number(m[2])),
        npcIds: ids.filter((m) => m[1] === 'NPC').map((m) => Number(m[2])),
        chance: textOf(tds[1].children),
        quality: textOf(tds[2].children),
        heights: listOf(tds[3]).map((li) => textOf(li.children)).filter(Boolean),
        conditions: listOf(tds[4]).flatMap((li) => conditionRef(li.children) ?? []),
      })
    }
  })
  return { definitions, rows }
}
