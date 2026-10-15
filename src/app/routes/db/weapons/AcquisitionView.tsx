import { CircleHelp, ExternalLink, Fish, Hammer, Info, Lock, Package, Skull, Store, type LucideIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ConditionChip } from '../../../../components/ConditionChip'
import { cx } from '../../../../components/cx'
import { DerivedLabel } from '../../../../components/DerivedLabel'
import { InventoryGrid } from '../../../../components/InventoryGrid'
import { ItemSlot } from '../../../../components/ItemSlot'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { AcquisitionData } from '../../../../data-access'
import type { DropSource, Recipe, SpriteIndex, Weapon } from '../../../../data-access/types'
import { isModeledField } from '../../../../schemas/dropQuantity'
import { getField } from '../../../../schemas/getField'
import type { Acquisition } from '../../../../schemas'
import { itemHref } from '../items/itemNav'
import {
  DIFFICULTY_LABELS,
  dropSourceUrl,
  dropTableRows,
  formatCoins,
  formatQuantity,
  formatRate,
  groupDropSources,
  humanizeSlug,
  routeTitle,
  type DropCell,
} from './weaponDisplay'
import { weaponHref } from './weaponNav'

/**
 * AcquisitionSection body (PRD P2-S3 AC3, UX_SPEC §3.3): every route the record lists — craft
 * (station + materials as ItemSlots with exact quantities), drop (source + per-difficulty
 * verified rate or Unknown; identical tables grouped), purchase (vendor + price), loot,
 * fishing, other — plus required progress (gatedBy). An unverified acquisition renders the
 * honest "Ways to obtain: Unknown" state. No route is ever inferred: only what the datasets
 * say, read through getField. Every Unknown rendered here is also counted by
 * ./weaponUnknowns.ts for the partially-verified badge — change both together.
 *
 * Shared by the weapon pages and the item encyclopedia (P6, AMENDMENTS-016): any record with the shared
 * item core (`AcquirableRecord`). Materials and stations that are Item records link their item page; a
 * drop quantity derived by the B105 ruling shows "derived"; fishing routes show their conditions as
 * ConditionChips (linked to the condition's wiki article).
 */
/** A record with the shared item core (DATA_SCHEMA_SPEC §2.2): a weapon, an encyclopedia item, … */
export type AcquirableRecord = Pick<Weapon, 'id' | 'name' | 'wikiUrl' | 'acquisition' | 'gatedBy' | '_prov'>

/** What a page knows about a referenced item beyond its name: its sprite and its page (encyclopedia: from the search docs). */
export interface ItemRefInfo {
  sprite?: string
  /** Placeholder silhouette when it has no sprite. */
  damageClass?: string
  link?: { kind: 'internal'; to: string } | { kind: 'external'; href: string }
}

export interface AcquisitionViewProps {
  /** The record whose routes are shown (named `weapon` for the weapon pages that came first). */
  weapon: AcquirableRecord
  data: AcquisitionData | undefined
  weaponsById: ReadonlyMap<number, Weapon> | undefined
  sprites: SpriteIndex | null
  /** "weapon" (default) or "item": the record's noun in the page copy. */
  noun?: string
  /** Optional richer lookup for referenced items (sprite + page); the weapon pages go without it. */
  refInfo?: (itemId: number) => ItemRefInfo | undefined
}

type ConditionList = readonly string[]

const ROUTE_ICON: Record<Acquisition['method'], LucideIcon> = {
  craft: Hammer,
  drop: Skull,
  purchase: Store,
  loot: Package,
  fishing: Fish,
  other: Info,
}

export function AcquisitionView({ weapon, data, weaponsById, sprites, noun = 'weapon', refInfo }: AcquisitionViewProps) {
  const acquisition = getField(weapon, 'acquisition')
  const routes = acquisition.status === 'unverified' ? [] : weapon.acquisition

  return (
    <div className="space-y-5">
      {acquisition.status === 'unverified' ? (
        <AcquisitionUnknown weapon={weapon} />
      ) : routes.length === 0 ? (
        <p className="text-fg-muted">No ways to obtain this {noun} are listed in the dataset.</p>
      ) : (
        <ol className="space-y-5">
          {routes.map((route, index) => (
            <li key={index}>
              <RouteBlock weapon={weapon} route={route} index={index} data={data} weaponsById={weaponsById} sprites={sprites} refInfo={refInfo} />
            </li>
          ))}
        </ol>
      )}
      <GateRow weapon={weapon} data={data} />
    </div>
  )
}

