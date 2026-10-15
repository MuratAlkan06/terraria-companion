import { CircleCheck, ExternalLink, Minus, Plus } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ConditionChip } from '../../../components/ConditionChip'
import { cx } from '../../../components/cx'
import { GateBadge } from '../../../components/GateBadge'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { UnknownValue } from '../../../components/UnknownValue'
import type { DropSource, Recipe } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import type { Availability } from '../../../scoring/candidates'
import { bossMapHref, bossPageHref } from '../bosses/bossNav'
import { itemHref } from '../db/items/itemNav'
import { formatCoins, formatRate, humanizeSlug } from '../db/weapons/weaponDisplay'
import type { NodeInfo, PlanBase } from './planData'
import * as copy from './planCopy'
import type { RouteGate } from './planRouteGates'
import { dropSourceGroups, ingredientWords, itemName, LINK } from './planText'
import { isShimmer, type PlanRecord, type PlanRoute } from './planTree'

/** Building blocks shared by the plan views (UX_SPEC §3.9 PlanStepRow / OwnedQtyInput / ChecklistItem; §8 honesty affordances). */


/** A node's picture: its sprite (or placeholder art) in a slot-styled square — decorative; the name beside it carries the meaning. */
export function NodeSprite({ info, sprites, size = 'md' }: { info: NodeInfo; sprites: PlanBase['sprites']; size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden="true" className={cx('grid shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel', size === 'sm' ? 'size-9' : 'size-11')}>
      {info.damageClass ? <SpriteImg src={info.sprite} sprites={sprites} damageClass={info.damageClass} box={32} /> : <SpriteImg src={info.sprite} sprites={sprites} placeholder="material" box={32} />}
    </span>
  )
}

/** A node's name: rarity-tinted, linking its page (weapon / Item in-app; armor / accessory: its wiki article, new tab). */
export function NodeName({ info, className }: { info: NodeInfo; className?: string }) {
  const name = (
    <RarityText rarity={asRarity(info.rarity)} className="font-semibold">
      {info.name}
    </RarityText>
  )
  if (info.link?.kind === 'internal') {
    return (
      <Link to={info.link.to} className={cx(LINK, className)}>
        {name}
      </Link>
    )
  }
  if (info.link?.kind === 'external') {
    return (
      <a href={info.link.href} target="_blank" rel="noopener noreferrer" className={cx(LINK, className)}>
        {name}
        <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5 align-baseline" />
        <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
      </a>
    )
  }
  return <span className={className}>{name}</span>
}

/**
 * What the player's progress makes of an item (PRD §9 Feature B AC2; UX_SPEC §8): "Obtainable now" only on
 * verified, satisfied gating; a GateBadge per boss still to defeat (linked); Unknown gating as Unknown — never
 * obtainable, never blocked. Non-node conditions as requirement chips (B69/Q4).
 */
export function AvailabilityChips({ availability, base, record }: { availability: Availability | undefined; base: PlanBase; record?: PlanRecord }) {
  if (!availability) return null
  return (
    <>
      {availability.status === 'yes' ? (
        <span data-availability="yes" className="inline-flex items-center gap-1 border-2 border-forest-600 bg-forest-900 px-1.5 text-xs font-semibold text-success">
          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
          {copy.AVAILABLE_NOW}
        </span>
      ) : availability.status === 'gated' ? (
        bossBadges(availability.missing, base)
      ) : (
        <span data-availability="unknown" className="inline-flex items-center gap-1 text-xs">
          <UnknownValue field="gatedBy" sourceUrl={record?.wikiUrl} />
          <span className="text-fg-muted">{copy.AVAILABILITY_WORD}</span>
        </span>
      )}
      {availability.conditions.map((c) => {
        const condition = base.acquisition.conditions.byId.get(c)
        return <ConditionChip key={c} name={condition?.name ?? humanizeSlug(c)} href={condition?.wikiUrl} requires />
      })}
    </>
  )
}

function bossBadges(bosses: readonly string[], base: PlanBase): ReactNode {
  const graph = base.acquisition.progression
  return bosses.map((boss) => <GateBadge key={boss} name={graph?.nodeById.get(boss)?.name ?? humanizeSlug(boss)} to={bossPageHref(boss) ?? bossMapHref(boss)} />)
}

/**
 * One way's gating at the player's progress (the chooser, B118(f); planRouteGates.ts): "Obtainable now"; the
 * bosses still to defeat; "one of" several boss sets; or Unknown — with the bosses that ARE known still named.
 */
export function RouteGateChips({ gate, base, record }: { gate: RouteGate; base: PlanBase; record: PlanRecord }) {
  if (gate.kind === 'any') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5" data-route-gate="any">
        <span className="text-xs text-fg-muted">{copy.ONE_OF}</span>
        {gate.options.map((option, i) => (
          <Fragment key={option.join('+')}>
            {i > 0 ? <span className="text-xs text-fg-muted">{copy.OR}</span> : null}
            {bossBadges(option, base)}
          </Fragment>
        ))}
      </span>
    )
  }
  const a = gate.availability
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-route-gate={a.status}>
      {a.status === 'unknown' && a.missing.length > 0 ? bossBadges(a.missing, base) : null}
      <AvailabilityChips availability={a} base={base} record={record} />
    </span>
  )
}

