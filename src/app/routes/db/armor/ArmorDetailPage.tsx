import { ArrowLeft, CircleHelp, Info } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { buttonClass } from '../../../../components/buttonStyles'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SpriteImg } from '../../../../components/SpriteImg'
import type { SpriteFallback } from '../../../../components/spriteFallback'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import { UnknownValue } from '../../../../components/UnknownValue'
import { peekDetailIndex } from '../../../../data-access'
import type { ArmorPiece, ArmorSet } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { hasRoute } from '../../../routes'
import { useHashTarget } from '../../../useHashTarget'
import { useDelayedFlag, useResource, type ResourceState } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import NotFoundPage from '../../NotFoundPage'
import { LOADOUT_PATH } from '../../loadout/loadoutLinks'
import { GrindButton } from '../../plan/GrindLink'
import { SPRITE_FALLBACK } from '../items/itemCopy'
import { refInfoFrom } from '../items/itemsData'
import { AcquisitionPanel, AcquisitionView } from '../weapons/AcquisitionView'
import { unknownCount } from '../weapons/weaponUnknowns'
import * as copy from './armorCopy'
import { ArmorCompare } from './ArmorCompare'
import { loadArmorData, loadArmorSections, peekArmorData, peekArmorSections, type ArmorData, type ArmorSectionsData } from './armorData'
import { compareState, resolveArmorId, setPieceIds, setTotals, variantsOf } from './armorModel'
import { ARMOR_ACQUISITION_ID, ARMOR_COMPARE_ID, ARMOR_PATH, armorListHref, armorSetHref, cameFromArmorList, COMPARE_HELMET_PARAM, COMPARE_SET_PARAM, HELMET_PARAM, pieceAnchorId } from './armorNav'
import { ArmorSetView, PieceStatRows } from './ArmorSetView'
import { pieceUnknowns } from './armorUnknowns'
import { FIELD_LABEL, HeaderFact, RarityValue, SECTION_TITLE, SourcesPanel, StageValue } from './EquipmentBits'

/** The Back link's id: where focus goes when Retry replaces the page's error panel (B113 M7 — never <body>). */
export const ARMOR_BACK_ID = 'armor-back'

/**
 * /armor/:id (PRD P6-S1; UX_SPEC §1). One route, two kinds of id (see armorNav.ts): a set's slug renders the set
 * page; an armor piece's id opens its set's page at the piece (`#piece-<id>`, the history entry replaced) or, for
 * a piece outside any set, the piece's own page. Anything else → styled 404 linking the armor list. The sets and
 * pieces load first (header, totals and comparison paint at once); each piece's "how to obtain" loads after.
 * Chunk failures → ErrorState with Retry (shell alive); skeletons only after 300ms (UX_SPEC §5.1).
 */
