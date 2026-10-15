import { ArrowLeftRight, FlaskConical, Minus, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../../components/buttonStyles'
import { ConditionChip } from '../../../../components/ConditionChip'
import { cx } from '../../../../components/cx'
import { EstimateLabel } from '../../../../components/EstimateLabel'
import { GateBadge } from '../../../../components/GateBadge'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityColor } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { ConditionIndex, ProgressionData, SpriteIndex, Weapon } from '../../../../data-access/types'
import { labWeaponSearch, offersLab } from '../../../../lab/labLinks'
import { effectiveProgress, type TrackedProgress } from '../../../../scoring/progress'
import { hasRoute, pathFor } from '../../../routes'
import { bossMapHref, bossPageHref } from '../../bosses/bossNav'
import { ClassBadge } from '../weapons/WeaponBits'
import { humanizeSlug } from '../weapons/weaponDisplay'
import { weaponHref } from '../weapons/weaponNav'
import * as copy from './compareCopy'
import {
  acquisitionCell,
  changeButtonId,
  columnUnknowns,
  dppCell,
  gatingCell,
  prosCons,
  removeButtonId,
  shownStatKeys,
  STAT_GROUPS,
  statCell,
  tooltipCell,
  type GatingCell,
  type StatCell,
  type StatGroupId,
  type StatKey,
} from './compareModel'

/**
 * CompareTable (UX_SPEC §3.6, §7, §8; PRD P4-S1 AC1–AC4): one column per weapon, one row per stat, in a
 * real table (column headers = weapons, row headers = stats, a row group per section). Every cell comes
 * from ./compareModel — Unknown cells carry the hatch + UnknownValue, the damage rate its EstimateLabel
 * with a populated AssumptionsTip, gates the shared GateBadge / ConditionChip against TRACKED defeats.
 * No cell is styled to single out a weapon: the layout shows differences, never a pick.
 *
 * Layout (UX_SPEC §7 Compare): below md one weapon "card" per view beside a sticky stat-label rail,
 * snap-scrolling sideways; 768–1023 two columns per view; ≥1024 three. Column widths come from the
 * scroll region's own width (container units), so the page never scrolls sideways at 375px. On desktop
 * one or two weapons share the full width, so the table fills its frame (AMENDMENTS-016 B101b).
 */
export interface CompareTableProps {
  weapons: readonly Weapon[]
  graph: ProgressionData
  conditions: ConditionIndex
  sprites: SpriteIndex | null
  progress: TrackedProgress
  onChange?: (weapon: Weapon) => void
  onRemove?: (weapon: Weapon) => void
}

// The stat-label rail and the weapon columns (UX_SPEC §7: 1 / 2 / 3 weapons per view).
const RAIL = 'sticky left-0 z-[1] w-30 bg-panel md:w-40 lg:w-44'
const COLUMN = 'w-[calc(100cqw-7.5rem)] md:w-[calc((100cqw-10rem)/2)]'
/** ≥1024: the columns split the width beside the rail by how many weapons there are (B101b: no dead band). */
const COLUMN_LG: Readonly<Record<number, string>> = {
  1: 'lg:w-[calc(100cqw-11rem)]',
  2: 'lg:w-[calc((100cqw-11rem)/2)]',
  3: 'lg:w-[calc((100cqw-11rem)/3)]',
}
const CELL = 'border-t-2 border-panel-border px-3 py-2.5 align-top'
const ROW_HEAD = cx(RAIL, CELL, 'text-left text-sm font-normal text-fg-muted')
const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