function AcquisitionUnknown({ weapon }: { weapon: AcquirableRecord }) {
  return (
    <div className="flex gap-3 border-2 border-dashed border-stone-500 bg-hatch-unknown p-4">
      <CircleHelp aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-unknown" />
      <div className="space-y-2">
        <p className="font-semibold text-fg">
          Ways to obtain: <UnknownValue field="acquisition" sourceUrl={weapon.wikiUrl} />
        </p>
        <p className="text-sm text-fg-muted">
          How to get {weapon.name} hasn’t been verified against the wiki data yet, so no route is shown rather than a
          guessed one. The wiki page may describe it.
        </p>
      </div>
    </div>
  )
}

/** Route heading; the wording comes from `routeTitle` so the badge details name routes identically. */
function RouteHeading({ route }: { route: Acquisition }) {
  const Icon = ROUTE_ICON[route.method]
  return (
    <h3 className="flex items-center gap-2 font-semibold text-fg">
      <Icon aria-hidden="true" className="size-5 shrink-0 text-accent" />
      <span>{routeTitle(route)}</span>
    </h3>
  )
}

interface RouteProps {
  weapon: AcquirableRecord
  route: Acquisition
  index: number
  data: AcquisitionData | undefined
  weaponsById: ReadonlyMap<number, Weapon> | undefined
  sprites: SpriteIndex | null
  refInfo?: (itemId: number) => ItemRefInfo | undefined
}

function RouteBlock(props: RouteProps) {
  const { route } = props
  switch (route.method) {
    case 'craft':
      return <CraftRoute {...props} route={route} />
    case 'drop':
      return <DropRoute {...props} route={route} />
    case 'purchase':
      return <PurchaseRoute {...props} route={route} />
    case 'loot':
      return (
        <div className="space-y-2">
          <RouteHeading route={route} />
          <dl className="space-y-1 text-sm">
            {route.locations.length > 0 ? <InfoRow label="Locations">{route.locations.join(', ')}</InfoRow> : null}
            <ConditionsRow {...props} />
          </dl>
        </div>
      )
    case 'fishing':
      return (
        <div className="space-y-2">
          <RouteHeading route={route} />
          <dl className="space-y-1 text-sm">
            <InfoRow label="Where">{route.biomes.join(', ')}</InfoRow>
            <ConditionsRow {...props} chips />
          </dl>
        </div>
      )
    case 'other':
      return (
        <div className="space-y-2">
          <RouteHeading route={route} />
          <p className="text-sm whitespace-pre-line">{route.description}</p>
          <ProvenanceLink href={route.sourceUrl} />
        </div>
      )
  }
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-fg-muted">{label}:</dt>
      <dd>{children}</dd>
    </div>
  )
}

function conditionNames(slugs: ConditionList, data: AcquisitionData | undefined): string {
  return slugs.map((slug) => data?.conditions.byId.get(slug)?.name ?? humanizeSlug(slug)).join(', ')
}

/**
 * Route-level availability conditions (`acquisition.<i>.conditions`); omitted when verified-empty. `chips`
 * (fishing routes, P6 encyclopedia): each condition as a ConditionChip linking its wiki article — the
 * B69/Q4 "non-node requirement" treatment, never folded into "obtainable".
 */
function ConditionsRow({ weapon, index, data, chips = false }: RouteProps & { chips?: boolean }) {
  const field = `acquisition.${index}.conditions`
  const view = getField(weapon, field)
  if (view.status === 'not-applicable') return null
  if (view.status === 'unverified') {
    return (
      <InfoRow label="Conditions">
        <UnknownValue field={field} sourceUrl={weapon.wikiUrl} />
      </InfoRow>
    )
  }
  const slugs = view.value as ConditionList
  if (slugs.length === 0) return null
  if (!chips) return <InfoRow label="Conditions">{conditionNames(slugs, data)}</InfoRow>
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <dt className="text-fg-muted">Conditions:</dt>
      {slugs.map((slug) => {
        const condition = data?.conditions.byId.get(slug)
        return (
          <dd key={slug}>
            <ConditionChip name={condition?.name ?? humanizeSlug(slug)} href={condition?.wikiUrl} />
          </dd>
        )
      })}
    </div>
  )
}

