import { ChevronDown, Columns3, FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../../components/buttonStyles'
import { FavoriteStar } from '../../../../components/FavoriteStar'
import { PartiallyVerifiedBadge } from '../../../../components/PartiallyVerifiedBadge'
import { PixelPanel } from '../../../../components/PixelPanel'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityColor, rarityLabel } from '../../../../components/rarity'
import { RarityText } from '../../../../components/RarityText'
import { SendToLabButton } from '../../../../components/SendToLabButton'
import { SpriteImg } from '../../../../components/SpriteImg'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { AcquisitionData } from '../../../../data-access'
import type { SpriteIndex, Weapon } from '../../../../data-access/types'
import { offersLab } from '../../../../lab/labLinks'
import type { DamageClass } from '../../../../schemas'
import { getField, type FieldView } from '../../../../schemas/getField'
import { hasRoute } from '../../../routes'
import { GrindButton } from '../../plan/GrindLink'
import { compareHref } from '../compare/compareLinks'
import { ClassBadge } from './WeaponBits'
import { BASE_CRIT_PCT, labBlurb, sourceTitle, stageLabel, weaponStatRows } from './weaponDisplay'
import { weaponPageUnknowns } from './weaponUnknowns'

/**
 * Weapon detail v1 body (PRD P2-S3 AC3/AC4, UX_SPEC §3.3): DetailHeader, StatsPanel,
 * behavior + Lab note, and the acquisition slot. Pure presentation over one record, so tests
 * can render it for every weapon and check Unknown markers against `_prov.unverifiedFields`.
 */
export interface WeaponDetailViewProps {
  weapon: Weapon
  sprites: SpriteIndex | null
  /**
   * The acquisition section's loaded indexes (undefined while loading / on error). The header's
   * partially-verified badge counts the Unknowns of the drop records shown there too.
   */
  acquisitionData: AcquisitionData | undefined
  /** The acquisition section (loads its own indexes on the page; injected directly in tests). */
  acquisition: ReactNode
}

export function WeaponDetailView({ weapon, sprites, acquisitionData, acquisition }: WeaponDetailViewProps) {
  return (
    <div className="space-y-4 md:space-y-6">
      <DetailHeader weapon={weapon} sprites={sprites} acquisitionData={acquisitionData} />
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <StatsPanel weapon={weapon} />
        <BehaviorPanel weapon={weapon} />
      </div>
      {acquisition}
      <SourcesPanel weapon={weapon} sprites={sprites} />
    </div>
  )
}

function unknownOr(view: FieldView, field: string, weapon: Weapon, render: (value: unknown) => ReactNode): ReactNode {
  if (view.status === 'unverified') return <UnknownValue field={field} sourceUrl={weapon.wikiUrl} />
  return render(view.value)
}

function HeaderFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</dt>
      <dd className="flex min-h-6 items-center">{children}</dd>
    </div>
  )
}