export function CompareTable({ weapons, graph, conditions, sprites, progress, onChange, onRemove }: CompareTableProps) {
  const ep = effectiveProgress(graph, progress)
  const memo = new Map<string, boolean>()
  const statKeys = shownStatKeys(weapons)
  const columns = weapons.map((w) => {
    const gating = gatingCell(w, graph, ep, memo)
    return { w, gating, unknowns: columnUnknowns(w, statKeys, gating) }
  })
  const span = weapons.length + 1
  const column = cx(COLUMN, COLUMN_LG[Math.min(weapons.length, 3)])
  const groupLabel = (id: StatGroupId) => STAT_GROUPS.find((g) => g.id === id)?.label ?? ''
  const statRows = (id: StatGroupId) =>
    (STAT_GROUPS.find((g) => g.id === id)?.keys ?? [])
      .filter((key) => statKeys.includes(key))
      .map((key) => (
        <Row key={key} label={copy.ROW_LABELS[key]} rowKey={key}>
          {weapons.map((w) => (
            <StatTd key={w.id} weapon={w} cell={statCell(w, key)} statKey={key} />
          ))}
        </Row>
      ))

  return (
    <div
      role="region"
      aria-label={copy.TABLE_CAPTION}
      // Keyboard users can scroll the region sideways (it is focusable only to scroll).
      tabIndex={0}
      // `relative`: the containing block of the cells' absolutely positioned sr-only text, so the region
      // clips it too — otherwise an off-screen column's sr-only spans widen the page at 375px.
      className="@container relative snap-x snap-mandatory scroll-pl-30 overflow-x-auto overscroll-x-contain border-2 border-panel-border bg-panel shadow-pixel md:scroll-pl-40 lg:scroll-pl-44"
    >
      <table data-compare-table={weapons.map((w) => w.id).join(',')} className="w-max table-fixed border-collapse text-left">
        <caption className="sr-only">{copy.TABLE_CAPTION}</caption>
        <thead>
          <tr>
            {/* The corner names the row-header column (B101d): a real column header, read only by screen readers. */}
            <th scope="col" className={cx(RAIL, 'px-3 pt-3 pb-2 text-left font-normal')} data-stat-corner="">
              <span className="sr-only">{copy.STAT_COLUMN}</span>
            </th>
            {weapons.map((w) => (
              <th key={w.id} scope="col" data-column={w.id} className={cx(column, 'snap-start px-3 pt-3 pb-2 align-top font-normal')}>
                <ColumnHeading weapon={w} sprites={sprites} />
              </th>
            ))}
          </tr>
          {onChange || onRemove ? (
            <tr>
              <td className={cx(RAIL, 'px-3 pb-3')} />
              {weapons.map((w) => (
                <td key={w.id} className="px-3 pb-3 align-top">
                  <div className="flex flex-wrap gap-2">
                    {onChange ? (
                      <button type="button" id={changeButtonId(w.id)} onClick={() => onChange(w)} className={buttonClass('secondary', 'flex-1 px-3')}>
                        <ArrowLeftRight aria-hidden="true" className="size-4" />
                        <span aria-hidden="true">{copy.CHANGE}</span>
                        <span className="sr-only">{copy.changeSr(w.name)}</span>
                      </button>
                    ) : null}
                    {onRemove ? (
                      <button type="button" id={removeButtonId(w.id)} onClick={() => onRemove(w)} className={buttonClass('secondary', 'flex-1 px-3')}>
                        <X aria-hidden="true" className="size-4" />
                        <span aria-hidden="true">{copy.REMOVE}</span>
                        <span className="sr-only">{copy.removeSr(w.name)}</span>
                      </button>
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
          ) : null}
        </thead>

        <RowGroup label={groupLabel('stats')} span={span}>
          {statRows('stats')}
        </RowGroup>
        {/* The estimate sits right after the stats it is computed from. */}
        <RowGroup label={copy.GROUP_ESTIMATE} span={span}>
          <Row label={copy.ROW_LABELS.dpp} note={copy.ROW_NOTES.dpp} rowKey="dpp">
            {weapons.map((w) => (
              <DppTd key={w.id} weapon={w} />
            ))}
          </Row>
        </RowGroup>
        <RowGroup label={groupLabel('costs')} span={span}>
          {statRows('costs')}
        </RowGroup>
        <RowGroup label={groupLabel('progress')} span={span}>
          {statRows('progress')}
          <Row label={copy.ROW_LABELS.gating} note={copy.ROW_NOTES.gating} rowKey="gating">
            {columns.map(({ w, gating }) => (
              <td key={w.id} className={cx(CELL, gating.kind === 'unknown' && 'bg-hatch-unknown')}>
                <GatingView weapon={w} cell={gating} graph={graph} conditions={conditions} />
              </td>
            ))}
          </Row>
          <Row label={copy.ROW_LABELS.acquisition} rowKey="acquisition">
            {weapons.map((w) => (
              <AcquisitionTd key={w.id} weapon={w} />
            ))}
          </Row>
        </RowGroup>

        <RowGroup label={copy.GROUP_BEHAVIOR} span={span}>
          <Row label={copy.ROW_LABELS.tooltip} rowKey="tooltip">
            {weapons.map((w) => (
              <TooltipTd key={w.id} weapon={w} />
            ))}
          </Row>
          <Row label={copy.ROW_LABELS.lab} rowKey="lab">
            {weapons.map((w) => (
              <td key={w.id} className={CELL}>
                <LabCell weapon={w} />
              </td>
            ))}
          </Row>
        </RowGroup>

        <RowGroup label={copy.GROUP_NOTES} span={span}>
          {(['pros', 'cons'] as const).map((side) => (
            <Row key={side} label={copy.ROW_LABELS[side]} rowKey={side}>
              {weapons.map((w) => (
                <td key={w.id} className={CELL}>
                  <ProsConsList lines={prosCons(w)[side]} side={side} />
                </td>
              ))}
            </Row>
          ))}
          <Row label={copy.ROW_LABELS.source} rowKey="source">
            {columns.map(({ w, unknowns }) => (
              <td key={w.id} className={CELL} data-source-cell={w.id}>
                <div className="flex flex-col items-start gap-1">
                  <ProvenanceLink href={w.wikiUrl} srContext={copy.SOURCE_SR(w.name)} />
                  <PartiallyVerifiedBadge items={unknowns} />
                </div>
              </td>
            ))}
          </Row>
        </RowGroup>
      </table>
    </div>
  )
}

function RowGroup({ label, span, children }: { label: string; span: number; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <th scope="rowgroup" colSpan={span} className="border-t-2 border-panel-border bg-night-900 p-0 text-left">
          {/* The group name stays in view while the columns scroll sideways. */}
          <span className="sticky left-0 inline-block px-3 py-2 font-display text-xs leading-relaxed text-accent">{label}</span>
        </th>
      </tr>
      {children}
    </tbody>
  )
}

function Row({ label, note, rowKey, children }: { label: string; note?: string; rowKey: string; children: ReactNode }) {
  return (
    <tr data-row={rowKey}>
      <th scope="row" className={ROW_HEAD}>
        <span className="block font-semibold text-fg">{label}</span>
        {note ? <span className="mt-0.5 block text-xs">{note}</span> : null}
      </th>
      {children}
    </tr>
  )
}

function ColumnHeading({ weapon, sprites }: { weapon: Weapon; sprites: SpriteIndex | null }) {
  return (
    <Link to={weaponHref(weapon.id)} className={cx('flex min-h-tap items-center gap-3', LINK)}>
      <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
        <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={48} />
      </span>
      <span className="min-w-0">
        <RarityText rarity={asRarity(weapon.rarity)} className="font-semibold">
          {weapon.name}
        </RarityText>
        <span className="sr-only">, {copy.OPEN_PAGE_SR}</span>
      </span>
    </Link>
  )
}

function StatTd({ weapon, cell, statKey }: { weapon: Weapon; cell: StatCell; statKey: StatKey }) {
  return (
    <td className={cx(CELL, cell.kind === 'unknown' && 'bg-hatch-unknown')} data-cell={`${statKey}:${weapon.id}`}>
      <StatValue weapon={weapon} cell={cell} />
    </td>
  )
}

function StatValue({ weapon, cell }: { weapon: Weapon; cell: StatCell }) {
  switch (cell.kind) {
    case 'unknown':
      return <UnknownValue field={cell.field} sourceUrl={weapon.wikiUrl} inCell />
    case 'none':
      return <span className="text-fg-muted">{cell.text}</span>
    case 'not-applicable':
      return (
        <span data-not-applicable={cell.field}>
          <span className="font-semibold">{copy.NOT_APPLICABLE}</span>
          <span className="mt-0.5 block text-xs text-fg-muted">{cell.reason}</span>
        </span>
      )
    case 'value':
      if (cell.damageClass) return <ClassBadge damageClass={cell.damageClass} />
      if (cell.rarity !== undefined) {
        return (
          <span className="inline-flex items-center gap-2 font-semibold">
            <span aria-hidden="true" className="size-3 shrink-0 border-2 border-night-950" style={{ backgroundColor: rarityColor(cell.rarity) }} />
            {cell.text}
          </span>
        )
      }
      return <span className="font-semibold tabular-nums">{cell.text}</span>
  }
}

function DppTd({ weapon }: { weapon: Weapon }) {
  const cell = dppCell(weapon)
  return (
    <td className={CELL} data-dpp-cell={weapon.id}>
      {cell.kind === 'estimate' ? (
        <>
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="text-lg font-semibold tabular-nums" data-dpp={cell.text}>
              {cell.text}
            </span>
            <EstimateLabel assumptions={cell.assumptions} context={copy.dppContext(weapon.name)} />
          </span>
          {/* B101a: the same secondary line as "Not applicable" / "Not estimated" — what the number assumes here. */}
          {cell.qualifier ? (
            <span className="mt-0.5 block text-xs text-fg-muted" data-dpp-qualifier="">
              {cell.qualifier}
            </span>
          ) : null}
        </>
      ) : (
        <span data-dpp-none={cell.kind}>
          <span className="font-semibold">{copy.DPP_NOT_ESTIMATED}</span>
          <span className="mt-0.5 block text-xs text-fg-muted">{cell.kind === 'summon' ? copy.DPP_SUMMON_REASON : copy.dppMissingReason(cell.fields)}</span>
        </span>
      )}
    </td>
  )
}

function GatingView({ weapon, cell, graph, conditions }: { weapon: Weapon; cell: GatingCell; graph: ProgressionData; conditions: ConditionIndex }) {
  if (cell.kind === 'unknown') return <UnknownValue field="gatedBy" sourceUrl={weapon.wikiUrl} inCell />
  const name = (id: string) => graph.nodeById.get(id)?.name ?? humanizeSlug(id)
  const chips = cell.conditions.map((slug) => {
    const condition = conditions.byId.get(slug)
    return <ConditionChip key={slug} name={condition?.name ?? humanizeSlug(slug)} href={condition?.wikiUrl} requires />
  })
  return (
    <div className="flex flex-col items-start gap-1.5" data-gating={cell.kind}>
      {cell.kind === 'gated' ? (
        <div className="flex flex-wrap gap-1.5">
          {cell.missing.map((id) => (
            <GateBadge key={id} name={name(id)} to={bossPageHref(id) ?? bossMapHref(id)} />
          ))}
        </div>
      ) : (
        <span className="text-sm">{cell.kind === 'none' ? copy.GATE_NONE : copy.gateMet(copy.andList(cell.bosses.map(name)))}</span>
      )}
      {chips.length > 0 ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null}
    </div>
  )
}

function AcquisitionTd({ weapon }: { weapon: Weapon }) {
  const cell = acquisitionCell(weapon)
  return (
    <td className={cx(CELL, cell.kind === 'unknown' && 'bg-hatch-unknown')}>
      {cell.kind === 'unknown' ? (
        <UnknownValue field="acquisition" sourceUrl={weapon.wikiUrl} inCell />
      ) : (
        <div className="space-y-1 text-sm">
          {cell.kind === 'none' ? (
            <p className="text-fg-muted">{copy.ACQUISITION_NONE}</p>
          ) : (
            <ul className="space-y-0.5">
              {cell.titles.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ul>
          )}
          <Link to={weaponHref(weapon.id)} className={cx('inline-flex min-h-tap items-center', LINK)}>
            {copy.ACQUISITION_DETAILS}
            <span className="sr-only"> ({weapon.name})</span>
          </Link>
        </div>
      )}
    </td>
  )
}

function TooltipTd({ weapon }: { weapon: Weapon }) {
  const cell = tooltipCell(weapon)
  return (
    <td className={cx(CELL, cell.kind === 'unknown' && 'bg-hatch-unknown')}>
      {cell.kind === 'unknown' ? (
        <UnknownValue field="behaviorText" sourceUrl={weapon.wikiUrl} inCell />
      ) : cell.kind === 'none' ? (
        <span className="text-sm text-fg-muted">{copy.NO_TOOLTIP}</span>
      ) : (
        // A15: wiki-derived text renders as text, never HTML.
        <p className="text-sm whitespace-pre-line" data-wiki-text="">
          {cell.text}
        </p>
      )}
    </td>
  )
}

/**
 * The Lab link for a weapon the Lab equips (same rule as SendToLabButton: the route ships AND the data
 * gives an archetype the Lab draws — src/lab/labLinks.ts, types-only, so this chunk never loads the sim).
 * Names its weapon for screen readers: several of these sit in one row.
 */
function LabCell({ weapon }: { weapon: Weapon }) {
  if (!hasRoute('lab') || !offersLab(weapon)) return <span className="text-sm text-fg-muted">{copy.LAB_NOT_SIMULATED}</span>
  return (
    <Link to={`${pathFor('lab')}${labWeaponSearch(weapon.id)}`} className={buttonClass('primary', 'w-full px-3')} data-send-to-lab={weapon.id}>
      <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
      {copy.LAB_TEST}
      <span className="sr-only"> ({weapon.name})</span>
    </Link>
  )
}

function ProsConsList({ lines, side }: { lines: readonly string[]; side: 'pros' | 'cons' }) {
  if (lines.length === 0) return <span className="text-sm text-fg-muted">{copy.PROS_CONS_NONE}</span>
  const Icon = side === 'pros' ? Plus : Minus
  return (
    <ul className="space-y-1 text-sm" data-pros-cons={side}>
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-1.5">
          <Icon aria-hidden="true" className={cx('mt-0.5 size-4 shrink-0', side === 'pros' ? 'text-success' : 'text-gate')} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}
