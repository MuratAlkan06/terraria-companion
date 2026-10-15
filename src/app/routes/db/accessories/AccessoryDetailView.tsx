import { ChevronRight, CircleHelp, ImageOff } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../../components/buttonStyles'
import { CuratedLabel } from '../../../../components/CuratedLabel'
import { cx } from '../../../../components/cx'
import { ItemSlot } from '../../../../components/ItemSlot'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import type { SpriteFallback } from '../../../../components/spriteFallback'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { Accessory, SpriteIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { effectPhrase } from '../../../../scoring/readinessCopy'
import { hasRoute } from '../../../routes'
import { LOADOUT_PATH } from '../../loadout/loadoutLinks'
import { GrindButton, PlanItLink } from '../../plan/GrindLink'
import { ClassChip, EffectList, FIELD_LABEL, HeaderFact, LINK, RarityValue, SECTION_TITLE, SourcesPanel, StageValue, WikiQuote } from '../armor/EquipmentBits'
import { classLabel } from '../armor/equipmentDisplay'
import { SPRITE_FALLBACK } from '../items/itemCopy'
import { refInfoFrom } from '../items/itemsData'
import { humanizeSlug } from '../weapons/weaponDisplay'
import { unknownCount } from '../weapons/weaponUnknowns'
import * as copy from './accessoryCopy'
import type { AccessorySectionsData } from './accessoryData'
import { ACCESSORY_EFFECTS_ID, ACCESSORY_TREE_ID, accessoryHref } from './accessoryNav'
import { categoryBuckets, categoryLabel, combinationTree, loadoutFit, upgradeTree, type ComboNode, type UpgradeNode } from './accessoryModel'
import { accessoryPageUnknowns, WING_FIELDS } from './accessoryUnknowns'

/**
 * Accessory page body (PRD P6-S2 AC1–AC3; UX_SPEC §1 `/accessories/:id`, §5.3, §8): the header (category — curated
 * —, rarity, game stage, provenance, partially-verified badge, plan + builder links), its exact effects (stat
 * effects in the builder's words incl. the B54 kinds, wiki-text effects quoted with their source, wing stats), which
 * classes those effects count for (AC1's loadout notes), the combination tree down to its ingredients and what it
 * combines into (AC2 — every node a link), how to obtain it and where the data comes from. Every effect is verified
 * with its source or Unknown (AC3). Pure presentation over one record + the loaded data, so tests render every
 * accessory.
 */
export interface AccessoryDetailViewProps {
  accessory: Accessory
  accessories: ReadonlyMap<number, Accessory>
  sprites: SpriteIndex | null
  /** Recipes, names and search docs (undefined while loading / on error). */
  sections: AccessorySectionsData | undefined
  /** The "How to obtain" section (the page wraps AcquisitionView with its loading / error states). */
  acquisition: ReactNode
  /** Shown in the combination tree's place while its recipes load or failed (the page's status / error). */
  treeFallback?: ReactNode
}

export function AccessoryDetailView({ accessory, accessories, sprites, sections, acquisition, treeFallback }: AccessoryDetailViewProps) {
  const unknowns = accessoryPageUnknowns(accessory, sections?.acquisition.drops, sections !== undefined)
  const combines = accessory.combinedFrom.length > 0 || accessory.upgradesTo.length > 0
  return (
    <div className="space-y-4 md:space-y-6">
      <DetailHeader accessory={accessory} sprites={sprites} unknowns={unknowns} />
      <EffectsPanel accessory={accessory} />
      <FitPanel accessory={accessory} />
      {combines ? <TreePanel accessory={accessory} accessories={accessories} sprites={sprites} sections={sections} fallback={treeFallback} /> : null}
      {acquisition}
      <SourcesPanel records={[accessory]} sprites={sprites} summary={copy.SOURCES_SUMMARY} spriteCredit={copy.SPRITE_CREDIT} />
    </div>
  )
}

function DetailHeader({ accessory, sprites, unknowns }: { accessory: Accessory; sprites: SpriteIndex | null; unknowns: ReturnType<typeof accessoryPageUnknowns> }) {
  const rarityView = getField(accessory, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const categories = getField(accessory, 'categories')
  const [fallback, setFallback] = useState<SpriteFallback | undefined>(accessory.sprite ? undefined : 'no-sprite')
  const loadout = hasRoute('loadout') ? `${LOADOUT_PATH}?owned=${accessory.id}` : undefined
  return (
    <PixelPanel as="header" className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <div className="grid size-28 shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
        {/* Detail page: always the full sprite file, never a thumbnail (B30). */}
        <SpriteImg src={accessory.sprite} sprites={sprites} placeholder="material" box={96} full maxScale={4} onFallback={setFallback} />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="space-y-1">
          <p className={FIELD_LABEL}>{copy.BADGE}</p>
          <h1 className="min-w-0 font-display text-base leading-relaxed md:text-2xl">
            <RarityText rarity={rarity} tooltip>
              {accessory.name}
            </RarityText>
          </h1>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          <HeaderFact label={copy.CATEGORY_LABEL}>
            {categories.status === 'unverified' ? (
              <UnknownValue field="categories" sourceUrl={accessory.wikiUrl} />
            ) : (
              <>
                {categoryBuckets(accessory).map((c) => (
                  <span key={c} data-category={c} className="inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase">
                    {categoryLabel(c)}
                  </span>
                ))}
                {categories.status === 'editorial' ? <CuratedLabel className="text-sm" /> : null}
              </>
            )}
          </HeaderFact>
          <HeaderFact label={copy.RARITY_LABEL}>
            <RarityValue record={accessory} />
          </HeaderFact>
          <HeaderFact label={copy.STAGE_LABEL}>
            <StageValue record={accessory} />
          </HeaderFact>
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProvenanceLink href={accessory.wikiUrl} srContext={`for ${accessory.name}`} />
          <PartiallyVerifiedBadge items={unknowns} />
        </div>
        <div className="flex flex-col gap-2 empty:hidden md:flex-row md:flex-wrap">
          <GrindButton id={accessory.id} name={accessory.name} className="w-full md:w-auto" />
          {loadout ? (
            <Link to={loadout} className={buttonClass('secondary', 'w-full md:w-auto')} data-loadout-link="">
              {copy.LOADOUT_LINK}
              <span className="sr-only">{copy.loadoutLinkSr(accessory.name)}</span>
            </Link>
          ) : null}
        </div>
        {fallback ? (
          <p data-sprite-note={fallback} className="flex gap-2 text-sm text-fg-muted">
            <ImageOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {SPRITE_FALLBACK[fallback]}
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

/** AC1/AC3: the effects exactly as stated (B54 kinds included), wing stats where the record has them. */
function EffectsPanel({ accessory }: { accessory: Accessory }) {
  const rows = WING_FIELDS.map((field) => ({ field, view: getField(accessory, field) })).filter((r) => r.view.status !== 'not-applicable')
  const ticks = rows.some((r) => r.field === 'wingStats.flightTimeTicks' && r.view.status === 'verified') || accessory.effects.some((e) => e.kind === 'stat' && /-ticks$/.test(e.stat))
  const label: Record<(typeof WING_FIELDS)[number], string> = { 'wingStats.flightTimeTicks': copy.FLIGHT_TIME, 'wingStats.verticalSpeedTps': copy.VERTICAL_SPEED, 'wingStats.hover': copy.HOVER }
  const value = (field: (typeof WING_FIELDS)[number], v: unknown) =>
    field === 'wingStats.flightTimeTicks' ? copy.flightTime(v as number) : field === 'wingStats.verticalSpeedTps' ? copy.verticalSpeed(v as number) : v ? 'Yes' : 'No'
  return (
    <PixelPanel as="section" aria-labelledby={ACCESSORY_EFFECTS_ID} className="space-y-4">
      <h2 id={ACCESSORY_EFFECTS_ID} tabIndex={-1} className={SECTION_TITLE}>
        {copy.EFFECTS_HEADING}
      </h2>
      <p className="text-sm text-fg-muted">{copy.EFFECTS_INTRO}</p>
      <div data-stat="effects">
        <EffectList record={accessory} empty={copy.NO_EFFECTS} />
      </div>
      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 md:max-w-xl">
          {rows.map((r) => (
            <div key={r.field} className="contents" data-stat={r.field}>
              <dt className="text-fg-muted">{label[r.field]}</dt>
              <dd className="font-semibold tabular-nums">{r.view.status === 'unverified' ? <UnknownValue field={r.field} sourceUrl={accessory.wikiUrl} /> : value(r.field, r.view.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {ticks ? <p className="text-xs text-fg-muted">{copy.TICKS_NOTE}</p> : null}
      <ProvenanceLink href={accessory.wikiUrl} srContext={`effects of ${accessory.name}`} />
    </PixelPanel>
  )
}

/** AC1 "loadout notes": which classes each effect counts for, as the builder reads them (never a ranking). */
function FitPanel({ accessory }: { accessory: Accessory }) {
  const fit = loadoutFit(accessory)
  return (
    <PixelPanel as="section" aria-labelledby="accessory-fit-title" className="space-y-3">
      <h2 id="accessory-fit-title" className={SECTION_TITLE}>
        {copy.FIT_HEADING}
      </h2>
      <p className="text-sm text-fg-muted">{copy.FIT_INTRO}</p>
      {fit.kind === 'unknown' ? (
        <p className="text-sm" data-fit="unknown">
          {copy.FIT_UNKNOWN}
        </p>
      ) : fit.groups.length === 0 ? (
        <p className="text-sm text-fg-muted" data-fit="none">
          {copy.FIT_NONE}
        </p>
      ) : (
        <ul className="space-y-2">
          {fit.groups.map((g) => (
            <li key={g.scope ?? 'all'} className="space-y-1 border-l-4 border-panel-border pl-3" data-fit={g.scope ?? 'all'}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{g.scope ? <><ClassChip cls={g.scope} /> {copy.fitClass(classLabel(g.scope))}</> : copy.FIT_ALL}</p>
              <ul className="space-y-0.5 text-sm">
                {g.stats.map((e, i) => (
                  <li key={`s${i}`} className="tabular-nums">
                    {effectPhrase(e)}
                  </li>
                ))}
                {g.specials.map((s, i) => (
                  <li key={`t${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <WikiQuote text={s.effect.text} />
                    {s.curated ? <CuratedLabel explanation={copy.FIT_CURATED} className="text-xs" /> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </PixelPanel>
  )
}

// --- combination tree (AC2) -----------------------------------------------------------------------------

function TreePanel({ accessory, accessories, sprites, sections, fallback }: { accessory: Accessory; accessories: ReadonlyMap<number, Accessory>; sprites: SpriteIndex | null; sections: AccessorySectionsData | undefined; fallback?: ReactNode }) {
  const recipes = sections?.acquisition.recipes
  const tree = recipes && accessory.combinedFrom.length > 0 ? combinationTree(accessory.id, { accessories, recipes: recipes.byId, groups: recipes.groups }) : undefined
  const up = accessory.upgradesTo.length > 0 ? upgradeTree(accessory.id, accessories) : undefined
  const ctx: TreeCtx = { accessories, sprites, sections }
  return (
    <PixelPanel as="section" aria-labelledby={ACCESSORY_TREE_ID} className="space-y-4" data-combination={accessory.id}>
      <h2 id={ACCESSORY_TREE_ID} tabIndex={-1} className={SECTION_TITLE}>
        {copy.TREE_HEADING}
      </h2>
      {accessory.combinedFrom.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">{copy.TREE_INTRO}</p>
          {tree ? (
            <ul className="space-y-1" data-combo-tree="">
              <ComboNodeView node={tree} amount={1} ctx={ctx} depth={0} root />
            </ul>
          ) : (
            fallback
          )}
          {hasRoute('plan-new') ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
              {copy.PLAN_POINTER} <PlanItLink id={accessory.id} name={accessory.name} />
            </p>
          ) : null}
        </div>
      ) : null}
      {up ? (
        <div className="space-y-2">
          <h3 className="font-semibold">{copy.UP_HEADING}</h3>
          <p className="text-sm text-fg-muted">{copy.UP_INTRO}</p>
          <ul className="space-y-1" data-upgrade-tree="">
            {up.into.map((n) => (
              <UpgradeNodeView key={n.id} node={n} ctx={ctx} />
            ))}
          </ul>
        </div>
      ) : null}
    </PixelPanel>
  )
}

interface TreeCtx {
  accessories: ReadonlyMap<number, Accessory>
  sprites: SpriteIndex | null
  sections: AccessorySectionsData | undefined
}

/** One item in a tree: its slot picture and name — an accessory links its page, any other item its own page where it has one. */
function TreeItem({ id, amount, ctx, current }: { id: number; amount: number; ctx: TreeCtx; current?: boolean }) {
  const a = ctx.accessories.get(id)
  const info = a ? undefined : ctx.sections ? refInfoFrom(ctx.sections.docs)(id) : undefined
  const name = a?.name ?? ctx.sections?.docs.get(`i:${id}`)?.name ?? ctx.sections?.acquisition.names?.byId.get(id) ?? `Item #${id}`
  const sprite = a?.sprite ?? info?.sprite
  const link = a ? { kind: 'internal' as const, to: accessoryHref(id) } : info?.link
  const slot = (
    <span aria-hidden="true" className="shrink-0">
      <ItemSlot item={{ name, stack: amount, sprite: <SpriteImg src={sprite} sprites={ctx.sprites} placeholder="material" box={32} /> }} />
    </span>
  )
  // between words (the global li rule is `overflow-wrap: anywhere`); inside a word only if one alone can't fit a line
  const text = (
    <span className="min-w-0 wrap-break-word">
      {amount > 1 ? <span className="sr-only">{amount} × </span> : null}
      {name}
      {current ? (
        <>
          {' '}
          <span className="text-xs text-fg-muted">{copy.THIS_ONE}</span>
        </>
      ) : null}
    </span>
  )
  if (current || !link) {
    return (
      <span className="flex min-h-tap min-w-0 items-center gap-3" data-tree-item={id}>
        {slot}
        {text}
      </span>
    )
  }
  if (link.kind === 'internal') {
    return (
      <Link to={link.to} className={cx('flex min-h-tap min-w-0 items-center gap-3', LINK)} data-tree-item={id}>
        {slot}
        {text}
      </Link>
    )
  }
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cx('flex min-h-tap min-w-0 items-center gap-3', LINK)} data-tree-item={id}>
      {slot}
      {text}
      <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
    </a>
  )
}

/**
 * One tree level's indent: 18px below md (four levels deep at 375px still leave ~116px for a name, so names wrap
 * between words — at the old 34px the deepest were ~40px wide and broke mid-word), 34px from md. Tap targets keep
 * their 44px either way.
 */
const TREE_LEVEL = 'border-l-2 border-panel-border pl-2 md:pl-3'
const TREE_CHILDREN = 'mt-1 ml-2 space-y-1 md:ml-5'

/**
 * A node and — collapsible in place (the user's choice, UX_SPEC §3.1 CraftTreeNode) — what it is combined from:
 * one recipe as its ingredients, several as "Recipe 1 of N" alternatives joined by "or". The whole tree starts open
 * (AC2: the full tree; the largest, Terraspark Boots, is 67 rows).
 */
function ComboNodeView({ node, amount, ctx, depth, root = false }: { node: ComboNode; amount: number; ctx: TreeCtx; depth: number; root?: boolean }) {
  const [open, setOpen] = useState(true)
  const name = ctx.accessories.get(node.id)?.name ?? `Item #${node.id}`
  const has = node.recipes.length > 0
  // unique per rendered node (an accessory can appear twice at one depth, in alternative recipes); the list it
  // controls stays in the DOM while collapsed (hidden), so aria-controls always names an element
  const childId = useId()
  return (
    <li data-combo-node={node.id} className={cx(depth > 0 && TREE_LEVEL)}>
      <div className="flex min-w-0 items-center gap-1">
        {has ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={childId}
            aria-label={copy.expandLabel(name)}
            onClick={() => setOpen((v) => !v)}
            className="grid size-tap shrink-0 place-items-center text-fg-muted hover:text-fg"
          >
            <ChevronRight aria-hidden="true" className={cx('size-5 transition-transform duration-(--dur-ui) ease-out-strong', open && 'rotate-90')} />
          </button>
        ) : (
          <span aria-hidden="true" className="size-tap shrink-0" />
        )}
        <TreeItem id={node.id} amount={amount} ctx={ctx} current={root} />
        {node.repeat ? <span className="text-xs text-fg-muted">{copy.REPEAT}</span> : null}
      </div>
      {has ? (
        <ul id={childId} hidden={!open} className={TREE_CHILDREN}>
          {node.recipes.map((r, i) => (
            <li key={r.recipeId} data-combo-recipe={r.recipeId}>
              {node.recipes.length > 1 ? (
                <p className="flex items-center gap-2 py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  {i > 0 ? <span className="text-accent">{copy.OR}</span> : null}
                  {copy.recipeOf(i + 1, node.recipes.length)}
                </p>
              ) : null}
              <ul className="space-y-1">
                {r.ingredients.map((ing, j) =>
                  ing.kind === 'accessory' ? (
                    <ComboNodeView key={j} node={ing.node} amount={ing.amount} ctx={ctx} depth={depth + 1} />
                  ) : ing.kind === 'item' ? (
                    <li key={j} className={TREE_LEVEL}>
                      <div className="flex items-center gap-1">
                        <span aria-hidden="true" className="size-tap shrink-0" />
                        <TreeItem id={ing.id} amount={ing.amount} ctx={ctx} />
                      </div>
                    </li>
                  ) : (
                    <li key={j} className={cx('space-y-1', TREE_LEVEL)} data-combo-group={ing.groupId}>
                      <p className="text-sm text-fg-muted">{copy.anyOf(ctx.sections?.acquisition.recipes?.groups.get(ing.groupId)?.name ?? humanizeSlug(ing.groupId))}</p>
                      <ul className="flex flex-wrap gap-x-4">
                        {ing.members.map((m, k) => (
                          <li key={m} className="flex items-center gap-2">
                            {k > 0 ? <span className="text-xs font-semibold text-accent uppercase">{copy.OR}</span> : null}
                            <TreeItem id={m} amount={ing.amount} ctx={ctx} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ),
                )}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function UpgradeNodeView({ node, ctx }: { node: UpgradeNode; ctx: TreeCtx }) {
  return (
    <li data-upgrade-node={node.id} className={TREE_LEVEL}>
      <div className="flex items-center gap-2">
        <TreeItem id={node.id} amount={1} ctx={ctx} />
        {node.repeat ? <span className="text-xs text-fg-muted">{copy.REPEAT}</span> : null}
      </div>
      {node.into.length > 0 ? (
        <ul className={TREE_CHILDREN}>
          {node.into.map((n) => (
            <UpgradeNodeView key={n.id} node={n} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
