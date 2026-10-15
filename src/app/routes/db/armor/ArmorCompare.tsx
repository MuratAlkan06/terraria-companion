import { X } from 'lucide-react'
import { useId, useRef } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../../components/cx'
import { PixelPanel } from '../../../../components/PixelPanel'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { ArmorSet } from '../../../../data-access/types'
import { STAGES } from '../../../stages'
import * as copy from './armorCopy'
import { verifiedStage, type CompareCell, type CompareRow, type CompareState, type SetTotals, type SetVariant } from './armorModel'
import { setChestIds } from '../../../../schemas/setCombos'
import { ARMOR_COMPARE_ID, armorSetHref } from './armorNav'
import { FIELD_LABEL, LINK, SECTION_TITLE, WikiQuote } from './EquipmentBits'
import { classWords, statAmount, statLabel } from './equipmentDisplay'

/**
 * "Compare with another set" (PRD P6-S1 AC2; UX_SPEC §1 "set-bonus-aware compare"): pick a set (and a helmet on
 * either side when a set has several), see both full sets side by side — each stat the pieces' stated values plus
 * the set bonus once, never a per-piece sum — and, in words, every stat where the set bonuses change which set
 * gives more. Unknown is never counted as 0. The choice lives in the URL (`?vs=&helmet=&vshelmet=`), so a
 * comparison can be shared; native selects keep it keyboard- and screen-reader-plain at every width.
 */
export interface ArmorCompareProps {
  set: ArmorSet
  sets: ReadonlyMap<string, ArmorSet>
  state: CompareState
  /** Updates the comparison (null clears a parameter); `helmet` / `vshelmet` name a combination by its key. */
  onChange: (patch: { vs?: string | null; helmet?: string | null; vshelmet?: string | null }) => void
}

/** What a set's picker chooses: a helmet, a chest piece (Beetle armor), or both (the Wizard set). */
const pickNoun = (set: ArmorSet): 'helmet' | 'chest piece' | 'combination' =>
  set.pieces.helmets.length > 1 && setChestIds(set).length > 1 ? 'combination' : setChestIds(set).length > 1 ? 'chest piece' : 'helmet'

const FIELD = 'min-h-tap w-full border-2 border-panel-border bg-surface-sunken px-3 text-base text-fg focus:border-gold-600'

const rowLabel = (row: CompareRow): string => (row.stat === 'defense' ? copy.DEFENSE_LABEL : statLabel(row.stat, row.scope))
const amount = (row: CompareRow, total: number): string => (row.stat === 'defense' ? String(total) : statAmount(row.stat, total))
/** Text effects of the pieces themselves (the set bonus's own are in the "Set bonus" row). */
const pieceSpecials = (t: SetTotals): number => t.specials.filter((x) => x.from !== 'bonus').length
/** The set bonus's part, always signed ("+4", "−40%"). */
const bonusAmount = (row: CompareRow, bonus: number): string => statAmount(row.stat === 'defense' ? 'defense-flat' : row.stat, bonus)

