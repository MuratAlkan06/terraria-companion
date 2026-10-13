/**
 * The renderer's pure math (no PixiJS needed): floating damage numbers (UX_SPEC §9/§12) and their
 * collision-free layout (design review P3-S1 H1), the blade sprite transform + arc guide (PRD P3-S1
 * AC2/AC4) and the pixel-perfect camera with its scene / action framings (ADR-001 D5; design review
 * H3, M6).
 */
import { describe, expect, it } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { ARENA_CORE_X, ARENA_LAYOUT, ARENA_SET_PIECES, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import {
  bladeSpriteTransform,
  DEG,
  guideCells,
  interpolateBlade,
  spriteTipOffset,
  streakCells,
  swingEndAngle,
  swingStartAngle,
  THRUST_HAND,
  THRUST_LUNGE,
  thrustVisual,
  trailSpan,
} from './blade'
import { actionBox, DEFAULT_CAMERA, fitCamera, PLAYER_TOP_Y, screenToWorld, visibleWorldX, worldToScreen, type CameraFit, type CameraOptions } from './camera'
import {
  FLOAT_GAP_X,
  FLOAT_GAP_Y,
  FLOAT_MS,
  FLOAT_RISE_PX,
  FloatLayout,
  floatPose,
  readsAsPartOfNumber,
  RecyclingPool,
  rectsOverlap,
  type FloatBounds,
  type FloatRect,
} from './floatingNumbers'
import { createLabSession } from './labSession'
import { labWeapons } from './labWeapons'

/** The swing renderer's subjects: every equippable swung weapon (thrusts draw no arc or guide). */
const weapons = labWeapons(weaponsJson as Weapon[]).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')
const byName = (name: string) => weapons.find((w) => w.name === name)!
/** Every equippable thrust weapon (spears, shortswords), with its sprite's size from the sprite manifest. */
const thrusts = labWeapons(weaponsJson as Weapon[])
  .filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'thrust')
  .map((weapon) => {
    const file = manifest.files.find((f) => f.path === weapon.sprite)
    if (!file?.width || !file.height) throw new Error(`no sprite size for ${weapon.name}`)
    return { weapon, width: file.width, height: file.height }
  })

/**
 * Rendered damage-number boxes, as measured in the browser (Press Start 2P BitmapFonts): one glyph
 * advance per digit (16 px normal, 24 px crit) plus the outline drawn outside it (4 / 7 px).
 */
const numberSize = (amount: number, crit: boolean) => {
  const [advance, stroke] = crit ? [24, 7] : [16, 4]
  return { w: String(amount).length * advance + stroke, h: advance + stroke }
}

/**
 * Two numbers collide — or read as one composite ("14" + "16" → "1416") — when they come closer
 * than the clear space: FLOAT_GAP_X side by side, FLOAT_GAP_Y stacked. Strict overlap included.
 */
const tooClose = (a: FloatRect, b: FloatRect) => rectsOverlap(a, b, FLOAT_GAP_X - 1e-6, FLOAT_GAP_Y - 1e-6)

interface Viewport {
  name: string
  fit: CameraFit
  bounds: FloatBounds
}

/** The Lab at 375 (phone, action framing) and 1024 (narrow centre column between both panels). */
function viewports(weapon: Weapon): Viewport[] {
  const created = createLabSession(weapon, { seed: () => 1 })
  if (!created.ok) throw new Error('refused')
  const box = actionBox(created.session.swing!.reachTiles, created.session.sim.renderState().dummies)
  const phone = fitCamera(360, 447, 1, { framing: 'action', insetTop: 138, insetBottom: 52, action: box })
  const desk = fitCamera(436, 668, 1, { insetTop: 160 })
  return [
    { name: '375', fit: phone, bounds: { left: 0, top: 138, right: 360, bottom: 447 - 52 } },
    { name: '1024', fit: desk, bounds: { left: 0, top: 160, right: 436, bottom: 668 - 56 } },
  ]
}

/** Drives a real session at 60 fps with attack held; returns every damage event with its time (ms). */
function sustainedAttack(weapon: Weapon, seconds: number, seed = 7) {
  const created = createLabSession(weapon, { seed: () => seed })
  if (!created.ok) throw new Error('refused')
  const s = created.session
  s.press('key')
  const hits: { at: number; amount: number; crit: boolean; x: number; y: number }[] = []
  const frameMs = 1000 / 60
  for (let f = 0; f < seconds * 60; f++) {
    for (const e of s.frame(frameMs).events) if (e.type === 'damage') hits.push({ at: f * frameMs, amount: e.amount, crit: e.crit, x: e.x, y: e.y })
  }
  return hits
}

/** Places every hit through a FloatLayout and checks all live boxes, every `stepMs`, for any pair that is too close. */
function playOut(hits: ReturnType<typeof sustainedAttack>, view: Viewport, reduced: boolean, stepMs = 4) {
  const layout = new FloatLayout<number>()
  let overlaps = 0
  let evictions = 0
  let maxLive = 0
  let next = 0
  const end = (hits.at(-1)?.at ?? 0) + FLOAT_MS
  for (let now = 0; now <= end; now += stepMs) {
    for (; next < hits.length && hits[next].at <= now; next++) {
      const h = hits[next]
      const p = worldToScreen(view.fit, h.x, h.y)
      const size = numberSize(h.amount, h.crit)
      evictions += layout.place(next, h.at, { x: p.x, y: p.y - 4 }, size, h.crit, reduced, view.bounds).evicted.length
    }
    const rects = layout.rectsAt(now, reduced)
    maxLive = Math.max(maxLive, rects.length)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (tooClose(rects[i], rects[j])) overlaps++
  }
  return { overlaps, evictions, maxLive }
}

