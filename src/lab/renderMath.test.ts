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
import { ARENA_CORE_X, ARENA_LAYOUT, ARENA_SET_PIECES, buildDebuffIcon, buildTagIcon, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
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
import { actionBox, DEFAULT_CAMERA, fitCamera, PLAYER_TOP_Y, sceneXFor, screenToWorld, visibleWorldX, worldToScreen, type CameraFit, type CameraOptions } from './camera'
import { debuffMarker, markerClearOfHud } from './debuffVisuals'
import {
  DotNumberTicker,
  FLOAT_GAP_X,
  FLOAT_GAP_Y,
  FLOAT_MS,
  FLOAT_RISE_PX,
  FloatLayout,
  floatPose,
  MARK_CLEARANCE,
  readsAsPartOfNumber,
  RecyclingPool,
  rectAt,
  rectsOverlap,
  TRACER_CLEARANCE,
  type FloatBounds,
  type FloatRect,
  type FloatZone,
} from './floatingNumbers'
import { createLabSession } from './labSession'
import { labWeapons } from './labWeapons'
import { bullseyeRect, dotAnchor, NUMBER_BAND_PAD_TILES, numberZone } from './numberZone'
import { LAB_SETUP } from './testing/labData'
import type { RenderState } from '../sim'

/** The swing renderer's subjects: every equippable swung weapon (thrusts draw no arc or guide). */
const weapons = labWeapons(weaponsJson as Weapon[], LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')
const byName = (name: string) => weapons.find((w) => w.name === name)!
/** Every equippable thrust weapon (spears, shortswords), with its sprite's size from the sprite manifest. */
const thrusts = labWeapons(weaponsJson as Weapon[], LAB_SETUP)
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
  const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
  if (!created.ok) throw new Error('refused')
  const box = actionBox(created.session.swing!.reachTiles, created.session.sim.renderState().dummies)
  const phone = fitCamera(360, 447, 1, { framing: 'action', insetTop: 138, insetBottom: 52, action: box })
  const desk = fitCamera(436, 668, 1, { insetTop: 160 })
  return [
    { name: '375', fit: phone, bounds: { left: 0, top: 138, right: 360, bottom: 447 - 52 } },
    { name: '1024', fit: desk, bounds: { left: 0, top: 160, right: 436, bottom: 668 - 56 } },
  ]
}

/** Drives a real session at 60 fps with attack held; returns every direct hit with its time (ms). */
function sustainedAttack(weapon: Weapon, seconds: number, seed = 7) {
  const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => seed })
  if (!created.ok) throw new Error('refused')
  const s = created.session
  s.press('key')
  const hits: { at: number; amount: number; crit: boolean; x: number; y: number }[] = []
  const frameMs = 1000 / 60
  for (let f = 0; f < seconds * 60; f++) {
    for (const e of s.frame(frameMs).events) if (e.type === 'damage' && e.source !== 'dot') hits.push({ at: f * frameMs, amount: e.amount, crit: e.crit, x: e.x, y: e.y })
  }
  return hits
}

/** The arena's zone for numbers on the view's (only) dummy: near the dummy (../numberZone.ts). */
const zoneOf = (weapon: Weapon, view: Viewport) => {
  const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
  if (!created.ok) throw new Error('refused')
  return numberZone(view.fit, created.session.sim.renderState().dummies[0], false)
}

/**
 * Places every hit through a FloatLayout (with the arena's zone, when given) and checks all live
 * boxes, every `stepMs`, for any pair that is too close; returns each number's anchor x as placed.
 */