export function ArmorCompare({ set, sets, state, onChange }: ArmorCompareProps) {
  const pickId = useId()
  const aHelmetId = useId()
  const bHelmetId = useId()
  const { other, a, b, rows } = state
  // "Clear comparison" removes itself with the table: focus returns to the set picker, never to <body>
  const pickRef = useRef<HTMLSelectElement>(null)
  // every other set, grouped by its verified stage (then "Stage unknown"), by name
  const groups = [...STAGES.map((s) => ({ id: s.id as string, label: s.label })), { id: 'unknown', label: 'Stage unknown' }]
    .map((g) => ({ ...g, sets: [...sets.values()].filter((s) => s.id !== set.id && (verifiedStage(s) ?? 'unknown') === g.id).sort((x, y) => x.name.localeCompare(y.name)) }))
    .filter((g) => g.sets.length > 0)
  return (
    <PixelPanel as="section" aria-labelledby={ARMOR_COMPARE_ID} className="space-y-4" data-armor-compare={other?.id ?? ''}>
      <h2 id={ARMOR_COMPARE_ID} tabIndex={-1} className={SECTION_TITLE}>
        {copy.COMPARE_HEADING}
      </h2>
      <p className="max-w-prose text-sm text-fg-muted">{copy.COMPARE_INTRO}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={pickId} className={FIELD_LABEL}>
            {copy.COMPARE_PICK_LABEL}
          </label>
          <select ref={pickRef} id={pickId} value={other?.id ?? ''} onChange={(e) => onChange({ vs: e.target.value || null, vshelmet: null })} className={FIELD} data-compare-pick="">
            <option value="">{copy.COMPARE_PICK_NONE}</option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {state.aVariants.length > 1 ? <HelmetPick id={aHelmetId} label={copy.HELMET_PICK_LABEL(set.name, pickNoun(set))} variants={state.aVariants} value={state.aVariant} onPick={(key) => onChange({ helmet: key })} /> : null}
        {other && state.bVariant && state.bVariants.length > 1 ? (
          <HelmetPick id={bHelmetId} label={copy.HELMET_PICK_LABEL(other.name, pickNoun(other))} variants={state.bVariants} value={state.bVariant} onPick={(key) => onChange({ vshelmet: key })} />
        ) : null}
      </div>

      {other && b && rows ? (
        <div className="space-y-3">
          <table className="w-full table-fixed text-sm" data-compare-table="">
            <caption className="sr-only">{copy.compareCaption(set.name, other.name)}</caption>
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[31%]" />
              <col className="w-[31%]" />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-panel-border text-left align-bottom">
                <th scope="col" className="py-2 pr-2 text-xs font-semibold text-fg-muted">
                  {copy.STAT_COLUMN}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold break-words">
                  {set.name}
                  {state.aVariants.length > 1 ? <span className="block text-xs font-normal text-fg-muted">{a.variant.label}</span> : null}
                </th>
                <th scope="col" className="px-2 py-2 font-semibold break-words">
                  <Link to={armorSetHref(other.id)} className={LINK}>
                    {other.name}
                  </Link>
                  {state.bVariants.length > 1 ? <span className="block text-xs font-normal text-fg-muted">{b.variant.label}</span> : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-border align-top" data-compare-row={row.key} {...(row.bonusChangesOrder ? { 'data-bonus-changes': '' } : {})}>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-fg-muted">
                    {rowLabel(row)}
                  </th>
                  <ValueCell row={row} cell={row.a} field={`compare:${row.key}:a`} sourceUrl={set.wikiUrl} />
                  <ValueCell row={row} cell={row.b} field={`compare:${row.key}:b`} sourceUrl={other.wikiUrl} />
                </tr>
              ))}
              <tr className="border-t border-border align-top">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-fg-muted">
                  {copy.BONUS_HEADING}
                </th>
                <td className="px-2 py-1.5 break-words">
                  <WikiQuote text={a.variant.setBonusText} />
                </td>
                <td className="px-2 py-1.5 break-words">
                  <WikiQuote text={b.variant.setBonusText} />
                </td>
              </tr>
              {/* the pieces' own text effects — the set bonus's are quoted in the row above, never counted twice */}
              {pieceSpecials(a) + pieceSpecials(b) > 0 ? (
                <tr className="border-t border-border align-top" data-compare-row="piece-specials">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-fg-muted">
                    {copy.SPECIALS_ROW}
                  </th>
                  <td className="px-2 py-1.5">{copy.specialsCount(pieceSpecials(a))}</td>
                  <td className="px-2 py-1.5">{copy.specialsCount(pieceSpecials(b))}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <BonusNotes rows={rows} names={[set.name, other.name]} />
          {rows.some((r) => r.a.kind === 'unknown' || r.b.kind === 'unknown') ? <p className="text-xs text-fg-muted">{copy.UNKNOWN_COMPARE}</p> : null}
          <button
            type="button"
            onClick={() => {
              onChange({ vs: null, vshelmet: null })
              pickRef.current?.focus()
            }}
            className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)}
            data-compare-clear=""
          >
            <X aria-hidden="true" className="size-4" />
            {copy.COMPARE_CLEAR}
          </button>
        </div>
      ) : null}
    </PixelPanel>
  )
}

function HelmetPick({ id, label, variants, value, onPick }: { id: string; label: string; variants: readonly SetVariant[]; value: SetVariant; onPick: (key: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <select id={id} value={value.key} onChange={(e) => onPick(e.target.value)} className={FIELD}>
        {variants.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label} ({classWords(v.classes).toLowerCase()})
          </option>
        ))}
      </select>
    </div>
  )
}

function ValueCell({ row, cell, field, sourceUrl }: { row: CompareRow; cell: CompareCell; field: string; sourceUrl: string }) {
  if (cell.kind === 'unknown') {
    return (
      <td className="bg-hatch-unknown px-2 py-1.5">
        <UnknownValue field={field} sourceUrl={sourceUrl} inCell />
      </td>
    )
  }
  if (cell.kind === 'none') return <td className="px-2 py-1.5 text-fg-muted">{copy.NONE_CELL}</td>
  return (
    <td className="px-2 py-1.5 tabular-nums">
      <span className="font-semibold">{amount(row, cell.total)}</span>
      {cell.bonus !== 0 ? <span className="block text-xs text-fg-muted">{copy.breakdown(cell.pieces === 0 ? undefined : amount(row, cell.pieces), bonusAmount(row, cell.bonus))}</span> : null}
    </td>
  )
}

/**
 * In words, each stat where the set bonuses change the picture (AC2's "a set whose bonus changes the comparison"):
 * stated for stats counted upward (defense, damage, slots …); a reduction kind (mana cost) keeps its numbers in the
 * table, where the sign says it.
 */
function BonusNotes({ rows, names }: { rows: readonly CompareRow[]; names: [string, string] }) {
  const notes = rows.flatMap((row) => {
    if (!row.bonusChangesOrder) return []
    const v = (c: CompareCell) => (c.kind === 'value' ? c : { total: 0, pieces: 0, bonus: 0 })
    const a = v(row.a)
    const b = v(row.b)
    if (Math.min(a.total, b.total, a.pieces, b.pieces) < 0) return []
    const label = rowLabel(row)
    const piecesMore = a.pieces === b.pieces ? undefined : a.pieces > b.pieces ? names[0] : names[1]
    if (a.total === b.total) return piecesMore ? [{ key: row.key, text: copy.bonusEvens(label, piecesMore) }] : []
    return [{ key: row.key, text: copy.bonusChanges(label, a.total > b.total ? names[0] : names[1], piecesMore) }]
  })
  if (notes.length === 0) return null
  return (
    <ul className="space-y-1 border-l-4 border-gold-600 bg-night-900 px-3 py-2 text-sm" data-bonus-notes="">
      {notes.map((n) => (
        <li key={n.key}>{n.text}</li>
      ))}
    </ul>
  )
}