describe('floating damage numbers', () => {
  it('rise and fade over 600 ms, then expire', () => {
    expect(FLOAT_MS).toBe(600)
    expect(floatPose(0, false, false)).toEqual({ dy: -0, alpha: 1, scale: 1 })
    let lastDy = 1
    let lastAlpha = 2
    for (let t = 0; t < FLOAT_MS; t += 25) {
      const pose = floatPose(t, false, false)!
      expect(pose.dy).toBeLessThanOrEqual(lastDy) // moving up (y down is positive)
      expect(pose.alpha).toBeLessThanOrEqual(lastAlpha)
      lastDy = pose.dy
      lastAlpha = pose.alpha
    }
    expect(floatPose(FLOAT_MS - 1, false, false)!.dy).toBeCloseTo(-FLOAT_RISE_PX, 0)
    expect(floatPose(FLOAT_MS - 1, false, false)!.alpha).toBeLessThan(0.01)
    expect(floatPose(FLOAT_MS, false, false)).toBeNull()
    expect(floatPose(-1, false, false)).toBeNull()
  })

  it('crits pop larger at first (size, on top of the bigger outlined font — never colour alone)', () => {
    expect(floatPose(0, true, false)!.scale).toBeGreaterThan(1.2)
    expect(floatPose(FLOAT_MS / 2, true, false)!.scale).toBe(1)
    expect(floatPose(0, false, false)!.scale).toBe(1)
  })

  it('reduced motion: no drift, no pop — the number fades in place', () => {
    for (const crit of [false, true]) {
      for (let t = 0; t < FLOAT_MS; t += 50) {
        const pose = floatPose(t, crit, true)!
        expect(pose.dy).toBe(0)
        expect(pose.scale).toBe(1)
      }
      expect(floatPose(0, crit, true)!.alpha).toBe(1)
      expect(floatPose(FLOAT_MS - 1, crit, true)!.alpha).toBeLessThan(0.01)
    }
  })

  it('the pool never allocates past capacity: a burst recycles the oldest live number', () => {
    let created = 0
    const pool = new RecyclingPool(3, () => ({ n: created++ }))
    const [a, b, c] = [pool.acquire(), pool.acquire(), pool.acquire()]
    expect(created).toBe(3)
    expect(pool.acquire()).toBe(a) // recycled, not allocated
    expect(created).toBe(3)
    expect(pool.active).toEqual([b, c, a])
    pool.release(b)
    expect(pool.acquire()).toBe(b) // freed items are reused first
    pool.releaseAll()
    expect(pool.active).toHaveLength(0)
    expect(pool.size).toBe(3)
  })
})

describe('damage-number layout: never two numbers on top of each other (design review H1)', () => {
  const glove = byName('Bladed Glove')
  const hits = sustainedAttack(glove, 60)

  it('the fixture is a real sustained Bladed Glove attack (its 8.57/s cadence, crits included)', () => {
    expect(glove.useAnimationTicks).toBe(Math.min(...weapons.map((w) => w.useAnimationTicks ?? Infinity)))
    expect(hits.length).toBeGreaterThan(500)
    expect(hits.filter((h) => h.crit).length).toBeGreaterThan(5)
    expect(hits[1].at - hits[0].at).toBeCloseTo((7 * 1000) / 60, 6) // 8 ticks, auto-swing one sooner
  })

  for (const reduced of [false, true]) {
    it(`${reduced ? 'reduced motion (stacked in place)' : 'rising'}: zero overlapping boxes at 375 and 1024, nothing dropped`, () => {
      for (const view of viewports(glove)) {
        const run = playOut(hits, view, reduced)
        expect(run.overlaps, view.name).toBe(0)
        // The layout has room for every number at this cadence: none is retired early.
        expect(run.evictions, view.name).toBe(0)
        expect(run.maxLive, view.name).toBeGreaterThanOrEqual(5)
      }
    })
  }

  it('the fastest high-damage weapons (3-digit crits) stay overlap-free too', () => {
    for (const weapon of [...weapons].sort((a, b) => (a.useAnimationTicks ?? 0) - (b.useAnimationTicks ?? 0) || (b.damage ?? 0) - (a.damage ?? 0)).slice(0, 3)) {
      const run = sustainedAttack(weapon, 20, 3)
      for (const view of viewports(weapon)) {
        for (const reduced of [false, true]) {
          const result = playOut(run, view, reduced)
          expect(result.overlaps, `${weapon.name} ${view.name}`).toBe(0)
          expect(result.evictions, `${weapon.name} ${view.name}`).toBe(0)
        }
      }
    }
  })

  it('a burst far faster than any weapon still never overlaps: it retires normal hits, never a crit for a normal hit', () => {
    const layout = new FloatLayout<{ crit: boolean }>()
    const bounds = { left: 0, top: 0, right: 360, bottom: 400 }
    let overlaps = 0
    let critsDroppedForNormals = 0
    for (let i = 0; i < 200; i++) {
      const now = i * 12
      const crit = i % 5 === 0
      const placed = layout.place({ crit }, now, { x: 180, y: 200 }, numberSize(crit ? 128 : 64, crit), crit, false, bounds)
      if (!crit) critsDroppedForNormals += placed.evicted.filter((e) => e.crit).length
      for (let t = now; t < now + 12; t += 2) {
        const rects = layout.rectsAt(t, false)
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) if (tooClose(rects[a], rects[b])) overlaps++
      }
    }
    expect(overlaps).toBe(0)
    expect(critsDroppedForNormals).toBe(0)
  })

  it('keeps clear space between boxes, prefers the impact point, and stays inside the bounds (below the HUD)', () => {
    const layout = new FloatLayout<number>()
    const size = numberSize(14, false)
    const bounds = { left: 0, top: 100, right: 360, bottom: 400 }
    const first = layout.place(1, 0, { x: 200, y: 250 }, size, false, false, bounds)
    expect([first.dx, first.dy]).toEqual([0, 0])
    const second = layout.place(2, 50, { x: 200, y: 250 }, size, false, false, bounds)
    expect(second.dx !== 0 || second.dy !== 0).toBe(true)
    for (let t = 50; t < FLOAT_MS; t += 5) {
      const [a, b] = layout.rectsAt(t, false)
      expect(tooClose(a, b)).toBe(false)
      for (const r of [a, b]) {
        expect(r.y).toBeGreaterThanOrEqual(bounds.top)
        expect(r.x).toBeGreaterThanOrEqual(bounds.left)
        expect(r.x + r.w).toBeLessThanOrEqual(bounds.right)
      }
    }
    // Rising numbers reach FLOAT_RISE_PX above their spot; the layout leaves room for that under the HUD.
    expect(layout.rectsAt(FLOAT_MS - 1, false)[0].y).toBeCloseTo(250 - FLOAT_RISE_PX - size.h, 0)
  })
})