// --- craft --------------------------------------------------------------------------------

function CraftRoute({ weapon, route, data, weaponsById, sprites, refInfo }: RouteProps & { route: Extract<Acquisition, { method: 'craft' }> }) {
  const recipes = route.recipeIds.map((id) => ({ id, recipe: data?.recipes?.byId.get(id) }))
  const multiple = recipes.length > 1
  return (
    <div className="space-y-3">
      <RouteHeading route={route} />
      {/* One recipe spans the whole panel; alternatives sit side by side from md. */}
      <ul className={cx('grid gap-3', multiple && 'md:grid-cols-2')}>
        {recipes.map(({ id, recipe }, i) => (
          <li key={id} className="space-y-2 border-2 border-panel-border bg-night-900 p-3">
            {multiple ? <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Recipe {i + 1}</p> : null}
            {recipe ? (
              <RecipeCard
                recipe={recipe}
                label={`Materials for ${weapon.name}${multiple ? `, recipe ${i + 1}` : ''}`}
                data={data}
                weaponsById={weaponsById}
                sprites={sprites}
                refInfo={refInfo}
              />
            ) : (
              <p className="text-sm text-fg-muted">This recipe isn’t in the loaded recipe data.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function stationName(station: Recipe['stations'][number], data: AcquisitionData | undefined): string {
  switch (station.kind) {
    case 'item':
      return data?.names?.byId.get(station.itemId) ?? `Item #${station.itemId}`
    case 'group':
      return data?.recipes?.groups.get(station.groupId)?.name ?? humanizeSlug(station.groupId)
    case 'environment':
      return station.name
  }
}

const STATION_LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

/**
 * A station group whose every member is an Item record, as those members ("Iron Anvil or Lead Anvil"), in
 * id order — each links its item page (AMENDMENTS-016 B113(e)); undefined when any member has no page.
 */
function groupMembers(station: Recipe['stations'][number], data: AcquisitionData | undefined): number[] | undefined {
  if (station.kind !== 'group') return undefined
  const members = data?.recipes?.groups.get(station.groupId)?.memberItemIds ?? []
  return members.length > 0 && members.every((id) => data?.items?.ids.has(id) && data.names?.byId.has(id)) ? [...members].sort((a, b) => a - b) : undefined
}

/** Stations joined with " + "; a station that is an Item record — or a group of them — links its item page (P6 encyclopedia). */
function StationList({ stations, data }: { stations: Recipe['stations']; data: AcquisitionData | undefined }) {
  return (
    <>
      {stations.map((station, i) => {
        const members = groupMembers(station, data)
        if (members) {
          return (
            <span key={i} data-station-group={station.kind === 'group' ? station.groupId : undefined}>
              {i > 0 ? ' + ' : null}
              {members.map((id, j) => (
                <Fragment key={id}>
                  {j > 0 ? ' or ' : null}
                  <Link to={itemHref(id)} className={STATION_LINK}>
                    {data?.names?.byId.get(id)}
                  </Link>
                </Fragment>
              ))}
            </span>
          )
        }
        const name = stationName(station, data)
        const page = station.kind === 'item' && data?.items?.ids.has(station.itemId) ? itemHref(station.itemId) : undefined
        return (
          <span key={i}>
            {i > 0 ? ' + ' : null}
            {page ? (
              <Link to={page} className={STATION_LINK}>
                {name}
              </Link>
            ) : (
              name
            )}
          </span>
        )
      })}
    </>
  )
}

export function RecipeCard({
  recipe,
  label,
  data,
  weaponsById,
  sprites,
  refInfo,
}: {
  recipe: Recipe
  /** Accessible name of the materials grid. */
  label: string
  data: AcquisitionData | undefined
  weaponsById: ReadonlyMap<number, Weapon> | undefined
  sprites: SpriteIndex | null
  refInfo?: (itemId: number) => ItemRefInfo | undefined
}) {
  return (
    <dl className="space-y-2 text-sm">
      <InfoRow label={recipe.stations.length > 1 ? 'Crafting stations' : 'Crafting station'}>
        {recipe.stations.length > 0 ? <StationList stations={recipe.stations} data={data} /> : 'By hand (no station)'}
      </InfoRow>
      {recipe.conditions.length > 0 ? <InfoRow label="Requires">{conditionNames(recipe.conditions, data)}</InfoRow> : null}
      {recipe.resultAmount > 1 ? <InfoRow label="Makes">{recipe.resultAmount}</InfoRow> : null}
      <div>
        <dt className="text-fg-muted">Materials:</dt>
        <dd className="mt-2">
          <InventoryGrid label={label} cellMinWidth="12rem">
            {recipe.ingredients.map((ingredient, i) => (
              <MaterialCell key={i} ingredient={ingredient} data={data} weaponsById={weaponsById} sprites={sprites} refInfo={refInfo} />
            ))}
          </InventoryGrid>
        </dd>
      </div>
    </dl>
  )
}

/**
 * One recipe material: an ItemSlot (sprite whole-number scaled into the 32px slot, quantity
 * badge as in-game) plus its visible name — names stay readable on touch screens, where slot
 * tooltips can't be hovered. Materials that are weapons link to their page, Item records to their
 * encyclopedia page (P6); with `refInfo` (the encyclopedia) a material also shows its own sprite and an
 * armor / accessory material opens its own wiki article. Anything else is an inert cell (never a dead
 * local link, never a guessed wiki URL). The amount is always announced, including ×1 (no badge, as in-game).
 */
function MaterialCell({
  ingredient,
  data,
  weaponsById,
  sprites,
  refInfo,
}: {
  ingredient: Recipe['ingredients'][number]
  data: AcquisitionData | undefined
  weaponsById: ReadonlyMap<number, Weapon> | undefined
  sprites: SpriteIndex | null
  refInfo?: (itemId: number) => ItemRefInfo | undefined
}) {
  const ref = ingredient.ref
  const weapon = ref.kind === 'item' ? weaponsById?.get(ref.itemId) : undefined
  const info = ref.kind === 'item' ? refInfo?.(ref.itemId) : undefined
  const name =
    ref.kind === 'item'
      ? (data?.names?.byId.get(ref.itemId) ?? weapon?.name ?? `Item #${ref.itemId}`)
      : (data?.recipes?.groups.get(ref.groupId)?.name ?? humanizeSlug(ref.groupId))
  const link: ItemRefInfo['link'] =
    ref.kind !== 'item'
      ? undefined
      : weapon
        ? { kind: 'internal', to: weaponHref(weapon.id) }
        : data?.items?.ids.has(ref.itemId)
          ? { kind: 'internal', to: itemHref(ref.itemId) }
          : info?.link
  const sprite = weapon?.sprite ?? info?.sprite
  const slot = (
    // The visible name (with the sr-only amount) labels the cell; the slot is the picture.
    <div aria-hidden="true" className="shrink-0">
      <ItemSlot
        item={{
          name,
          stack: ingredient.amount,
          sprite:
            weapon || info?.damageClass ? (
              <SpriteImg src={sprite} sprites={sprites} damageClass={weapon?.damageClass ?? info?.damageClass} box={32} />
            ) : (
              <SpriteImg src={sprite} sprites={sprites} placeholder="material" box={32} />
            ),
        }}
      />
    </div>
  )
  const text = (
    <span className="min-w-0">
      <span className="sr-only">{ingredient.amount} × </span>
      {name}
    </span>
  )
  if (link?.kind === 'internal') {
    return (
      <Link
        to={link.to}
        className="flex min-h-tap items-center gap-3 text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
      >
        {slot}
        {text}
      </Link>
    )
  }
  if (link?.kind === 'external') {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-tap items-center gap-3 text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
      >
        {slot}
        <span className="min-w-0">
          <span className="sr-only">{ingredient.amount} × </span>
          {name}
          <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5 align-baseline" />
          <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
        </span>
      </a>
    )
  }
  return (
    <div className="flex min-h-tap items-center gap-3">
      {slot}
      {text}
    </div>
  )
}

// --- drop ---------------------------------------------------------------------------------

function DropRoute({ weapon, route, data }: RouteProps & { route: Extract<Acquisition, { method: 'drop' }> }) {
  const loaded = route.dropIds.map((id) => data?.drops?.byId.get(id))
  const missing = loaded.filter((drop) => drop === undefined).length
  const groups = groupDropSources(loaded.filter((drop): drop is DropSource => drop !== undefined))
  return (
    <div className="space-y-3">
      <RouteHeading route={route} />
      <ul className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <li key={group[0].id} className="space-y-2 border-2 border-panel-border bg-night-900 p-3">
            <DropCard drops={group} weapon={weapon} data={data} />
          </li>
        ))}
        {missing > 0 ? (
          <li className="border-2 border-panel-border bg-night-900 p-3">
            <p className="text-sm text-fg-muted">
              {missing === 1 ? 'One drop source isn’t' : `${missing} drop sources aren’t`} in the loaded drop data.
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/**
 * One drop table cell via getField on the DROP record (its own _prov): value / Unknown / n/a.
 * An Unknown cell carries the diagonal hatch itself (UX_SPEC §5.3).
 */
function DropValueCell({ drop, cell, format }: { drop: DropSource; cell: DropCell; format: (v: unknown) => string }) {
  const { view } = cell
  if (view.status === 'unverified') {
    return (
      <td className="bg-hatch-unknown px-2 py-1.5">
        <UnknownValue field={`drop:${drop.id}:${cell.field}`} sourceUrl={dropSourceUrl(drop)} inCell />
      </td>
    )
  }
  return (
    <td className="px-2 py-1.5">
      {view.status === 'not-applicable' || view.value === undefined ? (
        <span className="text-fg-muted">
          n/a<span className="sr-only"> (not applicable)</span>
        </span>
      ) : isModeledField(drop, cell.field) ? (
        // AMENDMENTS-016 B105: derived from the item kind, never shown like a wiki-stated quantity
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-nums">{format(view.value)}</span>
          <DerivedLabel className="text-xs" />
        </span>
      ) : (
        <span className="tabular-nums">{format(view.value)}</span>
      )}
    </td>
  )
}

/** A source's Treasure Bag tag — kept on one line, and left out where the source's name already says it ("Treasure Bag (Golem)"). */
function TreasureBagTag({ name }: { name?: string }) {
  if (name !== undefined && /treasure bag/i.test(name)) return null
  return <span className="ml-2 inline-block border-2 border-stone-600 px-1.5 text-xs font-semibold whitespace-nowrap text-fg-muted">Treasure Bag</span>
}

/**
 * One drop table for one source, or for several sources with identical values (grouped by
 * groupDropSources — never when a value is Unknown, so each Unknown names its own source).
 * A group lists every source by name, each linking to the wiki page its data came from.
 */
function DropCard({ drops, weapon, data }: { drops: readonly DropSource[]; weapon: AcquirableRecord; data: AcquisitionData | undefined }) {
  const [drop] = drops
  const grouped = drops.length > 1
  const sourceUrl = dropSourceUrl(drop)
  const conditions = getField(drop, 'conditions')
  const qty = (v: unknown) => formatQuantity(v as { min: number; max: number })
  const names = drops.map((d) => d.source.npcName)
  return (
    <>
      {grouped ? (
        <div className="space-y-1">
          <p className="font-semibold">
            Same drop table from {drops.length} sources
            {drop.source.treasureBag ? <TreasureBagTag /> : null}
          </p>
          <ul className="flex flex-wrap gap-x-4">
            {drops.map((d) => {
              const url = dropSourceUrl(d)
              return (
                <li key={d.id}>
                  {url ? (
                    <ProvenanceLink href={url} label={d.source.npcName} srContext={`(drop data source for ${weapon.name})`} />
                  ) : (
                    <span className="inline-flex min-h-tap items-center text-sm">{d.source.npcName}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p className="font-semibold">
            {drop.source.npcName}
            {drop.source.treasureBag ? <TreasureBagTag name={drop.source.npcName} /> : null}
          </p>
          {sourceUrl ? <ProvenanceLink href={sourceUrl} label="Source" srContext={`drop data for ${drop.source.npcName} (${weapon.name})`} /> : null}
        </div>
      )}
      {conditions.status === 'unverified' ? (
        <p className="text-sm">
          <span className="text-fg-muted">Conditions: </span>
          <UnknownValue field={`drop:${drop.id}:conditions`} sourceUrl={sourceUrl} />
        </p>
      ) : drop.conditions.length > 0 ? (
        <p className="text-sm">
          <span className="text-fg-muted">Conditions: </span>
          {conditionNames(drop.conditions, data)}
        </p>
      ) : null}
      {/* Fixed layout + set column widths: every drop table on the page lines up. */}
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">
          Drop chance and quantity for {weapon.name} from {grouped ? `each of: ${names.join(', ')}` : drop.source.npcName}, by
          difficulty
        </caption>
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[33%]" />
          <col className="w-[33%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-xs text-fg-muted">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Difficulty
            </th>
            <th scope="col" className="px-2 py-1 font-semibold">
              Chance
            </th>
            <th scope="col" className="px-2 py-1 font-semibold">
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {dropTableRows(drop).map((row) => (
            <tr key={row.difficulty} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-fg-muted">
                {DIFFICULTY_LABELS[row.difficulty]}
              </th>
              <DropValueCell drop={drop} cell={row.rate} format={(v) => formatRate(v as number)} />
              <DropValueCell drop={drop} cell={row.quantity} format={qty} />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// --- purchase -----------------------------------------------------------------------------

function PurchaseRoute(props: RouteProps & { route: Extract<Acquisition, { method: 'purchase' }> }) {
  const { weapon, route, index } = props
  const priceField = `acquisition.${index}.priceCopper`
  const price = getField(weapon, priceField)
  return (
    <div className="space-y-2">
      <RouteHeading route={route} />
      <dl className="space-y-1 text-sm">
        {price.status === 'not-applicable' ? null : (
          <InfoRow label="Price">
            {price.status === 'unverified' ? (
              <UnknownValue field={priceField} sourceUrl={weapon.wikiUrl} />
            ) : (
              <span className="tabular-nums">{formatCoins(price.value as number)}</span>
            )}
          </InfoRow>
        )}
        <ConditionsRow {...props} />
      </dl>
    </div>
  )
}

// --- gating ---------------------------------------------------------------------------------

/**
 * Required progress (gatedBy, §2.2/§7b): the progression nodes to defeat and world conditions
 * implied by the easiest verified route. Underivable gating is Unknown — and Unknown is never
 * "obtainable now" (Feature A/B rule); this page makes no availability claim either way.
 * Gates render as GateBadge-style chips: lock glyph + name (UX_SPEC §8), not colour alone.
 */
function GateRow({ weapon, data }: { weapon: AcquirableRecord; data: AcquisitionData | undefined }) {
  const view = getField(weapon, 'gatedBy')
  if (view.status === 'not-applicable') return null
  const gate = view.value as Weapon['gatedBy']
  const gates = gate
    ? [
        ...gate.bosses.map((slug) => ({
          key: `node:${slug}`,
          kind: 'Defeat first: ',
          name: data?.progression?.nodeById.get(slug)?.name ?? humanizeSlug(slug),
        })),
        ...gate.conditions.map((slug) => ({
          key: `cond:${slug}`,
          kind: 'Condition: ',
          name: data?.conditions.byId.get(slug)?.name ?? humanizeSlug(slug),
        })),
      ]
    : []
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t-2 border-panel-border pt-4 text-sm">
      <span className="text-fg-muted">Required progress:</span>
      {view.status === 'unverified' || !gate ? (
        <UnknownValue field="gatedBy" sourceUrl={weapon.wikiUrl} />
      ) : gates.length === 0 ? (
        <span>None — no boss or world condition gates it</span>
      ) : (
        <ul className="contents">
          {gates.map((g) => (
            <li key={g.key} className="inline-flex items-center gap-1.5 border-2 border-earth-600 bg-night-900 px-2 py-0.5 font-semibold text-gate">
              <Lock aria-hidden="true" className="size-4 shrink-0" />
              <span>
                <span className="sr-only">{g.kind}</span>
                {g.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Id of the panel heading (also where focus lands after Retry replaces the error panel). */
export const ACQUISITION_TITLE_ID = 'acq-title'

/** Panel wrapper used by the page and by tests. */
export function AcquisitionPanel({ weapon, children }: { weapon: Pick<AcquirableRecord, 'name' | 'wikiUrl'>; children?: ReactNode }) {
  return (
    <PixelPanel as="section" aria-labelledby={ACQUISITION_TITLE_ID} className="space-y-4">
      <h2
        id={ACQUISITION_TITLE_ID}
        tabIndex={-1}
        className="scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base"
      >
        How to obtain
      </h2>
      {children}
      <ProvenanceLink href={weapon.wikiUrl} srContext={`for ${weapon.name}`} />
    </PixelPanel>
  )
}
