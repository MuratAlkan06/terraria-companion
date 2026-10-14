/**
 * P3-S11 — thrown explosives' damage and knockback (AMENDMENTS-013 B64: "the param-complete explosives
 * stay downgraded until their damage/crit/knockback verify").
 *
 * WHY THEY WERE WITHHELD. The established rule (merge/weapons.ts) takes damage and knockback from
 * Module:Iteminfo/data (game-source numeric truth) and cross-checks them against the Cargo infobox. A
 * thrown explosive's ITEM carries no damage of its own — Iteminfo `damage` is 0 or −1 and `knockBack` 0
 * for every Bomb / Dynamite variant — because the game sets the explosion's damage and knockback on the
 * projectile when it goes off (the wiki's Explosives (class) table cites "the Desktop 1.4.5.5 source
 * code, method Kill() in Terraria.Projectile.cs"); Module:Projectileinfo/data has no damage field. So
 * the numeric source had nothing to cross-check and both fields were left Unknown — not a disagreement
 * between two values. (critPct is a separate matter: classless damage never crits — not applicable,
 * AMENDMENTS-015 B85(b); merge/weapons.ts.)
 *
 * HOW THEY VERIFY NOW (two independent wiki statements of the same quantity, any disagreement withheld):
 * - the item infobox (Cargo Items `damage` / `knockback`), AND
 * - the item's row in the "Explosives (class)" article's types table ("Item | Damage | Radius |
 *   Knockback | …", hand-written per item — e.g. Freeze Bomb "0 (to enemies) 1 (to user)", Scarab Bomb
 *   radius "/"), matched by the row's "Internal Item ID",
 * - and, where the weapon's OWN article states the explosion's damage ("The explosion also deals 100
 *   damage to all enemies…", checked verbatim on the cached revision), that sentence too.
 * Iteminfo's ≤ 0 is the item's own (absent) value, not a contradiction. A value is taken only when every
 * statement present agrees and it is positive; otherwise the field stays Unknown (disagreement →
 * source-mismatch gap; a 0 "to enemies" → Unknown as before). Weapons without a row in the class table
 * (launchers, grenades — "not considered part of the explosives class") are untouched by this rule.
 */
import type { ProvSource } from '../../src/schemas'
import { articleText, type Article } from '../fetch/articles'
import { wikiPageUrl } from '../fetch/config'
import { parseItemTable } from '../parse/infobox'
import { stripMarkup } from '../parse/text'
import { isoDate } from './prov'

export const EXPLOSIVES_CLASS_PAGE = 'Explosives (class)'

/** The types table is found by this column (its header "Radius[1]" with the footnote marker removed). */
const TABLE_KEY_COLUMN = 'Radius'

export interface ExplosiveTableRow {
  /** Leading number of the "Damage" cell (undefined when it starts with none). */
  damage?: number
  /** Leading number of the "Knockback" cell ("8 (Very strong)" → 8). */
  knockback?: number
  /** The cells as rendered (report). */
  cells: Readonly<Record<string, string>>
}

export interface ExplosiveTable {
  rows: ReadonlyMap<number, ExplosiveTableRow>
  source: ProvSource
}

const leading = (cell: string | undefined): number | undefined => {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(stripMarkup(cell ?? ''))
  return m ? Number(m[1]) : undefined
}

/** The Explosives (class) types table, by item ID (undefined when the article has no such table). */
export function explosiveTable(article: Article | undefined): ExplosiveTable | undefined {
  if (!article) return undefined
  const rows = new Map<number, ExplosiveTableRow>()
  for (const r of parseItemTable(article.html, TABLE_KEY_COLUMN)) {
    const damage = leading(r.cells.Damage)
    const knockback = leading(r.cells.Knockback)
    for (const id of r.itemIds) if (!rows.has(id)) rows.set(id, { ...(damage !== undefined ? { damage } : {}), ...(knockback !== undefined ? { knockback } : {}), cells: r.cells })
  }
  if (rows.size === 0) return undefined
  return { rows, source: { kind: 'wiki-article', url: wikiPageUrl(article.resolvedTitle), rev: article.revid, fetchedAt: isoDate(article.fetchedAt) } }
}

