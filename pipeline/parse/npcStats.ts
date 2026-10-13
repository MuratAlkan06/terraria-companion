/**
 * Cargo NPCs stat cells (`life`, `defense`, `damage`) → per-difficulty integers (P2-S6 boss stats,
 * TO-VERIFY #4). Cells are rendered HTML; the accepted shape (verified against every boss row of
 * the 2026-10-13 sync) is ONE per-difficulty block on the first line:
 *
 * - `<span class="npcstat"><span class="m-normal m-journey">2000</span><span class="ssep">/</span>
 *   <span class="m-expert …">2800</span>…</span>` (also `m-expert-master`, `m-master`, `m-all`), or
 * - `<span class="mode-content">…</span>` with the same mode classes (values may be wrapped in
 *   `[[Expert Mode|<span class="mode-exclusive expert">…</span>]]`).
 * - a bare integer as the whole cell (6 of 1,538 life/defense cells, e.g. Plantera's defense "36"):
 *   the infobox states one value with no per-difficulty distinction → every difficulty.
 *
 * Every difficulty value must be a plain integer. Anything else is NOT a single verified value and
 * is reported as unparseable so the caller lists it as Unknown — never guessed:
 * - a cell carrying the wiki's "information based on outdated versions of Terraria's source code"
 *   category flag (the flag does not say which value it covers, so the whole cell is withheld);
 * - ranges / state-dependent values ("8–28 (depending on health)", "42 / 27 (≤50% health)");
 * - several lines (alternative values: "50<br/>100 (when enraged)", "(with Creepers)"). Only for
 *   `damage` may further lines follow, and only when line 1 is explicitly noted "(contact)": the
 *   other lines are projectile damages, and line 1 is then the contact damage.
 * - any other note on line 1, or text outside the block.
 */
import { noteKey, type Difficulty, type Parsed } from './dropCells'
import { hasClass, parseHtml, rawText, type HNode } from './html'
import { stripMarkup } from './text'

export type NpcStatKind = 'life' | 'defense' | 'damage'
export type PerDifficulty = Partial<Record<Difficulty, number>>

const MODE_CLASSES: Record<string, Difficulty[]> = {
  'm-normal': ['classic'],
  'm-expert-master': ['expert', 'master'],
  'm-expert': ['expert'],
  'm-master': ['master'],
  'm-all': ['classic', 'expert', 'master'],
}

const OUTDATED = /Category:Pages with information based on outdated versions/i
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
const isNote = (n: HNode) => hasClass(n, 'note-text') || hasClass(n, 'note')
const textOf = (nodes: readonly HNode[]) => stripMarkup(rawText(nodes))

/** Top-level nodes split into lines at `<br/>`. */
function lines(nodes: readonly HNode[]): HNode[][] {
  const out: HNode[][] = [[]]
  for (const n of nodes) {
    if (n.type === 'br') out.push([])
    else out[out.length - 1].push(n)
  }
  return out.filter((l) => l.some((n) => n.type !== 'text' || stripMarkup(n.text) !== ''))
}

/** The per-difficulty values of one npcstat / mode-content block. */
function blockValues(block: Extract<HNode, { type: 'el' }>): Parsed<PerDifficulty> {
  const out: PerDifficulty = {}
  for (const child of block.children) {
    if (child.type === 'text') {
      if (stripMarkup(child.text) !== '') return fail('text between the per-difficulty values')
      continue
    }
    if (child.type === 'br') return fail('line break inside the per-difficulty block')
    if (hasClass(child, 'ssep')) continue
    const ds = [...new Set(child.classes.flatMap((c) => MODE_CLASSES[c] ?? []))]
    if (ds.length === 0) {
      if (child.classes.includes('m-journey')) continue
      return fail(`unknown mode class "${child.classes.join(' ')}"`)
    }
    if (child.children.some((n) => n.type === 'el' && isNote(n))) return fail('a difficulty value carries a note')
    const text = textOf(child.children)
    if (!/^\d+$/.test(text)) return fail(`"${text}" is not a single integer`)
    for (const d of ds) out[d] = Number(text)
  }
  if (Object.keys(out).length === 0) return fail('empty per-difficulty block')
  return { ok: true, value: out }
}

export function parseNpcStat(cell: string, kind: NpcStatKind): Parsed<PerDifficulty> {
  if (cell.trim() === '') return fail('empty cell')
  if (OUTDATED.test(cell)) return fail('flagged by the wiki as based on outdated source code')
  if (/^\s*\d+\s*$/.test(cell)) return { ok: true, value: { classic: Number(cell), expert: Number(cell), master: Number(cell) } }
  const ls = lines(parseHtml(cell))
  if (ls.length === 0) return fail('empty cell')
  const first = ls[0]
  const blocks = first.filter((n): n is Extract<HNode, { type: 'el' }> => n.type === 'el' && (hasClass(n, 'npcstat') || hasClass(n, 'mode-content')))
  if (blocks.length !== 1) return fail(blocks.length === 0 ? 'no per-difficulty block' : 'several per-difficulty blocks on one line')
  const notes: string[] = []
  for (const n of first) {
    if (n === blocks[0]) continue
    if (n.type === 'el' && isNote(n)) notes.push(noteKey(textOf(n.children)))
    else if (textOf([n]) !== '') return fail(`text next to the value ("${textOf([n])}")`)
  }
  const contact = notes.length === 1 && notes[0] === 'contact'
  if (notes.length > 0 && !(kind === 'damage' && contact)) return fail(`value noted "${notes.join('; ')}"`)
  if (ls.length > 1 && !(kind === 'damage' && contact)) return fail('several values (alternatives on further lines)')
  return blockValues(blocks[0])
}