function playOut(hits: ReturnType<typeof sustainedAttack>, view: Viewport, reduced: boolean, stepMs = 4, zone?: FloatZone) {
  const layout = new FloatLayout<number>()
  let overlaps = 0
  let evictions = 0
  let maxLive = 0
  let next = 0
  const anchors: number[] = []
  const end = (hits.at(-1)?.at ?? 0) + FLOAT_MS
  for (let now = 0; now <= end; now += stepMs) {
    for (; next < hits.length && hits[next].at <= now; next++) {
      const h = hits[next]
      const p = worldToScreen(view.fit, h.x, h.y)
      const size = numberSize(h.amount, h.crit)
      const placed = layout.place(next, h.at, { x: p.x, y: p.y - 4 }, size, h.crit, reduced, view.bounds, zone)
      evictions += placed.evicted.length
      anchors.push(p.x + placed.dx)
    }
    const rects = layout.rectsAt(now, reduced)
    maxLive = Math.max(maxLive, rects.length)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (tooClose(rects[i], rects[j])) overlaps++
  }
  return { overlaps, evictions, maxLive, anchors }
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
    it(`${reduced ? 'reduced motion (stacked in place)' : 'rising'}: zero overlapping boxes at 375 and 1024, nothing dropped — kept near the dummy as the arena does`, () => {
      for (const view of viewports(glove)) {
        for (const zone of [undefined, zoneOf(glove, view)]) {
          const run = playOut(hits, view, reduced, 4, zone)
          expect(run.overlaps, view.name).toBe(0)
          // The layout has room for every number at this cadence: none is retired early.
          expect(run.evictions, view.name).toBe(0)
          expect(run.maxLive, view.name).toBeGreaterThanOrEqual(5)
          if (zone?.band) for (const x of run.anchors) expect(x).toBeGreaterThanOrEqual(zone.band.left - 1e-6)
        }
      }
    })
  }

  it('the fastest high-damage weapons (3-digit crits) stay overlap-free too', () => {
    for (const weapon of [...weapons].sort((a, b) => (a.useAnimationTicks ?? 0) - (b.useAnimationTicks ?? 0) || (b.damage ?? 0) - (a.damage ?? 0)).slice(0, 3)) {
      const run = sustainedAttack(weapon, 20, 3)
      for (const view of viewports(weapon)) {
        for (const reduced of [false, true]) {
          const result = playOut(run, view, reduced, 4, zoneOf(weapon, view))
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

describe('numbers stay with their dummy; tracers never read as a minus (design review P3-S4/S5 M4)', () => {
  const all = labWeapons(weaponsJson as Weapon[], LAB_SETUP)
  const named = (name: string) => all.find((w) => w.name === name)!
  /** A projectile weapon on a phone (action framing between the HUD rows), as the arena frames it. */
  function phone(weapon: Weapon): Viewport & { dummy: RenderState['dummies'][number] } {
    const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
    if (!created.ok) throw new Error('refused')
    const s = created.session
    const dummy = s.sim.renderState().dummies[0]
    const fit = fitCamera(360, 447, 1, { framing: 'action', insetTop: 138, insetBottom: 52, reachTiles: s.frameTiles, action: actionBox(s.frameTiles, [dummy]) })
    return { name: '375', fit, bounds: { left: 0, top: 138, right: 360, bottom: 447 - 52 }, dummy }
  }

  it('Minishark (and the Quad-Barrel’s volleys) at 375: every number’s anchor stays over the dummy, at most half a tile into the flight lane — with no overlap and nothing dropped', () => {
    for (const name of ['Minishark', 'Quad-Barrel Shotgun']) {
      const weapon = named(name)
      const view = phone(weapon)
      const hits = sustainedAttack(weapon, 20)
      expect(hits.length, name).toBeGreaterThan(40)
      const zone = numberZone(view.fit, view.dummy, false)
      const tile = view.fit.tilePx
      // The band: the dummy's 2 tiles, half a tile toward the player (the flight lane), more behind it.
      const dummyLeft = worldToScreen(view.fit, view.dummy.x - view.dummy.width / 2, 0).x
      expect(dummyLeft - zone.band!.left).toBeCloseTo(NUMBER_BAND_PAD_TILES.towardPlayer * tile, 6)
      expect(zone.band!.right - zone.band!.left).toBeCloseTo((view.dummy.width + NUMBER_BAND_PAD_TILES.towardPlayer + NUMBER_BAND_PAD_TILES.beyond) * tile, 6)
      for (const reduced of [false, true]) {
        const run = playOut(hits, view, reduced, 4, zone)
        expect(run.overlaps, name).toBe(0)
        expect(run.evictions, name).toBe(0)
        for (const x of run.anchors) {
          expect(x, name).toBeGreaterThanOrEqual(zone.band!.left - 1e-6)
          expect(x, name).toBeLessThanOrEqual(zone.band!.right + 1e-6)
        }
      }
      // Without the band the same burst fans far back toward the player (the reviewer's capture): the cap is what holds them.
      if (name === 'Minishark') expect(Math.min(...playOut(hits, view, false).anchors)).toBeLessThan(zone.band!.left - tile)
    }
  })

  it('damage over time rises from above the bullseye and never crosses it, birth to the top of its rise (Frost Staff at full speed, its own half-second cadence)', () => {
    const frost = named('Frost Staff')
    // 375 (a 360 × 447 arena; bottom row 44 px + pad, first-use hint 28 px + pad — measured live): the
    // swords' baseline row (insetTop 138, as above), then Frost Staff's rows measured live + the 8 px
    // pad: the ManaBar with the low-mana callout's room reserved beside it (177 px), and the same in
    // test mode (193 px: the test-mode chip widens the stats box). All three frame the fight at 2×.
    for (const insetTop of [138, 185, 201]) {
      for (const reduced of [false, true]) {
        const created = createLabSession(frost, { setup: LAB_SETUP, seed: () => 5, settings: { ignoreMana: true } })
        if (!created.ok) throw new Error('refused')
        const s = created.session
        const dummy = s.sim.renderState().dummies[0]
        const fit = fitCamera(360, 447, 1, { framing: 'action', insetTop, insetBottom: 52, floorPx: 32, reachTiles: s.frameTiles, action: actionBox(s.frameTiles, [dummy]) })
        expect(fit.tilePx, `insetTop ${insetTop}`).toBe(2 * GAME_PX_PER_TILE)
        const bounds = { left: 0, top: insetTop, right: 360, bottom: 447 - 52 }
        const layout = new FloatLayout<number>()
        const ticker = new DotNumberTicker()
        const eye = bullseyeRect(fit, dummy)
        const anchor = worldToScreen(fit, dotAnchor(dummy).x, dotAnchor(dummy).y)
        expect(anchor.y).toBeCloseTo(eye.y, 6) // just above the painted bullseye
        const dots: { born: number; x: number; y: number; w: number; h: number }[] = []
        let evictions = 0
        let id = 0
        const band = numberZone(fit, dummy, false).band!
        s.press('key')
        const frameMs = 1000 / 60
        for (let f = 0; f < 20 * 60; f++) {
          const now = f * frameMs
          for (const e of s.frame(frameMs).events) {
            if (e.type !== 'damage') continue
            if (e.source === 'dot') ticker.add({ ...e, tick: s.sim.renderState().tick })
            else {
              const p = worldToScreen(fit, e.x, e.y)
              const placed = layout.place(id++, now, { x: p.x, y: p.y - 4 }, numberSize(e.amount, e.crit), e.crit, reduced, bounds, numberZone(fit, dummy, false))
              evictions += placed.evicted.length
              expect(p.x + placed.dx).toBeGreaterThanOrEqual(band.left - 1e-6) // never back along the flight lane
            }
          }
          for (const n of ticker.drain(s.sim.renderState().tick)) {
            const size = { w: String(n.amount).length * 12 + 3, h: 15 }
            const at = { x: anchor.x, y: anchor.y - 4 + 1.5 }
            const placed = layout.place(id++, now, at, size, false, reduced, bounds, numberZone(fit, dummy, true))
            evictions += placed.evicted.length
            expect(at.x + placed.dx).toBeGreaterThanOrEqual(band.left - 1e-6)
            dots.push({ born: now, x: at.x + placed.dx, y: at.y + placed.dy, ...size })
          }
        }
        expect(dots.length).toBeGreaterThan(20)
        const label = `insetTop ${insetTop}, reduced ${reduced}, tile ${fit.tilePx}px`
        // At 2× nothing is retired early — the mana weapon's phone camera included, now that its HUD
        // row (the warning's room beside the ManaBar) leaves it at 2×, at a non-stop 5 casts/s.
        expect(evictions, label).toBe(0)
        // Every age of every DoT number, as drawn: never over the bullseye.
        for (const d of dots) {
          for (let age = 0; age < FLOAT_MS; age += 10) expect(rectsOverlap(rectAt({ ...d, crit: false }, age, reduced), eye), `${insetTop} ${reduced} ${age}`).toBe(false)
        }
      }
    }
  })

  it('a tracer’s end stub along a number’s baseline, ~25 px to its left, read as "–57": the tracer rule knocks it out (guide dashes keep theirs)', () => {
    const n = { x: 200, y: 280, ...numberSize(57, false) } // "57": 36 × 20
    const stub = (gap: number, below = 0): FloatRect => ({ x: n.x - gap - 8, y: n.y + n.h - 6 + below, w: 8, h: 8 })
    // The reviewer's frame: the grey stub ends ~25 px left of the number, on its baseline.
    expect(readsAsPartOfNumber(stub(25), [n], MARK_CLEARANCE)).toBe(false) // the old (dash) rule missed it
    expect(readsAsPartOfNumber(stub(25), [n], TRACER_CLEARANCE)).toBe(true)
    // …a little under the baseline too (the impact line sits just under a number's spawn point).
    expect(readsAsPartOfNumber(stub(25, n.h * 0.4), [n], TRACER_CLEARANCE)).toBe(true)
    // Two glyphs' room away, or clearly below, it stays drawn.
    expect(readsAsPartOfNumber(stub(2 * n.h + 1), [n], TRACER_CLEARANCE)).toBe(false)
    expect(readsAsPartOfNumber(stub(10, n.h * 0.5 + 7), [n], TRACER_CLEARANCE)).toBe(false)
    expect(MARK_CLEARANCE).toEqual({ side: 1, above: 0.25, below: 0.25 })
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
    const created = createLabSession(sword, { setup: LAB_SETUP, seed: () => 7 })
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
  const glove = createLabSession(byName('Bladed Glove'), { setup: LAB_SETUP, seed: () => 1 })
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
          const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
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
      const created = createLabSession(byName(name), { setup: LAB_SETUP, seed: () => 1 })
      if (!created.ok) throw new Error('refused')
      const box = actionBox(created.session.swing!.reachTiles, created.session.sim.renderState().dummies)
      expect(fitCamera(360, 447, 1, { insetTop: 138 }).tilePx).toBe(16)
      expect(fitCamera(360, 447, 1, { framing: 'action', action: box, insetTop: 138, insetBottom: 52 }).tilePx, name).toBe(32)
    }
  })

  it('mana weapons at 375 frame the fight at 2× again: the low-mana room moved beside the ManaBar (design review P3-S4/S5 follow-up)', () => {
    const bolts = labWeapons(weaponsJson as Weapon[], LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'magic-bolt')
    expect(bolts.length).toBeGreaterThan(0)
    // HUD rows measured live at 375 (Diamond Staff), + the 8 px pad: the warning's room inside the
    // ManaBar made the row 233 px; beside it (under the stats box) the row is the ManaBar column's 177 px.
    const fitWith = (w: Weapon, hudRow: number) => {
      const created = createLabSession(w, { setup: LAB_SETUP, seed: () => 1 })
      if (!created.ok) throw new Error('refused')
      const s = created.session
      return fitCamera(360, 447, 1, { framing: 'action', insetTop: hudRow + 8, insetBottom: 52, floorPx: 32, reachTiles: s.frameTiles, action: actionBox(s.frameTiles, s.sim.renderState().dummies) })
    }
    for (const w of bolts) {
      expect(fitWith(w, 233).tilePx, w.name).toBe(1.5 * GAME_PX_PER_TILE)
      expect(fitWith(w, 177).tilePx, w.name).toBe(2 * GAME_PX_PER_TILE)
      // The room left: 2× holds up to a 195 px row (test mode's 193 px included).
      expect(fitWith(w, 195).tilePx, w.name).toBe(2 * GAME_PX_PER_TILE)
      expect(fitWith(w, 196).tilePx, w.name).toBe(1.5 * GAME_PX_PER_TILE)
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
    const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 2 })
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
    const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
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

describe('camera: a thrown explosive’s whole blast ring on phones (design review P3-S11 #3)', () => {
  const explosives = labWeapons(weaponsJson as Weapon[], LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'explosive-aoe')
  /**
   * The phone Lab's HUD rows for a thrown explosive, measured live (CSS px, + the 8 px pad): the top row
   * (EquippedBar with its blast / fuse facts + the "Explosives used" counter, beside the stats box), the
   * bottom one (the reserved latest-blast strip + the controls), the first-use hint's room.
   */
  const layouts = [
    { name: '360', w: 360, h: 429, top: 179.5, bottom: 122, floor: 32 },
    { name: '375', w: 375, h: 446.59, top: 147.5, bottom: 106, floor: 32 },
    { name: '375 (3-line strip)', w: 375, h: 446.59, top: 147.5, bottom: 122, floor: 32 },
    { name: '390', w: 390, h: 464.19, top: 147.5, bottom: 106, floor: 32 },
    { name: '414', w: 414, h: 492.8, top: 144, bottom: 106, floor: 32 },
  ] as const

  it('every explosive: the ring sits across the canvas, its lower arc above the bottom row, the fight below the top row — whole between the rows wherever one device pixel per game pixel allows', () => {
    expect(explosives).toHaveLength(15)
    let whole = 0
    let checked = 0
    for (const weapon of explosives) {
      const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
      if (!created.ok) throw new Error('refused')
      const s = created.session
      const blast = s.blastFrame()
      expect(blast, weapon.name).toMatchObject({ x: s.sim.renderState().dummies[0].x, radiusTiles: s.explosive!.blastRadiusTiles })
      const box = actionBox(s.frameTiles, s.sim.renderState().dummies, blast)
      for (const l of layouts) {
        for (const dpr of [1, 2, 3]) {
          const fit = fitCamera(l.w, l.h, dpr, { framing: 'action', action: box, actionWhole: true, insetTop: l.top, insetBottom: l.bottom, floorPx: l.floor, reachTiles: s.frameTiles })
          const at = `${weapon.name} ${l.name}@${dpr}`
          const px = 1 / dpr
          checked++
          expect(fit.framing, at).toBe('action')
          const left = worldToScreen(fit, blast!.x - blast!.radiusTiles, blast!.y)
          const right = worldToScreen(fit, blast!.x + blast!.radiusTiles, blast!.y)
          const top = worldToScreen(fit, blast!.x, blast!.y - blast!.radiusTiles)
          const bottom = worldToScreen(fit, blast!.x, blast!.y + blast!.radiusTiles)
          expect(left.x, at).toBeGreaterThanOrEqual(-px)
          expect(right.x, at).toBeLessThanOrEqual(l.w + px)
          // the player's head stays below the top row, always
          const head = worldToScreen(fit, 0, PLAYER_TOP_Y).y
          expect(head, at).toBeGreaterThanOrEqual(l.top - px)
          if ((box.y1 - box.y0) * fit.tilePx <= l.h - l.top - l.bottom + px) {
            // a box that fits at the zoom chosen: the whole ring between the rows
            expect(top.y, at).toBeGreaterThanOrEqual(l.top - px)
            expect(bottom.y, at).toBeLessThanOrEqual(l.h - l.bottom + px)
            whole++
          } else {
            // only the 1-device-px floor stops it (a 1× screen): the box keeps its bottom — the lower arc — above
            // the bottom row unless the head, which wins on a canvas too short for both, sits right at the top row
            expect(fit.devicePxPerGamePx, at).toBe(1)
            if (bottom.y > l.h - l.bottom + px) expect(head, at).toBeLessThanOrEqual(l.top + px)
          }
        }
      }
    }
    // at 2× and 3× (every phone of the last years) each ring is whole between the rows
    expect(whole).toBeGreaterThanOrEqual((checked * 2) / 3)
  })

  it('375@2 (the review’s capture): the Dynamite and Power Bomb rings are whole between the HUD rows; the Bomb’s keeps a closer zoom', () => {
    const l = layouts[1]
    const fitFor = (name: string) => {
      const created = createLabSession(explosives.find((w) => w.name === name)!, { setup: LAB_SETUP, seed: () => 1 })
      if (!created.ok) throw new Error('refused')
      const s = created.session
      const blast = s.blastFrame()!
      const box = actionBox(s.frameTiles, s.sim.renderState().dummies, blast)
      return { blast, fit: fitCamera(l.w, l.h, 2, { framing: 'action', action: box, actionWhole: true, insetTop: l.top, insetBottom: l.bottom, floorPx: l.floor, reachTiles: s.frameTiles }) }
    }
    for (const name of ['Dynamite', 'Power Bomb']) {
      const { blast, fit } = fitFor(name)
      expect(worldToScreen(fit, blast.x, blast.y - blast.radiusTiles).y, name).toBeGreaterThanOrEqual(l.top)
      expect(worldToScreen(fit, blast.x, blast.y + blast.radiusTiles).y, name).toBeLessThanOrEqual(l.h - l.bottom)
      expect(worldToScreen(fit, blast.x - blast.radiusTiles, 0).x, name).toBeGreaterThanOrEqual(0)
      expect(worldToScreen(fit, blast.x + blast.radiusTiles, 0).x, name).toBeLessThanOrEqual(l.w)
      // the scene framing (the old rule's fallback, more zoomed in) would cut it
      const scene = fitCamera(l.w, l.h, 2, { insetTop: l.top, insetBottom: l.bottom, floorPx: l.floor })
      expect(scene.tilePx, name).toBeGreaterThan(fit.tilePx)
      const cut =
        worldToScreen(scene, blast.x + blast.radiusTiles, 0).x > l.w ||
        worldToScreen(scene, blast.x - blast.radiusTiles, 0).x < 0 ||
        worldToScreen(scene, 0, blast.y - blast.radiusTiles).y < l.top ||
        worldToScreen(scene, 0, blast.y + blast.radiusTiles).y > l.h - l.bottom
      expect(cut, name).toBe(true)
    }
    expect(fitFor('Bomb').fit.tilePx).toBe(20)
  })

  it('without a blast nothing changes: the box, and the scene fallback for a box the scene shows better', () => {
    const sword = createLabSession(byName('Wooden Sword'), { setup: LAB_SETUP, seed: () => 1 })
    if (!sword.ok) throw new Error('refused')
    expect(sword.session.blastFrame()).toBeNull()
    const dummy = { x: 6, y: 0, width: 2, height: 3 }
    expect(actionBox(2, [dummy], null)).toEqual(actionBox(2, [dummy]))
    const box = actionBox(2, [dummy])
    // `actionWhole` off (every other weapon): the scene fallback rule as before
    const tight = { framing: 'action' as const, action: box, insetTop: 300, insetBottom: 120 }
    expect(fitCamera(375, 447, 2, tight)).toEqual(fitCamera(375, 447, 2, { ...tight, actionWhole: false }))
    // nor a scene without a blast
    expect(fitCamera(864, 801, 2, { insetTop: 210, insetBottom: 148, blast: null })).toEqual(fitCamera(864, 801, 2, { insetTop: 210, insetBottom: 148 }))
  })
})

describe('camera: a thrown explosive’s whole blast ring at tablet and desktop (scene framing, design review P3-S11 #3)', () => {
  const explosives = labWeapons(weaponsJson as Weapon[], LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'explosive-aoe')
  /**
   * The Lab's HUD rows for a thrown explosive, measured live (CSS px, + the HUD pad): the top row (the
   * EquippedBar, the "Explosives used" counter and the latest-blast readout under it, beside the stats box),
   * the bottom one (graph strip + controls; at 1024 the compact HUD's latest-blast strip too), the hint's room.
   */
  const layouts = [
    { name: '1440', w: 864, h: 800.75, top: 210, bottom: 148, floor: 38 },
    { name: '1024', w: 448, h: 668.75, top: 144, bottom: 168, floor: 36 },
    { name: '768', w: 768, h: 614.39, top: 210, bottom: 148, floor: 38 },
  ] as const
  const fitFor = (weapon: Weapon, l: (typeof layouts)[number], dpr: number, withBlast = true) => {
    const created = createLabSession(weapon, { setup: LAB_SETUP, seed: () => 1 })
    if (!created.ok) throw new Error('refused')
    const s = created.session
    const ring = s.blastFrame()!
    const dummies = s.sim.renderState().dummies
    const options: Partial<CameraOptions> = { insetTop: l.top, insetBottom: l.bottom, floorPx: l.floor, reachTiles: s.frameTiles, sceneX: sceneXFor(dummies), blast: withBlast ? ring : null }
    return { ring, fit: fitCamera(l.w, l.h, dpr, options) }
  }
  /** The ring's screen box. */
  const ringOn = (fit: CameraFit, ring: { x: number; y: number; radiusTiles: number }) => ({
    left: worldToScreen(fit, ring.x - ring.radiusTiles, 0).x,
    right: worldToScreen(fit, ring.x + ring.radiusTiles, 0).x,
    top: worldToScreen(fit, 0, ring.y - ring.radiusTiles).y,
    bottom: worldToScreen(fit, 0, ring.y + ring.radiusTiles).y,
  })

  it('every explosive: the ring whole across the canvas and between the HUD rows (wherever one device pixel per game pixel allows), the platforms whole, the head below the top row', () => {
    expect(explosives).toHaveLength(15)
    let whole = 0
    let checked = 0
    for (const weapon of explosives) {
      for (const l of layouts) {
        for (const dpr of [1, 2]) {
          const { ring, fit } = fitFor(weapon, l, dpr)
          const at = `${weapon.name} ${l.name}@${dpr}`
          const px = 1 / dpr
          const r = ringOn(fit, ring)
          checked++
          expect(fit.framing, at).toBe('scene')
          expect(r.left, at).toBeGreaterThanOrEqual(-px)
          expect(r.right, at).toBeLessThanOrEqual(l.w + px)
          const [x0, x1] = visibleWorldX(fit)
          expect(x0, at).toBeLessThanOrEqual(ARENA_CORE_X[0] + 1e-9)
          expect(x1, at).toBeGreaterThanOrEqual(ARENA_CORE_X[1] - 1e-9)
          expect(worldToScreen(fit, 0, PLAYER_TOP_Y).y, at).toBeGreaterThanOrEqual(l.top - px)
          if (2 * ring.radiusTiles * fit.tilePx <= l.h - l.top - l.bottom) {
            expect(r.top, at).toBeGreaterThanOrEqual(l.top - px)
            expect(r.bottom, at).toBeLessThanOrEqual(l.h - l.bottom + px)
            whole++
          } else {
            // only the 1-device-px floor stops it (the Power Bombs at 768@1): the lower arc stays above the bottom row
            expect(fit.devicePxPerGamePx, at).toBe(1)
            expect(r.bottom, at).toBeLessThanOrEqual(l.h - l.bottom + px)
          }
        }
      }
    }
    expect(whole).toBeGreaterThanOrEqual(checked - 2)
  })

  it('only a ring the scene would cut changes the view: one the scene shows whole (its 1½ art px stroke too) keeps its zoom and placement exactly; the zoom never steps in', () => {
    const air = (1.5 * GAME_PX_PER_ART_PX) / GAME_PX_PER_TILE
    let kept = 0
    let zoomed = 0
    for (const weapon of explosives) {
      for (const l of layouts) {
        for (const dpr of [1, 2]) {
          const { ring, fit } = fitFor(weapon, l, dpr)
          const base = fitFor(weapon, l, dpr, false).fit
          const at = `${weapon.name} ${l.name}@${dpr}`
          const b = ringOn(base, { ...ring, radiusTiles: ring.radiusTiles + air })
          const shownWhole = b.left >= 0 && b.right <= l.w && b.top >= l.top && b.bottom <= l.h - l.bottom
          expect(fit.tilePx, at).toBeLessThanOrEqual(base.tilePx)
          if (shownWhole) {
            expect(fit, at).toEqual(base)
            kept++
          }
          if (fit.tilePx < base.tilePx) {
            expect(shownWhole, at).toBe(false)
            zoomed++
          }
        }
      }
    }
    expect(kept).toBeGreaterThan(0)
    expect(zoomed).toBeGreaterThan(0)
  })

  it('1440 (the review’s capture): the Dynamite and Power Bomb rings, cut at 48 px per tile, are whole at 24 — the largest crisp zoom that holds them (32 would not); the Bomb keeps 48, only lifted', () => {
    const l = layouts[0]
    for (const name of ['Dynamite', 'Power Bomb']) {
      const weapon = explosives.find((w) => w.name === name)!
      const { ring, fit } = fitFor(weapon, l, 1)
      const base = fitFor(weapon, l, 1, false).fit
      expect(base.tilePx, name).toBe(48)
      const cut = ringOn(base, ring)
      expect(cut.right > l.w || cut.bottom > l.h - l.bottom, name).toBe(true)
      expect(fit.tilePx, name).toBe(24)
      expect(2 * ring.radiusTiles * 32, name).toBeGreaterThan(l.h - l.top - l.bottom)
      const r = ringOn(fit, ring)
      expect(r.top, name).toBeGreaterThanOrEqual(l.top)
      expect(r.bottom, name).toBeLessThanOrEqual(l.h - l.bottom)
      expect(r.right, name).toBeLessThanOrEqual(l.w)
      // the composition otherwise as before: the player at the scene's anchor
      expect(fit.originX / l.w, name).toBeCloseTo(DEFAULT_CAMERA.anchorX, 2)
    }
    const bomb = explosives.find((w) => w.name === 'Bomb')!
    const { ring, fit } = fitFor(bomb, l, 1)
    const base = fitFor(bomb, l, 1, false).fit
    expect(fit.tilePx).toBe(base.tilePx)
    expect(fit.originX).toBe(base.originX)
    expect(fit.originY).toBeLessThan(base.originY)
    expect(ringOn(fit, ring).bottom).toBeLessThanOrEqual(l.h - l.bottom)
  })
})

describe('markers over a dummy keep clear of the HUD’s top row, like the damage numbers (design review P3-S11: the Imp Staff’s flame at 375)', () => {
  /** The taller marker (a debuff glyph) and its 2 art px over the bar's line, in tiles — what the arena keeps clear. */
  const height = ((Math.max(buildTagIcon().length, ...(['flame', 'frost', 'drop'] as const).map((g) => buildDebuffIcon(g).length)) + 2) * GAME_PX_PER_ART_PX) / GAME_PX_PER_TILE
  const impStaff = labWeapons(weaponsJson as Weapon[], LAB_SETUP).find((w) => w.name === 'Imp Staff')!

  it('the Imp Staff on the Debuff Dummy at 375 (the phone HUD with its reserved debuff strip): the flame moves down under the top row — no further — never up, and stays put where it is clear', () => {
    const created = createLabSession(impStaff, { setup: LAB_SETUP, seed: () => 1, target: { kind: 'debuff' } })
    if (!created.ok) throw new Error('refused')
    const s = created.session
    const [dummy] = s.sim.renderState().dummies
    const marker = debuffMarker({ ...dummy, debuffs: [{ buffId: 'on-fire', remainingTicks: 60, durationTicks: 300 }] })!
    expect(marker.glyph).toBe('flame')
    // measured live: the top row (EquippedBar beside the stats box), the bottom (minions + debuff strips + controls)
    const l = { w: 375, h: 446.59, top: 144, bottom: 180, floor: 48 }
    let under = 0
    for (const dpr of [1, 2, 3]) {
      const fit = fitCamera(l.w, l.h, dpr, { framing: 'action', insetTop: l.top, insetBottom: l.bottom, floorPx: l.floor, reachTiles: s.frameTiles, action: actionBox(s.frameTiles, [dummy]) })
      const at = `375@${dpr}`
      const top = (y: number) => worldToScreen(fit, 0, y - height).y
      if (top(marker.y) < l.top) under++
      const y = markerClearOfHud(marker.y, height, fit, l.top)
      expect(y, at).toBeGreaterThanOrEqual(marker.y)
      expect(top(y), at).toBeGreaterThanOrEqual(l.top - 1e-9)
      if (y > marker.y) {
        // moved: onto the art-pixel grid, at most one art pixel lower than the row needs
        expect(Number.isInteger(Math.round(((y * GAME_PX_PER_TILE) / GAME_PX_PER_ART_PX) * 1e6) / 1e6), at).toBe(true)
        expect(top(y) - l.top, at).toBeLessThan(GAME_PX_PER_ART_PX * fit.scale + 1e-9)
      } else expect(y, at).toBe(marker.y)
    }
    // the review's bug: without the clamp it sat under the stats box at every density
    expect(under).toBe(3)
    // desktop (scene framing, the full HUD): already clear — unchanged
    const desk = fitCamera(864, 800.75, 1, { insetTop: 226, insetBottom: 148, floorPx: 38, reachTiles: s.frameTiles })
    expect(markerClearOfHud(marker.y, height, desk, 226)).toBe(marker.y)
  })
})