/** "The explosion also deals 250 damage to all enemies…" / "…deals 200 classless damage to all…": the one value the own article states. */
const DAMAGE_SENTENCE = /[^.]*\bdeals? (\d+) (?:classless )?damage to all\b[^.]*\./gi

export interface StatedExplosionDamage {
  value: number
  /** The sentence as it appears in the article's plain text (checked verbatim by the caller's evidence index). */
  quote: string
  source: ProvSource
}

/**
 * The explosion damage the weapon's own article states, if it states exactly one value (several
 * different values → undefined: never picked).
 */
export function statedExplosionDamage(article: Article | undefined): StatedExplosionDamage | undefined {
  if (!article) return undefined
  const text = articleText(article.html)
  const found = [...text.matchAll(DAMAGE_SENTENCE)].map((m) => ({ value: Number(m[1]), quote: m[0].trim() }))
  if (found.length === 0 || new Set(found.map((f) => f.value)).size > 1) return undefined
  return { ...found[0], source: { kind: 'wiki-article', url: wikiPageUrl(article.resolvedTitle), rev: article.revid, fetchedAt: isoDate(article.fetchedAt) } }
}

/** What merge/weapons.ts checks a thrown explosive's infobox damage / knockback against. */
export interface ExplosiveEvidence {
  table: ExplosiveTableRow
  tableSource: ProvSource
  stated?: StatedExplosionDamage
}

/**
 * Evidence lookup for buildWeapons: the class table row of the item (if any) plus its own article's
 * damage sentence — an extracted sentence, so `checkSentence` (the build's Evidence index) confirms it
 * verbatim on the cached revision, as every extracted sentence is.
 */
export function explosiveEvidence(
  articles: ReadonlyMap<string, Article>,
  checkSentence: (page: string, sentence: string) => void = () => {},
): (itemId: number, page: string) => ExplosiveEvidence | undefined {
  const table = explosiveTable(articles.get(EXPLOSIVES_CLASS_PAGE))
  return (itemId, page) => {
    const row = table?.rows.get(itemId)
    if (!table || !row) return undefined
    const stated = statedExplosionDamage(articles.get(page))
    if (stated) checkSentence(page, stated.quote)
    return { table: row, tableSource: table.source, ...(stated ? { stated } : {}) }
  }
}

export type ExplosiveCheck =
  | { ok: true; value: number; sources: ProvSource[] }
  | { ok: false; detail: string }
  /** No positive value stated by the infobox AND the table: not this rule's to decide (stays Unknown). */
  | { ok: false; detail: null }

/**
 * Damage: the infobox, the class table and (when the own article states one) the article sentence must
 * all state the same positive value. Knockback: the infobox and the class table (no article states one).
 */
export function checkExplosiveStat(field: 'damage' | 'knockback', infobox: number | undefined, ev: ExplosiveEvidence): ExplosiveCheck {
  const table = field === 'damage' ? ev.table.damage : ev.table.knockback
  const stated = field === 'damage' ? ev.stated : undefined
  if (!(infobox !== undefined && infobox > 0) || !(table !== undefined && table > 0)) {
    if (infobox !== undefined && infobox > 0 && table !== undefined && table !== infobox) return { ok: false, detail: `the wiki infobox states ${infobox}, the Explosives (class) table ${table}` }
    return { ok: false, detail: null }
  }
  if (table !== infobox) return { ok: false, detail: `the wiki infobox states ${infobox}, the Explosives (class) table ${table}` }
  if (stated && stated.value !== infobox) return { ok: false, detail: `the wiki infobox and the Explosives (class) table state ${infobox}, the weapon's article ${stated.value} ("${stated.quote}")` }
  return { ok: true, value: infobox, sources: [ev.tableSource, ...(stated ? [stated.source] : [])] }
}
