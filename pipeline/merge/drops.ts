/**
 * Cargo Drops (+ NPCs cross-check, + Iteminfo IDs) → DropSource[] (P2-S2a).
 *
 * Row semantics (verified 2026-10-13):
 * - `nameraw` = source NPC/container name; `name` (HTML) may add a variant note ("(T3)",
 *   "(Second Form)") → npcName becomes "Ogre (T3)" so variants keep distinct records/ids.
 * - `isfromnpc` 1 = NPC, 0 = container (crate, chest, treasure bag, Shadow Orb…); containers
 *   carry no NPC ids. "Treasure Bag (X)" sources get `treasureBag: true`.
 * - `normal`/`expert`/`master` flags = difficulties where the drop exists (others are
 *   not-applicable, so absent + unlisted). Rate/quantity cells per dropCells.ts grammar.
 * - Platform: a row whose name/custom icons exclude Desktop is skipped; within cells only the
 *   Desktop value is used.
 * - `id` (TO-VERIFY #3): Cargo NPC ids are present for most NPC rows ("113, 114",
 *   "170 (Corrupt), 171 (Hallow)…", ranges "87–92", negative netIDs for variants — emitted,
 *   AMENDMENTS-003 B10). Ids are cross-checked against the NPCs table ids for the same
 *   `nameraw`; a disagreement (e.g. Eater of Worlds rows carrying 262 = Plantera) strips
 *   npcIds + source-mismatch gap. Empty ids are filled from the NPCs table.
 * - Boss attribution (TO-VERIFY #3): a drop is a boss drop when its source NPC is typed
 *   `boss` / `boss Part` in the NPCs table (multi-part bosses: every segment/part id —
 *   EoW 13–15, Twins 125/126, Golem 245–249, Moon Lord 396–398, Destroyer 134–136,
 *   Skeletron 35/36, WoF 113/114 — belongs to the boss article `_page` of that NPCs row) or
 *   when it is a treasure bag. bossId must resolve to bosses.json (P2-S6, pending), so it is
 *   absent + listed in unverifiedFields until the boss registry exists.
 */
import type { GapEntry, ProvSource } from '../../src/schemas'
import { type DropSource } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import {
  customNotesOf,
  DIFFICULTIES,
  desktopSegments,
  modeParts,
  noteKey,
  notesOf,
  parseQty,
  parseRate,
  platformsOf,
  plainTextOf,
  type Difficulty,
  type Parsed,
  type Segment,
} from '../parse/dropCells'
import { resolveItemName, type Iteminfo } from '../parse/iteminfo'
import { fnv1a32hex, slugify, stripMarkup } from '../parse/text'
import type { ConditionMatchers } from './overlays'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'

export interface NpcIndex {
  byName: Map<string, { ids: Set<number>; types: Set<string>; pages: Set<string> }>
  byId: Map<number, { types: Set<string>; name: string; page: string }>
}

const str = (v: CargoRow[string]) => (v === null || v === undefined ? '' : String(v))

export const BOSS_TYPES = ['boss', 'boss Part'] as const
const isBossTyped = (types: ReadonlySet<string>) => BOSS_TYPES.some((t) => types.has(t))

export function indexNpcs(rows: readonly CargoRow[]): NpcIndex {
  const byName: NpcIndex['byName'] = new Map()
  const byId: NpcIndex['byId'] = new Map()
  for (const row of rows) {
    const name = stripMarkup(str(row.nameraw))
    const types = str(row.type).split('^').map((t) => t.trim()).filter(Boolean)
    const id = Number(str(row.npcid))
    const entry = byName.get(name) ?? { ids: new Set<number>(), types: new Set<string>(), pages: new Set<string>() }
    for (const t of types) entry.types.add(t)
    entry.pages.add(str(row._page))
    if (Number.isInteger(id) && id !== 0) {
      entry.ids.add(id)
      const byIdEntry = byId.get(id) ?? { types: new Set<string>(), name, page: str(row._page) }
      for (const t of types) byIdEntry.types.add(t)
      byId.set(id, byIdEntry)
    }
    byName.set(name, entry)
  }
  return { byName, byId }
}

