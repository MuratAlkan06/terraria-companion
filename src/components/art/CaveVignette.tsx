import { PixelArt, type PixelPalette } from '../PixelArt'
import { PixelCanvas } from './pixelCanvas'

/**
 * "Lost in the caverns" — original 48x24 pixel-art vignette for the 404 page
 * (UX_SPEC §1, AMENDMENTS-001 A12). A torch-lit cave with stalactites, a
 * wooden "?" signpost and a crystal cluster. Drawn procedurally from the
 * profiles below; not derived from any Re-Logic asset.
 */
const W = 48
const H = 24

// Rock depth per column from the top (ceiling) and bottom (floor).
const CEILING = [3, 3, 4, 4, 3, 2, 2, 3, 3, 4, 5, 4, 3, 3, 2, 2, 3, 4, 4, 3, 2, 3, 3, 4, 4, 5, 4, 3, 2, 2, 3, 3, 4, 3, 3, 2, 3, 4, 4, 4, 3, 2, 2, 3, 3, 4, 3, 3]
const FLOOR = [5, 5, 4, 4, 4, 5, 5, 4, 4, 3, 3, 3, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6]
const STALACTITES: Array<[x: number, length: number]> = [[5, 3], [11, 5], [19, 3], [27, 6], [35, 3], [43, 4]]
const STALAGMITES: Array<[x: number, length: number]> = [[2, 2], [16, 3], [46, 2]]

const TORCH = ['.f.', 'fyf', 'fyf', '.w.', '.w.', '.w.']
const SIGN = [
  'WWWWWWWWW',
  'WwwwwwwwW',
  'WwwkkkwwW',
  'WwkwwwkwW',
  'WwwwwkwwW',
  'WwwwkwwwW',
  'WwwwwwwwW',
  'WwwwkwwwW',
  'WWWWWWWWW',
  '....T....',
  '....T....',
  '....T....',
]
const CRYSTALS = ['...c..', '..cC.c', '.ccCcC', 'cCCcCC']

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
  // upward-facing floor pixels get moss in two patches.
  const snapshot = art.rows()
  const open = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && snapshot[y][x] === '.'
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (snapshot[y][x] !== 'R') continue
      const mossy = open(x, y - 1) && y > H / 2 && ((x >= 7 && x <= 14) || (x >= 29 && x <= 34))
      if (mossy) art.set(x, y, 'm')
      else if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) art.set(x, y, 'r')
    }
  }
  // Dirt seam along the bottom two rows.
  for (let x = 0; x < W; x++) {
    art.set(x, H - 1, (x * 7) % 5 === 0 ? 'D' : 'd')
    art.set(x, H - 2, (x * 3) % 4 === 0 ? 'd' : 'D')
  }

  art.stamp(8, 7, TORCH)
  art.stamp(20, 8, SIGN)
  art.stamp(37, 16, CRYSTALS)
  return art.rows()
}

const SCENE_ROWS = buildScene()

const SCENE_PALETTE: PixelPalette = {
  R: 'var(--color-stone-800)',
  r: 'var(--color-stone-600)',
  m: 'var(--color-forest-500)',
  d: 'var(--color-earth-700)',
  D: 'var(--color-earth-800)',
  f: { fill: 'var(--color-gold-400)', className: 'motion-safe:animate-flicker' },
  y: { fill: 'var(--color-gold-200)', className: 'motion-safe:animate-flicker' },
  w: 'var(--color-earth-400)',
  W: 'var(--color-earth-400)',
  T: 'var(--color-earth-600)',
  k: 'var(--color-night-950)',
  c: 'var(--color-night-200)',
  C: 'var(--color-night-400)',
}

export function CaveVignette({ className }: { className?: string }) {
  return (
    <PixelArt
      rows={SCENE_ROWS}
      palette={SCENE_PALETTE}
      className={className}
      underlay={
        <>
          <defs>
            <radialGradient id="cave-torch-glow">
              <stop offset="0" style={{ stopColor: 'var(--color-gold-400)', stopOpacity: 0.35 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-gold-400)', stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id="cave-crystal-glow">
              <stop offset="0" style={{ stopColor: 'var(--color-night-400)', stopOpacity: 0.4 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-night-400)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <circle cx="9.5" cy="8.5" r="11" fill="url(#cave-torch-glow)" />
          <circle cx="40" cy="18" r="8" fill="url(#cave-crystal-glow)" />
        </>
      }
    />
  )
}
