import { HeroScene } from '../../../components/art/HeroScene'
import {
  DEFAULT_HERO_SCENE,
  HERO_SCENES,
  type HeroSceneDef,
  type HeroSceneId,
} from '../../../components/art/hero/heroScenes'
import { meta } from '../../../data/meta'
import { SITE } from '../../site'

/**
 * Homepage hero (UX_SPEC §3.2, PRD P1-S2 AC1): full-bleed original pixel-art
 * scene with the site identity over the sky. No primary-action buttons yet —
 * their targets (/loadout, /lab, /bosses) haven't shipped, so they are absent.
 */
function heroScene(): HeroSceneDef {
  // Dev-only variant preview for design review: `/?hero=<id>`. The branch is
  // compiled out of production builds, which always ship DEFAULT_HERO_SCENE.
  if (import.meta.env.DEV) {
    const id = new URLSearchParams(window.location.search).get('hero')
    if (id && id in HERO_SCENES) return HERO_SCENES[id as HeroSceneId]
  }
  return DEFAULT_HERO_SCENE
}

export function HomeHero() {
  const scene = heroScene()

  return (
    <section
      aria-labelledby="home-title"
      className="relative isolate overflow-hidden border-b-2 border-night-950 bg-night-950"
    >
      <HeroScene scene={scene} className="absolute inset-0 -z-10 size-full" />
      {/* Scrim behind the title block only: top-down on small screens (faded out at
          the far right from md so the moon stays bright), left-to-right on desktop.
          Keeps hero text >= 4.5:1 over stars, peaks and snow in every variant. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-b from-night-950/80 via-night-950/55 via-40% to-transparent to-65% md:mask-r-from-80% lg:bg-linear-to-r lg:from-night-950/60 lg:via-night-950/25 lg:via-35% lg:to-transparent lg:to-60%"
      />
      <div className="mx-auto flex min-h-112 max-w-7xl flex-col px-4 pt-10 pb-8 md:min-h-120 md:px-6 md:pt-14 lg:min-h-136 lg:pt-20">
        <h1
          id="home-title"
          className="font-display text-2xl leading-snug text-accent text-shadow-pixel md:text-display-lg lg:text-display-xl lg:text-shadow-pixel-lg"
        >
          {SITE.name}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-fg md:mt-5 md:text-lg">
          Your fan-made field guide to vanilla Terraria {meta.gameVersion}, built on wiki data.
        </p>
      </div>
    </section>
  )
}