function DetailHeader({
  weapon,
  sprites,
  acquisitionData,
}: {
  weapon: Weapon
  sprites: SpriteIndex | null
  acquisitionData: AcquisitionData | undefined
}) {
  const rarityView = getField(weapon, 'rarity')
  const rarity = rarityView.status === 'verified' ? asRarity(rarityView.value as number | string) : undefined
  const classView = getField(weapon, 'damageClass')
  const stageView = getField(weapon, 'stage')
  // Every Unknown on the page, including drop-record cells (design review P2-S3 #1).
  const unknowns = weaponPageUnknowns(weapon, acquisitionData?.drops)

  return (
    <PixelPanel as="header" className="flex flex-col gap-4 sm:flex-row sm:items-start md:gap-6">
      <div className="grid size-28 shrink-0 place-items-center border-2 border-slot-border bg-slot shadow-pixel">
        {/* Detail page: always the full sprite file, never a thumbnail (B30). */}
        <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={96} full />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="min-w-0 font-display text-base leading-relaxed md:text-2xl">
            <RarityText rarity={rarity} tooltip>
              {weapon.name}
            </RarityText>
          </h1>
          {/* UX_SPEC §3.3 DetailHeader FavoriteStar (P7-S1); the negative margin aligns the 44px target's star with the title. */}
          <FavoriteStar entityRef={`i:${weapon.id}`} name={weapon.name} className="-mt-2.5 -mr-2" />
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          {classView.status === 'not-applicable' ? (
            <HeaderFact label="Class">
              <ClassBadge damageClass={undefined} />
            </HeaderFact>
          ) : (
            <HeaderFact label="Class">
              {unknownOr(classView, 'damageClass', weapon, (v) => (
                <ClassBadge damageClass={v as DamageClass} />
              ))}
            </HeaderFact>
          )}
          {rarityView.status === 'not-applicable' ? null : (
            <HeaderFact label="Rarity">
              {unknownOr(rarityView, 'rarity', weapon, () =>
                rarity === undefined ? (
                  String(rarityView.value)
                ) : (
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span aria-hidden="true" className="size-3 border-2 border-night-950" style={{ backgroundColor: rarityColor(rarity) }} />
                    {rarityLabel(rarity)}
                  </span>
                ),
              )}
            </HeaderFact>
          )}
          {stageView.status === 'not-applicable' ? null : (
            <HeaderFact label="Game stage">
              {unknownOr(stageView, 'stage', weapon, (v) => <span className="font-semibold">{stageLabel(v as string)}</span>)}
            </HeaderFact>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ProvenanceLink href={weapon.wikiUrl} srContext={`for ${weapon.name}`} />
          <PartiallyVerifiedBadge items={unknowns} />
        </div>
        {/* ActionRow (UX_SPEC §3.3): SendToLabButton · "Compare" · "What Should I Grind For?" (Feature B, P6-S5); each present only when it applies. */}
        <div className="flex flex-col gap-2 empty:hidden md:flex-row md:flex-wrap">
          <SendToLabButton weapon={weapon} className="w-full md:w-auto" />
          <CompareLink weapon={weapon} className="w-full md:w-auto" />
          <GrindButton id={weapon.id} name={weapon.name} className="w-full md:w-auto" />
        </div>
      </div>
    </PixelPanel>
  )
}

/**
 * "Compare" (UX_SPEC §3.3 ActionRow; PRD P4-S1): opens the comparison with this weapon in it
 * (`/compare?w=:id`). Absent until the compare route ships — never a dead button.
 */
function CompareLink({ weapon, className }: { weapon: Weapon; className?: string }) {
  if (!hasRoute('compare')) return null
  return (
    <Link to={compareHref([weapon.id])} className={buttonClass('secondary', className)} data-compare-link={weapon.id}>
      <Columns3 aria-hidden="true" className="size-5" />
      Compare<span className="sr-only"> {weapon.name} with other weapons</span>
    </Link>
  )
}

function StatsPanel({ weapon }: { weapon: Weapon }) {
  const rows = weaponStatRows(weapon)
  const shows = (key: string) => rows.some((r) => r.key === key && r.text !== undefined)
  return (
    <PixelPanel as="section" aria-labelledby="stats-title" className="space-y-4">
      <h2 id="stats-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        Stats
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2.5">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-fg-muted">{row.label}</dt>
            <dd className="font-semibold tabular-nums">
              {row.text ?? <UnknownValue field={row.field} sourceUrl={weapon.wikiUrl} />}
            </dd>
          </div>
        ))}
      </dl>
      {shows('useTime') || shows('crit') ? (
        <ul className="space-y-1 text-xs text-fg-muted">
          {shows('useTime') ? <li>Use time is in game ticks (60 ticks = 1 second), as on the wiki.</li> : null}
          {shows('crit') ? <li>Critical chance includes the universal {BASE_CRIT_PCT}% base.</li> : null}
        </ul>
      ) : null}
      <ProvenanceLink href={weapon.wikiUrl} srContext={`stats for ${weapon.name}`} />
    </PixelPanel>
  )
}

