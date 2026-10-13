/**
 * Cargo Drops cell grammar (verified against all 3,253 rows on 2026-10-13). Cells are rendered
 * HTML; the supported shapes are:
 *
 * - per-difficulty: `<span class="mode-content"><span class="m-normal [m-journey]">A</span>
 *   <span class="m-expert-master">B</span>…</span>` (also `m-expert`, `m-master`). m-normal →
 *   classic; m-expert-master → expert + master; m-journey is ignored (no Journey difficulty).
 * - plain: `33%`, `1/3`, `1/56 (1.79%)` (the exact fraction wins), quantities `3`, `2–5`.
 * - mode-exclusive styling (`[[Expert Mode|<span class="mode-exclusive expert">…]]`) around the
 *   whole value: difficulties come from the row's normal/expert/master flags.
 * - platform variants: segments tagged by `eico` icons ("Desktop, Console and Mobile
 *   versions" / "Old-gen console and 3DS versions"), separated by `<br/>` or " / ": only the
 *   Desktop segment is kept.
 * - notes: `<span class="note-text">(Hardmode)</span>` after a value → a condition (curated
 *   registry match); several noted values (Underground/Cavern…) → one variant per condition.
 *   In the `custom` cell a `note2` span is either the amount ("(30–60)", Happy Grenade) or a
 *   condition ("(if 100% of damage is dealt at daytime)", Terraprisma) — see customNotesOf.
 *   "A<br/>B (Hardmode)" reads as A outside Hardmode and B in Hardmode → pre-hardmode/hardmode.
 *
 * Anything else (ranges of rates, "~2–3", "More info", unregistered notes, mixed shapes) is
 * reported as unparseable — the caller lists the field as unverified, never guesses.
 */
import { findAll, hasClass, parseHtml, rawText, type HNode } from './html'
import { stripMarkup } from './text'

export const DIFFICULTIES = ['classic', 'expert', 'master'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

export interface ModePart {
  /** Difficulties this part applies to; 'all' = take them from the row flags. */
  difficulties: Difficulty[] | 'all'
  nodes: HNode[]
}

export interface Segment {
  text: string
  notes: string[]
  platforms: string[]
}

const MODE_CLASSES: Record<string, Difficulty[]> = {
  'm-normal': ['classic'],
  'm-expert-master': ['expert', 'master'],
  'm-expert': ['expert'],
  'm-master': ['master'],
  'm-all': ['classic', 'expert', 'master'],
}

const isEico = (n: HNode) => hasClass(n, 'eico')
const isNote = (n: HNode) => hasClass(n, 'note-text') || hasClass(n, 'note')

/** Raw text of `nodes`, skipping (whole subtrees of) nodes matching `skip`. */
function textExcluding(nodes: readonly HNode[], skip: (n: HNode) => boolean): string {
  return nodes.map((n) => (skip(n) ? '' : n.type === 'text' ? n.text : n.type === 'br' ? ' ' : textExcluding(n.children, skip))).join('')
}

export function modeParts(cell: string): Parsed<ModePart[]> {
  const nodes = parseHtml(cell)
  const containers = findAll(nodes, (n) => hasClass(n, 'mode-content'))
  if (containers.length > 1) return fail('more than one mode-content block')
  if (containers.length === 0) return { ok: true, value: [{ difficulties: 'all', nodes }] }
  const mc = containers[0]
  if (mc.type !== 'el') return fail('malformed mode-content')
  if (stripMarkup(textExcluding(nodes, (n) => n === mc || isEico(n))) !== '') return fail('text outside the per-difficulty block')
  const parts: ModePart[] = []
  for (const child of mc.children) {
    if (child.type === 'text' && child.text.trim() === '') continue
    if (child.type !== 'el') return fail('unexpected content inside mode-content')
    const difficulties = [...new Set(child.classes.flatMap((c) => MODE_CLASSES[c] ?? []))]
    if (difficulties.length === 0) {
      if (child.classes.includes('m-journey')) continue
      return fail(`unknown mode class "${child.classes.join(' ')}"`)
    }
    parts.push({ difficulties, nodes: child.children })
  }
  return { ok: true, value: parts }
}

type Tok = { t: 'text'; v: string } | { t: 'br' } | { t: 'eico'; v: string } | { t: 'note'; v: string }

function tokens(nodes: readonly HNode[], out: Tok[] = []): Tok[] {
  for (const n of nodes) {
    if (n.type === 'text') out.push({ t: 'text', v: n.text })
    else if (n.type === 'br') out.push({ t: 'br' })
    else if (isEico(n)) out.push({ t: 'eico', v: n.attrs.title ?? '' })
    else if (isNote(n)) out.push({ t: 'note', v: stripMarkup(rawText(n.children)) })
    else tokens(n.children, out)
  }
  return out
}

/** Normalized note text: "(Hardmode)" → "Hardmode". */
export const noteKey = (note: string) => note.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim()

/** Splits one mode part into value segments and keeps only the Desktop platform's. */
export function desktopSegments(nodes: readonly HNode[]): Parsed<Segment[]> {
  if (findAll(nodes, (n) => hasClass(n, 'mode-exclusive')).length > 0) {
    // The exclusive value must be the whole cell: only the `[[Expert Mode|…]]` link wrapper may surround it.
    const outside = textExcluding(nodes, (n) => hasClass(n, 'mode-exclusive') || isEico(n) || isNote(n))
    if (outside.replace(/\[\[[^|\]]*\|/g, '').replace(/\]\]/g, '').trim() !== '') return fail('value mixes mode-exclusive and plain text')
  }
  const toks = tokens(nodes)
  const multiPlatform = toks.filter((t) => t.t === 'eico').length >= 2
  const split: Tok[] = []
  for (const t of toks) {
    if (t.t === 'text' && multiPlatform && /\s\/\s/.test(t.v)) {
      t.v.split(/\s\/\s/).forEach((piece, i) => {
        if (i > 0) split.push({ t: 'br' })
        split.push({ t: 'text', v: piece })
      })
    } else split.push(t)
  }
  const raw: Segment[] = [{ text: '', notes: [], platforms: [] }]
  for (const t of split) {
    const seg = raw[raw.length - 1]
    if (t.t === 'br') raw.push({ text: '', notes: [], platforms: [] })
    else if (t.t === 'text') seg.text += t.v
    else if (t.t === 'eico') seg.platforms.push(t.v)
    else seg.notes.push(t.v)
  }
  const segments: Segment[] = []
  for (const seg of raw) {
    // between platform variants a dangling " /" separator may precede the <br/>
    const text = multiPlatform ? stripMarkup(seg.text).replace(/^\/\s*|\s*\/$/g, '') : stripMarkup(seg.text)
    if (text === '' && seg.notes.length > 0 && segments.length > 0) {
      segments[segments.length - 1].notes.push(...seg.notes) // note on its own line belongs to the value above
      continue
    }
    if (text === '' && seg.notes.length === 0 && seg.platforms.length === 0) continue
    segments.push({ text, notes: seg.notes, platforms: seg.platforms })
  }
  const anyPlatform = segments.some((s) => s.platforms.length > 0)
  const kept = anyPlatform ? segments.filter((s) => s.platforms.length === 0 || s.platforms.some((p) => p.includes('Desktop'))) : segments
  if (anyPlatform && kept.length === 0) return fail('no Desktop value among platform variants')
  return { ok: true, value: kept }
}

