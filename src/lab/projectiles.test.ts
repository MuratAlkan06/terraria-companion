/**
 * Projectile render math (no PixiJS): shots drawn from the engine's own path at native pixel
 * scale on the art-pixel grid (consistent with the thrust ruling — no density mismatch), seen from
 * the player's hand, ending at the dummy hit or the lifetime / arena edge; the held weapon at native
 * scale in the hand; damage-over-time numbers at their own slower cadence (UX_SPEC §12).
 */
import { describe, expect, it } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import type { Weapon } from '../data-access/types'
import type { SimEvent } from '../sim'
import { GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { heldWeaponVisual, holdStyleFor, spriteTipOffset, THRUST_HAND } from './blade'
import { DOT_NUMBER_TICKS, DotNumberTicker } from './floatingNumbers'
import { createLabSession, type LabSession } from './labSession'
import { labWeapons } from './labWeapons'
import { bodyCells, handLaunchTiles, ProjectileTracks, projectileStyleFor, TRACER_FADE_MS, trailCells, type ProjectileStyle } from './projectiles'
import { ALL_WEAPONS, LAB_SETUP } from './testing/labData'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const byName = (name: string) => list.find((w) => w.name === name)!
const CELL = GAME_PX_PER_ART_PX
const STYLES: ProjectileStyle[] = ['arrow', 'bullet', 'bolt']
const onGrid = (v: number) => Math.abs(v / CELL - Math.round(v / CELL)) < 1e-9

function session(weapon: Weapon, seed = 3): LabSession {
  const created = createLabSession(weapon, { seed: () => seed, setup: LAB_SETUP })
  if (!created.ok) throw new Error('refused')
  return created.session
}

describe('shot bodies: original pixel shapes at native scale on the art-pixel grid', () => {
  it('every cell is one art pixel on the arena’s grid, at any position and angle', () => {
    for (const style of STYLES) {
      for (let a = 0; a < 360; a += 7) {
        const rad = (a * Math.PI) / 180
        for (const [x, y] of bodyCells(style, { x: 37.3 + a, y: -11.9 }, { x: Math.cos(rad), y: Math.sin(rad) })) {
          expect(onGrid(x) && onGrid(y), `${style} ${a}°`).toBe(true)
        }
      }
    }
  })

  it('never stretched by speed: the same shape for any velocity length (a fast bullet is not a longer sprite)', () => {
    for (const style of STYLES) {
      const slow = bodyCells(style, { x: 10, y: 4 }, { x: 0.3, y: 0.1 })
      const fast = bodyCells(style, { x: 10, y: 4 }, { x: 300, y: 100 })
      expect(fast).toEqual(slow)
    }
  })

  it('rotation keeps the shape’s pixel count (nearest-neighbour inverse rotation: no holes, no smears)', () => {
    for (const style of STYLES) {
      const axis = bodyCells(style, { x: 1, y: 1 }, { x: 1, y: 0 }).length
      for (const dir of [{ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) expect(bodyCells(style, { x: 1, y: 1 }, dir).length, style).toBe(axis)
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180
        const n = bodyCells(style, { x: 0.7, y: 0.2 }, { x: Math.cos(rad), y: Math.sin(rad) }).length
        expect(n, `${style} ${a}°`).toBeGreaterThanOrEqual(Math.floor(axis * 0.7))
        expect(n, `${style} ${a}°`).toBeLessThanOrEqual(Math.ceil(axis * 1.3))
      }
    }
  })

  it('the nose leads: flying right, no cell is ahead of the head; the arrow trails 10 art px behind it', () => {
    for (const style of STYLES) {
      const head = { x: 21, y: 5 }
      const cells = bodyCells(style, head, { x: 1, y: 0 })
      expect(Math.max(...cells.map(([x]) => x))).toBeLessThanOrEqual(head.x + CELL)
    }
    const arrow = bodyCells('arrow', { x: 21, y: 5 }, { x: 1, y: 0 })
    expect(Math.max(...arrow.map(([x]) => x)) - Math.min(...arrow.map(([x]) => x))).toBe(9 * CELL)
  })

  it('styles come from the data: arrows for arrow ammo, bullets for other ammo, bolts for magic', () => {
    const styles = new Map(list.map((w) => [w.name, projectileStyleFor(w)]))
    expect(styles.get('Wooden Bow')).toBe('arrow')
    expect(styles.get('Minishark')).toBe('bullet')
    expect(styles.get('Frost Staff')).toBe('bolt')
  })
})

describe('trails: the real path of the last ticks of flight, on the same grid', () => {
  it('cells are grid-aligned, unique and contiguous (each touches the last, diagonals included)', () => {
    const path = [
      { x: 3.1, y: 1.2 },
      { x: 40.7, y: -9.3 },
      { x: 61.2, y: 18.8 },
    ]
    const cells = trailCells(path)
    expect(cells.length).toBeGreaterThan(10)
    expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(cells.length)
    for (const [x, y] of cells) expect(onGrid(x) && onGrid(y)).toBe(true)
    for (let i = 1; i < cells.length; i++) {
      expect(Math.abs(cells[i][0] - cells[i - 1][0])).toBeLessThanOrEqual(CELL)
      expect(Math.abs(cells[i][1] - cells[i - 1][1])).toBeLessThanOrEqual(CELL)
    }
  })
})

describe('ProjectileTracks on a real session: the drawn shot is the engine’s shot', () => {
  /** Drives a session with Space held; feeds the tracks like the arena does; returns per-frame visuals. */
  function drive(weapon: Weapon, frames: number) {
    const s = session(weapon)
    const tracks = new ProjectileTracks()
    const out: { renderT: number; now: number; visuals: ReturnType<ProjectileTracks['visuals']>; state: ReturnType<LabSession['sim']['renderState']>; events: SimEvent[]; alpha: number }[] = []
    s.press('key')
    let now = 0
    for (let f = 0; f < frames; f++) {
      const frameMs = f % 3 === 0 ? 7 : 19 // uneven frames: alpha varies
      now += frameMs
      const { alpha, events } = s.frame(frameMs)
      const state = s.sim.renderState()
      for (const e of events) {
        if (e.type === 'projectile-spawn') tracks.spawn(e, state.facing)
        else if (e.type === 'projectile-despawn') tracks.despawn(e)
        else if (e.type === 'damage') tracks.impact(e)
      }
      tracks.sync(state.projectiles, state.tick, state.facing)
      const renderT = state.tick - 1 + alpha
      out.push({ renderT, now, visuals: tracks.visuals(renderT, now), state, events, alpha })
    }
    return { s, tracks, frames: out }
  }

  it('in flight, the nose is exactly the render state’s interpolated position (prev → current with alpha)', () => {
    const { frames } = drive(byName('Wooden Bow'), 240)
    let checked = 0
    for (const { visuals, state, alpha } of frames) {
      for (const p of state.projectiles) {
        const v = visuals.find((x) => x.id === p.id)!
        if (!v.head) continue
        expect(v.head.x).toBeCloseTo(p.prevX + (p.x - p.prevX) * alpha, 9)
        expect(v.head.y).toBeCloseTo(p.prevY + (p.y - p.prevY) * alpha, 9)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('shots are seen from the hand on — never inside the player — and end at the dummy hit', () => {
    const weapon = byName('Wooden Bow')
    const { frames, s } = drive(weapon, 240)
    const dummy = s.sim.renderState().dummies[0]
    const launch = handLaunchTiles(1, 1, 0)
    expect(launch).toBeCloseTo(THRUST_HAND.x / GAME_PX_PER_TILE, 9)
    for (const { visuals } of frames) {
      for (const v of visuals) {
        for (const p of v.trail) expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(launch - 1e-9)
        if (v.head) expect(v.head.x).toBeLessThanOrEqual(dummy.x - dummy.width / 2 + 1e-9)
      }
    }
    // An ended shot's tracer ends exactly at the impact point.
    const hit = frames.flatMap((f) => f.events).find((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage')!
    const id = Number(hit.sourceId.slice(5))
    const tracer = frames.flatMap((f) => f.visuals).find((v) => v.id === id && v.head === null && v.trail.length > 0)!
    expect(tracer.trail.at(-1)!.x).toBeCloseTo(hit.x, 9)
    expect(tracer.trail.at(-1)!.y).toBeCloseTo(hit.y, 9)
  })

  it('a shot that crosses to the dummy inside one tick is still seen travelling (render time trails by a tick)', () => {
    const tracks = new ProjectileTracks()
    // Spawned at tick 10 at 100 tiles/s, hits the face of a dummy at x = 5 within that tick.
    tracks.spawn({ type: 'projectile-spawn', tick: 10, seq: 0, projectileId: 1, x: 0, y: 0, vx: 600, vy: 0 }, 1)
    tracks.impact({ type: 'damage', tick: 10, seq: 1, source: 'projectile', sourceId: 'proj:1', dummyId: 'dummy-0', amount: 5, crit: false, x: 5, y: 0 })
    tracks.despawn({ type: 'projectile-despawn', tick: 10, seq: 2, projectileId: 1, reason: 'pierce-exhausted' })
    const mid = tracks.visuals(10.5, 0)[0]
    expect(mid.head?.x).toBeCloseTo(2.5, 9)
    expect(mid.alpha).toBe(1)
    const end = tracks.visuals(11.2, 100)[0]
    expect(end.head).toBeNull()
    expect(end.trail.at(-1)).toEqual({ x: 5, y: 0 })
    expect(end.trail[0].x).toBeCloseTo(handLaunchTiles(1, 1, 0), 9)
    // The tracer fades out, then the track is dropped.
    expect(tracks.visuals(11.5, 100 + TRACER_FADE_MS / 2)[0].alpha).toBeCloseTo(0.5, 9)
    expect(tracks.visuals(12, 100 + TRACER_FADE_MS)).toEqual([])
    expect(tracks.size).toBe(0)
  })

  it('a shot that leaves the arena or times out ends where it made its last move', () => {
    const tracks = new ProjectileTracks()
    tracks.spawn({ type: 'projectile-spawn', tick: 0, seq: 0, projectileId: 7, x: 0, y: 0, vx: 60, vy: 0 }, 1)
    tracks.sync([{ id: 7, prevX: 3, prevY: 0, x: 4, y: 0, vx: 60, vy: 0 }], 4, 1)
    tracks.despawn({ type: 'projectile-despawn', tick: 6, seq: 1, projectileId: 7, reason: 'lifetime' })
    const [v] = tracks.visuals(8, 0)
    expect(v.trail.at(-1)!.x).toBeCloseTo(7, 9)
  })

  it('a multi-shot volley draws every projectile (Quad-Barrel Shotgun: 8 noses, fanned)', () => {
    const { frames } = drive(byName('Quad-Barrel Shotgun'), 40)
    const most = Math.max(...frames.map((f) => f.visuals.filter((v) => v.head).length))
    expect(most).toBe(8)
    const fan = frames.find((f) => f.visuals.filter((v) => v.head).length === 8)!
    const angles = fan.visuals.map((v) => Math.atan2(v.dir.y, v.dir.x))
    expect((Math.max(...angles) - Math.min(...angles)) * (180 / Math.PI)).toBeCloseTo(45, 3)
  })
})

describe('the held weapon: native art scale, at the front hand, pointing along the shot', () => {
  const sized = list
    .filter((w) => w.labBehavior.kind === 'archetype' && ['bow-gun', 'magic-bolt'].includes(w.labBehavior.params.archetype))
    .map((weapon) => {
      const file = manifest.files.find((f) => f.path === weapon.sprite)
      if (!file?.width || !file.height) throw new Error(`no sprite size for ${weapon.name}`)
      return { weapon, width: file.width, height: file.height }
    })

  it('guns, bows and repeaters are held along their axis; staffs (near-square sprites) diagonally', () => {
    for (const { weapon, width, height } of sized) {
      const style = holdStyleFor(width, height)
      if (weapon.tags.some((t) => ['guns', 'bows', 'repeaters', 'magic-guns'].includes(t))) expect(style, weapon.name).toBe('axis')
      if (weapon.tags.includes('wands')) expect(style, weapon.name).toBe('diagonal')
    }
  })

  it('|scale| = 1 at every angle; the handle sits at the hand (mirrored by facing); the muzzle lies along the aim', () => {
    for (const { weapon, width, height } of sized) {
      const style = holdStyleFor(width, height)
      for (const facing of [1, -1] as const) {
        for (const deg of facing === 1 ? [-60, -20, 0, 35, 80] : [100, 150, 180, 215, 260]) {
          const angle = (deg * Math.PI) / 180
          const v = heldWeaponVisual(angle, facing, width, height, style)
          expect(Math.abs(v.transform.scaleX), weapon.name).toBe(1)
          expect(Math.abs(v.transform.scaleY), weapon.name).toBe(1)
          expect(v.handle).toEqual({ x: facing * THRUST_HAND.x, y: THRUST_HAND.y })
          const dx = v.muzzle.x - v.handle.x
          const dy = v.muzzle.y - v.handle.y
          const length = style === 'axis' ? width : Math.hypot(width, height)
          expect(Math.hypot(dx, dy), weapon.name).toBeCloseTo(length, 6)
          expect(Math.atan2(dy, dx)).toBeCloseTo(Math.atan2(Math.sin(angle), Math.cos(angle)), 6)
          if (style === 'diagonal') {
            const tip = spriteTipOffset(v.transform, width, height)
            expect(tip.x).toBeCloseTo(dx, 6)
            expect(tip.y).toBeCloseTo(dy, 6)
          } else {
            // Upright either way: the sprite's "up" never points down-screen when held level.
            const upY = -Math.cos(v.transform.rotation) * v.transform.scaleY
            if (Math.abs(Math.sin(angle)) < 0.5) expect(upY, `${weapon.name} ${deg}°`).toBeLessThan(0)
          }
        }
      }
    }
  })
})

describe('damage-over-time numbers: a smaller, slower cadence (UX_SPEC §12)', () => {
  it('one number per debuff per dummy per half second, summing every DoT tick (no damage lost)', () => {
    const s = session(byName('Frost Staff'))
    s.updateSettings({ ignoreMana: true })
    const ticker = new DotNumberTicker()
    s.press('key')
    let dotTotal = 0
    let dotEvents = 0
    const shown: number[] = []
    for (let f = 0; f < 600; f++) {
      const { events } = s.frame(1000 / 60)
      for (const e of events) {
        if (e.type !== 'damage' || e.source !== 'dot') continue
        dotTotal += e.amount
        dotEvents++
        ticker.add(e)
      }
      shown.push(...ticker.drain(s.sim.renderState().tick).map((n) => n.amount))
    }
    shown.push(...ticker.drain(Infinity, true).map((n) => n.amount))
    expect(dotEvents).toBeGreaterThan(100)
    expect(shown.reduce((a, b) => a + b, 0)).toBe(dotTotal)
    // Far fewer numbers than DoT ticks: at most one per window of the 10 s run (plus the flush).
    expect(shown.length).toBeLessThanOrEqual(Math.ceil(600 / DOT_NUMBER_TICKS) + 1)
    expect(shown.length).toBeLessThan(dotEvents / 4)
  })

  it('separate debuffs and dummies keep separate numbers; a window opens at its first tick', () => {
    const t = new DotNumberTicker(30)
    const base = { x: 6, y: 0 }
    t.add({ tick: 0, dummyId: 'a', sourceId: 'buff:x', amount: 1, ...base })
    t.add({ tick: 5, dummyId: 'a', sourceId: 'buff:y', amount: 2, ...base })
    t.add({ tick: 10, dummyId: 'b', sourceId: 'buff:x', amount: 3, ...base })
    t.add({ tick: 20, dummyId: 'a', sourceId: 'buff:x', amount: 4, ...base })
    expect(t.drain(29)).toEqual([])
    expect(t.drain(30).map((n) => [n.dummyId, n.sourceId, n.amount])).toEqual([['a', 'buff:x', 5]])
    expect(t.drain(40).map((n) => [n.dummyId, n.sourceId, n.amount])).toEqual([
      ['a', 'buff:y', 2],
      ['b', 'buff:x', 3],
    ])
  })
})
