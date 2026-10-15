import { useId } from 'react'
import { cx } from '../cx'
import { PixelArt } from '../PixelArt'
import { HERO_ANIMATED_CHARS, HERO_PALETTE } from './hero/heroPalette'
import type { Glow, GlowTone, HeroSceneDef } from './hero/heroScenes'
import { splitAnimated } from './hero/sceneKit'

/**
 * Renders a procedural hero scene so it covers its box like a background image
 * (`xMidYMax slice`: the ground stays anchored, the sides crop). Decorative:
 * aria-hidden. Two stacked SVGs with identical geometry:
 *  - base: the full static scene, rasterised once;
 *  - live: only the twinkling/flickering pixels plus soft glows, on its own
 *    compositing layer so stepped animations never re-rasterise the base.
 */
interface SceneLayers {
  base: string[]
  animated: string[]
  glows: Glow[]
}

const cache = new Map<string, SceneLayers>()

function sceneLayers(def: HeroSceneDef): SceneLayers {
  let layers = cache.get(def.id)
  if (!layers) {
    const data = def.build()
    layers = { ...splitAnimated(data.rows, HERO_ANIMATED_CHARS), glows: data.glows }
    cache.set(def.id, layers)
  }
  return layers
}

const GLOW_TOKEN: Record<GlowTone, string> = {
  moon: 'var(--color-gold-200)',
  crystal: 'var(--color-night-200)',
  warm: 'var(--color-gold-400)',
}

const TONES = Object.keys(GLOW_TOKEN) as GlowTone[]
const FIT = 'xMidYMax slice'

export function HeroScene({ scene, className }: { scene: HeroSceneDef; className?: string }) {
  const layers = sceneLayers(scene)
  const uid = useId()
  const gradientId = (tone: GlowTone) => `${uid}glow-${tone}`

  return (
    <div aria-hidden="true" className={cx('pointer-events-none', className)}>
      <PixelArt rows={layers.base} palette={HERO_PALETTE} preserveAspectRatio={FIT} className="absolute inset-0 size-full" />
      <PixelArt
        rows={layers.animated}
        palette={HERO_PALETTE}
        preserveAspectRatio={FIT}
        className="absolute inset-0 size-full will-change-transform"
        overlay={
          <>
            <defs>
              {TONES.map((tone) => (
                <radialGradient key={tone} id={gradientId(tone)}>
                  <stop offset="0" style={{ stopColor: GLOW_TOKEN[tone], stopOpacity: 0.9 }} />
                  <stop offset="0.35" style={{ stopColor: GLOW_TOKEN[tone], stopOpacity: 0.35 }} />
                  <stop offset="1" style={{ stopColor: GLOW_TOKEN[tone], stopOpacity: 0 }} />
                </radialGradient>
              ))}
            </defs>
            {layers.glows.map((glow) => (
              <g key={`${glow.x},${glow.y}`} opacity={glow.strength}>
                <circle
                  cx={glow.x}
                  cy={glow.y}
                  r={glow.r}
                  fill={`url(#${gradientId(glow.tone)})`}
                  className={glow.pulse ? 'motion-safe:animate-glow' : undefined}
                />
              </g>
            ))}
          </>
        }
      />
    </div>
  )
}