describe('blade + arc guide geometry', () => {
  it('a swing spans exactly the record’s arc, mirrored by facing (up-front → down-front)', () => {
    for (const arc of [90, 180, 240]) {
      expect(swingEndAngle(1, arc) - swingStartAngle(1, arc)).toBeCloseTo(arc * DEG, 12)
      expect(swingStartAngle(1, arc)).toBeCloseTo(-(arc / 2) * DEG, 12)
      expect(swingStartAngle(-1, arc) + swingStartAngle(1, arc)).toBeCloseTo(Math.PI, 12)
      expect(swingEndAngle(-1, arc) - swingStartAngle(-1, arc)).toBeCloseTo(-arc * DEG, 12)
    }
  })

  it('the weapon sprite’s tip lands exactly at the modeled reach along the blade angle', () => {
    for (const [w, h] of [
      [32, 32],
      [40, 44],
      [14, 36],
    ]) {
      for (const facing of [1, -1] as const) {
        for (const angle of [-Math.PI / 2, -0.4, 0, 0.7, Math.PI / 2, Math.PI]) {
          const reach = 3.7
          const t = bladeSpriteTransform(angle, facing, w, h, reach)
          const tip = spriteTipOffset(t, w, h)
          expect(tip.x).toBeCloseTo(Math.cos(angle) * reach * GAME_PX_PER_TILE, 6)
          expect(tip.y).toBeCloseTo(Math.sin(angle) * reach * GAME_PX_PER_TILE, 6)
          expect(Math.sign(t.scaleX)).toBe(facing) // facing left mirrors the sprite
        }
      }
    }
  })

  it('interpolates between the last two sim ticks (alpha clamped to [0, 1])', () => {
    const pose = { kind: 'swing' as const, prevAngle: 0, angle: 1, prevLength: 3, length: 3 }
    expect(interpolateBlade(pose, 0.25)).toEqual({ angle: 0.25, length: 3 })
    expect(interpolateBlade(pose, -1).angle).toBe(0)
    expect(interpolateBlade(pose, 2).angle).toBe(1)
  })

  it('the reach guide is a dashed arc of art-pixel cells at the modeled reach, start to end', () => {
    const cell = GAME_PX_PER_ART_PX
    for (const facing of [1, -1] as const) {
      for (const arc of [90, 180]) {
        const r = 3.4 * GAME_PX_PER_TILE
        const cells = guideCells(facing, arc, r, cell, 4, 3)
        for (const [x, y] of cells) {
          expect(Math.abs(x % cell) + Math.abs(y % cell)).toBe(0)
          expect(Math.abs(Math.hypot(x + cell / 2, y + cell / 2) - r)).toBeLessThanOrEqual(cell)
        }
        const near = (angle: number) => cells.some(([x, y]) => Math.hypot(x + cell / 2 - Math.cos(angle) * r, y + cell / 2 - Math.sin(angle) * r) <= cell)
        expect(near(swingStartAngle(facing, arc))).toBe(true)
        // Dashed: gaps of several cells along the arc, never one unbroken line.
        const steps = Math.ceil((arc * DEG * r) / cell)
        expect(cells.length).toBeLessThan(steps * 0.7)
        expect(cells.length).toBeGreaterThan(steps * 0.4)
      }
    }
    expect(guideCells(1, 180, 0, GAME_PX_PER_ART_PX, 4, 3)).toEqual([])
  })

  it('a guide dash beside a damage number at its height would read as a minus sign ("–7"): it is knocked out', () => {
    const n = { x: 200, y: 290, ...numberSize(7, false) }
    const dash = (x: number, y: number): FloatRect => ({ x, y, w: 4, h: 8 })
    // The reviewer's frame: a dash ~12 px left of the "7", at its height — and the same on the right.
    expect(readsAsPartOfNumber(dash(n.x - 12 - 4, n.y + 6), [n])).toBe(true)
    expect(readsAsPartOfNumber(dash(n.x + n.w + 12, n.y + 6), [n])).toBe(true)
    // A whole glyph's room away (the number's height) at the same height: kept.
    expect(readsAsPartOfNumber(dash(n.x - n.h - 4, n.y + 6), [n])).toBe(false)
    expect(readsAsPartOfNumber(dash(n.x + n.w + n.h, n.y + 6), [n])).toBe(false)
    // Clearly above or below the number: kept.
    expect(readsAsPartOfNumber(dash(n.x - 8, n.y - 8 - n.h / 4), [n])).toBe(false)
    expect(readsAsPartOfNumber(dash(n.x - 8, n.y + n.h + n.h / 4), [n])).toBe(false)
    expect(readsAsPartOfNumber(dash(n.x - 8, n.y + 6), [])).toBe(false)
  })

  it('Wooden Sword on a phone: numbers do spawn beside the guide’s top end; knocking those dashes out keeps the rest of the guide', () => {
    const sword = byName('Wooden Sword')
    const created = createLabSession(sword, { seed: () => 7 })
    if (!created.ok) throw new Error('refused')
    const s = created.session
    const view = viewports(sword).find((v) => v.name === '375')!
    const { fit } = view
    const layout = new FloatLayout<number>()
    const cell = GAME_PX_PER_ART_PX
    // The arena's mapping: the guide is drawn in the world container (game px from the player's centre).
    const boxOf = ([x, y]: [number, number]): FloatRect => {
      const p = worldToScreen(fit, x / GAME_PX_PER_TILE, y / GAME_PX_PER_TILE)
      return { x: p.x, y: p.y, w: cell * fit.scale, h: 2 * cell * fit.scale }
    }
    s.press('key')
    let beside = 0
    let minKept = 1
    const frameMs = 1000 / 60
    for (let f = 0; f < 5 * 60; f++) {
      const now = f * frameMs
      for (const e of s.frame(frameMs).events) {
        if (e.type !== 'damage') continue
        const p = worldToScreen(fit, e.x, e.y)
        layout.place(f, now, { x: p.x, y: p.y - 4 }, numberSize(e.amount, e.crit), e.crit, false, view.bounds)
      }
      const numbers = layout.rectsAt(now, false)
      const cells = guideCells(s.sim.renderState().facing, s.swing!.arcDegrees, s.swing!.reachTiles * GAME_PX_PER_TILE, cell, 4, 3)
      const knocked = cells.filter((c) => readsAsPartOfNumber(boxOf(c), numbers)).length
      beside += knocked
      minKept = Math.min(minKept, 1 - knocked / cells.length)
    }
    expect(beside).toBeGreaterThan(0)
    // Even with numbers rising through it, most of the arc stays drawn (the reach stays readable).
    expect(minKept).toBeGreaterThan(0.5)
  })

  it('the trail never starts before the swing and is at most the max length', () => {
    const max = 110 * DEG
    const start = swingStartAngle(1, 180)
    expect(trailSpan(start + 0.1, 1, 180, max)).toEqual([start, start + 0.1])
    const [from, to] = trailSpan(start + 2.5, 1, 180, max)
    expect(to - from).toBeCloseTo(max, 12)
    const left = swingStartAngle(-1, 180)
    expect(trailSpan(left - 0.2, -1, 180, max)).toEqual([left, left - 0.2])
  })
})

