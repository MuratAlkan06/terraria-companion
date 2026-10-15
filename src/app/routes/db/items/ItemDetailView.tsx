import { ChevronDown, CircleHelp, ExternalLink, ImageOff, Info } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../../components/cx'
import { InventoryGrid } from '../../../../components/InventoryGrid'
import { ItemSlot } from '../../../../components/ItemSlot'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityColor, rarityLabel } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import type { SpriteFallback } from '../../../../components/spriteFallback'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { Item, SpriteIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { bossPageHref } from '../../bosses/bossNav'
import { GrindButton } from '../../plan/GrindLink'
import { humanizeSlug, sourceTitle, stageLabel } from '../weapons/weaponDisplay'
import { unknownCount } from '../weapons/weaponUnknowns'
import * as copy from './itemCopy'
import { CategoryBadge } from './ItemBits'
import { formatDuration, itemStatRows, itemUses, USED_IN_PREVIEW, usedInEntries, usedInLine } from './itemDisplay'
import { ITEM_STATS_TITLE_ID, ITEM_USED_TITLE_ID } from './itemNav'
import { refInfoFrom, type ItemSectionsData } from './itemsData'
import { itemPageUnknowns } from './itemUnknowns'

/**
 * Item page body (P6 encyclopedia, AMENDMENTS-016; UX_SPEC §3.10 ItemPage: effect, acquisition, progression
 * fit): DetailHeader, Stats (per category: tool / fishing / bait powers, ammo, healing, buffs granted, the
 * boss it summons, crafting-station role; hook / mount stats Unknown — never claimed not applicable), the
 * acquisition slot (how to obtain, incl. fishing routes with condition chips; required progress = progression
 * fit), "Used in" (every recipe using it, as links) and "Where this data comes from". Pure presentation over
 * one record + the loaded sections data, so tests render it for every category.
 */
export interface ItemDetailViewProps {
  item: Item
  sprites: SpriteIndex | null
  /** Data the sections below the header read (undefined while loading / on error). */
  sections: ItemSectionsData | undefined
  /** The "How to obtain" section (the page wraps AcquisitionView with its loading / error states). */
  acquisition: ReactNode
  /** The "Used in" section (likewise). */
  usedIn: ReactNode
}

export function ItemDetailView({ item, sprites, sections, acquisition, usedIn }: ItemDetailViewProps) {
  const unknowns = itemPageUnknowns(item, sections?.acquisition.drops, sections !== undefined)
  return (
    <div className="space-y-4 md:space-y-6">
      <DetailHeader item={item} sprites={sprites} unknowns={unknowns} />
      <StatsPanel item={item} sections={sections} />
      {acquisition}
      {usedIn}
      <SourcesPanel item={item} sprites={sprites} />
    </div>
  )
}

function HeaderFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</dt>
      <dd className="flex min-h-6 items-center">{children}</dd>
    </div>
  )
}

