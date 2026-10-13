/**
 * Rendered wiki article HTML → structured infobox data (P2-S7). Three shapes, all verified on the
 * 2026-10-13 sync:
 *
 * 1. ITEM infobox (`div.infobox.item`, Template:Item infobox): a title, `table.stat` rows
 *    (`<th>label</th><td>value</td>` — e.g. "Base Velocity" 4, "Velocity Multiplier" 2×; a potion's
 *    "Grants Buff" section has "Buff tooltip" / "Duration") and an ids section
 *    ("Internal Item ID: 97", "Internal Projectile ID: 89, 90", "Internal Buff ID: 5"; item-ID lists
 *    may use en-dash ranges: "4459, 4447–4449"). Multi-item articles have one infobox per item, or one
 *    shared infobox listing several item IDs.
 * 2. BUFF infobox (`aside.portable-infobox`, buff/debuff articles): a title and `pi-data` rows
 *    (label `h3.pi-data-label`, value `div.pi-data-value`), e.g. "Effects" = lines separated by <br>
 *    ("−24 health per second (on enemies)", "No health regeneration"), "Buff ID" = 39.
 * 3. The "Buff IDs" article table (ID · image · name link · internal name · Buff/Debuff): the game's
 *    buff ID list with each buff's article (TO-VERIFY-IN-P2 #12).
 *
 * All text is plain (A15: markup stripped, entities decoded).
 */
import { findAll, hasClass, parseHtml, rawText, type HNode } from './html'
import { stripMarkup } from './text'

const kids = (n: HNode | undefined): HNode[] => (n && n.type === 'el' ? n.children : [])
const text = (nodes: readonly HNode[]): string => stripMarkup(rawText(nodes))
/** Plain-text lines of a cell (<br> separates lines). */
const lines = (nodes: readonly HNode[]): string[] =>
  rawText(nodes)
    .split('\n')
    .map((l) => stripMarkup(l))
    .filter((l) => l !== '')

/** "97" · "89, 90" · "4459, 4447–4449" → ids (ranges expanded). Undefined when not a pure id list. */
export function parseIdList(s: string): number[] | undefined {
  const out: number[] = []
  for (const part of s.split(',').map((p) => p.trim())) {
    const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      if (b < a || b - a > 1000) return undefined
      for (let i = a; i <= b; i += 1) out.push(i)
    } else if (/^\d+$/.test(part)) out.push(Number(part))
    else return undefined
  }
  return out.length > 0 ? out : undefined
}

export interface ItemInfobox {
  title: string
  itemIds: number[]
  projectileIds: number[]
  buffIds: number[]
  /** Stat rows in document order (label → plain-text value). A label can repeat across sections. */
  rows: { label: string; value: string }[]
}

export function parseItemInfoboxes(html: string): ItemInfobox[] {
  const boxes = findAll(parseHtml(html), (n) => hasClass(n, 'infobox') && hasClass(n, 'item'))
  return boxes.map((box) => {
    const titleEl = findAll(kids(box), (n) => hasClass(n, 'title'))[0]
    // the title div also holds the collapsible toggle placeholder (empty text) — plain text is the name
    const title = text(kids(titleEl))
    const ids: Record<'Item' | 'Projectile' | 'Buff', number[]> = { Item: [], Projectile: [], Buff: [] }
    for (const section of findAll(kids(box), (n) => hasClass(n, 'ids'))) {
      for (const li of findAll(kids(section), (n) => n.type === 'el' && n.tag === 'li')) {
        const m = /^Internal (Item|Projectile|Buff) IDs?\s*:\s*(.+)$/.exec(text(kids(li)))
        const list = m ? parseIdList(m[2]) : undefined
        if (m && list) ids[m[1] as keyof typeof ids].push(...list)
      }
    }
    const rows: ItemInfobox['rows'] = []
    for (const tr of findAll(kids(box), (n) => n.type === 'el' && n.tag === 'tr')) {
      const cells = kids(tr).filter((c) => c.type === 'el' && (c.tag === 'th' || c.tag === 'td'))
      if (cells.length !== 2 || cells[0].type !== 'el' || cells[0].tag !== 'th') continue
      const label = text(kids(cells[0]))
      if (label !== '') rows.push({ label, value: text(kids(cells[1])) })
    }
    return { title, itemIds: ids.Item, projectileIds: ids.Projectile, buffIds: ids.Buff, rows }
  })
}

/** The single infobox whose "Internal Item ID" list contains `itemId` (undefined when none or several). */
export function infoboxForItem(boxes: readonly ItemInfobox[], itemId: number): ItemInfobox | undefined {
  const matches = boxes.filter((b) => b.itemIds.includes(itemId))
  return matches.length === 1 ? matches[0] : undefined
}

export interface BuffInfobox {
  title: string
  /** "Buff ID" row (debuff/buff articles); undefined when absent or not one integer. */
  buffId?: number
  /** label → plain-text lines of the value (<br>-separated). */
  data: Map<string, string[]>
}

export function parseBuffInfoboxes(html: string): BuffInfobox[] {
  const asides = findAll(parseHtml(html), (n) => n.type === 'el' && n.tag === 'aside' && hasClass(n, 'portable-infobox'))
  return asides.map((aside) => {
    const title = text(kids(findAll(kids(aside), (n) => hasClass(n, 'pi-title'))[0]))
    const data = new Map<string, string[]>()
    for (const row of findAll(kids(aside), (n) => hasClass(n, 'pi-data'))) {
      const label = text(kids(findAll(kids(row), (n) => hasClass(n, 'pi-data-label'))[0]))
      const value = findAll(kids(row), (n) => hasClass(n, 'pi-data-value'))[0]
      if (label !== '' && value && !data.has(label)) data.set(label, lines(kids(value)))
    }
    const idLine = data.get('Buff ID')
    const buffId = idLine?.length === 1 && /^\d+$/.test(idLine[0]) ? Number(idLine[0]) : undefined
    return { title, ...(buffId !== undefined ? { buffId } : {}), data }
  })
}

export interface BuffIdRow {
  id: number
  name: string
  internalName: string
  isDebuff: boolean
  /** The article the name links to ("Ironskin" → "Ironskin Potion"); absent when the name is unlinked. */
  article?: string
}

/** The "Buff IDs" article's ID list. Rows without a name (unused legacy IDs) are skipped. */
export function parseBuffIdTable(html: string): BuffIdRow[] {
  const out: BuffIdRow[] = []
  for (const table of findAll(parseHtml(html), (n) => n.type === 'el' && n.tag === 'table' && hasClass(n, 'terraria'))) {
    for (const tr of findAll(kids(table), (n) => n.type === 'el' && n.tag === 'tr')) {
      const cells = kids(tr).filter((c) => c.type === 'el' && c.tag === 'td')
      if (cells.length !== 5) continue
      const id = Number(text(kids(cells[0])))
      const name = text(kids(cells[2]))
      const type = text(kids(cells[4]))
      if (!Number.isInteger(id) || id <= 0 || name === '' || (type !== 'Buff' && type !== 'Debuff')) continue
      const link = findAll(kids(cells[2]), (n) => n.type === 'el' && n.tag === 'a' && (n.attrs.href ?? '').startsWith('/wiki/'))[0]
      const href = link && link.type === 'el' ? link.attrs.href.slice('/wiki/'.length).split('#')[0] : undefined
      const article = href ? decodeURIComponent(href).replaceAll('_', ' ') : undefined
      out.push({ id, name, internalName: text(kids(cells[3])), isDebuff: type === 'Debuff', ...(article ? { article } : {}) })
    }
  }
  return out
}