function conditionChips(slugs: readonly string[], base: PlanBase): ReactNode {
  if (slugs.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {slugs.map((c) => {
        const condition = base.acquisition.conditions.byId.get(c)
        return <ConditionChip key={c} name={condition?.name ?? humanizeSlug(c)} href={condition?.wikiUrl} requires />
      })}
    </span>
  )
}

/** One drop record's chance in words: one figure when every difficulty agrees, else "varies"; Unknown when any is unverified. */
function DropChance({ drop }: { drop: DropSource }) {
  const rates = (['classic', 'expert', 'master'] as const).map((d) => ({ d, view: getField(drop, `rates.${d}`) }))
  if (rates.some((r) => r.view.status === 'unverified')) return <UnknownValue field={`drop:${drop.id}:rates`} interactive={false} />
  const values = rates.filter((r) => r.view.status === 'verified').map((r) => r.view.value as number)
  if (values.length === 0) return null
  return <span className="tabular-nums">{values.every((v) => v === values[0]) ? formatRate(values[0]) : copy.chanceVaries}</span>
}

const DROP_PREVIEW = 4

/**
 * Crafting stations, joined with " + "; a station that is an Item record links its item page, and a group of
 * them is said as its members, each linked ("Iron Anvil or Lead Anvil") — the item pages' pattern (B113(e)).
 */
function StationLinks({ stations, base }: { stations: Recipe['stations']; base: PlanBase }) {
  const hasPage = (id: number) => base.acquisition.items?.ids.has(id) ?? false
  return (
    <>
      {stations.map((s, i) => {
        const members = s.kind === 'group' ? [...(base.acquisition.recipes?.groups.get(s.groupId)?.memberItemIds ?? [])].sort((a, b) => a - b) : []
        const sep = i > 0 ? ' + ' : null
        if (s.kind === 'group' && members.length > 0 && members.every(hasPage)) {
          return (
            <span key={i} data-station-group={s.groupId}>
              {sep}
              {members.map((id, j) => (
                <Fragment key={id}>
                  {j > 0 ? ' or ' : null}
                  <Link to={itemHref(id)} className={LINK}>
                    {itemName(id, base)}
                  </Link>
                </Fragment>
              ))}
            </span>
          )
        }
        if (s.kind === 'item') {
          return (
            <span key={i}>
              {sep}
              {hasPage(s.itemId) ? (
                <Link to={itemHref(s.itemId)} className={LINK}>
                  {itemName(s.itemId, base)}
                </Link>
              ) : (
                itemName(s.itemId, base)
              )}
            </span>
          )
        }
        return (
          <span key={i}>
            {sep}
            {s.kind === 'group' ? (base.acquisition.recipes?.groups.get(s.groupId)?.name ?? humanizeSlug(s.groupId)) : s.name}
          </span>
        )
      })}
    </>
  )
}

/** This plan's demand for the item a way is shown for (the chooser scales a recipe's needs to it, B118(f)). */
export interface RouteScale {
  amount: number
  name: string
}

/**
 * A route's facts in brief (the route chooser; UX_SPEC §3.9 "alternative methods compared with stated
 * tradeoffs, never a bare best"): what a recipe needs — for this plan's quantity, so the in-use way shows the
 * tree's own numbers — and where it's made (stations linked); drop sources (a boss with its Treasure Bag as one
 * source, the tree's count; bosses linked) with their verified chance (or Unknown); vendor and price;
 * containers; fishing places; the wiki's own description — each with its requirement chips. The full detail
 * (every drop table) is the item's "Where do I find this?".
 */