/** "33%" → 0.33, "1/3" → 1/3, "1/56 (1.79%)" → 1/56. Must be in (0, 1]. */
export function parseRate(text: string): number | undefined {
  const t = text.replace(/\s+/g, ' ').trim()
  let value: number | undefined
  const pct = /^(\d+(?:\.\d+)?)\s?%$/.exec(t)
  const frac = /^(\d+)\s?\/\s?(\d+)(?: \(\d+(?:\.\d+)?%\))?$/.exec(t)
  if (pct) value = Number(pct[1]) / 100
  else if (frac && Number(frac[2]) > 0) value = Number(frac[1]) / Number(frac[2])
  if (value === undefined || !(value > 0 && value <= 1)) return undefined
  return Number(value.toPrecision(12))
}

/** "3" → {3,3}; "2–5" / "2-5" → {2,5}. */
export function parseQty(text: string): { min: number; max: number } | undefined {
  const t = text.trim()
  const single = /^(\d+)$/.exec(t)
  if (single) return Number(single[1]) > 0 ? { min: Number(single[1]), max: Number(single[1]) } : undefined
  const range = /^(\d+)\s?[–-]\s?(\d+)$/.exec(t)
  if (range && Number(range[1]) > 0 && Number(range[1]) <= Number(range[2])) return { min: Number(range[1]), max: Number(range[2]) }
  return undefined
}

/** All platform-icon titles in a cell. */
export function platformsOf(cell: string): string[] {
  return findAll(parseHtml(cell), isEico).map((n) => (n.type === 'el' ? (n.attrs.title ?? '') : ''))
}

/** All note texts in a cell (normalized with noteKey). */
export function notesOf(cell: string): string[] {
  return findAll(parseHtml(cell), isNote).map((n) => noteKey(stripMarkup(rawText(n.type === 'el' ? n.children : []))))
}

/** A parenthesized amount ("(30–60)") — used by some `custom` cells for the quantity, not a condition. */
const QTY_NOTE = /^\(?\s*\d+(?:\s?[–-]\s?\d+)?\s*\)?$/

/**
 * Notes of a Drops `custom` cell: note/note-text spans, plus `note2` spans that are not an amount
 * (found by the P2-S2 spot-check: Terraprisma's daytime condition was silently dropped before).
 */
export function customNotesOf(cell: string): string[] {
  const nodes = parseHtml(cell)
  const text = (n: HNode) => stripMarkup(rawText(n.type === 'el' ? n.children : []))
  const note2 = findAll(nodes, (n) => hasClass(n, 'note2'))
    .map(text)
    .filter((t) => !QTY_NOTE.test(t))
  return [...findAll(nodes, isNote).map(text), ...note2].map(noteKey)
}

/** Plain text of a cell without notes and platform icons. */
export function plainTextOf(cell: string): string {
  const strip = (nodes: readonly HNode[]): string =>
    nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'br' ? ' ' : isEico(n) || isNote(n) ? '' : strip(n.children))).join('')
  return stripMarkup(strip(parseHtml(cell)))
}