export default function ArmorDetailPage() {
  const { id = '' } = useParams()
  const resource = useResource('armor-data', loadArmorData, peekArmorData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const location = useLocation()
  const found = resource.status === 'ready' ? resolveArmorId(id, resource.data) : undefined

  useDocumentTitle(found?.kind === 'set' ? found.set.name : found?.kind === 'piece' ? found.piece.name : found?.kind === 'none' ? copy.NOT_FOUND_TITLE : copy.ARMOR_TITLE)

  if (found?.kind === 'none') return <NotFoundPage title={copy.NOT_FOUND_TITLE} message={copy.notFoundBody} action={{ to: ARMOR_PATH, label: copy.BACK_TO_ARMOR }} />
  // a piece in a set: its set's page, at the piece (replacing this entry, so Back skips the redirect)
  if (found?.kind === 'in-set') return <Navigate replace to={`${armorSetHref(found.set.id)}#${pieceAnchorId(found.pieceId)}`} state={location.state} />

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <BackLink />
      {resource.status === 'ready' && found?.kind === 'set' ? (
        <SetBody key={found.set.id} set={found.set} data={resource.data} />
      ) : resource.status === 'ready' && found?.kind === 'piece' ? (
        <LoosePieceBody key={found.piece.id} piece={found.piece} data={resource.data} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.DETAIL_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={ARMOR_BACK_ID} />
      ) : showSkeleton ? (
        <SkeletonPanel label={copy.DETAIL_LOADING} lines={8} />
      ) : (
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

function BackLink() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const fromList = cameFromArmorList(state)
  return (
    <Link
      id={ARMOR_BACK_ID}
      to={armorListHref()}
      onClick={(event) => {
        // Came from the list: go back in history so its filters AND scroll position restore.
        if (fromList && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
          event.preventDefault()
          navigate(-1)
        }
      }}
      className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
      {copy.BACK_TO_ARMOR}
    </Link>
  )
}

type SectionsResource = ResourceState<ArmorSectionsData> & { retry: () => void }

function SetBody({ set, data }: { set: ArmorSet; data: ArmorData }) {
  const [params, setParams] = useSearchParams()
  const variants = useMemo(() => variantsOf(set, data.armor), [set, data.armor])
  const totals = useMemo(() => variants.map((v) => setTotals(set, v, data.armor)), [set, variants, data.armor])
  const pieces = useMemo(() => setPieceIds(set).map((id) => data.armor.get(id)).filter((p): p is ArmorPiece => p !== undefined), [set, data.armor])
  const sections = useResource(`armor-sections:${set.id}`, () => loadArmorSections(pieces), () => peekArmorSections(pieces))
  const compare = useMemo(() => compareState(set, data.sets, data.armor, params), [set, data.sets, data.armor, params])
  // B113c: `#piece-<id>` (an armor piece's link), `#acq-title` (readiness "how to get it") and `#armor-compare-title`
  // (a stage peer's "Compare") — revealed once the pieces' "how to obtain" has settled, so nothing above shifts it
  useHashTarget([ARMOR_ACQUISITION_ID, ARMOR_COMPARE_ID, ...pieces.map((p) => pieceAnchorId(p.id))], sections.status !== 'loading')
  const onCompare = useCallback(
    (patch: { vs?: string | null; helmet?: string | null; vshelmet?: string | null }) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const put = (key: string, value: string | null | undefined) => {
            if (value === undefined) return
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          put(COMPARE_SET_PARAM, patch.vs)
          put(HELMET_PARAM, patch.helmet)
          put(COMPARE_HELMET_PARAM, patch.vshelmet)
          return next
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  )
  const ready = sections.status === 'ready' ? sections.data : undefined
  return (
    <ArmorSetView
      set={set}
      sets={data.sets}
      armor={data.armor}
      sprites={data.sprites}
      variants={variants}
      totals={totals}
      drops={ready?.acquisition.drops}
      acquisitionShown={ready !== undefined}
      acquisition={(piece) => <PieceAcquisition piece={piece} resource={sections} data={data} />}
      piecesNotice={sections.status === 'error' ? <ErrorState title={copy.ACQ_ERROR} error={sections.error} onRetry={sections.retry} retryFocusId={ARMOR_ACQUISITION_ID} /> : null}
      compare={<ArmorCompare set={set} sets={data.sets} state={compare} onChange={onCompare} />}
      compareRows={compare.other && compare.rows ? { rows: compare.rows, names: [set.name, compare.other.name] } : undefined}
    />
  )
}

/** A set piece's "how to obtain": the routes once loaded (a short status while loading; the section shows one error). */
function PieceAcquisition({ piece, resource, data }: { piece: ArmorPiece; resource: SectionsResource; data: ArmorData }) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <div className="space-y-3" data-piece-acquisition={piece.id}>
      <h4 className={FIELD_LABEL}>{copy.HOW_TO_OBTAIN}</h4>
      {resource.status === 'ready' ? (
        <AcquisitionView weapon={piece} noun="armor piece" headingLevel={5} data={resource.data.acquisition} weaponsById={peekDetailIndex('weapons')} sprites={data.sprites} refInfo={refInfoFrom(resource.data.docs)} />
      ) : resource.status === 'error' ? null : showSkeleton ? (
        <p role="status" className="text-sm text-fg-muted">
          {copy.ACQ_LOADING}
        </p>
      ) : (
        <div className="min-h-16" aria-hidden="true" />
      )}
    </div>
  )
}

/** A piece outside any set: its own page — header, stats, how to obtain, sources. */
function LoosePieceBody({ piece, data }: { piece: ArmorPiece; data: ArmorData }) {
  const sections = useResource(`armor-sections:piece:${piece.id}`, () => loadArmorSections([piece]), () => peekArmorSections([piece]))
  useHashTarget([ARMOR_ACQUISITION_ID], sections.status !== 'loading')
  const ready = sections.status === 'ready' ? sections.data : undefined
  const unknowns = pieceUnknowns(piece, ready?.acquisition.drops, ready !== undefined, false)
  const rarityView = getField(piece, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const [fallback, setFallback] = useState<SpriteFallback | undefined>(piece.sprite ? undefined : 'no-sprite')
  const showSkeleton = useDelayedFlag(sections.status === 'loading')
  const loadout = hasRoute('loadout') ? `${LOADOUT_PATH}?owned=${piece.id}` : undefined
  const setUnknown = getField(piece, 'setId').status === 'unverified'
  return (
    <div className="space-y-4 md:space-y-6">
      <PixelPanel as="header" className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="grid size-28 shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
          <SpriteImg src={piece.sprite} sprites={data.sprites} placeholder="material" box={96} full maxScale={4} onFallback={setFallback} />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className={FIELD_LABEL}>{copy.PIECE_BADGE}</p>
            <h1 className="min-w-0 font-display text-base leading-relaxed md:text-2xl">
              <RarityText rarity={rarity} tooltip>
                {piece.name}
              </RarityText>
            </h1>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-3">
            <HeaderFact label="Slot">
              <span className="font-semibold">{copy.SLOT_LABEL[piece.slot]}</span>
            </HeaderFact>
            <HeaderFact label={copy.RARITY_ROW}>
              <RarityValue record={piece} />
            </HeaderFact>
            <HeaderFact label={copy.STAGE_LABEL}>
              <StageValue record={piece} />
            </HeaderFact>
          </dl>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ProvenanceLink href={piece.wikiUrl} srContext={`for ${piece.name}`} />
            <PartiallyVerifiedBadge items={unknowns} />
          </div>
          <div className="flex flex-col gap-2 empty:hidden md:flex-row md:flex-wrap">
            <GrindButton id={piece.id} name={piece.name} className="w-full md:w-auto" />
            {loadout ? (
              <Link to={loadout} className={buttonClass('secondary', 'w-full md:w-auto')} data-loadout-link="">
                {copy.LOADOUT_LINK}
                <span className="sr-only">{copy.loadoutLinkSr(piece.name)}</span>
              </Link>
            ) : null}
          </div>
          {fallback ? (
            <p data-sprite-note={fallback} className="flex gap-2 text-sm text-fg-muted">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
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
      <PixelPanel as="section" aria-labelledby="piece-stats-title" className="space-y-4">
        <h2 id="piece-stats-title" className={SECTION_TITLE}>
          {copy.PIECE_STATS_HEADING}
        </h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2.5 md:max-w-3xl">
          <PieceStatRows piece={piece} />
          {/* dataset-scoped — never "no set bonus" as a fact; Unknown where the wiki ties it to a set this dataset can't record */}
          <dt className="text-fg-muted">{copy.SET_ROW}</dt>
          <dd data-stat="set">{setUnknown ? <UnknownValue field="setId" sourceUrl={piece.wikiUrl} /> : <span className="text-fg-muted">{copy.SET_NONE_RECORDED}</span>}</dd>
        </dl>
        <p className="flex gap-2 text-sm text-fg-muted" data-not-in-set={setUnknown ? 'unknown' : ''}>
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {setUnknown ? copy.SET_UNKNOWN_NOTE : copy.NOT_IN_SET}
        </p>
        <ProvenanceLink href={piece.wikiUrl} srContext={`stats for ${piece.name}`} />
      </PixelPanel>
      <AcquisitionPanel weapon={piece}>
        {sections.status === 'ready' ? (
          <AcquisitionView weapon={piece} noun="armor piece" data={sections.data.acquisition} weaponsById={peekDetailIndex('weapons')} sprites={data.sprites} refInfo={refInfoFrom(sections.data.docs)} />
        ) : sections.status === 'error' ? (
          <ErrorState title={copy.PIECE_ACQ_ERROR} error={sections.error} onRetry={sections.retry} retryFocusId={ARMOR_ACQUISITION_ID} />
        ) : showSkeleton ? (
          <p role="status" className="text-fg-muted">
            {copy.ACQ_LOADING}
          </p>
        ) : (
          <div className="min-h-24" aria-hidden="true" />
        )}
      </AcquisitionPanel>
      <SourcesPanel records={[piece]} sprites={data.sprites} summary={copy.SOURCES_SUMMARY} spriteCredit={copy.SPRITE_CREDIT} />
    </div>
  )
}
