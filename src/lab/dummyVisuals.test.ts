/**
 * The arena's dummy roster v2 visuals (PRD P3-S12), pure: a Moving Dummy's interpolated pose and dashed
 * track, the armored art, and the camera framing a whole path (never following the dummy) and any dummy
 * reaching above the default band — while the standard dummies' framing stays exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { createLabSim, type RenderState } from '../sim'
import { swordFixture } from '../sim/testing/fixtures'
import { buildDummy, buildShieldIcon, DUMMY_ART, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { A } from './art/arenaPalette'
import { DEFAULT_CAMERA, dummyFrames, fitCamera, sceneBandFor, sceneXFor } from './camera'
import { dummyArt, dummyCentre, dummyTrackCells, TRACK_DASH, TRACK_GAP } from './dummyVisuals'
import { labDummiesFor, type LabTarget } from './labSetup'

const renderOf = (target: LabTarget, ticks = 0): RenderState['dummies'] => {
  const r = createLabSim({ weapon: swordFixture(), dummies: labDummiesFor('bow-gun', target) })
  if (!r.ok) throw new Error('refused')
  r.sim.step(ticks)
  return r.sim.renderState().dummies
}

describe('a Moving Dummy’s pose and track', () => {
  it('glides between its last two ticks (alpha); a finished test shows where the run ended', () => {
    const d = { x: 10, y: -2, prevX: 9, prevY: -1 }
    expect(dummyCentre(d, 0, false)).toEqual({ x: 9, y: -1 })
    expect(dummyCentre(d, 0.5, false)).toEqual({ x: 9.5, y: -1.5 })
    expect(dummyCentre(d, 0.25, true)).toEqual({ x: 10, y: -2 })
  })

  it('away and back: dashes along the ground under its feet, home to the far end, on the art-pixel grid', () => {
    const [d] = renderOf({ kind: 'moving', axis: 'horizontal', speedTps: 4 })
    const px = GAME_PX_PER_ART_PX
    const cells = dummyTrackCells(d, px)
    expect(cells.length).toBeGreaterThan(10)
    const ys = new Set(cells.map(([, y]) => y))
    expect([...ys]).toEqual([(d.y + d.height / 2) * GAME_PX_PER_TILE - px]) // one art px above the feet line
    expect(cells[0][0]).toBe(d.path!.fromX * GAME_PX_PER_TILE)
    expect(Math.max(...cells.map(([x]) => x))).toBeLessThanOrEqual(d.path!.toX * GAME_PX_PER_TILE)
    for (const [x, y] of cells) expect([x % px, y % px]).toEqual([0, 0])
    // dashed: TRACK_DASH cells, then a TRACK_GAP-cell gap
    expect(cells[TRACK_DASH][0] - cells[TRACK_DASH - 1][0]).toBe((TRACK_GAP + 1) * px)
  })

  it('up and back: dashes up the middle of the column its feet rise through', () => {
    const [d] = renderOf({ kind: 'moving', axis: 'vertical', speedTps: 4 })
    const cells = dummyTrackCells(d, GAME_PX_PER_ART_PX)
    expect(new Set(cells.map(([x]) => x)).size).toBe(1)
    const ys = cells.map(([, y]) => y)
    expect(Math.max(...ys)).toBe((d.path!.fromY + d.height / 2) * GAME_PX_PER_TILE - GAME_PX_PER_ART_PX)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual((d.path!.toY + d.height / 2) * GAME_PX_PER_TILE - GAME_PX_PER_ART_PX)
  })

  it('a dummy that never moves has no track', () => {
    for (const target of [{ kind: 'single' }, { kind: 'boss', scale: 3 }, { kind: 'armored', defense: 9, bossId: null }] as LabTarget[]) {
      expect(dummyTrackCells(renderOf(target)[0], GAME_PX_PER_ART_PX)).toEqual([])
    }
  })
})

describe('the Armored Dummy’s look', () => {
  it('armored art for a dummy with defense, the plain dummy otherwise; same frame, the bullseye where it was', () => {
    expect(dummyArt({ defense: 0 })).toBe('plain')
    expect(dummyArt({ defense: 1 })).toBe('armored')
    const plain = buildDummy()
    const armored = buildDummy('armored')
    expect([armored.length, armored[0].length]).toEqual([DUMMY_ART.height, DUMMY_ART.width])
    expect(armored).not.toEqual(plain)
    // every painted ring cell (red / white) of the bullseye is the same on the plate
    const { x0, x1, y0, y1 } = DUMMY_ART.bullseye
    let rings = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (plain[y][x] !== A.red && plain[y][x] !== A.white) continue
        rings++
        expect(armored[y][x], `${x},${y}`).toBe(plain[y][x])
      }
    }
    expect(rings).toBeGreaterThan(10)
    expect(buildDummy('plain')).toEqual(plain)
  })

  it('the shield icon is outlined on every side', () => {
    const rows = buildShieldIcon()
    expect(rows[0]).toMatch(/^\.+[^.]+\.+$/) // the outline's top, with air either side
    expect(rows.at(-1)).toMatch(/^\.+[^.]\.+$/) // the point
  })
})

describe('camera framing for the roster (never follows a moving dummy)', () => {
  it('a Moving Dummy is framed at both ends of its path — the same frames wherever it is now', () => {
    const home = renderOf({ kind: 'moving', axis: 'horizontal', speedTps: 6 })
    const later = renderOf({ kind: 'moving', axis: 'horizontal', speedTps: 6 }, 47)
    expect(later[0].x).not.toBe(home[0].x)
    expect(dummyFrames(later)).toEqual(dummyFrames(home))
    expect(dummyFrames(home).map((f) => f.x)).toEqual([home[0].path!.fromX, home[0].path!.toX])
    expect(sceneXFor(dummyFrames(later))).toEqual(sceneXFor(dummyFrames(home)))
  })

  it('the standard dummies keep the default band; a tall box or a rising path raises its top, never its bottom', () => {
    for (const target of [{ kind: 'single' }, { kind: 'row', count: 5 }, { kind: 'armored', defense: 40, bossId: null }, { kind: 'moving', axis: 'horizontal', speedTps: 9 }] as LabTarget[]) {
      expect(sceneBandFor(dummyFrames(renderOf(target))), target.kind).toEqual({ minTilesH: DEFAULT_CAMERA.minTilesH, focusY: DEFAULT_CAMERA.focusY })
    }
    const bottom = DEFAULT_CAMERA.focusY + DEFAULT_CAMERA.minTilesH / 2
    for (const target of [{ kind: 'boss', scale: 3 }, { kind: 'boss', scale: 4 }, { kind: 'moving', axis: 'vertical', speedTps: 3 }] as LabTarget[]) {
      const frames = dummyFrames(renderOf(target))
      const band = sceneBandFor(frames)
      expect(band.focusY + band.minTilesH / 2, target.kind).toBeCloseTo(bottom, 12)
      const top = band.focusY - band.minTilesH / 2
      for (const f of frames) expect(top, target.kind).toBeLessThanOrEqual(f.y - f.height / 2 - 1.5 + 1e-9) // its head, with room for numbers
    }
  })

  it('fitted: the scene view shows the whole 4× Boss-Sized Dummy and a vertical path’s top at desktop and phone sizes', () => {
    for (const target of [{ kind: 'boss', scale: 4 }, { kind: 'moving', axis: 'vertical', speedTps: 3 }] as LabTarget[]) {
      const frames = dummyFrames(renderOf(target))
      for (const [w, h, inset] of [[1440 - 600, 760, 90], [375, 460, 70]]) {
        const fit = fitCamera(w, h, 2, { ...sceneBandFor(frames), sceneX: sceneXFor(frames), insetTop: inset })
        const topY = Math.min(...frames.map((f) => f.y - f.height / 2))
        expect(fit.originY + topY * fit.tilePx, `${target.kind} ${w}`).toBeGreaterThanOrEqual(inset - 1)
      }
    }
  })
})
