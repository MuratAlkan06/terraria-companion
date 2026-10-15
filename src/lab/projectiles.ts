/**
 * Projectiles in the arena (PRD P3-S4 AC1/AC4, P3-S5 AC3) — pure render math, no PixiJS.
 *
 * What is drawn is exactly the engine's projectile path (src/sim README "Render state", "Events"):
 * each shot is a track of timed sim positions — its `projectile-spawn` origin, every rendered
 * tick's position, and its end (the impact point of its last hit, or where it left the arena /
 * timed out). Render time trails the sim by one tick, like the blade (`prev → current` with alpha), so
 * even a shot that crosses to the dummy inside a single tick is seen travelling there.
 *
 * - The shot is seen from the player's front hand on (the projectile is launched at the player's
 *   centre, inside the body sprite): the hand projected onto the launch line, along the path.
 * - Body: a small ORIGINAL pixel shape per style (arrow / bullet / bolt), rasterized onto the
 *   arena's art-pixel grid (one art pixel = 2 game pixels, like the arena art and the thrust streak)
 *   by nearest-neighbour inverse rotation — never scaled, so no pixel-density mismatch at any angle.
 * - Trail: the path covered in the last TRAIL_TICKS ticks (a longer streak for a faster shot — the
 *   real distance travelled, not a stretched sprite), on the same grid. After a shot ends, its trail
 *   lingers as a tracer and fades over TRACER_FADE_MS (wall time), then the track is dropped.
 *
 * Styles are chosen from the data, never per weapon: magic bolts → `bolt`; bow/gun ammo classes
 * named for arrows → `arrow`; any other ammo → `bullet`.
 */