/** "113, 114" · "170 (Corrupt), 171 (Hallow)" · "87–92" · "-3" → ids (negatives kept separately). */
export function parseNpcIdCell(cell: string): Parsed<{ positive: number[]; negative: number[] }> {
  const text = plainTextOf(cell).replace(/\([^)]*\)/g, ' ')
  const positive: number[] = []
  const negative: number[] = []
  for (const token of text.split(/[,;]/).map((t) => t.trim()).filter(Boolean)) {
    const range = /^(\d+)\s?[–-]\s?(\d+)$/.exec(token)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      if (b < a || b - a > 50) return { ok: false, reason: `implausible id range "${token}"` }
      for (let i = a; i <= b; i += 1) positive.push(i)
      continue
    }
    if (/^-\d+$/.test(token)) negative.push(Number(token))
    else if (/^\d+$/.test(token) && Number(token) > 0) positive.push(Number(token))
    else return { ok: false, reason: `unparseable NPC id token "${token}"` }
  }
  return { ok: true, value: { positive: [...new Set(positive)], negative } }
}

interface Variant {
  conditions: string[]
  rates: Partial<Record<Difficulty, number>>
}

export type ReasonTally = Map<string, { count: number; examples: string[] }>
export function tally(t: ReasonTally, reason: string, example: string) {
  const e = t.get(reason) ?? { count: 0, examples: [] }
  e.count += 1
  if (e.examples.length < 3) e.examples.push(example)
  t.set(reason, e)
}

export interface DropLedger {
  cargoRows: number
  nonDesktopRows: number
  excludedRows: number
  emittedRows: number
  emittedRecords: number
  splitRows: number
  idCollisions: number
}

export interface DropBuildInput {
  rows: readonly CargoRow[]
  fetchedAt: string
  npcs: NpcIndex
  npcsFetchedAt: string
  iteminfo: Iteminfo
  conditions: ConditionMatchers
}

