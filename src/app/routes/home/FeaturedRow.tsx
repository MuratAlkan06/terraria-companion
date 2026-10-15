import { ChevronRight, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { CuratedLabel } from '../../../components/CuratedLabel'
import { cx } from '../../../components/cx'
import { NoBreak } from '../../../components/NoBreak'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { asRarity, rarityLabel } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { UnknownValue } from '../../../components/UnknownValue'
import { useBreakpoint } from '../../../components/useMediaQuery'
import type { Boss, SpriteIndex, WeaponListRecord } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import { useDelayedFlag } from '../../useResource'
import { ClassBadge } from '../db/weapons/WeaponBits'
import { stageLabel } from '../db/weapons/weaponDisplay'
import { weaponHref, WEAPONS_SOURCE_URL } from '../db/weapons/weaponNav'
import { pickFeaturedBoss, pickFeaturedWeapon, type HomeResource } from './homeData'

/**
 * FeaturedRow (UX_SPEC §3.2, PRD P2-S5 AC1): today's FeaturedWeaponCard + FeaturedBossCard,
 * picked per local day (./homeData.ts). Every link is real: the weapon card opens its detail
 * page; bosses have no local page yet, so the boss card opens the boss's wiki article in a new
 * tab, labeled as such. The boss card exists only when the boss dataset has records (A17).
 *
 * Composition (P2-S5 design review): both cards share one anatomy — eyebrow, sprite slot, name,
 * meta line, stat line, trailing affordance (chevron = in-app page, ↗ = wiki, new tab) — and one
 * slot size. From lg the slot grows so small sprites get a whole-number upscale instead of
 * sitting at 1× in a large empty box, capped at 3× (MAX_UPSCALE, design review: a 16px sword
 * would otherwise fill the slot at 9×); art bigger than the slot still gets an exact ½/⅓
 * (components/spriteScale). Heavy boss GIFs draw their still thumbnail (B30). The weapons source
 * link sits directly under the weapon card and says what it is — the wiki's weapons category,
 * not the item's own page (AMENDMENTS-007 B31).
 */
const TITLE_ID = 'featured-title'

const CARD =
  'group flex h-full flex-col gap-3 border-2 border-panel-border bg-panel p-4 text-fg shadow-pixel transition-colors duration-(--dur-ui) ease-out-strong hover:border-gold-600 md:p-5'
// Below 375px (B43) the sprite slot stacks above the text: the slot never shrinks and no-break
// stage terms stay whole; the trailing affordance moves up into the eyebrow row.
const ROW = 'flex flex-1 flex-col items-start gap-3 xs:flex-row xs:items-center xs:gap-4'
const SLOT = 'grid size-28 shrink-0 place-items-center border-2 border-slot-border bg-slot lg:size-40'
const EYEBROW = 'flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase'
const NAME = 'text-lg leading-snug font-semibold'
const TRAILING_ICON =
  'size-5 shrink-0 text-fg-muted transition-colors duration-(--dur-ui) ease-out-strong group-hover:text-accent'
/** Sprite box (px) inside SLOT (size-28 / lg:size-40, minus the 2px borders and a little air). */
const SPRITE_BOX = { base: 96, lg: 152 } as const
/** Largest whole-number sprite upscale in the featured slot (both cards share it). */
export const MAX_UPSCALE = 3
/**
 * Stretched link: the link's ::after covers the whole card (the card is `relative`), so the card
 * stays one click target while other controls in it (the "curated" toggletip) remain separate,
 * later-painted controls — never interactive content nested inside a link. The focus ring is
 * drawn around the card, where the global ring would sit (2px out from its border).
 */
const STRETCHED_LINK =
  "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-ring focus-visible:after:outline-solid"

export function FeaturedRow({ home }: { home: HomeResource }) {
  // Picked once per visit, so the cards never swap under the reader at midnight.
  const [today] = useState(() => new Date())
  const showSkeleton = useDelayedFlag(home.status === 'loading')
  const box = useBreakpoint('lg') ? SPRITE_BOX.lg : SPRITE_BOX.base
  const weapon = home.status === 'ready' ? pickFeaturedWeapon(home.data.weapons, today) : undefined
  const boss = home.status === 'ready' ? pickFeaturedBoss(home.data.bosses, today) : undefined

  if (home.status === 'ready' && !weapon && !boss) return null

  return (
    <section aria-labelledby={TITLE_ID} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id={TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none"
        >
          Featured today
        </h2>
        <p className="text-sm text-fg-muted">A new pick every day.</p>
      </div>

      {home.status === 'ready' ? (
        // Cards share row 1 (equal heights from md); the weapons source link sits under the
        // weapon card in every layout (single column: between the two cards).
        <div className={cx('grid gap-x-6 gap-y-2', weapon && boss && 'md:grid-cols-2')}>
          {weapon ? <FeaturedWeaponCard weapon={weapon} sprites={home.data.sprites} box={box} /> : null}
          {weapon ? (
            <ProvenanceLink
              href={WEAPONS_SOURCE_URL}
              label="Source: Weapons category, terraria.wiki.gg"
              srContext="(the wiki list today’s weapon comes from; its own wiki page is linked from its detail page)"
              className="justify-self-start md:col-start-1 md:row-start-2"
            />
          ) : null}
          {boss ? (
            <FeaturedBossCard boss={boss} sprites={home.data.sprites} box={box} className={weapon ? 'max-md:mt-2' : undefined} />
          ) : null}
        </div>
      ) : home.status === 'error' ? (
        <ErrorState title="Couldn’t load today’s featured picks" error={home.error} onRetry={home.retry} retryFocusId={TITLE_ID} />
      ) : showSkeleton ? (
        <div className="grid gap-4 md:grid-cols-2 md:gap-6">
          <SkeletonPanel label="Loading today’s featured picks…" lines={2} />
          <SkeletonPanel lines={2} className="max-md:hidden" />
        </div>
      ) : (
        // Reserve roughly the cards' + source link's height until the skeleton is due (no layout jump).
        <div className="min-h-106 md:min-h-60 lg:min-h-72" aria-hidden="true" />
      )}
    </section>
  )
}

interface CardProps {
  sprites: SpriteIndex | null
  /** Sprite box edge in CSS px (SPRITE_BOX for the current breakpoint). */
  box: number
}

function FeaturedWeaponCard({ weapon, sprites, box }: CardProps & { weapon: WeaponListRecord }) {
  const rarity = asRarity(weapon.rarity)
  return (
    <Link to={weaponHref(weapon.id)} className={CARD}>
      <span className={EYEBROW}>
        Weapon of the day
        <ChevronRight aria-hidden="true" className={cx(TRAILING_ICON, 'xs:hidden')} />
      </span>
      <span className={ROW}>
        <span className={SLOT}>
          <SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={box} maxScale={MAX_UPSCALE} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <RarityText rarity={rarity} className={NAME}>
            {weapon.name}
          </RarityText>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <ClassBadge damageClass={weapon.damageClass} />
            {rarity === undefined ? null : <span className="text-fg-muted">{rarityLabel(rarity)}</span>}
          </span>
          <span className="text-sm">
            <span className="text-fg-muted">Damage </span>
            <span className="font-semibold tabular-nums">{weapon.damage}</span>
          </span>
        </span>
        <ChevronRight aria-hidden="true" className={cx(TRAILING_ICON, 'max-xs:hidden')} />
      </span>
    </Link>
  )
}

function FeaturedBossCard({ boss, sprites, box, className }: CardProps & { boss: Boss; className?: string }) {
  const stage = getField(boss, 'stage')
  return (
    <div className={cx(CARD, 'relative', className)}>
      <span className={EYEBROW}>
        Boss of the day
        <ExternalLink aria-hidden="true" className={cx(TRAILING_ICON, 'xs:hidden')} />
      </span>
      <span className={ROW}>
        <span className={SLOT}>
          {/* Same generic creature placeholder as search rows (B32), never the "?" Unknown glyph. */}
          <SpriteImg src={boss.sprite} sprites={sprites} placeholder="creature" box={box} maxScale={MAX_UPSCALE} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <a href={boss.wikiUrl} target="_blank" rel="noopener noreferrer" className={cx(NAME, 'text-shadow-pixel', STRETCHED_LINK)}>
            {boss.name}
            <span className="sr-only"> on the Terraria Wiki (opens in a new tab)</span>
          </a>
          {stage.status === 'not-applicable' ? null : (
            <span className="text-sm">
              <span className="text-fg-muted">Stage </span>
              {stage.status === 'unverified' ? (
                <UnknownValue field="stage" interactive={false} />
              ) : (
                <NoBreak>
                  <span className="font-semibold">{stageLabel(String(stage.value))}</span>
                </NoBreak>
              )}
              {/* DATA_SCHEMA_SPEC §2.1 rule 4: curated (overlay-only) fields are labeled (B33 wording). */}
              {stage.status === 'editorial' ? (
                <>
                  <span className="text-fg-muted"> · </span>
                  <CuratedLabel />
                </>
              ) : null}
            </span>
          )}
          <span aria-hidden="true" className="text-sm text-fg-muted">
            via Terraria Wiki
          </span>
        </span>
        <ExternalLink aria-hidden="true" className={cx(TRAILING_ICON, 'max-xs:hidden')} />
      </span>
    </div>
  )
}