import type { Weapon } from '../schemas'
import type { RenderState, SimEvent } from '../sim'
import { GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { streakCells, THRUST_HAND } from './blade'

export type ProjectileStyle = 'arrow' | 'bullet' | 'bolt'
export type ProjectileTone = 'tip' | 'shaft' | 'fletch' | 'core' | 'glow'

export function projectileStyleFor(weapon: Pick<Weapon, 'labBehavior'>): ProjectileStyle {
  const lab = weapon.labBehavior
  const params = lab.kind === 'archetype' ? lab.params : null
  if (params?.archetype === 'bow-gun') return /arrow/.test(params.ammoClass) ? 'arrow' : 'bullet'
  return 'bolt'
}

/**
 * Shapes in art pixels: `[along, across, tone]`, the nose at along 0, the tail toward negative
 * along, `across` perpendicular to the flight. Original pixel art (AMENDMENTS-001 A12).
 */
const SHAPES: Record<ProjectileStyle, readonly (readonly [number, number, ProjectileTone])[]> = {
  // A 10-art-px arrow: barbed steel head, wooden shaft, two-feather fletching.
  arrow: [
    [0, 0, 'tip'],
    [-1, 0, 'tip'],
    [-1, -1, 'tip'],
    [-1, 1, 'tip'],
    ...[-2, -3, -4, -5, -6, -7, -8].map((a) => [a, 0, 'shaft'] as const),
    [-7, -1, 'fletch'],
    [-7, 1, 'fletch'],
    [-8, -1, 'fletch'],
    [-8, 1, 'fletch'],
    [-9, 0, 'fletch'],
  ],
  // A hot slug: white nose, glowing tail.
  bullet: [
    [0, 0, 'core'],
    [-1, 0, 'glow'],
  ],
  // A bolt of light: a two-pixel core in a one-pixel glow.
  bolt: [
    [0, 0, 'core'],
    [-1, 0, 'core'],
    [1, 0, 'glow'],
    [-2, 0, 'glow'],
    [0, -1, 'glow'],
    [0, 1, 'glow'],
    [-1, -1, 'glow'],
    [-1, 1, 'glow'],
  ],
}

export type Cell = readonly [x: number, y: number, tone: ProjectileTone]

/**
 * The body's cells (top-left corners, game px, `cell`-sized): every grid cell whose centre, rotated
 * back into the shape's frame, lands on a shape pixel. `head` = the nose (game px), `dir` = the
 * flight direction (any length).
 */
export function bodyCells(style: ProjectileStyle, head: { x: number; y: number }, dir: { x: number; y: number }, cell = GAME_PX_PER_ART_PX): Cell[] {
  const len = Math.hypot(dir.x, dir.y)
  if (!(len > 0) || !(cell > 0)) return []
  const dx = dir.x / len
  const dy = dir.y / len
  const shape = new Map(SHAPES[style].map(([a, c, tone]) => [`${a},${c}`, tone]))
  let extent = 0
  for (const [a, c] of SHAPES[style]) extent = Math.max(extent, Math.hypot(a, c))
  const radius = (extent + 1) * cell
  const cells: Cell[] = []
  for (let gy = Math.floor((head.y - radius) / cell); gy <= Math.ceil((head.y + radius) / cell); gy++) {
    for (let gx = Math.floor((head.x - radius) / cell); gx <= Math.ceil((head.x + radius) / cell); gx++) {
      const rx = (gx + 0.5) * cell - head.x
      const ry = (gy + 0.5) * cell - head.y
      const along = Math.round((rx * dx + ry * dy) / cell) + 0
      const across = Math.round((ry * dx - rx * dy) / cell) + 0
      const tone = shape.get(`${along},${across}`)
      if (tone) cells.push([gx * cell, gy * cell, tone])
    }
  }
  return cells
}

/** The trail's cells along a polyline (game px), oldest first, each square once. */
export function trailCells(path: readonly { x: number; y: number }[], cell = GAME_PX_PER_ART_PX): [number, number][] {
  const out: [number, number][] = []
  const seen = new Set<string>()
  for (let i = 1; i < path.length; i++) {
    for (const [x, y] of streakCells(path[i - 1], path[i], cell)) {
      const key = `${x},${y}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([x, y])
    }
  }
  return out
}

/** Ticks of flight the trail shows behind the nose. */
export const TRAIL_TICKS = 3
/** How long a finished shot's tracer lingers (ms, fading out). */
export const TRACER_FADE_MS = 140

/**
 * Where a shot becomes visible (tiles along its path from the player's centre): the front hand
 * (../blade.ts THRUST_HAND, mirrored by facing) projected onto the launch direction.
 */
export function handLaunchTiles(facing: 1 | -1, dirX: number, dirY: number): number {
  const len = Math.hypot(dirX, dirY)
  if (!(len > 0)) return 0
  return Math.max(0, (facing * THRUST_HAND.x * dirX + THRUST_HAND.y * dirY) / len / GAME_PX_PER_TILE)
}

interface TimedPoint {
  x: number
  y: number
  /** Sim time in ticks (a position after tick k is at time k + 1). */
  t: number
  /** Path length from the launch point (tiles). */
  s: number
}

interface Track {
  points: TimedPoint[]
  launch: number
  /** Latest velocity (tiles/s). */
  vx: number
  vy: number
  impact: { x: number; y: number } | null
  /** Sim time the shot ended (null while flying). */
  endT: number | null
  /** Wall time (ms) render time first passed the end: the tracer fades from here. */
  fadeFrom: number | null
}

export interface ProjectileVisual {
  id: number
  /** The nose (tiles) while the shot is in flight and past the hand; null otherwise. */
  head: { x: number; y: number } | null
  /** Flight direction at the nose (unit). */
  dir: { x: number; y: number }
  /** The path covered in the last TRAIL_TICKS (tiles, oldest first), from the hand on. */
  trail: { x: number; y: number }[]
  /** 1 in flight; fades to 0 after the shot ends. */
  alpha: number
}

type Spawn = Extract<SimEvent, { type: 'projectile-spawn' }>
type Despawn = Extract<SimEvent, { type: 'projectile-despawn' }>
type Damage = Extract<SimEvent, { type: 'damage' }>

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

function addPoint(track: Track, x: number, y: number, t: number): void {
  const last = track.points.at(-1)
  if (last && t <= last.t) return
  const s = last ? last.s + Math.hypot(x - last.x, y - last.y) : 0
  track.points.push({ x, y, t, s })
}

/** Position on the track at sim time `t` (clamped to its known span). */
function pointAt(points: readonly TimedPoint[], t: number): TimedPoint {
  if (t <= points[0].t) return points[0]
  for (let i = 1; i < points.length; i++) {
    const b = points[i]
    if (t <= b.t) {
      const a = points[i - 1]
      const f = (t - a.t) / (b.t - a.t)
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), t, s: lerp(a.s, b.s, f) }
    }
  }
  return points[points.length - 1]
}

/** Position on the track at path length `s`. */
function pointAtLength(points: readonly TimedPoint[], s: number): TimedPoint {
  if (s <= points[0].s) return points[0]
  for (let i = 1; i < points.length; i++) {
    const b = points[i]
    if (s <= b.s) {
      const a = points[i - 1]
      const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 1
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), t: lerp(a.t, b.t, f), s }
    }
  }
  return points[points.length - 1]
}

/** Every shot in flight (and every fading tracer), fed by the session's events and render state. */
export class ProjectileTracks {
  private readonly tracks = new Map<number, Track>()

  get size(): number {
    return this.tracks.size
  }

  clear(): void {
    this.tracks.clear()
  }

  spawn(e: Spawn, facing: 1 | -1): void {
    this.tracks.set(e.projectileId, {
      points: [{ x: e.x, y: e.y, t: e.tick, s: 0 }],
      launch: handLaunchTiles(facing, e.vx, e.vy),
      vx: e.vx,
      vy: e.vy,
      impact: null,
      endT: null,
      fadeFrom: null,
    })
  }

  /** A projectile's hit (`sourceId` `proj:<id>`): its last one is where it stops if its pierce runs out. */
  impact(e: Damage): void {
    // Any projectile's hit — a summon's shot too (P3-S9: its source is the summon's kind).
    if (!e.sourceId.startsWith('proj:')) return
    const id = Number(e.sourceId.slice('proj:'.length))
    const track = this.tracks.get(id)
    if (track) track.impact = { x: e.x, y: e.y }
  }

  despawn(e: Despawn): void {
    const track = this.tracks.get(e.projectileId)
    if (!track || track.endT !== null) return
    const endT = e.tick + 1
    const last = track.points[track.points.length - 1]
    // Pierce spent: it stopped at its last hit. Lifetime / out of bounds: it made its last move first.
    const end =
      e.reason === 'pierce-exhausted' && track.impact
        ? track.impact
        : { x: last.x + (track.vx * (endT - last.t)) / 60, y: last.y + (track.vy * (endT - last.t)) / 60 }
    addPoint(track, end.x, end.y, endT)
    track.endT = endT
  }

  /** The render state's positions after `tick` ticks: `prev` at tick − 1, current at tick. */
  sync(projectiles: RenderState['projectiles'], tick: number, facing: 1 | -1): void {
    for (const p of projectiles) {
      let track = this.tracks.get(p.id)
      if (!track) {
        // Its spawn event was never seen (e.g. dropped from a full queue): start where it was.
        track = { points: [], launch: handLaunchTiles(facing, p.vx, p.vy), vx: p.vx, vy: p.vy, impact: null, endT: null, fadeFrom: null }
        this.tracks.set(p.id, track)
      }
      addPoint(track, p.prevX, p.prevY, tick - 1)
      addPoint(track, p.x, p.y, tick)
      track.vx = p.vx
      track.vy = p.vy
    }
  }

  /**
   * What to draw at sim time `renderT` (= render-state tick − 1 + alpha) and wall time `nowMs`.
   * Drops tracers that have faded and track points too old for any trail.
   */
  visuals(renderT: number, nowMs: number): ProjectileVisual[] {
    const out: ProjectileVisual[] = []
    for (const [id, track] of this.tracks) {
      const { points } = track
      if (points.length === 0 || renderT < points[0].t) continue
      const ended = track.endT !== null && renderT >= track.endT
      let alpha = 1
      if (ended) {
        track.fadeFrom ??= nowMs
        alpha = 1 - (nowMs - track.fadeFrom) / TRACER_FADE_MS
        if (alpha <= 0) {
          this.tracks.delete(id)
          continue
        }
      }
      const head = pointAt(points, Math.min(renderT, points[points.length - 1].t))
      const tail = pointAt(points, Math.max(points[0].t, head.t - TRAIL_TICKS))
      const from = tail.s >= track.launch ? tail : pointAtLength(points, Math.min(track.launch, head.s))
      const trail: { x: number; y: number }[] = []
      if (head.s > track.launch) {
        trail.push({ x: from.x, y: from.y })
        for (const p of points) if (p.t > from.t && p.t < head.t) trail.push({ x: p.x, y: p.y })
        trail.push({ x: head.x, y: head.y })
      }
      // Direction at the nose: the path just behind it, else the velocity.
      const behind = pointAt(points, Math.max(points[0].t, head.t - 0.25))
      let dx = head.x - behind.x
      let dy = head.y - behind.y
      if (Math.hypot(dx, dy) < 1e-9) [dx, dy] = [track.vx, track.vy]
      const len = Math.hypot(dx, dy) || 1
      out.push({
        id,
        head: !ended && head.s >= track.launch ? { x: head.x, y: head.y } : null,
        dir: { x: dx / len, y: dy / len },
        trail,
        alpha,
      })
      // Points older than any future trail are no longer needed (keep one before the trail's start).
      const keepFrom = head.t - TRAIL_TICKS - 1
      while (points.length > 2 && points[1].t < keepFrom) points.shift()
    }
    return out
  }
}

/** Tiles → game px (the arena's world container units). */
export const toGamePx = (p: { x: number; y: number }) => ({ x: p.x * GAME_PX_PER_TILE, y: p.y * GAME_PX_PER_TILE })
