import { ChevronRight, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../../components/cx'
import { PixelPanel } from '../../../components/PixelPanel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { UnknownValue } from '../../../components/UnknownValue'
import type { Boss, ConditionIndex, DropSource, SpriteIndex } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import { DIFFICULTY_LABELS, dropSourceUrl, formatQuantity, formatRate, humanizeSlug } from '../db/weapons/weaponDisplay'
import { ItemCell, PanelHeading, SourceIconLink } from './BossBits'
import { dropCells, type DropCellView, type DropGroup, type DropRow, type DropSections, type DropTier } from './bossPageModel'

/**
 * DropsTable (UX_SPEC §3.7; PRD P5-S2 AC1/AC4): every drop record of the boss (Boss.dropIds →
 * drops.json), one row per record, read in the page model's order (H2): rewards (Treasure Bag
 * first), then materials & supplies, each item's records together — the boss's own row, its
 * per-segment rows (labelled, they add to the whole boss's drop), the Treasure Bag's. Records whose
 * conditions are Unknown sit apart in a COLLAPSED group that says up front that their chance only
 * applies under those unverified conditions. Per difficulty: the verified chance (+ quantity) or
 * UnknownValue (hatched cell), "n/a" where the drop doesn't apply. Each row carries its own source
 * link (the drop record's wiki page). Values are read through getField on the DROP record.
 */
export const CONDITIONAL_SUMMARY = 'Condition-dependent drops (conditions not verified)'
export const CONDITIONAL_QUALIFIER =
  'Each chance in this group applies only when that drop’s conditions are met — and those conditions couldn’t be verified. Don’t count on these drops from a normal fight.'

const TIER_LABEL: Readonly<Record<Exclude<DropTier, 'conditional'>, string>> = { rewards: 'Rewards', materials: 'Materials & supplies' }

export function BossDrops({ boss, sections, conditions, sprites, titleId }: { boss: Boss; sections: DropSections; conditions: ConditionIndex; sprites: SpriteIndex | null; titleId: string }) {
  const { tiers, rows, missing } = sections
  const conditionalRecords = tiers.conditional.reduce((n, g) => n + g.rows.length, 0)
  const shared = { bossName: boss.name, conditions, sprites }
  return (
    <PixelPanel as="section" aria-labelledby={titleId} data-section="drops" className="space-y-4">
      <PanelHeading id={titleId} aside={<span className="text-fg-muted">{rows.length} drop records</span>}>
        Drops
      </PanelHeading>
      <p className="text-sm text-fg-muted">
        Chance and quantity per difficulty. Expert and Master drops usually come from the Treasure Bag.
      </p>
      {rows.length === 0 ? (
        <p className="text-fg-muted">No drop records are linked to this boss.</p>
      ) : (
        <>
          {tiers.rewards.length + tiers.materials.length > 0 ? (
            <DropTable caption={`Drops of ${boss.name}: chance and quantity by difficulty, with each row’s source`}>
              {(['rewards', 'materials'] as const).map((tier) =>
                tiers[tier].length > 0 ? (
                  <tbody key={tier} data-drop-tier={tier}>
                    <tr>
                      <th colSpan={4} scope="rowgroup" className="pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase">
                        {TIER_LABEL[tier]}
                      </th>
                    </tr>
                    {tiers[tier].map((group) => (
                      <DropGroupRows key={`${group.item.id}`} group={group} {...shared} />
                    ))}
                  </tbody>
                ) : null,
              )}
            </DropTable>
          ) : null}
          {tiers.conditional.length > 0 ? (
            // Phones: dashed rules above and below only, so the table inside keeps the main table's full width.
            <details data-drop-tier="conditional" className="group border-y-2 border-dashed border-stone-500 bg-night-900 md:border-x-2">
              <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-1 py-2 font-semibold hover:text-accent-strong md:px-3 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-(--dur-ui) group-open:rotate-90" />
                <span className="min-w-0 flex-1">{CONDITIONAL_SUMMARY}</span>
                <span className="shrink-0 text-sm font-normal text-fg-muted">{conditionalRecords}</span>
              </summary>
              <div className="space-y-3 pb-3 md:px-3">
                <p data-conditional-qualifier="" className="flex gap-2 border-l-4 border-gate bg-earth-900 p-2 text-sm font-semibold">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
                  {CONDITIONAL_QUALIFIER}
                </p>
                <DropTable caption={`Drops of ${boss.name} that depend on unverified conditions: chance and quantity by difficulty`}>
                  <tbody data-drop-tier="conditional">
                    {tiers.conditional.map((group) => (
                      <DropGroupRows key={`${group.item.id}`} group={group} {...shared} />
                    ))}
                  </tbody>
                </DropTable>
              </div>
            </details>
          ) : null}
        </>
      )}
      {missing > 0 ? <p className="text-sm text-fg-muted">{missing === 1 ? 'One drop record isn’t' : `${missing} drop records aren’t`} in the loaded drop data.</p> : null}
      <ProvenanceLink href={boss.wikiUrl} srContext={`for the drops of ${boss.name}`} />
    </PixelPanel>
  )
}

/** Fixed layout: the item column takes what the three difficulty columns leave. */
function DropTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      {/* Phones: three 24% difficulty columns fit an Unknown marker and a "× Unknown" quantity line from a
          292px table (360px screen) up; from md the item column takes more. */}
      <colgroup>
        <col />
        <col className="w-[24%] md:w-[15%]" />
        <col className="w-[24%] md:w-[15%]" />
        <col className="w-[24%] md:w-[15%]" />
      </colgroup>
      <thead>
        <tr className="text-left text-xs text-fg-muted">
          <th scope="col" className="py-1 pr-2 font-semibold">
            Item
          </th>
          {(['classic', 'expert', 'master'] as const).map((d) => (
            <th key={d} scope="col" className="px-0.5 py-1 font-semibold md:px-2">
              {DIFFICULTY_LABELS[d]}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  )
}

type Shared = { bossName: string; conditions: ConditionIndex; sprites: SpriteIndex | null }

/** One item's records: the first row names the item; the rest read as indented sub-rows of it. */
function DropGroupRows({ group, ...shared }: { group: DropGroup } & Shared) {
  return (
    <>
      {group.rows.map((row, i) => (
        <DropTableRow key={row.drop.id} row={row} first={i === 0} group={group} {...shared} />
      ))}
      {group.segmented ? (
        <tr data-segment-note={group.item.id}>
          <td colSpan={4} className="pb-2 pl-4 text-xs text-fg-muted">
            Each segment’s drop comes on top of the whole boss’s drop: these rows add up, none is a total of the others.
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** What a row is, in words: its source within the boss's fight. */
function roleLabel(row: DropRow, group: DropGroup, bossName: string): string | undefined {
  switch (row.role) {
    case 'bag':
      return 'Treasure Bag'
    case 'segment':
      return `Per segment: ${row.part}`
    case 'variant':
      return `From ${row.drop.source.npcName}`
    case 'boss':
      return group.segmented ? 'On defeat (whole boss)' : row.drop.source.npcName === bossName ? undefined : `From ${row.drop.source.npcName}`
  }
}

function DropTableRow({ row, first, group, bossName, conditions, sprites }: { row: DropRow; first: boolean; group: DropGroup } & Shared) {
  const { drop } = row
  const source = dropSourceUrl(drop)
  const conditionView = getField(drop, 'conditions')
  const label = roleLabel(row, group, bossName)
  const tag = label === undefined ? null : row.role === 'bag' ? <BagTag className="font-semibold" /> : <span>{label}</span>
  const meta = (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
      {first ? tag : null}
      {conditionView.status === 'unverified' ? (
        <span>
          Only when: <UnknownValue field={`drop:${drop.id}:conditions`} sourceUrl={source} />
        </span>
      ) : drop.conditions.length > 0 ? (
        <span>Only: {drop.conditions.map((c) => conditions.byId.get(c)?.name ?? humanizeSlug(c)).join(', ')}</span>
      ) : null}
      {source ? <SourceIconLink href={source} srLabel={`Source for the ${row.item.name} drop${label ? ` (${label})` : ''}`} /> : null}
    </span>
  )
  return (
    <tr data-drop-row={drop.id} data-drop-role={row.role} className={cx('align-top', first && 'border-t border-border')}>
      <th scope="row" className="py-1 pr-2 text-left font-normal">
        {first ? (
          <ItemCell item={row.item} sprites={sprites} slotFromMd />
        ) : (
          // A sub-row of the item above: indented, named for screen readers, labelled by its source.
          <span className="flex min-h-8 items-center border-l-2 border-panel-border pl-2 text-xs font-semibold text-fg">
            <span className="sr-only">{row.item.name}, </span>
            {row.role === 'bag' ? <BagTag /> : label}
          </span>
        )}
        <span className={cx(!first && 'block pl-2.5')}>{meta}</span>
      </th>
      {dropCells(drop).map((cell) => (
        <DropCellTd key={cell.difficulty} drop={drop} cell={cell} source={source} />
      ))}
    </tr>
  )
}

/** The Treasure Bag tag; phones show "Bag" (the item column is narrow there), screen readers always hear the full name. */
function BagTag({ className }: { className?: string }) {
  return (
    <span className={cx('border-2 border-stone-600 px-1 leading-4 whitespace-nowrap', className)}>
      <span className="max-md:sr-only">Treasure </span>Bag
    </span>
  )
}

function DropCellTd({ drop, cell, source }: { drop: DropSource; cell: DropCellView; source: string | undefined }) {
  const rate = cell.rate.view
  const quantity = cell.quantity?.view
  const unknownRate = rate.status === 'unverified'
  const quantityText = quantity?.status === 'verified' || quantity?.status === 'editorial' ? formatQuantity(quantity.value as { min: number; max: number }) : undefined
  return (
    // Unknown markers in a cell keep 2px side padding (not 4px) so they stay inside the cell's content box (M8).
    <td
      data-cell={`${cell.difficulty}`}
      data-rate={unknownRate ? 'unknown' : rate.status === 'not-applicable' ? 'n/a' : String(rate.value)}
      className={cx('px-0.5 py-1.5 max-md:text-xs md:px-2 [&_[data-unknown-field]]:px-0.5', unknownRate && 'bg-hatch-unknown')}
    >
      {unknownRate ? (
        <UnknownValue field={`drop:${drop.id}:${cell.rate.field}`} sourceUrl={source} inCell />
      ) : rate.status === 'not-applicable' ? (
        <span className="text-fg-muted">
          n/a<span className="sr-only"> (not applicable)</span>
        </span>
      ) : (
        <span className="tabular-nums">{formatRate(rate.value as number)}</span>
      )}
      {quantity === undefined || quantity.status === 'not-applicable' ? null : quantity.status === 'unverified' ? (
        <span className="block text-[0.6875rem] leading-4 whitespace-nowrap">
          <span className="sr-only">Quantity: </span>
          <span aria-hidden="true">×&nbsp;</span>
          <UnknownValue field={`drop:${drop.id}:${cell.quantity?.field}`} sourceUrl={source} interactive={false} />
        </span>
      ) : quantityText !== undefined && quantityText !== '1' ? (
        // One unbreakable line (M8): "× 500–600" never splits at the dash.
        <span data-quantity="" className="block text-[0.6875rem] leading-4 whitespace-nowrap text-fg-muted tabular-nums">
          <span className="sr-only">Quantity: </span>×&nbsp;{quantityText}
        </span>
      ) : null}
    </td>
  )
}
