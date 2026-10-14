/* P3-S11 render math (pure): the blast ring's radius accuracy and timing, reduced motion, the flash disc, a thrown explosive's tumble, its fuse spark and resting stack, the debuff marker and glyphs. */
import { describe, expect, it } from 'vitest'
import { ART_PX_PER_TILE, buildDebuffIcon, buildTagIcon, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { ARENA_PALETTE, tokenProperty } from './art/arenaPalette'
import { debuffGlyph, debuffMarker, DEBUFF_BESIDE_TAG_TILES, DEBUFF_TINT_TOKENS } from './debuffVisuals'
import {
  BLAST_FADE_MS,
  BLAST_GROW_MS,
  BLAST_STATIC_MS,
  blastPose,
  discSpans,
  ExplosiveStack,
  explosiveRotation,
  fuseSparkCells,
  fuseTip,
  restingStackOffsets,
  ringCells,
  SPARK_STEP_TICKS,
  topmostOpaque,
} from './explosiveVisuals'
import { STACK_SPREAD_TILES, STACK_STEP_TILES, TAG_MARKER_LIFT_TILES } from './summonVisuals'

const px = GAME_PX_PER_ART_PX

describe('blast ring (radius-accurate, on the art-pixel grid)', () => {
  it('every cell straddles the blast circle: its centre within one cell of radius × 16 game px; a full, symmetric ring', () => {
    for (const radiusTiles of [4, 7.8, 8.75]) {
      const r = radiusTiles * GAME_PX_PER_TILE
      const center = { x: 6 * GAME_PX_PER_TILE, y: 1 * GAME_PX_PER_TILE }
      const cells = ringCells(center, r, px)
      expect(cells.length, String(radiusTiles)).toBeGreaterThan((2 * Math.PI * r) / px) // closed, at least one cell all round
      for (const [x, y] of cells) {
        expect(Number.isInteger(x / px) && Number.isInteger(y / px)).toBe(true) // on the art-pixel grid
        expect(Math.abs(Math.hypot(x + px / 2 - center.x, y + px / 2 - center.y) - r)).toBeLessThanOrEqual(px)
      }
      // the extremes of the ring sit at the radius on every side (within a cell)
      const xs = cells.map(([x]) => x + px / 2)
      const ys = cells.map(([, y]) => y + px / 2)
      expect(Math.max(...xs) - center.x).toBeCloseTo(r, -0.5)
      expect(center.x - Math.min(...xs)).toBeCloseTo(r, -0.5)
      expect(Math.max(...ys) - center.y).toBeCloseTo(r, -0.5)
      expect(center.y - Math.min(...ys)).toBeCloseTo(r, -0.5)
    }
    expect(ringCells({ x: 0, y: 0 }, 1, px)).toEqual([]) // under one art pixel: nothing
  })

  it('the flash disc: one span per pixel row, all inside the circle', () => {
    const r = 4 * GAME_PX_PER_TILE
    const spans = discSpans({ x: 0, y: 0 }, r, px)
    expect(spans.length).toBeGreaterThan(r / px)
    for (const [x, y, w] of spans) {
      expect(w).toBeGreaterThan(0)
      expect(Math.hypot(x, y + px / 2)).toBeLessThanOrEqual(r + px)
      expect(Math.hypot(x + w, y + px / 2)).toBeLessThanOrEqual(r + px)
    }
  })

  it('grows from the centre to the full radius, then fades; reduced motion: one static frame of the full ring, held, then gone', () => {
    expect(blastPose(0, false)).toEqual({ radiusFrac: 0, ringAlpha: 1, flashAlpha: 0.45 })
    const mid = blastPose(BLAST_GROW_MS / 2, false)
    expect(mid?.radiusFrac).toBeGreaterThan(0.5) // ease-out
    expect(mid?.radiusFrac).toBeLessThan(1)
    expect(blastPose(BLAST_GROW_MS, false)).toEqual({ radiusFrac: 1, ringAlpha: 1, flashAlpha: 0 })
    expect(blastPose(BLAST_GROW_MS + BLAST_FADE_MS / 2, false)?.ringAlpha).toBeCloseTo(0.5, 9)
    expect(blastPose(BLAST_GROW_MS + BLAST_FADE_MS, false)).toBeNull()
    for (const t of [0, 1, BLAST_STATIC_MS / 2, BLAST_STATIC_MS - 1]) expect(blastPose(t, true)).toEqual({ radiusFrac: 1, ringAlpha: 1, flashAlpha: 0.25 })
    expect(blastPose(BLAST_STATIC_MS, true)).toBeNull()
    expect(blastPose(-1, false)).toBeNull()
  })

  it('a thrown explosive tumbles in quarter turns while it moves, lies upright at rest', () => {
    const flying = { x: 2, y: 0.5, prevX: 1.7, prevY: 0.45 }
    const resting = { x: 6, y: 1, prevX: 6, prevY: 1 }
    expect(explosiveRotation(resting, 7, 1)).toBe(0)
    const turns = [0, 3, 6, 9].map((t) => explosiveRotation(flying, t, 1))
    expect(turns).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
    expect(explosiveRotation(flying, 3, -1)).toBe(-Math.PI / 2)
  })
})

describe('debuff marker over a dummy (PRD P3-S11 AC2)', () => {
  const dummy = { x: 6, y: 0, height: 3, tag: null, debuffs: [] as { buffId: string; remainingTicks: number; durationTicks: number }[] }
  it('none without a debuff; over the head with the longest-running debuff’s share left; beside a whip tag', () => {
    expect(debuffMarker(dummy)).toBeNull()
    const debuffed = { ...dummy, debuffs: [{ buffId: 'frostbite', remainingTicks: 210, durationTicks: 420 }, { buffId: 'on-fire', remainingTicks: 60, durationTicks: 300 }] }
    expect(debuffMarker(debuffed)).toEqual({ x: 6, y: -1.5 - TAG_MARKER_LIFT_TILES, left: 0.5, buffId: 'frostbite', glyph: 'frost', count: 2 })
    const tagged = { ...debuffed, tag: { remainingTicks: 100, durationTicks: 240, damageFlat: 4, critPct: null } }
    expect(debuffMarker(tagged)?.x).toBe(6 + DEBUFF_BESIDE_TAG_TILES)
    // the icons never overlap side by side: half the tag's width + half the widest glyph's, in art px
    const widest = Math.max(...(['flame', 'frost', 'drop'] as const).map((g) => buildDebuffIcon(g)[0].length))
    expect(DEBUFF_BESIDE_TAG_TILES * ART_PX_PER_TILE).toBeGreaterThan(buildTagIcon()[0].length / 2 + widest / 2)
    // the marker's glyph is the longest-running debuff's: On Fire! outlasting Frostbite shows a flame
    const fire = { ...dummy, debuffs: [{ buffId: 'frostbite', remainingTicks: 30, durationTicks: 420 }, { buffId: 'on-fire', remainingTicks: 200, durationTicks: 300 }] }
    expect(debuffMarker(fire)).toMatchObject({ buffId: 'on-fire', glyph: 'flame' })
  })

  it('one glyph per kind of debuff (design review P3-S11 #4): Frostbite a snowflake, On Fire! a flame, others the drop — distinct shapes, token colours', () => {
    expect(debuffGlyph('frostbite')).toBe('frost')
    expect(debuffGlyph('frostburn')).toBe('frost')
    expect(debuffGlyph('on-fire')).toBe('flame')
    expect(debuffGlyph('hellfire')).toBe('flame')
    for (const id of ['bleeding', 'poisoned', 'acid-venom', 'some-future-debuff']) expect(debuffGlyph(id), id).toBe('drop')
    const icons = { flame: buildDebuffIcon('flame'), frost: buildDebuffIcon('frost'), drop: buildDebuffIcon('drop') }
    expect(buildDebuffIcon()).toEqual(icons.drop)
    // three different shapes (not recolours of one): their silhouettes differ
    const shape = (rows: string[]) => rows.map((r) => r.replace(/[^.]/g, '#')).join('/')
    expect(new Set(Object.values(icons).map(shape)).size).toBe(3)
    for (const [glyph, rows] of Object.entries(icons)) {
      for (const row of rows) expect(row.length, glyph).toBe(rows[0].length)
      for (const ch of new Set(rows.join(''))) {
        if (ch === '.') continue
        expect(tokenProperty(ARENA_PALETTE[ch]), `${glyph} "${ch}"`).toMatch(/^--color-[a-z]+(-\d+)?$/)
      }
      // each glyph's tint is a colour it is drawn in (its bar matches its icon), except the drop's red
      const tint = DEBUFF_TINT_TOKENS[glyph as keyof typeof DEBUFF_TINT_TOKENS]
      if (glyph !== 'drop') expect(rows.join('').split('').some((ch) => ARENA_PALETTE[ch] === `var(--color-${tint})`), glyph).toBe(true)
    }
  })
})

describe('a fused explosive’s spark and a resting pile (design review P3-S11 #9)', () => {
  it('sparks at the fuse end every tick: two poses alternating; reduced motion: one static glow', () => {
    const tip = { x: 100, y: 40 }
    const a = fuseSparkCells(tip, 0, false, px)
    const b = fuseSparkCells(tip, SPARK_STEP_TICKS, false, px)
    expect(a.core).toEqual([[100, 40]])
    expect(a.glow).not.toEqual(b.glow)
    expect(fuseSparkCells(tip, 2 * SPARK_STEP_TICKS, false, px)).toEqual(a) // it loops
    for (const cells of [a, b]) for (const [x, y] of [...cells.core, ...cells.glow]) expect(Number.isInteger(x / px) && Number.isInteger(y / px)).toBe(true)
    // nothing below the fuse end (the fuse and the explosive are there)
    for (const [, y] of [...a.glow, ...b.glow]) expect(y).toBeLessThanOrEqual(40)
    const still = [0, 1, 5, 9, 77].map((t) => fuseSparkCells(tip, t, true, px))
    for (const frame of still) expect(frame).toEqual(still[0])
    // the fuse end is the sprite's topmost opaque pixel (a bomb's fuse curling up-left), turned with it
    const sprite = [
      '..#.....', // the fuse tip: row 0, column 2
      '...#....',
      '..####..',
      '.######.',
      '.######.',
      '..####..',
    ]
    const alpha = sprite.join('').split('').map((ch) => (ch === '#' ? 255 : 0))
    const top = topmostOpaque(alpha, 8, 6)
    expect(top).toEqual({ x: 2.5 - 4, y: 0.5 - 3 })
    expect(topmostOpaque(new Array(16).fill(0), 4, 4)).toBeNull()
    expect(fuseTip({ x: 10, y: 20 }, top!, 0)).toEqual({ x: 8.5, y: 17.5 })
    const turned = fuseTip({ x: 10, y: 20 }, { x: 0, y: -8 }, Math.PI / 2) // a quarter turn clockwise: the top points right
    expect(turned.x).toBeCloseTo(18, 9)
    expect(turned.y).toBeCloseTo(20, 9)
  })

  it('explosives resting on one spot fan out toward the player, oldest in place; one alone or in flight is not moved', () => {
    const rest = (id: number, x = 6) => ({ id, x, y: 1, prevX: x, prevY: 1 })
    expect(restingStackOffsets([rest(1)], 0).size).toBe(0)
    const pile = restingStackOffsets([rest(3), rest(1), rest(2)], 0)
    expect(pile.get(1)).toBeUndefined()
    expect(pile.get(2)).toBeCloseTo(-STACK_STEP_TILES, 9)
    expect(pile.get(3)).toBeCloseTo(-2 * STACK_STEP_TILES, 9)
    // a big pile stays within the spread; one still flying is not part of it
    const big = restingStackOffsets([...Array.from({ length: 10 }, (_, i) => rest(i + 1)), { id: 99, x: 6, y: 1, prevX: 5.8, prevY: 0.9 }], 0)
    expect(Math.min(...big.values())).toBeGreaterThanOrEqual(-STACK_SPREAD_TILES - 1e-9)
    expect(big.has(99)).toBe(false)
    // the player on the other side: the fan goes the other way
    expect(restingStackOffsets([rest(1), rest(2)], 20).get(2)).toBeCloseTo(STACK_STEP_TILES, 9)
    // frame by frame: a newcomer slides to its place (at once under reduced motion); a gone one is forgotten
    const stack = new ExplosiveStack()
    stack.update([rest(1)], 0, 16, false)
    const sliding = stack.update([rest(1), rest(2)], 0, 16, false).get(2) ?? 0
    expect(sliding).toBeCloseTo(-STACK_STEP_TILES, 9) // a newcomer starts at its goal (no slide in from nowhere)
    const reduced = new ExplosiveStack()
    reduced.update([rest(1), rest(2), rest(3)], 0, 16, true)
    // the oldest goes off: the others slide one step back toward the spot (instantly under reduced motion)
    expect(reduced.update([rest(2), rest(3)], 0, 16, true).get(3)).toBeCloseTo(-STACK_STEP_TILES, 9)
    const smooth = new ExplosiveStack()
    smooth.update([rest(1), rest(2), rest(3)], 0, 16, false)
    const moved = smooth.update([rest(2), rest(3)], 0, 16, false).get(3) ?? 0
    expect(moved).toBeLessThan(-STACK_STEP_TILES) // on its way, not there yet
    expect(moved).toBeGreaterThan(-2 * STACK_STEP_TILES)
  })
})