describe('camera: crisp pixels at every size', () => {
  const glove = createLabSession(byName('Bladed Glove'), { seed: () => 1 })
  if (!glove.ok) throw new Error('refused')
  const gloveBox = actionBox(glove.session.swing!.reachTiles, glove.session.sim.renderState().dummies)

  it('always a whole number of device pixels per ART pixel (½ steps per game pixel), in both framings', () => {
    for (const dpr of [1, 1.5, 2, 2.625, 3]) {
      for (const [w, h] of [
        [375, 446],
        [466, 614],
        [436, 600],
        [850, 800],
        [1920, 1080],
      ]) {
        for (const options of [{}, { framing: 'action', action: gloveBox, insetTop: 130, insetBottom: 52 }] as Partial<CameraOptions>[]) {
          const fit = fitCamera(w, h, dpr, options)
          expect(Number.isInteger(fit.devicePxPerGamePx * GAME_PX_PER_ART_PX)).toBe(true)
          expect(fit.devicePxPerGamePx).toBeGreaterThanOrEqual(1)
          expect(fit.scale * dpr).toBeCloseTo(fit.devicePxPerGamePx, 12)
          // The origin sits on the device-pixel grid.
          expect(Number.isInteger(Math.round(fit.originX * dpr * 1e6) / 1e6)).toBe(true)
          expect(Number.isInteger(Math.round(fit.originY * dpr * 1e6) / 1e6)).toBe(true)
        }
      }
    }
  })

  /** The P3-S1 camera before the design review: whole device px per game px, player at anchorX. */
  const previousFit = (w: number, h: number, dpr: number, insetTop: number) => {
    const o = DEFAULT_CAMERA
    const usable = Math.max(1, h - insetTop)
    const d = Math.max(1, Math.floor(Math.min((w * dpr) / (o.minTilesW * 16), (usable * dpr) / (o.minTilesH * 16), (o.maxTilePx * dpr) / 16)))
    return { tilePx: (d / dpr) * 16, originX: Math.round(w * o.anchorX * dpr) / dpr }
  }

  it('desktop (1440 and up): same zoom; same position unless the old view sliced a tree, then a small shift', () => {
    const cuts = (x0: number, x1: number) => ARENA_SET_PIECES.some(([a, b]) => (a < x0 && x0 < b) || (a < x1 && x1 < b))
    let identical = 0
    for (const [w, h] of [
      [850, 802], // 1440 × 900, both panels open (the default)
      [1104, 802], // 1440, one panel collapsed — the old view cut the right-hand tree
      [1344, 802], // 1440, both collapsed — the old view cut the left-hand tree
      [1330, 980], // 1920 × 1080, both panels — the old view cut the left-hand tree
    ]) {
      for (const dpr of [1, 2]) {
        const before = previousFit(w, h, dpr, 187)
        const fit = fitCamera(w, h, dpr, { insetTop: 187 })
        expect(fit.tilePx, `${w}×${h}@${dpr}`).toBe(before.tilePx)
        const x0 = -before.originX / before.tilePx
        if (!cuts(x0, x0 + w / before.tilePx)) {
          expect(fit.originX, `${w}×${h}@${dpr}`).toBe(before.originX)
          identical++
        } else {
          const [n0, n1] = visibleWorldX(fit)
          expect(cuts(n0, n1), `${w}×${h}@${dpr}`).toBe(false)
          expect(Math.abs(fit.originX - before.originX) / fit.tilePx, `${w}×${h}@${dpr}`).toBeLessThanOrEqual(2)
        }
      }
    }
    expect(identical).toBeGreaterThanOrEqual(2) // 1440 with both panels, at 1× and 2×
  })

  it('narrow centre columns zoom out instead of slicing: every platform whole, no set piece cut by an edge (M6)', () => {
    for (const [name, w, h, inset] of [
      ['1024 both panels', 436, 668, 160],
      ['768 with a panel', 480, 614, 150],
      ['768', 768, 614, 150],
      ['1280 both panels', 704, 702, 187],
      ['1366 both panels', 790, 670, 187],
      ['1440 both panels', 850, 802, 187],
    ] as const) {
      for (const dpr of [1, 2, 3]) {
        const fit = fitCamera(w, h, dpr, { insetTop: inset })
        const [x0, x1] = visibleWorldX(fit)
        const eps = 1e-9
        expect(x0, `${name}@${dpr}`).toBeLessThanOrEqual(ARENA_CORE_X[0] + eps)
        expect(x1, `${name}@${dpr}`).toBeGreaterThanOrEqual(ARENA_CORE_X[1] - eps)
        for (const [a, b] of ARENA_SET_PIECES) {
          for (const edge of [x0, x1]) expect(a + eps < edge && edge < b - eps, `${name}@${dpr}: edge ${edge} cuts [${a}, ${b}]`).toBe(false)
        }
        // Still the scene's rows: from above the tallest swing to the ground strip.
        expect((h - inset) / fit.tilePx).toBeGreaterThanOrEqual(DEFAULT_CAMERA.minTilesH)
      }
    }
  })

  it('phones frame the fight: 1.5–2× zoom between the HUD rows, the whole swing in view, for every weapon (H3)', () => {
    for (const [w, h] of [
      [360, 447],
      [375, 446],
      [390, 460],
      [414, 500],
    ]) {
      for (const dpr of [1, 2, 3]) {
        for (const weapon of weapons) {
          const created = createLabSession(weapon, { seed: () => 1 })
          if (!created.ok) throw new Error('refused')
          const box = actionBox(created.session.swing!.reachTiles, created.session.sim.renderState().dummies)
          const scene = fitCamera(w, h, dpr, { insetTop: 138 })
          const fit = fitCamera(w, h, dpr, { framing: 'action', action: box, insetTop: 138, insetBottom: 52 })
          expect(fit.framing, `${weapon.name} ${w}@${dpr}`).toBe('action')
          expect(fit.tilePx).toBeGreaterThanOrEqual(scene.tilePx)
          expect(fit.tilePx).toBeLessThanOrEqual(DEFAULT_CAMERA.actionMaxTilePx)
          // At least 1.5× the arena's 16 px tile (the 375 baseline the review measured at 1×).
          expect(fit.tilePx, `${weapon.name} ${w}@${dpr}`).toBeGreaterThanOrEqual(1.5 * GAME_PX_PER_TILE)
          // The swing circle, the dummy and the ground strip all sit between the HUD rows.
          const tl = worldToScreen(fit, box.x0, box.y0)
          const br = worldToScreen(fit, box.x1, box.y1)
          expect(tl.x).toBeGreaterThanOrEqual(-0.5)
          expect(br.x).toBeLessThanOrEqual(w + 0.5)
          expect(tl.y).toBeGreaterThanOrEqual(138 - 0.5)
          expect(br.y).toBeLessThanOrEqual(h - 52 + 0.5)
        }
      }
    }
    // The 375 baseline (16 px tiles before) doubles for the starter sword and the fastest weapon.
    for (const name of ['Wooden Sword', 'Bladed Glove']) {
      const created = createLabSession(byName(name), { seed: () => 1 })
      if (!created.ok) throw new Error('refused')
      const box = actionBox(created.session.swing!.reachTiles, created.session.sim.renderState().dummies)
      expect(fitCamera(360, 447, 1, { insetTop: 138 }).tilePx).toBe(16)
      expect(fitCamera(360, 447, 1, { framing: 'action', action: box, insetTop: 138, insetBottom: 52 }).tilePx, name).toBe(32)
    }
  })

  it('the action box holds the player, every dummy (with room for its numbers) and the full reach both ways', () => {
    const dummy = { x: 2, y: 0, width: 2, height: 3 }
    const box = actionBox(2.3, [dummy])
    expect(box.x0).toBeLessThan(-2.3)
    expect(box.x1).toBeGreaterThan(dummy.x + dummy.width / 2)
    expect(box.y0).toBeLessThan(dummy.y - dummy.height / 2 - 1)
    expect(box.y1).toBeGreaterThan(1.5) // below the feet
    const long = actionBox(5.7, [dummy])
    expect(long.x0).toBeLessThan(-5.7)
    expect(long.x1).toBeGreaterThan(5.7)
    expect(long.y0).toBeLessThan(-5.7)
  })

  it('keeps the minimum world area visible whenever the canvas can hold it at 1:1', () => {
    for (const [w, h, dpr] of [
      [375, 446, 3],
      [466, 614, 2],
      [850, 800, 1],
    ]) {
      const fit = fitCamera(w, h, dpr)
      if ((w * dpr) / (DEFAULT_CAMERA.minTilesW * GAME_PX_PER_TILE) < 1) continue
      expect(w / fit.tilePx).toBeGreaterThanOrEqual(DEFAULT_CAMERA.minTilesW)
      expect(h / fit.tilePx).toBeGreaterThanOrEqual(DEFAULT_CAMERA.minTilesH)
      expect(fit.tilePx).toBeLessThanOrEqual(DEFAULT_CAMERA.maxTilePx)
    }
  })

  it('frames the scene below a HUD inset, and maps screen ↔ world exactly', () => {
    const fit = fitCamera(800, 700, 2, { insetTop: 180 })
    const focus = worldToScreen(fit, 0, DEFAULT_CAMERA.focusY)
    expect(focus.y).toBeCloseTo(180 + (700 - 180) / 2, 0)
    for (const [x, y] of [
      [0, 0],
      [2, -1.5],
      [-4.25, 3],
    ]) {
      const p = worldToScreen(fit, x, y)
      const back = screenToWorld(fit, p.x, p.y)
      expect(back.x).toBeCloseTo(x, 9)
      expect(back.y).toBeCloseTo(y, 9)
    }
  })
})

