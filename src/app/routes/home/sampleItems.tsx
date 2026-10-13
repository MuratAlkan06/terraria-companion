/**
 * Sample items for the interface-kit preview on the P1 home view.
 * Names, stats and sprites are made up for demonstration and are labelled as such
 * in the UI — they are NOT game data (REQUIREMENTS §13: never present fake data as
 * official). Sprites are original pixel art drawn with PixelCanvas.
 */
import type { ReactNode } from 'react'
import { PixelCanvas } from '../../../components/art/pixelCanvas'
import { PixelArt, type PixelPalette } from '../../../components/PixelArt'
import type { ItemSlotItem } from '../../../components/ItemSlot'
import type { TerrariaTooltipData } from '../../../components/TerrariaTooltip'

const PALETTE: PixelPalette = {
  k: 'var(--color-night-950)',
  W: 'var(--color-white)',
  w: 'var(--color-stone-200)',
  s: 'var(--color-stone-400)',
  o: 'var(--color-gold-400)',
  O: 'var(--color-gold-600)',
  t: 'var(--color-earth-400)',
  T: 'var(--color-earth-600)',
  c: 'var(--color-night-200)',
  C: 'var(--color-night-400)',
  p: 'var(--color-forest-400)',
  P: 'var(--color-forest-200)',
}

const sword = new PixelCanvas(16, 16)
  .line(5, 9, 12, 2, 'W')
  .line(5, 10, 13, 2, 'w')
  .line(6, 10, 13, 3, 's')
  .set(14, 1, 'w')
  .line(3, 8, 7, 12, 'o')
  .line(2, 13, 4, 11, 'T')
  .set(1, 14, 'O')
  .outline()
  .rows()

const bow = new PixelCanvas(16, 16)
  .line(10, 1, 7, 3, 't')
  .line(7, 3, 6, 5, 't')
  .line(6, 5, 6, 10, 't')
  .line(6, 10, 7, 12, 't')
  .line(7, 12, 10, 14, 't')
  .line(8, 2, 7, 4, 'T')
  .line(7, 11, 8, 13, 'T')
  .rect(5, 7, 2, 2, 'O')
  .line(11, 1, 11, 14, 'w')
  .outline()
  .rows()

const potion = new PixelCanvas(16, 16)
  .rect(6, 1, 4, 2, 't')
  .rect(6, 3, 4, 2, 'c')
  .rect(3, 5, 10, 9, 'c')
  .set(3, 5, '.')
  .set(12, 5, '.')
  .set(3, 13, '.')
  .set(12, 13, '.')
  .rect(4, 8, 8, 5, 'p')
  .rect(4, 8, 8, 1, 'P')
  .set(4, 6, 'W')
  .set(4, 7, 'W')
  .outline()
  .rows()

const crystal = (() => {
  const art = new PixelCanvas(16, 16)
  for (let y = 2; y <= 13; y++) {
    const half = y <= 7 ? y - 1 : 14 - y
    for (let x = 8 - half; x < 8 + half; x++) art.set(x, y, x < 8 ? 'c' : 'C')
  }
  return art.set(6, 5, 'W').set(7, 4, 'W').set(5, 6, 'W').outline().rows()
})()

function sprite(rows: string[]): ReactNode {
  return <PixelArt rows={rows} palette={PALETTE} className="size-full" />
}

const SAMPLE_NOTE = 'Sample values — not game data'

export interface SampleItem extends ItemSlotItem {
  tooltip: TerrariaTooltipData
}

export const SAMPLE_ITEMS: readonly SampleItem[] = [
  {
    name: 'Sample Broadsword',
    sprite: sprite(sword),
    rarity: 2,
    tooltip: {
      name: 'Sample Broadsword',
      rarity: 2,
      lines: [
        { text: '14 melee damage' },
        { text: '4% critical strike chance' },
        { text: 'Fast speed' },
        { text: 'Average knockback' },
        { text: 'A practice blade for previewing tooltips', tone: 'flavor' },
      ],
      footnote: SAMPLE_NOTE,
    },
  },
  {
    name: 'Sample Bow',
    sprite: sprite(bow),
    rarity: 1,
    tooltip: {
      name: 'Sample Bow',
      rarity: 1,
      lines: [
        { text: '9 ranged damage' },
        { text: '4% critical strike chance' },
        { text: 'Average speed' },
        { text: 'Uses arrows as ammo', tone: 'muted' },
      ],
      footnote: SAMPLE_NOTE,
    },
  },
  {
    name: 'Sample Tonic',
    sprite: sprite(potion),
    stack: 30,
    rarity: 3,
    tooltip: {
      name: 'Sample Tonic',
      rarity: 3,
      lines: [
        { text: 'Consumable', tone: 'muted' },
        { text: '+10% movement speed', tone: 'positive' },
        { text: '-5% defense', tone: 'negative' },
      ],
      footnote: SAMPLE_NOTE,
    },
  },
  {
    name: 'Sample Crystal',
    sprite: sprite(crystal),
    stack: 12,
    rarity: 4,
    tooltip: {
      name: 'Sample Crystal',
      rarity: 4,
      lines: [
        { text: 'Material', tone: 'muted' },
        { text: 'It hums faintly in the dark', tone: 'flavor' },
      ],
      footnote: SAMPLE_NOTE,
    },
  },
]