function DetailHeader({ item, sprites, unknowns }: { item: Item; sprites: SpriteIndex | null; unknowns: ReturnType<typeof itemPageUnknowns> }) {
  const rarityView = getField(item, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const stageView = getField(item, 'stage')
  // B113d M1: why the grey placeholder stands in, said beside it (first paint: a record without a sprite)
  const [fallback, setFallback] = useState<SpriteFallback | undefined>(item.sprite ? undefined : 'no-sprite')
  return (
    <PixelPanel as="header" className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <div className="grid size-28 shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
        {/* Detail page: always the full sprite file, never a thumbnail (B30). */}
        <SpriteImg src={item.sprite} sprites={sprites} placeholder="material" box={96} full maxScale={4} onFallback={setFallback} />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <h1 className="min-w-0 font-display text-base leading-relaxed md:text-2xl">
          <RarityText rarity={rarity} tooltip>
            {item.name}
          </RarityText>
        </h1>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          <HeaderFact label="Category">
            <CategoryBadge category={item.category} />
          </HeaderFact>
          {rarityView.status === 'not-applicable' ? null : (
            <HeaderFact label="Rarity">
              {rarityView.status === 'unverified' ? (
                <UnknownValue field="rarity" sourceUrl={item.wikiUrl} />
              ) : rarity === undefined ? (
                String(rarityView.value)
              ) : (
                <span className="inline-flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className="size-3 border-2 border-night-950" style={{ backgroundColor: rarityColor(rarity) }} />
                  {rarityLabel(rarity)}
                </span>
              )}
            </HeaderFact>
          )}
          {stageView.status === 'not-applicable' ? null : (
            <HeaderFact label="Game stage">
              {stageView.status === 'unverified' ? <UnknownValue field="stage" sourceUrl={item.wikiUrl} /> : <span className="font-semibold">{stageLabel(stageView.value as string)}</span>}
            </HeaderFact>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProvenanceLink href={item.wikiUrl} srContext={`for ${item.name}`} />
          <PartiallyVerifiedBadge items={unknowns} />
        </div>
        {/* PRD §9 Feature B AC5 / UX_SPEC §3.10 ItemPage "grind CTA": the item's plan (absent until the planner ships) */}
        <div className="flex flex-col gap-2 empty:hidden md:flex-row">
          <GrindButton id={item.id} name={item.name} className="w-full md:w-auto" />
        </div>
        {fallback ? (
          <p data-sprite-note={fallback} className="flex gap-2 text-sm text-fg-muted">
            <ImageOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {copy.SPRITE_FALLBACK[fallback]}
          </p>
        ) : null}
        {unknownCount(unknowns) >= 3 ? (
          <p data-unknown-heavy="" className="flex gap-2 text-sm text-fg-muted">
            <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-unknown" />
            {copy.UNKNOWN_HEAVY}
          </p>
        ) : null}
      </div>
    </PixelPanel>
  )
}

function StatsPanel({ item, sections }: { item: Item; sections: ItemSectionsData | undefined }) {
  const rows = itemStatRows(item)
  const buffs = getField(item, 'buffGrants')
  const summons = getField(item, 'summonsBossNode')
  const stationUses = item.isStation && sections?.acquisition.recipes ? itemUses(item.id, sections.acquisition.recipes.byId.values(), sections.acquisition.recipes.groups).filter((u) => u.role.kind === 'station').length : undefined
  const durations = buffs.status === 'verified' && (item.buffGrants ?? []).some((g) => g.durationTicks !== undefined)
  const empty = rows.length === 0 && buffs.status === 'not-applicable' && summons.status === 'not-applicable' && !item.isStation
  return (
    <PixelPanel as="section" aria-labelledby={ITEM_STATS_TITLE_ID} className="space-y-4">
      <h2 id={ITEM_STATS_TITLE_ID} tabIndex={-1} className="scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base">
        {copy.STATS_HEADING}
      </h2>
      {empty ? <p className="text-fg-muted">{copy.NO_STATS}</p> : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2.5 md:max-w-3xl md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {rows.map((row) => (
          <div key={row.key} className="contents" data-stat={row.key}>
            <dt className="text-fg-muted">{row.label}</dt>
            <dd className="font-semibold tabular-nums">{row.text ?? <UnknownValue field={row.field} sourceUrl={item.wikiUrl} />}</dd>
          </div>
        ))}
        {buffs.status === 'not-applicable' ? null : (
          <div className="contents" data-stat="buffs">
            <dt className="text-fg-muted">{copy.BUFFS_LABEL}</dt>
            <dd className="md:col-span-3">
              {buffs.status === 'unverified' ? (
                <UnknownValue field="buffGrants" sourceUrl={item.wikiUrl} />
              ) : (
                <ul className="space-y-1">
                  {(item.buffGrants ?? []).map((grant, i) => {
                    const buff = sections?.buffs.get(grant.buffId)
                    const duration = getField(item, `buffGrants.${i}.durationTicks`)
                    return (
                      <li key={grant.buffId} className="flex flex-wrap items-baseline gap-x-2">
                        {buff ? (
                          <a href={buff.wikiUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
                            {buff.name}
                            <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
                          </a>
                        ) : (
                          <span className="font-semibold">{humanizeSlug(grant.buffId)}</span>
                        )}
                        {duration.status === 'unverified' ? (
                          <span className="text-sm">
                            <span className="text-fg-muted">for </span>
                            <UnknownValue field={`buffGrants.${i}.durationTicks`} sourceUrl={item.wikiUrl} />
                          </span>
                        ) : duration.status === 'verified' ? (
                          <span className="text-sm text-fg-muted tabular-nums">for {formatDuration(duration.value as NonNullable<typeof grant.durationTicks>)}</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </dd>
          </div>
        )}
        {summons.status === 'not-applicable' ? null : (
          <div className="contents" data-stat="summons">
            <dt className="text-fg-muted">{copy.SUMMONS_LABEL}</dt>
            <dd className="font-semibold">
              {summons.status === 'unverified' ? <UnknownValue field="summonsBossNode" sourceUrl={item.wikiUrl} /> : <SummonedBoss node={summons.value as string} sections={sections} />}
            </dd>
          </div>
        )}
        {item.isStation ? (
          <div className="contents" data-stat="station">
            <dt className="text-fg-muted">{copy.STATION_LABEL}</dt>
            <dd className="md:col-span-3">{stationUses === undefined ? 'Yes' : copy.stationUses(stationUses)}</dd>
          </div>
        ) : null}
      </dl>
      {durations ? <p className="text-xs text-fg-muted">{copy.TICKS_NOTE}</p> : null}
      <ProvenanceLink href={item.wikiUrl} srContext={`stats for ${item.name}`} />
    </PixelPanel>
  )
}

function SummonedBoss({ node, sections }: { node: string; sections: ItemSectionsData | undefined }) {
  const name = sections?.acquisition.progression?.nodeById.get(node)?.name ?? humanizeSlug(node)
  const page = bossPageHref(node)
  return page ? (
    <Link to={page} className="text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  )
}

// --- "Used in" -------------------------------------------------------------------------------------

export function UsedInPanel({ item, sections, sprites, children }: { item: Item; sections: ItemSectionsData | undefined; sprites: SpriteIndex | null; children?: ReactNode }) {
  return (
    <PixelPanel as="section" aria-labelledby={ITEM_USED_TITLE_ID} className="space-y-4">
      <h2 id={ITEM_USED_TITLE_ID} tabIndex={-1} className="scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base">
        {copy.USED_IN_HEADING}
      </h2>
      {children ?? (sections ? <UsedInList item={item} sections={sections} sprites={sprites} /> : null)}
    </PixelPanel>
  )
}

function UsedInList({ item, sections, sprites }: { item: Item; sections: ItemSectionsData; sprites: SpriteIndex | null }) {
  const listId = useId()
  const [all, setAll] = useState(false)
  const recipes = sections.acquisition.recipes
  if (!recipes) return null
  const uses = itemUses(item.id, recipes.byId.values(), recipes.groups)
  if (uses.length === 0) return <p className="text-fg-muted">{copy.USED_IN_NONE}</p>
  const entries = usedInEntries(uses)
  const ingredient = uses.filter((u) => u.role.kind === 'ingredient').length
  const station = uses.length - ingredient
  const shown = all ? entries : entries.slice(0, USED_IN_PREVIEW)
  const info = refInfoFrom(sections.docs)
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        {copy.usedInSummary(ingredient, station)}
        {entries.length < uses.length ? (
          <span className="block" data-used-in-merged="">
            {copy.usedInMerged(entries.length, uses.length)}
          </span>
        ) : null}
      </p>
      <div id={listId}>
        <InventoryGrid label={`Recipes that use ${item.name}`} cellMinWidth="13rem">
          {shown.map((entry) => {
            const ref = info(entry.resultId)
            const name = sections.docs.get(`i:${entry.resultId}`)?.name ?? sections.acquisition.names?.byId.get(entry.resultId) ?? `Item #${entry.resultId}`
            return <UsedInCell key={entry.resultId} name={name} line={usedInLine(entry, item.name)} sprite={ref?.sprite} damageClass={ref?.damageClass} link={ref?.link} sprites={sprites} />
          })}
        </InventoryGrid>
      </div>
      {entries.length > USED_IN_PREVIEW ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((v) => !v)}
          className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
        >
          <ChevronDown aria-hidden="true" className={cx('size-5 shrink-0', all && 'rotate-180')} />
          {all ? copy.SHOW_FEWER : copy.showAll(entries.length)}
        </button>
      ) : null}
    </div>
  )
}

function UsedInCell({
  name,
  line,
  sprite,
  damageClass,
  link,
  sprites,
}: {
  name: string
  line: string
  sprite?: string
  damageClass?: string
  link?: { kind: 'internal'; to: string } | { kind: 'external'; href: string }
  sprites: SpriteIndex | null
}) {
  const slot = (
    <div aria-hidden="true" className="shrink-0">
      <ItemSlot item={{ name, sprite: damageClass ? <SpriteImg src={sprite} sprites={sprites} damageClass={damageClass} box={32} /> : <SpriteImg src={sprite} sprites={sprites} placeholder="material" box={32} /> }} />
    </div>
  )
  // Only the name is underlined: the amount line under it is plain text, not part of the link's look.
  const NAME = 'text-link underline decoration-1 underline-offset-4 group-hover:text-accent-strong'
  const text = (
    <span className="flex min-w-0 flex-col">
      <span className={link ? NAME : undefined}>{name}</span>
      <span className="text-xs text-fg-muted tabular-nums">{line}</span>
    </span>
  )
  const linkClass = 'group flex min-h-tap items-center gap-3'
  if (link?.kind === 'internal') {
    return (
      <Link to={link.to} data-used-in={name} className={linkClass}>
        {slot}
        {text}
      </Link>
    )
  }
  if (link?.kind === 'external') {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" data-used-in={name} className={linkClass}>
        {slot}
        <span className="flex min-w-0 flex-col">
          <span className={NAME}>
            {name}
            {/* B82: the ↗ glued to the name (an armor piece / accessory has no page here: its wiki article) */}
            <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5 align-baseline" />
            <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
          </span>
          <span className="text-xs text-fg-muted tabular-nums">{line}</span>
        </span>
      </a>
    )
  }
  return (
    <div data-used-in={name} className="flex min-h-tap items-center gap-3">
      {slot}
      {text}
    </div>
  )
}

// --- sources -------------------------------------------------------------------------------------

function SourcesPanel({ item, sprites }: { item: Item; sprites: SpriteIndex | null }) {
  const sprite = item.sprite ? sprites?.byPath.get(item.sprite) : undefined
  return (
    <details className="group border-2 border-panel-border bg-surface px-4 py-2 text-sm">
      <summary className="flex min-h-tap items-center justify-between gap-3 font-semibold text-fg-muted group-open:text-fg [&::-webkit-details-marker]:hidden">
        {copy.SOURCES_SUMMARY}
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform duration-(--dur-ui) ease-out-strong group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 pt-2 pb-2">
        {item._prov.sources.map((source, i) => {
          const { label, page } = sourceTitle(source)
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2" data-source-kind={source.kind}>
              <span>
                {label}
                {page ? (
                  <>
                    : <span className="font-semibold">{page}</span>
                  </>
                ) : null}
              </span>
              {source.rev ? <span className="text-fg-muted tabular-nums">rev {source.rev}</span> : null}
              <span className="text-fg-muted tabular-nums">fetched {source.fetchedAt}</span>
              <ProvenanceLink href={source.url} srContext={page ? `(${label}: ${page})` : `(${label})`} />
            </li>
          )
        })}
        {sprite && !sprites?.fallbackMode ? (
          <li className="flex flex-wrap items-center gap-x-2">
            <span>{copy.SPRITE_CREDIT}</span>
            <ProvenanceLink href={sprite.wikiFileUrl} label={copy.SPRITE_FILE} srContext={`for the ${item.name} sprite`} />
          </li>
        ) : !item.sprite ? (
          <li className="flex items-center gap-2 text-fg-muted" data-no-sprite="">
            <Info aria-hidden="true" className="size-4 shrink-0" />
            {copy.NO_SPRITE}
          </li>
        ) : null}
      </ul>
    </details>
  )
}