describe('thrust sprite at native art scale (design review P3-S2/S3 H1)', () => {
  /** Every pose one auto-aimed (Space) attack draws over two whole thrusts: each tick at three interpolation alphas. */
  function thrustPoses(weapon: Weapon) {
    const created = createLabSession(weapon, { seed: () => 2 })
    if (!created.ok) throw new Error('refused')
    const s = created.session
    s.press('key')
    const poses: { angle: number; length: number; facing: 1 | -1 }[] = []
    for (let f = 0; f < 2 * (weapon.useAnimationTicks ?? 30) + 4; f++) {
      s.frame(1000 / 60)
      const { blade, facing } = s.sim.renderState()
      if (blade?.kind !== 'thrust') continue
      for (const alpha of [0, 0.5, 1]) poses.push({ ...interpolateBlade(blade, alpha), facing })
    }
    return { poses, reach: s.reachTiles }
  }
  const along = (p: { x: number; y: number }, angle: number) => p.x * Math.cos(angle) + p.y * Math.sin(angle)
  /** The sprite box's four corners (game px from the player's centre), as the renderer places them. */
  function corners(v: ReturnType<typeof thrustVisual>, width: number, height: number) {
    const { rotation, scaleX, scaleY } = v.transform
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    // Anchor (0, 1): local (0, 0) is the handle; the box spans x ∈ [0, w], y ∈ [−h, 0].
    return [
      [0, 0],
      [width, 0],
      [0, -height],
      [width, -height],
    ].map(([lx, ly]) => ({ x: v.handle.x + lx * scaleX * cos - ly * scaleY * sin, y: v.handle.y + lx * scaleX * sin + ly * scaleY * cos }))
  }

  it('the fixtures: every equippable thrust weapon, sprites authored in 2×2 texel blocks (one 2-game-px art pixel at 1:1)', () => {
    expect(thrusts.length).toBeGreaterThanOrEqual(18)
    expect(thrusts.map((t) => t.weapon.name)).toEqual(expect.arrayContaining(['Adamantite Glaive', 'Spear']))
    // Native scale is 1 game px per texel, so a sprite's visual pixel (2×2 texels) is GAME_PX_PER_ART_PX —
    // the size of the player's and the arena's art pixels.
    expect(GAME_PX_PER_ART_PX).toBe(2)
    for (const { width, height } of thrusts) expect([width % 2, height % 2]).toEqual([0, 0])
  })

  it('every pose of every thrust: native scale (1 game px per sprite px), held at the hand, never sliding back behind it', () => {
    for (const { weapon, width, height } of thrusts) {
      const { poses, reach } = thrustPoses(weapon)
      expect(poses.length, weapon.name).toBeGreaterThan(20)
      const diagonal = Math.hypot(width, height)
      let maxLunge = 0
      for (const { angle, length, facing } of poses) {
        const v = thrustVisual(angle, length, reach, facing, width, height)
        const hand = along({ x: facing * THRUST_HAND.x, y: THRUST_HAND.y }, angle)
        // Native art scale, mirrored by facing — whatever the reach (the old sprite was scaled to it).
        expect(Math.abs(v.transform.scaleX), weapon.name).toBe(1)
        expect(v.transform.scaleY).toBe(1)
        expect(Math.sign(v.transform.scaleX)).toBe(facing)
        // The transform and the position agree: the tip is the sprite's own diagonal along the aim.
        const tip = spriteTipOffset(v.transform, width, height)
        expect(v.handle.x + tip.x).toBeCloseTo(v.tip.x, 9)
        expect(v.handle.y + tip.y).toBeCloseTo(v.tip.y, 9)
        expect(along(v.tip, angle) - along(v.handle, angle)).toBeCloseTo(diagonal, 9)
        // No backslide: the handle is at or ahead of the hand (by at most the lunge), and no corner
        // of the sprite is behind the hand along the aim — nor behind the player's centre at all.
        const lunge = along(v.handle, angle) - hand
        expect(lunge, weapon.name).toBeGreaterThanOrEqual(-1e-9)
        expect(lunge).toBeLessThanOrEqual(THRUST_LUNGE * diagonal + 1e-9)
        maxLunge = Math.max(maxLunge, lunge)
        for (const c of corners(v, width, height)) {
          expect(along(c, angle), weapon.name).toBeGreaterThanOrEqual(hand - 1e-9)
          expect(c.x * facing, weapon.name).toBeGreaterThanOrEqual(0)
        }
        // The weapon never pokes past the modeled reach (unless the sprite itself is longer)…
        expect(along(v.tip, angle)).toBeLessThanOrEqual(Math.max(reach * GAME_PX_PER_TILE, hand + diagonal) + 1e-9)
        // …and the streak shows exactly the rest of the engine's extension, along the weapon's axis.
        const extension = length * GAME_PX_PER_TILE
        if (v.pierce) {
          expect(v.pierce.from).toEqual(v.tip)
          expect(along(v.pierce.to, angle), weapon.name).toBeCloseTo(extension, 9)
        } else {
          expect(extension).toBeLessThan(along(v.tip, angle) + 1)
        }
      }
      // Spears lunge with the thrust; a shortsword whose sprite already spans its reach stays put.
      if (reach * GAME_PX_PER_TILE > diagonal + THRUST_HAND.x + 4) expect(maxLunge, weapon.name).toBeGreaterThan(1)
    }
  })

  it('Adamantite Glaive (11.03 tiles) and Spear: the weapon is drawn its own length, the rest of the reach is the streak', () => {
    for (const [name, spriteTiles] of [
      ['Adamantite Glaive', 3.89],
      ['Spear', 3.36],
    ] as const) {
      const { weapon, width, height } = thrusts.find((t) => t.weapon.name === name)!
      const reach = weapon.labBehavior.kind === 'archetype' && weapon.labBehavior.params.archetype === 'thrust' ? weapon.labBehavior.params.reachTiles : 0
      const full = thrustVisual(0, reach, reach, 1, width, height)
      expect(Math.hypot(full.tip.x - full.handle.x, full.tip.y - full.handle.y) / GAME_PX_PER_TILE, name).toBeCloseTo(spriteTiles, 2)
      // Full extension: the hand lunges a quarter of the weapon forward; the streak ends at the reach.
      expect(full.handle.x).toBeCloseTo(THRUST_HAND.x + THRUST_LUNGE * Math.hypot(width, height), 9)
      expect(full.pierce!.to.x / GAME_PX_PER_TILE).toBeCloseTo(reach, 9)
      // At the start of a thrust (extension 0) the weapon sits in the hand, nothing behind the player.
      const start = thrustVisual(0, 0, reach, 1, width, height)
      expect(start.handle).toEqual({ x: THRUST_HAND.x, y: THRUST_HAND.y })
      expect(start.pierce).toBeNull()
      // The pre-fix renderer scaled the sprite to the whole reach (≈ 2.8× the Glaive's art pixels).
      if (name === 'Adamantite Glaive') expect(bladeSpriteTransform(0, 1, width, height, reach).scaleX).toBeGreaterThan(2.5)
    }
  })

  it('the streak is a run of art-pixel cells from the tip to the extension, no gaps, never the same cell twice in a row', () => {
    const cell = GAME_PX_PER_ART_PX
    for (const [from, to] of [
      [{ x: 70, y: 5 }, { x: 176, y: 5 }],
      [{ x: -40, y: -30 }, { x: -120, y: -95 }],
      [{ x: 3, y: 3 }, { x: 3.5, y: 3.2 }],
    ]) {
      const cells = streakCells(from, to, cell)
      expect(cells[0]).toEqual([Math.floor(from.x / cell) * cell, Math.floor(from.y / cell) * cell])
      expect(cells.at(-1)).toEqual([Math.floor(to.x / cell) * cell, Math.floor(to.y / cell) * cell])
      for (const [x, y] of cells) expect([x % cell, y % cell].map(Math.abs)).toEqual([0, 0])
      for (let i = 1; i < cells.length; i++) {
        const step = Math.max(Math.abs(cells[i][0] - cells[i - 1][0]), Math.abs(cells[i][1] - cells[i - 1][1]))
        expect(step).toBeGreaterThan(0)
        expect(step).toBeLessThanOrEqual(cell)
      }
    }
  })
})