function BehaviorPanel({ weapon }: { weapon: Weapon }) {
  const behavior = getField(weapon, 'behaviorText')
  const text = behavior.status === 'verified' || behavior.status === 'editorial' ? (behavior.value as string) : undefined
  const lab = weapon.labBehavior
  // When no verified behaviour text exists the pipeline stores a pointer to the wiki instead
  // (pipeline/validate/labDowngrade.ts `limitation()`): not a description, and the link below
  // already says it, so it isn't repeated (design review P2-S3: no "here's what it does" + link only).
  const wikiPointer = `See the ${weapon.name} wiki page for its in-game behavior.`
  const labText =
    lab.kind === 'limitation' && lab.inGameBehavior !== text && lab.inGameBehavior !== wikiPointer ? lab.inGameBehavior : undefined
  const labSource = lab.kind === 'limitation' ? lab.sourceUrl : weapon.wikiUrl
  // Equippable in the Lab now (the header's "Test in Weapon Lab" opens it); otherwise still coming.
  const inLab = offersLab(weapon)
  // What trying it in the Lab shows, by archetype family (thrown explosives: blast radius, per-dummy damage).
  const blurb = inLab ? labBlurb(weapon) : undefined

  return (
    <PixelPanel as="section" aria-labelledby="behavior-title" className="space-y-4">
      <h2 id="behavior-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        In-game behavior
      </h2>
      {text ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Item tooltip</p>
          {/* A15: wiki-derived strings are plain text; rendered as text, never as HTML. */}
          <p className="whitespace-pre-line">{text}</p>
        </div>
      ) : null}
      <div className="space-y-2 border-l-4 border-gold-600 bg-night-900 px-4 py-3">
        <p className="flex items-center gap-2 font-semibold">
          <FlaskConical aria-hidden="true" className="size-5 shrink-0 text-accent" />
          {/* No forward promise: the Lab doesn't simulate it, and that's all this says (design review P3-S1). */}
          {inLab ? 'Simulated in the Weapon Lab' : labText ? 'Not simulated in the Weapon Lab — here’s what it does in-game' : 'Not simulated in the Weapon Lab'}
        </p>
        {blurb ? (
          <p className="text-sm text-fg-muted" data-lab-blurb="">
            {blurb}
          </p>
        ) : labText ? (
          <p className="text-sm whitespace-pre-line text-fg-muted">{labText}</p>
        ) : (
          <p className="text-sm text-fg-muted">
            {text ? 'The item tooltip above and the wiki describe how it behaves in-game.' : 'The wiki describes how it behaves in-game.'}
          </p>
        )}
        <ProvenanceLink href={labSource} label="How it behaves, on the wiki" srContext={`(${weapon.name})`} />
      </div>
    </PixelPanel>
  )
}

function SourcesPanel({ weapon, sprites }: { weapon: Weapon; sprites: SpriteIndex | null }) {
  const sprite = weapon.sprite ? sprites?.byPath.get(weapon.sprite) : undefined
  return (
    <details className="group border-2 border-panel-border bg-surface px-4 py-2 text-sm">
      <summary className="flex min-h-tap items-center justify-between gap-3 font-semibold text-fg-muted group-open:text-fg [&::-webkit-details-marker]:hidden">
        Where this data comes from
        {/* Open/closed state as a glyph too (the native marker is hidden by flex). */}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 transition-transform duration-(--dur-ui) ease-out-strong group-open:rotate-180"
        />
      </summary>
      <ul className="space-y-2 pt-2 pb-2">
        {weapon._prov.sources.map((source, i) => {
          // The kind and the page it was read from: an explosive's class table and its own article are two sources.
          const { label, page } = sourceTitle(source)
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2" data-source-kind={source.kind}>
              <span>
                {label}
                {page ? (
                  <>
                    : <span className="font-semibold" data-source-page="">{page}</span>
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
            <span>Sprite © Re-Logic</span>
            <ProvenanceLink href={sprite.wikiFileUrl} label="Wiki file page" srContext={`for the ${weapon.name} sprite`} />
          </li>
        ) : null}
      </ul>
    </details>
  )
}
