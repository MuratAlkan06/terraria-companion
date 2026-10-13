import { useId } from 'react'
import { PixelArt, type PixelPalette } from '../PixelArt'
import { hash2 } from './hero/sceneKit'
import { PixelCanvas } from './pixelCanvas'

/**
 * "Lost in the caverns" — original 48x24 pixel-art vignette for the 404 page
 * (UX_SPEC §1, AMENDMENTS-001 A12). A torch-lit cave with stalactites, a
 * wooden "?" signpost and a crystal cluster. Drawn procedurally from the
 * profiles below; not derived from any Re-Logic asset.
 *
 * Texture pass (design review M3): brick-textured back wall instead of empty
 * air, dithered deep rock + speckle, plank seams and a frame on the sign, and
 * crystal glints, so no large flat fills remain at desktop size. Lights are
 * drawn over the pixels so they fall on the wall and rock.
 */
const W = 48
const H = 24

// Rock depth per column from the top (ceiling) and bottom (floor).
const CEILING = [3, 3, 4, 4, 3, 2, 2, 3, 3, 4, 5, 4, 3, 3, 2, 2, 3, 4, 4, 3, 2, 3, 3, 4, 4, 5, 4, 3, 2, 2, 3, 3, 4, 3, 3, 2, 3, 4, 4, 4, 3, 2, 2, 3, 3, 4, 3, 3]
const FLOOR = [5, 5, 4, 4, 4, 5, 5, 4, 4, 3, 3, 3, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6]
const STALACTITES: Array<[x: number, length: number]> = [[5, 3], [11, 5], [19, 3], [27, 6], [35, 3], [43, 4]]
const STALAGMITES: Array<[x: number, length: number]> = [[2, 2], [16, 3], [46, 2]]

const TORCH = ['.f.', 'fyf', 'fyf', '.w.', '.T.', '.T.']
const SIGN = [
  'FFFFFFFFF',
  'FHHHHHHHF',
  'FwwkkkwwF',
  'FwkPPPkwF',
  'FwwwwkwwF',
  'FPPPkPPPF',
  'FwwwwwwwF',
  'FwwwkwwwF',
  'FFFFFFFFF',
  '....T....',
  '....t....',
  '....T....',
]
const CRYSTALS = ['...G..', '..cC.G', '.cGCcC', 'cCCcCC']

function buildScene(): string[] {
  const art = new PixelCanvas(W, H)
  for (let x = 0; x < W; x++) {
    art.rect(x, 0, 1, CEILING[x], 'R')
    art.rect(x, H - FLOOR[x], 1, FLOOR[x], 'R')
  }
  for (const [x, length] of STALACTITES) {
    art.rect(x, CEILING[x], 1, length, 'R')
    if (length >= 4) art.rect(x + 1, CEILING[x + 1], 1, Math.ceil(length / 2), 'R')
  }
  for (const [x, length] of STALAGMITES) art.rect(x, H - FLOOR[x] - length, 1, length, 'R')

  // Rock rim: rock pixels touching open air get the lighter edge colour;
  // upward-facing floor pixels get moss in two patches. Rock two or more
  // pixels from the air is dithered toward the deep tone; the rest is speckled.
  const snapshot = art.rows()
  const open = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && snapshot[y][x] === '.'
  const nearOpen = (x: number, y: number, d: number) => {
    for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) if (open(x + i, y + j)) return true
    return false
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (snapshot[y][x] !== 'R') {
        // Back wall seen through the cave: staggered 3x2 bricks of varying tone.
        const row = y >> 1
        const brick = hash2((x + row * 2) >> 1, row, 5)
        art.set(x, y, y % 2 === 0 && hash2(x, y, 6) < 0.5 ? 'b' : brick < 0.35 ? 'b' : hash2(x, y, 7) > 0.92 ? 'e' : 'a')
        continue
      }
      const mossy = open(x, y - 1) && y > H / 2 && ((x >= 7 && x <= 14) || (x >= 29 && x <= 34))
      if (mossy) art.set(x, y, hash2(x, y, 1) < 0.35 ? 'g' : 'm')
      else if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) art.set(x, y, 'r')
      else if (!nearOpen(x, y, 1) && hash2(x >> 1, y, 8) < 0.45) art.set(x, y, 'Q')
      else if (hash2(x, y, 2) < 0.14) art.set(x, y, 'p')
    }
  }
  // Dirt seam along the bottom two rows, with pebble speckle.
  for (let x = 0; x < W; x++) {
    art.set(x, H - 1, (x * 7) % 5 === 0 ? 'D' : 'd')
    art.set(x, H - 2, (x * 3) % 4 === 0 ? 'd' : hash2(x, 3, 4) < 0.2 ? 'p' : 'D')
  }

  art.stamp(8, 7, TORCH)
  art.stamp(20, 8, SIGN)
  art.stamp(37, 16, CRYSTALS)
  return art.rows()
}

const SCENE_ROWS = buildScene()

const SCENE_PALETTE: PixelPalette = {
  R: 'var(--color-stone-800)',
  Q: 'var(--color-stone-900)',
  p: 'var(--color-stone-700)',
  r: 'var(--color-stone-600)',
  a: 'var(--color-stone-950)',
  b: 'var(--color-night-950)',
  e: 'var(--color-stone-900)',
  m: 'var(--color-forest-500)',
  g: 'var(--color-forest-400)',
  d: 'var(--color-earth-700)',
  D: 'var(--color-earth-800)',
  f: { fill: 'var(--color-gold-400)', className: 'motion-safe:animate-flicker' },
  y: { fill: 'var(--color-gold-200)', className: 'motion-safe:animate-flicker' },
  w: 'var(--color-earth-400)',
  H: 'var(--color-earth-300)',
  P: 'var(--color-earth-500)',
  F: 'var(--color-earth-600)',
  T: 'var(--color-earth-600)',
  t: 'var(--color-earth-700)',
  k: 'var(--color-night-950)',
  c: 'var(--color-night-200)',
  C: 'var(--color-night-400)',
  G: 'var(--color-white)',
}

export function CaveVignette({ className }: { className?: string }) {
  const uid = useId()
  return (
    <PixelArt
      rows={SCENE_ROWS}
      palette={SCENE_PALETTE}
      className={className}
      overlay={
        <>
          <defs>
            <radialGradient id={`${uid}torch`}>
              <stop offset="0" style={{ stopColor: 'var(--color-gold-400)', stopOpacity: 0.32 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-gold-400)', stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id={`${uid}crystal`}>
              <stop offset="0" style={{ stopColor: 'var(--color-night-200)', stopOpacity: 0.3 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-night-200)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <circle cx="9.5" cy="8.5" r="11" fill={`url(#${uid}torch)`} />
          <circle cx="40" cy="18" r="8" fill={`url(#${uid}crystal)`} />
        </>
      }
    />
  )
}