describe('camera: the fight clear of the HUD rows (design review P3-S2/S3)', () => {
  /**
   * The Lab's HUD rows as measured in the browser (CSS px): the top row, the bottom controls with
   * the DPS graph strip (open by default from tablet up; behind the chip on phones), and the
   * first-use hint's room above them (its height + half the HUD padding).
   */
  const layouts = [
    { name: '1440', w: 864, h: 801, top: 176, bottom: 148, floor: 38, framing: 'scene' },
    { name: '1024', w: 448, h: 669, top: 148, bottom: 136, floor: 36, framing: 'scene' },
    { name: '768', w: 768, h: 614, top: 176, bottom: 148, floor: 38, framing: 'scene' },
    { name: '375 graph open', w: 375, h: 447, top: 144, bottom: 132, floor: 32, framing: 'action' },
    { name: '375', w: 375, h: 447, top: 144, bottom: 52, floor: 32, framing: 'action' },
  ] as const
  const melee = [...weapons, ...thrusts.map((t) => t.weapon)]
  const fitFor = (l: (typeof layouts)[number], dpr: number, weapon: Weapon, use = { floor: true, reach: true }) => {
    const created = createLabSession(weapon, { seed: () => 1 })
    if (!created.ok) throw new Error('refused')
    const { reachTiles, sim } = created.session
    return {
      reach: reachTiles,
      dummies: sim.renderState().dummies,
      fit: fitCamera(l.w, l.h, dpr, {
        insetTop: l.top,
        insetBottom: l.bottom,
        floorPx: use.floor ? l.floor : 0,
        reachTiles: use.reach ? reachTiles : 0,
        framing: l.framing,
        action: actionBox(reachTiles, sim.renderState().dummies),
      }),
    }
  }

  it('every sword and spear: the feet clear the bottom row (with the hint’s room), the head and the dummy clear the top row, the zoom unchanged', () => {
    for (const l of layouts) {
      for (const dpr of [1, 2]) {
        for (const weapon of melee) {
          const { fit, dummies } = fitFor(l, dpr, weapon)
          const at = `${l.name}@${dpr} ${weapon.name}`
          const px = 1 / dpr
          // Placement only: the zoom is what it was without the hint's room and the reach lift;
          // the scene's zoom doesn't depend on the bottom row at all.
          expect(fit.tilePx, at).toBe(fitFor(l, dpr, weapon, { floor: false, reach: false }).fit.tilePx)
          if (l.framing === 'scene') expect(fit.tilePx, at).toBe(fitCamera(l.w, l.h, dpr, { insetTop: l.top }).tilePx)
          expect(worldToScreen(fit, 0, ARENA_LAYOUT.groundY).y, at).toBeLessThanOrEqual(l.h - l.bottom - l.floor + px)
          expect(worldToScreen(fit, 0, PLAYER_TOP_Y).y, at).toBeGreaterThanOrEqual(l.top - px)
          for (const d of dummies) expect(worldToScreen(fit, d.x, d.y - d.height / 2).y, at).toBeGreaterThanOrEqual(l.top - px)
        }
      }
    }
  })

  it('desktop/tablet: the view lifts until a swing’s whole sweep clears the bottom row, stopping where the sweep’s top meets the top row', () => {
    let whole = 0
    let lifted = 0
    for (const l of layouts.filter((x) => x.framing === 'scene')) {
      for (const dpr of [1, 2]) {
        for (const weapon of weapons) {
          const { fit, reach } = fitFor(l, dpr, weapon)
          const base = fitFor(l, dpr, weapon, { floor: true, reach: false }).fit
          const at = `${l.name}@${dpr} ${weapon.name}`
          const px = 1 / dpr
          const limit = l.h - l.bottom
          const sweep = (f: CameraFit) => ({ top: worldToScreen(f, 0, -reach).y, bottom: worldToScreen(f, 0, reach).y })
          const before = sweep(base)
          const after = sweep(fit)
          expect(fit.originY, at).toBeLessThanOrEqual(base.originY) // only ever lifts
          if (before.bottom <= limit + px) expect(fit.originY, at).toBe(base.originY)
          else if (after.bottom > limit + px) {
            // Not cleared: lifted until the sweep's top met the top row (or it was there already).
            expect(after.top, at).toBeLessThanOrEqual(Math.max(l.top + 2 * px, before.top))
            if (before.top >= l.top) expect(after.top, at).toBeGreaterThanOrEqual(l.top - px)
          }
          if (fit.originY < base.originY) lifted++
          if (after.top >= l.top - px && after.bottom <= limit + px) whole++
        }
      }
    }
    // The lift does work, and most swords' whole sweep sits between the rows at 1440, 1024 and 768.
    expect(lifted).toBeGreaterThan(0)
    expect(whole).toBeGreaterThan(weapons.length * 3)
  })

  it('1440 (both panels, graph open): the Adamantite Sword’s 10.6-tile sweep (taller than the 9.9 tiles between the rows) is lifted to the top row — under a tile of its underground tail stays behind the strip', () => {
    const l = layouts[0]
    const { fit, reach } = fitFor(l, 1, byName('Adamantite Sword'))
    expect(worldToScreen(fit, 0, -reach).y).toBeCloseTo(l.top, 0)
    const hidden = worldToScreen(fit, 0, reach).y - (l.h - l.bottom)
    expect(hidden).toBeGreaterThan(0)
    expect(hidden).toBeLessThan(fit.tilePx)
    // Before the lift (and the bottom-aware placement) it was 3.2 tiles.
    const old = fitCamera(l.w, l.h, 1, { insetTop: l.top })
    expect((worldToScreen(old, 0, reach).y - (l.h - l.bottom)) / old.tilePx).toBeGreaterThan(3)
  })

  it('with no bottom row, hint room or reach, the scene and action framings place the fight exactly as before', () => {
    for (const [w, h, top] of [
      [850, 802, 187],
      [436, 668, 160],
      [768, 614, 150],
    ]) {
      for (const dpr of [1, 2, 3]) {
        const fit = fitCamera(w, h, dpr, { insetTop: top })
        expect(fit.originY).toBe(Math.round((top + (h - top) / 2 - DEFAULT_CAMERA.focusY * fit.tilePx) * dpr) / dpr)
      }
    }
    const box = actionBox(3, [{ x: 2, y: 0, width: 2, height: 3 }])
    const fit = fitCamera(360, 447, 2, { framing: 'action', action: box, insetTop: 138, insetBottom: 52 })
    expect(fit.originY).toBe(Math.round((138 + (447 - 138 - 52) / 2 - ((box.y0 + box.y1) / 2) * fit.tilePx) * 2) / 2)
  })
})