export function buildDrops(input: DropBuildInput): { drops: DropSource[]; gaps: GapEntry[]; ledger: DropLedger; reasons: ReasonTally; ambiguousNames: Map<string, number[]> } {
  const { iteminfo, npcs } = input
  const gaps = new GapLog()
  const ambiguousNames = new Map<string, number[]>()
  const fetchedAt = isoDate(input.fetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: iteminfo.rev, fetchedAt: iteminfo.fetchedAt })
  const ledger: DropLedger = { cargoRows: input.rows.length, nonDesktopRows: 0, excludedRows: 0, emittedRows: 0, emittedRecords: 0, splitRows: 0, idCollisions: 0 }
  const drops = new Map<string, DropSource>()
  const reasons: ReasonTally = new Map()

  const mapNotes = (notes: readonly string[]): Parsed<string[]> => {
    const out: string[] = []
    for (const n of notes) {
      const cond = input.conditions.dropNote.get(noteKey(n))
      if (!cond) return { ok: false, reason: `note "${noteKey(n)}" maps to no registered condition` }
      out.push(cond.id)
    }
    return { ok: true, value: [...new Set(out)].sort() }
  }

  /** Rate variants for one mode part's segments. */
  const rateVariants = (segments: readonly Segment[]): Parsed<{ conditions: string[]; rate: number }[]> => {
    if (segments.length === 0) return { ok: false, reason: 'empty rate' }
    const parsed: { conditions: string[]; rate: number; noted: boolean }[] = []
    for (const seg of segments) {
      const rate = parseRate(seg.text)
      if (rate === undefined) return { ok: false, reason: `unparseable rate "${seg.text}"` }
      const conds = mapNotes(seg.notes)
      if (!conds.ok) return conds
      parsed.push({ conditions: conds.value, rate, noted: seg.notes.length > 0 })
    }
    if (parsed.length === 1) return { ok: true, value: parsed }
    const unnoted = parsed.filter((p) => !p.noted)
    if (unnoted.length === 1 && parsed.length === 2 && parsed.some((p) => p.conditions.join() === 'hardmode')) {
      unnoted[0].conditions = ['pre-hardmode'] // "A<br/>B (Hardmode)": A applies outside Hardmode
    } else if (unnoted.length > 0) {
      return { ok: false, reason: 'several values without distinguishing notes' }
    }
    if (new Set(parsed.map((p) => p.conditions.join('|'))).size !== parsed.length) return { ok: false, reason: 'duplicate conditions across values' }
    return { ok: true, value: parsed }
  }

  for (const row of input.rows) {
    const rowId = str(row._rowid)
    const page = str(row._page)
    const pageUrl = wikiPageUrl(page)
    const sourceName = stripMarkup(str(row.nameraw))
    const itemName = stripMarkup(str(row.item))
    const exclude = (field: string, kind: GapEntry['kind'], reason: string) => {
      ledger.excludedRows += 1
      gaps.add({ ref: `drop:cargo-row-${rowId}`, field, kind, detail: `Cargo Drops row ${rowId} (${page}: ${sourceName} → "${itemName}") not emitted: ${reason}`, sources: [pageUrl] })
    }

    // platform
    const rowPlatforms = [...platformsOf(str(row.name)), ...platformsOf(str(row.custom))]
    if (rowPlatforms.length > 0 && !rowPlatforms.some((p) => p.includes('Desktop'))) {
      ledger.nonDesktopRows += 1
      continue
    }

    // item
    const item = resolveItemName(iteminfo, itemName)
    if (!item.ok) {
      exclude('itemId', 'count-reconciliation', `item ${item.reason}`)
      continue
    }
    if (item.ambiguous) ambiguousNames.set(item.normalized ?? itemName, item.ambiguous)

    const unverified: string[] = []
    const sources: ProvSource[] = [{ kind: 'cargo:Drops', url: pageUrl, fetchedAt }, iteminfoSrc]
    let crossCheckFailed = false

    // source
    const fromNpc = str(row.isfromnpc) === '1'
    const nameNotes = notesOf(str(row.name)).filter((n) => n !== '' && !sourceName.includes(n))
    const npcName = nameNotes.length > 0 ? `${sourceName} (${nameNotes.join(', ')})` : sourceName
    const treasureBag = !fromNpc && /^Treasure Bag \(/.test(sourceName)
    const source: DropSource['source'] = { npcName }
    let isBoss = treasureBag
    if (fromNpc) {
      const known = npcs.byName.get(sourceName)
      const idCell = parseNpcIdCell(str(row.id))
      let ids: number[] | undefined
      if (!idCell.ok) {
        unverified.push('source.npcIds')
      } else if (idCell.value.positive.length + idCell.value.negative.length > 0) {
        const cellIds = [...idCell.value.positive, ...idCell.value.negative]
        const mismatched = known && known.ids.size > 0 ? cellIds.filter((id) => !known.ids.has(id)) : []
        if (mismatched.length > 0) {
          unverified.push('source.npcIds')
          crossCheckFailed = true
          gaps.add({
            ref: `drop:cargo-row-${rowId}`,
            field: 'source.npcIds',
            kind: 'source-mismatch',
            detail: `Cargo Drops row ${rowId} (${page}: ${sourceName}) lists NPC id(s) ${mismatched.join(', ')} which the NPCs table assigns to ${mismatched.map((id) => npcs.byId.get(id)?.name ?? 'no NPC').join(', ')}, not "${sourceName}" (NPCs ids: ${[...(known?.ids ?? [])].join(', ')}); npcIds withheld.`,
            sources: [pageUrl],
          })
        } else ids = cellIds
      } else if (known && known.ids.size > 0 && !known.types.has('boss Part')) {
        // Fill from the NPCs table only when the name is unambiguous; for multi-part bosses
        // (Moon Lord 396/397/398, Golem 245–249…) which part drops the loot is not stated.
        ids = [...known.ids].sort((a, b) => a - b)
        sources.push({ kind: 'cargo:NPCs', url: pageUrl, fetchedAt: isoDate(input.npcsFetchedAt) })
      } else {
        unverified.push('source.npcIds') // no id anywhere, or a multi-part boss
      }
      if (ids) source.npcIds = ids
      const typed = (ids ?? []).some((id) => isBossTyped(npcs.byId.get(id)?.types ?? new Set())) || (known !== undefined && isBossTyped(known.types))
      isBoss ||= typed
      if (known) sources.push({ kind: 'cargo:NPCs', url: pageUrl, fetchedAt: isoDate(input.npcsFetchedAt) })
    }
    if (treasureBag) source.treasureBag = true
    if (isBoss) unverified.push('source.bossId')

    // applicable difficulties
    const applicable = DIFFICULTIES.filter((d) => str(row[d === 'classic' ? 'normal' : d]) === '1')

    // rates → variants
    const variants = new Map<string, Variant>()
    const rateFailures: string[] = []
    const rateParts = modeParts(str(row.rate))
    const ratesUnknown = new Set<Difficulty>()
    if (!rateParts.ok) {
      rateFailures.push(rateParts.reason)
      for (const d of applicable) ratesUnknown.add(d)
    } else {
      for (const part of rateParts.value) {
        const ds = (part.difficulties === 'all' ? applicable : part.difficulties).filter((d) => applicable.includes(d))
        const segs = desktopSegments(part.nodes)
        const vs = segs.ok ? rateVariants(segs.value) : segs
        if (!vs.ok) {
          rateFailures.push(vs.reason)
          for (const d of ds) ratesUnknown.add(d)
          continue
        }
        for (const v of vs.value) {
          const key = v.conditions.join('|')
          const variant = variants.get(key) ?? { conditions: v.conditions, rates: {} }
          for (const d of ds) variant.rates[d] = v.rate
          variants.set(key, variant)
        }
      }
    }
    if (variants.size === 0) variants.set('', { conditions: [], rates: {} })

    // extra conditions from the custom cell's notes
    let conditionsUnknown = false
    const customNotes = customNotesOf(str(row.custom)).filter((n) => n !== '')
    const customConds = mapNotes(customNotes)
    if (!customConds.ok) conditionsUnknown = true

    // quantity (per difficulty); custom rows put "(2–5)" after the item instead
    const qty: Partial<Record<Difficulty, { min: number; max: number }>> = {}
    const qtyUnknown = new Set<Difficulty>()
    const qtyCell = str(row.quantity)
    if (qtyCell.trim() === '') {
      const m = /\(([\d–-]+)\)\s*$/.exec(plainTextOf(str(row.custom)))
      const q = m ? parseQty(m[1]) : undefined
      for (const d of applicable) {
        if (q) qty[d] = q
        else qtyUnknown.add(d)
      }
    } else {
      const parts = modeParts(qtyCell)
      if (!parts.ok) for (const d of applicable) qtyUnknown.add(d)
      else {
        for (const part of parts.value) {
          const ds = (part.difficulties === 'all' ? applicable : part.difficulties).filter((d) => applicable.includes(d))
          const segs = desktopSegments(part.nodes)
          const q = segs.ok && segs.value.length === 1 && segs.value[0].notes.length === 0 ? parseQty(segs.value[0].text) : undefined
          for (const d of ds) {
            if (q) qty[d] = q
            else qtyUnknown.add(d)
          }
        }
      }
      for (const d of applicable) if (!qty[d]) qtyUnknown.add(d)
    }
    const known = applicable.filter((d) => qty[d])
    const uniform = qtyUnknown.size === 0 && known.length > 0 && known.every((d) => qty[d]!.min === qty[known[0]]!.min && qty[d]!.max === qty[known[0]]!.max)
    const quantity: DropSource['quantity'] = uniform ? { ...qty[known[0]]! } : Object.fromEntries(known.map((d) => [d, { ...qty[d]! }]))
    const qtyFields = uniform ? [] : [...qtyUnknown].map((d) => `quantity.${d}`)

    // why fields are unknown (aggregated for the human-readable gap report, not duplicated in gaps.json)
    for (const r of rateFailures) tally(reasons, `rate: ${r.replace(/"[^"]*"/g, '"…"')}`, `${page}: ${sourceName} → ${itemName}`)
    if (qtyFields.length > 0) tally(reasons, 'quantity: not parseable', `${page}: ${sourceName} → ${itemName} ("${plainTextOf(qtyCell) || plainTextOf(str(row.custom))}")`)
    if (!customConds.ok) tally(reasons, `conditions: ${customConds.reason}`, `${page}: ${sourceName} → ${itemName}`)
    if (unverified.includes('source.npcIds')) tally(reasons, 'source.npcIds: unparseable, missing, multi-part boss or mismatched', `${page}: ${sourceName}`)

    // emit one record per rate variant
    ledger.emittedRows += 1
    if (variants.size > 1) ledger.splitRows += 1
    for (const variant of variants.values()) {
      const conditions = [...new Set([...variant.conditions, ...(customConds.ok ? customConds.value : [])])].sort()
      const fields = [...unverified, ...qtyFields]
      for (const d of applicable) if (variant.rates[d] === undefined) fields.push(`rates.${d}`)
      if (conditionsUnknown) fields.push('conditions')
      const baseId = `${item.id}-${slugify(npcName)}-${fnv1a32hex(JSON.stringify(conditions))}`
      let id = baseId
      for (let n = 2; drops.has(id); n += 1) id = `${baseId}-${n}`
      if (id !== baseId) ledger.idCollisions += 1
      const record: DropSource = {
        id,
        itemId: item.id,
        source: { ...source, ...(source.npcIds ? { npcIds: [...source.npcIds] } : {}) },
        quantity,
        rates: Object.fromEntries(applicable.flatMap((d) => (variant.rates[d] === undefined ? [] : [[d, variant.rates[d]]]))),
        conditions: conditionsUnknown ? [] : conditions,
        _prov: makeProv(sources, fields, crossCheckFailed),
      }
      drops.set(id, record)
      ledger.emittedRecords += 1
    }
  }
  const list = [...drops.values()].sort((a, b) => a.itemId - b.itemId || a.id.localeCompare(b.id))
  return { drops: list, gaps: gaps.entries, ledger, reasons, ambiguousNames }
}
