import { CircleAlert, List } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ItemSlot } from '../../../components/ItemSlot'
import { asRarity } from '../../../components/rarity'
import { SpriteImg } from '../../../components/SpriteImg'
import type { SpriteIndex, WeaponListRecord } from '../../../data-access/types'
import { buildItemIds, type SavedBuild } from '../../../storage/builds'
import { useBuildsStore } from '../../buildsStore'
import { useResource } from '../../useResource'
import { BUILDS_VIEW_HREF, buildOpenHref } from '../loadout/loadoutLinks'
import { loadBuildPreviewData, peekBuildPreviewData, previewItems, type BuildPreviewData, type HomeResource } from './homeData'
import { RAIL_ALL, RAIL_EMPTY_BUILD, RAIL_QUARANTINE, RAIL_TITLE, railItems, railMeta, railPreview, railSaved } from './savedBuildsRailCopy'

/**
 * SavedBuildsRail (UX_SPEC §3.2; PRD P4-S4 AC4 "saved builds survive reload and appear on the
 * homepage"; AMENDMENTS-016 B106 queue): the loadouts saved in this browser (tc.v1.builds), newest
 * first, as a snap-scroll rail of cards — the name opening the build in the builder, its inputs, an
 * equip preview (weapons, armor and accessories as saved; ammo and potions counted) — with the full
 * list one link away (the builder's `?view=builds`). Shown only when builds exist (or some couldn't be
 * read — said, never silent, UX_SPEC §5.6). Its copy is its own (./savedBuildsRailCopy.ts): the rail
 * sits in the eager bundle and never pulls the builder's modules.
 */
const TITLE_ID = 'saved-builds-title'
const dateText = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium' })

export function SavedBuildsRail({ home }: { home: HomeResource }) {
  const builds = useBuildsStore((s) => s.builds)
  const loadStatus = useBuildsStore((s) => s.loadStatus)
  if (builds.length === 0 && loadStatus !== 'quarantined') return null
  return <SavedBuildsSection builds={builds} quarantined={loadStatus === 'quarantined'} home={home} />
}

export function SavedBuildsSection({ builds, quarantined, home }: { builds: readonly SavedBuild[]; quarantined: boolean; home: HomeResource }) {
  const previews = useResource('build-previews', loadBuildPreviewData, peekBuildPreviewData)
  const sorted = useMemo(() => [...builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)), [builds])
  const weapons = home.status === 'ready' ? home.data.weaponsById : undefined
  const sprites = home.status === 'ready' ? home.data.sprites : null
  return (
    <section aria-labelledby={TITLE_ID} className="space-y-3" data-saved-builds-rail="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={TITLE_ID} className="font-display text-base leading-relaxed text-accent text-shadow-pixel">
          {RAIL_TITLE}
        </h2>
        <Link to={BUILDS_VIEW_HREF} className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong" data-rail-all="">
          <List aria-hidden="true" className="size-4" />
          {RAIL_ALL}
        </Link>
      </div>
      {quarantined ? (
        <p role="status" className="flex gap-2 border-2 border-earth-600 bg-earth-900 p-2 text-sm" data-rail-quarantine="">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
          {RAIL_QUARANTINE}
        </p>
      ) : null}
      {sorted.length > 0 ? (
        // the RecentRail pattern: bleeds to the screen edges below md; 4px room keeps focus rings unclipped
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 scheme-dark [scrollbar-color:var(--color-stone-600)_transparent] md:-mx-1 md:scroll-px-1 md:px-1">
          {sorted.map((b) => (
            <li key={b.buildId} className="w-72 shrink-0 snap-start md:w-80" data-rail-build={b.buildId}>
              <BuildCard build={b} weapons={weapons} sprites={sprites} previews={previews.status === 'ready' ? previews.data : undefined} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function BuildCard({ build, weapons, sprites, previews }: { build: SavedBuild; weapons: ReadonlyMap<number, WeaponListRecord> | undefined; sprites: SpriteIndex | null; previews: BuildPreviewData | undefined }) {
  const ids = buildItemIds(build)
  const items = weapons && previews ? previewItems(ids, weapons, previews) : undefined
  return (
    <article aria-labelledby={`rail-${build.buildId}`} className="flex h-full flex-col gap-2 border-2 border-panel-border bg-panel p-3 shadow-pixel">
      <h3 id={`rail-${build.buildId}`} className="min-w-0">
        <Link to={buildOpenHref(build.buildId)} className="inline-flex min-h-tap items-center font-semibold break-words text-link underline decoration-1 underline-offset-4 hover:text-accent-strong" data-rail-open={build.buildId}>
          {build.name}
        </Link>
      </h3>
      <p className="text-xs text-fg-muted">{railMeta(build)}</p>
      {ids.length === 0 ? (
        <p className="text-sm text-fg-muted">{RAIL_EMPTY_BUILD}</p>
      ) : (
        <div role="group" aria-label={railPreview(build.name)} className="flex flex-wrap gap-1" data-rail-preview="">
          {items
            ? items.map((it, i) => (
                <ItemSlot
                  key={`${it.id}-${i}`}
                  item={{
                    name: it.name,
                    sprite: it.damageClass ? <SpriteImg src={it.sprite} sprites={sprites} damageClass={it.damageClass} box={32} /> : <SpriteImg src={it.sprite} sprites={sprites} placeholder="material" box={32} />,
                    rarity: asRarity(it.rarity),
                  }}
                />
              ))
            : // reserved while the names load: one square per saved item (no layout shift)
              ids.map((id, i) => <ItemSlot key={`${id}-${i}`} />)}
        </div>
      )}
      <p className="mt-auto text-xs text-fg-muted">
        {railItems(ids.length)} · {railSaved(dateText(build.updatedAt))}
      </p>
    </article>
  )
}