export function RouteFacts({ record, route, base, scale }: { record: PlanRecord; route: PlanRoute; base: PlanBase; scale?: RouteScale }) {
  const acq = record.acquisition[route.acqIndex]
  if (!acq) return null
  switch (acq.method) {
    case 'craft': {
      const recipe = route.recipe
      if (!recipe) return <p className="text-sm text-fg-muted">{copy.LOADING_MORE}</p>
      const crafts = scale && scale.amount > 0 ? Math.ceil(scale.amount / recipe.resultAmount) : 1
      return (
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-fg-muted">{scale && scale.amount > 0 ? copy.needsFor(scale.amount, scale.name, crafts) : copy.RECIPE_INGREDIENTS}:</dt>
            <dd data-route-needs="">{ingredientWords(recipe, base, crafts)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dd>
              {recipe.stations.length > 0 ? (
                <>
                  {copy.CRAFT_AT} <StationLinks stations={recipe.stations} base={base} />
                </>
              ) : (
                copy.BY_HAND
              )}
              {recipe.resultAmount > 1 ? ` · ${copy.makesPerCraft(recipe.resultAmount)}` : ''}
            </dd>
          </div>
          {isShimmer(recipe) ? <p className="text-fg-muted">{copy.SHIMMER_NOTE}</p> : null}
          {recipe.conditions.length > 0 ? conditionChips(recipe.conditions, base) : null}
        </dl>
      )
    }
    case 'drop': {
      const groups = dropSourceGroups(acq.dropIds, base)
      const shown = groups.slice(0, DROP_PREVIEW)
      return (
        <ul className="space-y-1 text-sm" data-drop-sources={groups.length}>
          {shown.map((g) => {
            const page = g.bossId ? bossPageHref(g.bossId) : undefined
            return (
              <li key={g.key} className="flex flex-wrap items-baseline gap-x-2" data-drop-source={g.key}>
                {page ? (
                  <Link to={page} className={cx('font-semibold', LINK)}>
                    {g.name}
                  </Link>
                ) : (
                  <span>{g.name}</span>
                )}
                {g.drops.map((d: DropSource) => (
                  <span key={d.id} className="inline-flex flex-wrap items-baseline gap-x-2">
                    <span className="text-fg-muted">
                      {d.source.npcName === g.name ? copy.CHANCE : d.source.npcName}: <DropChance drop={d} />
                    </span>
                    {d.conditions.length > 0 ? conditionChips(d.conditions, base) : null}
                  </span>
                ))}
              </li>
            )
          })}
          {groups.length > shown.length ? <li className="text-fg-muted">{copy.moreSources(groups.length - shown.length)}</li> : null}
        </ul>
      )
    }
    case 'purchase': {
      const price = getField(record, `acquisition.${route.acqIndex}.priceCopper`)
      return (
        <div className="space-y-1 text-sm">
          <p>
            {copy.soldBy(acq.npcName)}
            {price.status === 'verified' ? <span className="text-fg-muted tabular-nums"> · {formatCoins(price.value as number)}</span> : null}
            {price.status === 'unverified' ? (
              <span className="text-fg-muted">
                {' '}
                · {copy.PRICE}: <UnknownValue field={`acquisition.${route.acqIndex}.priceCopper`} sourceUrl={record.wikiUrl} />
              </span>
            ) : null}
          </p>
          {conditionChips(acq.conditions, base)}
        </div>
      )
    }
    case 'loot':
      return (
        <div className="space-y-1 text-sm">
          <p>{copy.foundIn(acq.containers.join(', '))}</p>
          {acq.locations.length > 0 ? (
            <p className="text-fg-muted">
              {copy.LOCATIONS}: {acq.locations.join(', ')}
            </p>
          ) : null}
          {conditionChips(acq.conditions, base)}
        </div>
      )
    case 'fishing':
      return (
        <div className="space-y-1 text-sm">
          <p>{copy.fishedIn(acq.biomes.join(', '))}</p>
          {conditionChips(acq.conditions, base)}
        </div>
      )
    case 'other':
      return (
        <div className="space-y-1 text-sm">
          {/* A15: wiki-derived text, rendered as plain text */}
          <p data-wiki-text="" className="whitespace-pre-line">
            {acq.description}
          </p>
          <ProvenanceLink href={acq.sourceUrl} />
          {conditionChips(acq.conditions, base)}
        </div>
      )
  }
}

/** The browser's own number spin arrows, hidden: the − / + buttons are the stepper (B118(j)). */
const NO_SPINNER = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

/** OwnedQtyInput (UX_SPEC §3.9, §6): a stepper — always editable, numeric keyboard, ≥ 44px targets. */
export function OwnedQtyInput({ id, name, value, onChange, min = 0, labels }: { id: string; name: string; value: number; onChange: (n: number) => void; min?: number; labels?: { input: string; less: string; more: string } }) {
  const BTN = 'grid min-h-tap min-w-tap place-items-center border-2 border-border-strong bg-surface-raised text-fg hover:bg-night-700 disabled:opacity-60'
  return (
    <span className="inline-flex items-stretch" data-owned-input={id}>
      <button type="button" className={BTN} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={labels?.less ?? copy.decrease(name)}>
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={value}
        aria-label={labels?.input ?? copy.ownedFor(name)}
        onChange={(e) => onChange(Math.max(min, Number.parseInt(e.target.value || '0', 10) || 0))}
        className={cx('h-tap w-16 min-w-0 border-y-2 border-border-strong bg-surface-sunken px-1 text-center text-base text-fg tabular-nums', NO_SPINNER)}
      />
      <button type="button" className={BTN} onClick={() => onChange(value + 1)} aria-label={labels?.more ?? copy.increase(name)}>
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </span>
  )
}

/** The plan's progress bar (text beside it carries the numbers; the bar is decorative). */
export function ProgressBar({ complete, total }: { complete: number; total: number }) {
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0
  return (
    <span aria-hidden="true" className="block h-3 w-full border-2 border-panel-border bg-surface-sunken">
      <span className="block h-full bg-forest-500" style={{ width: `${pct}%` }} />
    </span>
  )
}
