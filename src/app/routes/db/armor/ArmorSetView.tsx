import { CircleHelp, Columns3, ImageOff, Info, Layers } from 'lucide-react'
import { Fragment, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../../components/buttonStyles'
import { CuratedLabel } from '../../../../components/CuratedLabel'
import { cx } from '../../../../components/cx'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { ArmorPiece, ArmorSet, SpriteIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { hasRoute } from '../../../routes'
import { LOADOUT_PATH } from '../../loadout/loadoutLinks'
import { GrindButton } from '../../plan/GrindLink'
import { stageLabel } from '../weapons/weaponDisplay'
import { unknownCount } from '../weapons/weaponUnknowns'
import * as copy from './armorCopy'
import { bonusGroups, bonusPieceCount, setPieceIds, setShape, stagePeers, verifiedStage, type CompareRow, type SetTotals, type SetVariant } from './armorModel'
import { ARMOR_ACQUISITION_ID, ARMOR_COMPARE_ID, armorCompareHref, armorSetHref, pieceAnchorId } from './armorNav'
import { setPageUnknowns } from './armorUnknowns'
import { ClassChip, EffectItems, EffectList, FIELD_LABEL, HeaderFact, LINK, RarityValue, SECTION_TITLE, SourcesPanel, StageValue, WikiQuote } from './EquipmentBits'
import { classWords, statAmount, statLabel, STAT_GROUPS, statGroup } from './equipmentDisplay'

/**
 * An armor set's page body (PRD P6-S1 AC1–AC3; UX_SPEC §1 `/armor/:id`, §3.10, §5.3, §8): the header (pieces'
 * sprites, classes — B52 hybrids named, curated —, game stage, provenance, partially-verified badge), the set
 * bonus quoted per helmet, the full-set totals per helmet (pieces + set bonus once), every piece with its stats
 * and how to get it, the set-bonus-aware comparison with another set, the sets at the same verified stage, and
 * where the data comes from. Pure presentation: the page passes the loaded data and the comparison choice, so
 * tests render every set.
 */
export interface ArmorSetViewProps {
  set: ArmorSet
  sets: ReadonlyMap<string, ArmorSet>
  armor: ReadonlyMap<number, ArmorPiece>
  sprites: SpriteIndex | null
  variants: readonly SetVariant[]
  totals: readonly SetTotals[]
  /** The drop records shown under "how to obtain" (undefined while loading / on error). */
  drops: Parameters<typeof setPageUnknowns>[3]
  /** The pieces' "how to obtain" are on screen (their data loaded). */
  acquisitionShown: boolean
  /** One piece's "how to obtain" (the page wraps AcquisitionView with its loading state). */
  acquisition: (piece: ArmorPiece) => ReactNode
  /** Shown under the pieces' heading (the one error panel when their "how to obtain" failed to load). */
  piecesNotice?: ReactNode
  /** The comparison section (ArmorCompare), rendered by the page with its URL state. */
  compare: ReactNode
  /** The comparison's rows when another set is chosen (their Unknown cells count in the badge). */
  compareRows?: { rows: readonly CompareRow[]; names: [string, string] }
}

export function ArmorSetView(props: ArmorSetViewProps) {
  const { set, armor, variants, totals } = props
  const pieces = setPieceIds(set).map((id) => armor.get(id)).filter((p): p is ArmorPiece => p !== undefined)
  const unknowns = setPageUnknowns(set, pieces, totals, props.drops, props.acquisitionShown, props.compareRows)
  return (
    <div className="space-y-4 md:space-y-6">
      <SetHeader {...props} pieces={pieces} unknowns={unknowns} />
      <BonusPanel set={set} variants={variants} armor={armor} />
      <TotalsPanel set={set} totals={totals} armor={armor} />
      <section aria-labelledby={ARMOR_ACQUISITION_ID} className="space-y-3">
        <h2 id={ARMOR_ACQUISITION_ID} tabIndex={-1} className={SECTION_TITLE}>
          {copy.PIECES_HEADING}
        </h2>
        {props.piecesNotice}
        {pieces.map((piece) => (
          <ArmorPieceCard key={piece.id} piece={piece} sprites={props.sprites} variant={variants.find((v) => v.bonusPieceId === piece.id) ?? variants.find((v) => v.helmetId === piece.id)} acquisition={props.acquisition(piece)} />
        ))}
      </section>
      {props.compare}
      <PeersPanel set={set} sets={props.sets} />
      <SourcesPanel records={[set, ...pieces]} sprites={props.sprites} summary={copy.SOURCES_SUMMARY} spriteCredit={copy.SPRITE_CREDIT} />
    </div>
  )
}

/**
 * "No legs piece" in the set article's own words (AMENDMENTS-016 B136): the verbatim quote the armor-sets overlay records
 * as that claim's evidence (`combination.legs.quote`, checked against the cached article revision at build). The set
 * record doesn't carry it, so it is kept here by set id — armor.test.ts pins it to the overlay's stored text.
 */
const LEGS_ANY_QUOTE: Readonly<Record<string, string>> = {
  'wizard-set': 'Any leg-slot equipment can be worn without affecting the set bonus.',
}

function SetHeader({ set, variants, sprites, pieces, unknowns }: ArmorSetViewProps & { pieces: ArmorPiece[]; unknowns: ReturnType<typeof setPageUnknowns> }) {
  const classes = [...new Set(variants.flatMap((v) => v.classes))]
  // one entry per data variant (a set with several chests has several combinations per variant)
  const perVariant = variants.filter((v, i) => variants.findIndex((x) => x.index === v.index) === i)
  const curated = variants.some((v) => v.curated)
  const hybrid = variants.some((v) => v.hybrid)
  const shape = setShape(set)
  const loadout = hasRoute('loadout') ? `${LOADOUT_PATH}?owned=${pieces.map((p) => p.id).join(',')}` : undefined
  const noSprite = pieces.some((p) => !p.sprite)
  return (
    <PixelPanel as="header" className="space-y-4">
      <ul aria-hidden="true" className="flex flex-wrap gap-2">
        {pieces.map((p) => (
          <li key={p.id} className="grid size-16 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
            <SpriteImg src={p.sprite} sprites={sprites} placeholder="material" box={56} full maxScale={3} />
          </li>
        ))}
      </ul>
      <div className="space-y-4">
        <div className="space-y-1">
          <p className={FIELD_LABEL}>{copy.SET_BADGE}</p>
          <h1 className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">{set.name}</h1>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          <HeaderFact label={classes.length === 1 ? copy.CLASS_LABEL : copy.CLASSES_LABEL}>
            {/* B52: a hybrid variant names every class it counts for; a set with several helmets, each helmet's */}
            {perVariant.length > 1 || hybrid ? (
              <span data-classes={perVariant.map((v) => v.classes.join('+')).join(',')}>{perVariant.map((v) => classWords(v.classes)).filter((w, i, all) => all.indexOf(w) === i).join(' · ')}</span>
            ) : (
              classes.map((c) => <ClassChip key={c} cls={c} />)
            )}
            {curated ? <CuratedLabel className="text-sm" /> : null}
          </HeaderFact>
          <HeaderFact label={copy.STAGE_LABEL}>
            <StageValue record={set} />
          </HeaderFact>
          <HeaderFact label={copy.PIECES_LABEL}>
            <span className="font-semibold tabular-nums">{copy.piecesValue(pieces.length, set.pieces.helmets.length, shape.chests)}</span>
          </HeaderFact>
        </dl>
        {hybrid ? (
          <p data-hybrid="" className="flex gap-2 text-sm text-fg-muted">
            <Layers aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {copy.HYBRID_NOTE}
          </p>
        ) : null}
        {shape.chests > 1 || shape.legsAny ? (
          <div data-set-shape={`${shape.chests}${shape.legsAny ? '+any-legs' : ''}`} className="flex gap-2 text-sm text-fg-muted">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>{copy.shapeNote(shape.chests, shape.chestKeyed, shape.legsAny)}</p>
              {shape.legsAny && LEGS_ANY_QUOTE[set.id] ? (
                <p data-legs-quote="" className="flex flex-wrap items-center gap-x-2">
                  <WikiQuote text={LEGS_ANY_QUOTE[set.id]} />
                  <ProvenanceLink href={set.wikiUrl} label="Source" srContext={`for “${LEGS_ANY_QUOTE[set.id]}”`} />
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProvenanceLink href={set.wikiUrl} srContext={`for ${set.name}`} />
          <PartiallyVerifiedBadge items={unknowns} />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
          <a href={`#${ARMOR_COMPARE_ID}`} className={buttonClass('secondary', 'w-full md:w-auto')} data-compare-jump="">
            <Columns3 aria-hidden="true" className="size-5" />
            {copy.COMPARE_HEADING}
          </a>
          {loadout ? (
            <Link to={loadout} className={buttonClass('secondary', 'w-full md:w-auto')} data-loadout-link="">
              {copy.LOADOUT_LINK}
              <span className="sr-only">{copy.loadoutLinkSr(set.name)}</span>
            </Link>
          ) : null}
        </div>
        {noSprite ? (
          <p data-sprite-note="no-sprite" className="flex gap-2 text-sm text-fg-muted">
            <ImageOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {copy.SPRITE_NOTE}
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

/**
 * The set bonus, quoted as the tooltip states it — once per distinct text, naming the pieces it comes with: its
 * helmets, or its chests when the bonus is keyed by the chest (Beetle armor: Scale Mail → offensive, Shell → defensive).
 */
function BonusPanel({ set, variants, armor }: { set: ArmorSet; variants: readonly SetVariant[]; armor: ReadonlyMap<number, ArmorPiece> }) {
  const groups = bonusGroups(variants)
  const labelled = bonusPieceCount(variants) > 1
  const shape = setShape(set)
  return (
    <PixelPanel as="section" aria-labelledby="armor-bonus-title" className="space-y-3">
      <h2 id="armor-bonus-title" className={SECTION_TITLE}>
        {copy.BONUS_HEADING}
      </h2>
      <p className="text-sm text-fg-muted">{copy.BONUS_INTRO}</p>
      <ul className={cx('grid gap-3', groups.length > 1 && 'md:grid-cols-2')}>
        {groups.map((g) => (
          <li key={g.text} className="space-y-2 border-2 border-panel-border bg-night-900 p-3" data-bonus-group={g.pieces.map((v) => v.bonusPieceId).join(',')}>
            {labelled ? (
              <p className="text-sm font-semibold">
                {copy.bonusFor(g.pieces.map((v) => `${armor.get(v.bonusPieceId)?.name ?? `#${v.bonusPieceId}`} (${classWords(v.classes).toLowerCase()})`).join(', '))}
              </p>
            ) : null}
            {shape.chests > 1 && !shape.chestKeyed ? <p className="text-xs text-fg-muted">{copy.anyChest(shape.chests)}</p> : null}
            <p className="text-base">
              <WikiQuote text={g.text} />
            </p>
            <BonusNumbers set={set} variant={g.variants[0]} />
          </li>
        ))}
      </ul>
      <ProvenanceLink href={set.wikiUrl} srContext={`set bonus of ${set.name}`} />
    </PixelPanel>
  )
}

function BonusNumbers({ set, variant }: { set: ArmorSet; variant: SetVariant }) {
  const stats = variant.setBonus.filter((e) => e.kind === 'stat')
  if (stats.length === 0) return <p className="text-xs text-fg-muted">{copy.BONUS_TEXT_ONLY}</p>
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs text-fg-muted">{copy.BONUS_NUMBERS}</p>
      <EffectItems effects={stats} wikiUrl={set.wikiUrl} />
    </div>
  )
}

/** More combinations than this (the Wizard set's 16) show one card at a time, chosen from a list. */
const MAX_TOTAL_CARDS = 4

/**
 * Full-set totals per wearable combination (AC1/AC2): defense, then each stat grouped as the AC words them, then the
 * text effects. Each group is its own labelled list (every term has its value — no heading posing as a term).
 */
function TotalsPanel({ set, totals, armor }: { set: ArmorSet; totals: readonly SetTotals[]; armor: ReadonlyMap<number, ArmorPiece> }) {
  const pickId = useId()
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const many = totals.length > MAX_TOTAL_CARDS
  const shown = many ? [totals.find((t) => t.variant.key === picked) ?? totals[0]] : totals
  const sameClasses = new Set(totals.map((t) => t.variant.classes.join('+'))).size === 1
  return (
    <PixelPanel as="section" aria-labelledby="armor-totals-title" className="space-y-3">
      <h2 id="armor-totals-title" className={SECTION_TITLE}>
        {copy.TOTALS_HEADING}
      </h2>
      <p className="text-sm text-fg-muted">{copy.TOTALS_INTRO}</p>
      {set.pieces.legs === undefined ? <p className="text-sm text-fg-muted" data-totals-legs-any="">{copy.TOTALS_LEGS_ANY}</p> : null}
      {many ? (
        <div className="max-w-md space-y-1">
          <label htmlFor={pickId} className={FIELD_LABEL}>
            {copy.totalsPickLabel(totals.length)}
          </label>
          <select id={pickId} value={shown[0].variant.key} onChange={(e) => setPicked(e.target.value)} className={PICK_FIELD} data-totals-pick="">
            {totals.map((t) => (
              <option key={t.variant.key} value={t.variant.key}>
                {/* the classes only when they differ between combinations (the card's title always says them) */}
                {sameClasses ? t.variant.label : `${t.variant.label} (${classWords(t.variant.classes).toLowerCase()})`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <ul className={cx('grid gap-3', shown.length > 1 && 'lg:grid-cols-2')}>
        {shown.map((t) => (
          <TotalsCard key={t.variant.key} set={set} t={t} armor={armor} titled={totals.length > 1} single={shown.length === 1} />
        ))}
      </ul>
    </PixelPanel>
  )
}

/**
 * Where a total comes from — a second description of the same term, on its own full-width row (inside the value
 * column it widened that column until the labels broke letter by letter at 375px).
 */
function Breakdown({ pieces, bonus }: { pieces: string | undefined; bonus: string }) {
  return <dd className="col-span-2 -mt-1 text-right text-xs text-fg-muted">{copy.breakdown(pieces, bonus)}</dd>
}

const PICK_FIELD = 'min-h-tap w-full border-2 border-panel-border bg-surface-sunken px-3 text-base text-fg focus:border-gold-600'
const TOTALS_DL = 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 text-sm'

function TotalsCard({ set, t, armor, titled, single }: { set: ArmorSet; t: SetTotals; armor: ReadonlyMap<number, ArmorPiece>; titled: boolean; single: boolean }) {
  const groupId = useId()
  return (
    <li className={cx('space-y-3 border-2 border-panel-border bg-night-900 p-3', single && 'max-w-2xl')} data-totals={t.variant.key}>
      {titled ? <h3 className="text-sm font-semibold">{copy.totalsFor(t.variant.label, classWords(t.variant.classes).toLowerCase())}</h3> : null}
      <dl className={TOTALS_DL}>
        <dt className="font-semibold">{copy.DEFENSE_LABEL}</dt>
        <dd className="text-right tabular-nums" data-total="defense">
          {t.defense.kind === 'unknown' ? <UnknownValue field={`totals:${t.variant.key}:defense`} sourceUrl={set.wikiUrl} /> : <span className="font-semibold">{t.defense.total}</span>}
        </dd>
        {t.defense.kind === 'known' && t.defense.bonus !== 0 ? <Breakdown pieces={t.defense.pieces === 0 ? undefined : String(t.defense.pieces)} bonus={statAmount('defense-flat', t.defense.bonus)} /> : null}
      </dl>
      {STAT_GROUPS.map((g) => {
        const lines = t.lines.filter((l) => statGroup(l.stat) === g.id)
        if (lines.length === 0) return null
        return (
          <div key={g.id} role="group" aria-labelledby={`${groupId}-${g.id}`} className="space-y-1.5">
            <p id={`${groupId}-${g.id}`} className={FIELD_LABEL}>
              {g.label}
            </p>
            <dl className={TOTALS_DL}>
              {lines.map((l) => (
                <Fragment key={l.key}>
                  <dt className="text-fg-muted">{statLabel(l.stat, l.scope)}</dt>
                  <dd className="text-right tabular-nums" data-total={l.key}>
                    <span className="font-semibold">{statAmount(l.stat, l.total)}</span>
                  </dd>
                  {l.bonus !== 0 ? <Breakdown pieces={l.pieces === 0 ? undefined : statAmount(l.stat, l.pieces)} bonus={statAmount(l.stat, l.bonus)} /> : null}
                </Fragment>
              ))}
            </dl>
          </div>
        )
      })}
      {t.lines.length === 0 && t.specials.length > 0 ? <p className="text-xs text-fg-muted">{copy.NO_STAT_LINES}</p> : null}
      {t.specials.length > 0 ? (
        <div className="space-y-1 text-sm">
          <p className={FIELD_LABEL}>{copy.SPECIALS_LABEL}</p>
          <ul className="space-y-1">
            {t.specials.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <WikiQuote text={s.effect.text} />
                <span className="text-xs text-fg-muted">— {s.from === 'bonus' ? copy.FROM_BONUS : (armor.get(s.from)?.name ?? `#${s.from}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {t.effectsUnknown.length > 0 ? <p className="text-xs text-fg-muted">{copy.effectsUnknown(t.effectsUnknown.map((id) => armor.get(id)?.name ?? `#${id}`).join(', '))}</p> : null}
    </li>
  )
}

/**
 * One armor piece of a set: its heading (the `#piece-<id>` hash target — an armor piece's link lands here), its
 * slot, defense, effects, rarity and game stage, and how to get it.
 */
export function ArmorPieceCard({ piece, sprites, variant, acquisition }: { piece: ArmorPiece; sprites: SpriteIndex | null; variant?: SetVariant; acquisition: ReactNode }) {
  const rarityView = getField(piece, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  return (
    <PixelPanel as="article" aria-labelledby={pieceAnchorId(piece.id)} className="space-y-4" data-piece={piece.id}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-slot shrink-0 place-items-center border-2 border-slot-border bg-slot">
          <SpriteImg src={piece.sprite} sprites={sprites} placeholder="material" box={40} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className={FIELD_LABEL}>{copy.SLOT_LABEL[piece.slot]}</p>
          <h3 id={pieceAnchorId(piece.id)} tabIndex={-1} className="scroll-mt-24 font-semibold leading-snug focus:outline-none md:text-lg">
            <RarityText rarity={rarity} tooltip>
              {piece.name}
            </RarityText>
          </h3>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2.5 text-sm md:max-w-3xl md:text-base">
        {variant ? (
          <>
            <dt className="text-fg-muted">{copy.PIECE_FOR[piece.slot]}</dt>
            <dd className="font-semibold" data-helmet-classes={variant.classes.join('+')}>
              {classWords(variant.classes)}
            </dd>
          </>
        ) : null}
        <PieceStatRows piece={piece} />
        <dt className="text-fg-muted">{copy.RARITY_ROW}</dt>
        <dd>
          <RarityValue record={piece} />
        </dd>
        <dt className="text-fg-muted">{copy.STAGE_LABEL}</dt>
        <dd>
          <StageValue record={piece} />
        </dd>
      </dl>
      {acquisition}
      <div className="flex flex-col gap-2 border-t-2 border-panel-border pt-3 md:flex-row md:flex-wrap md:items-center md:gap-x-4">
        <GrindButton id={piece.id} name={piece.name} className="w-full md:w-auto" />
        <ProvenanceLink href={piece.wikiUrl} srContext={`for ${piece.name}`} />
      </div>
    </PixelPanel>
  )
}

/** A piece's defense and effects rows (a set page's piece card, a loose piece's stats panel). */
export function PieceStatRows({ piece }: { piece: ArmorPiece }) {
  const defense = getField(piece, 'defense')
  return (
    <>
      <dt className="text-fg-muted">{copy.DEFENSE_ROW}</dt>
      <dd className="font-semibold tabular-nums" data-stat="defense">
        {defense.status === 'unverified' ? <UnknownValue field="defense" sourceUrl={piece.wikiUrl} /> : defense.status === 'not-applicable' ? '0' : String(defense.value)}
      </dd>
      <dt className="text-fg-muted">{copy.EFFECTS_ROW}</dt>
      <dd data-stat="effects">
        <EffectList record={piece} empty={copy.NO_EFFECTS} />
      </dd>
    </>
  )
}

/** AC3: the other sets at this set's VERIFIED stage, each linked, with a comparison link; honest when there is no verified stage. */
function PeersPanel({ set, sets }: { set: ArmorSet; sets: ReadonlyMap<string, ArmorSet> }) {
  const stage = verifiedStage(set)
  const peers = stagePeers(set, sets.values())
  return (
    <PixelPanel as="section" aria-labelledby="armor-peers-title" className="space-y-3">
      <h2 id="armor-peers-title" className={SECTION_TITLE}>
        {copy.PEERS_HEADING}
      </h2>
      {stage === undefined ? (
        <p className="flex gap-2 text-sm text-fg-muted" data-peers="unknown-stage">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{copy.PEERS_UNKNOWN}</span>
        </p>
      ) : peers.length === 0 ? (
        <p className="text-sm text-fg-muted" data-peers="none">
          {copy.PEERS_NONE}
        </p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">{copy.peersIntro(stageLabel(stage))}</p>
          <ul className="grid gap-2 md:grid-cols-2" data-peers={peers.length}>
            {peers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 border-2 border-panel-border bg-night-900 px-3 py-1" data-peer={p.id}>
                <Link to={armorSetHref(p.id)} className={cx('inline-flex min-h-tap items-center font-semibold', LINK)}>
                  {p.name}
                </Link>
                <Link to={armorCompareHref(set.id, p.id)} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)} data-peer-compare={p.id}>
                  <Columns3 aria-hidden="true" className="size-4" />
                  {copy.COMPARE_LINK}
                  <span className="sr-only">{copy.compareWithSr(set.name, p.name)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </PixelPanel>
  )
}

