/**
 * The dummy roster v2 (PRD P3-S12) in the engine: Moving (a closed-form back-and-forth path — exact,
 * frame-rate independent, reset to home), Boss-Sized (a bigger box that a spread fan and an off-centre
 * blast reach more of), Armored (the verified defense formula on every hit), the missed-projectile count
 * a moving dummy makes observable, the `dummy-motion` label, and setup validation. Frame-rate
 * independence across 30/60/144 fps, jittered and spiky frames, and the golden fingerprints of these
 * configs live in determinism.test.ts with every other reference scenario.
 */
import { describe, expect, it } from 'vitest'
import { applyDefense } from './damage'
import { createLabSim, dummyRow, mulberry32, type DummySpec, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { dummyPathOffset } from './motion'
import { ammoFixture, bowFixture, explosiveFixture, staffFixture, swordFixture } from './testing/fixtures'

function create(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

const moving = (axis: 'horizontal' | 'vertical', speedTps: number, rangeTiles: number, x = 6): DummySpec => ({ x, y: 0, motion: { axis, speedTps, rangeTiles } })

function run(sim: LabSim, ticks: number): SimEvent[] {
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) {
    sim.step()
    events.push(...sim.drainEvents())
  }
  return events
}

describe('Moving Dummy path (P3-S12 AC2): a closed form of the tick', () => {
  it('a triangle wave: out to the range at the set speed, instantly back, again and again', () => {
    const m = { axis: 'horizontal', speedTps: 6, rangeTiles: 8 } as const
    // 6 tiles/s = 0.1 tile/tick: the far end at tick 80, home again at 160
    expect([0, 1, 40, 80, 120, 160, 200].map((t) => dummyPathOffset(m, t))).toEqual([0, 0.1, 4, 8, 4, 0, 4])
    for (let t = 0; t < 2000; t++) {
      const o = dummyPathOffset(m, t)
      expect(o).toBeGreaterThanOrEqual(0)
      expect(o).toBeLessThanOrEqual(8)
    }
  })

  it('horizontal moves away (+x) and back; vertical moves up (−y) and back; render state gives prev, current and the path', () => {
    const h = create({ weapon: swordFixture(), dummies: [moving('horizontal', 6, 8)] })
    expect(h.renderState().dummies[0]).toMatchObject({ x: 6, y: 0, prevX: 6, prevY: 0, path: { fromX: 6, fromY: 0, toX: 14, toY: 0 } })
    h.step(80)
    expect(h.renderState().dummies[0]).toMatchObject({ x: 14, y: 0 })
    h.step(1)
    const back = h.renderState().dummies[0]
    expect(back.prevX).toBe(14)
    expect(back.x).toBeCloseTo(13.9, 12)
    const v = create({ weapon: swordFixture(), dummies: [moving('vertical', 3, 5)] })
    expect(v.renderState().dummies[0].path).toEqual({ fromX: 6, fromY: 0, toX: 6, toY: -5 })
    v.step(100) // 5 tiles at 3 tiles/s
    expect(v.renderState().dummies[0]).toMatchObject({ x: 6, y: -5 })
    // a dummy that never moves: prev = current, no path
    const still = create({ weapon: swordFixture() }).renderState().dummies[0]
    expect(still).toMatchObject({ prevX: still.x, prevY: still.y, path: null })
  })

  it('exact over long runs: the box keeps its size and lands on the closed-form point (no accumulated rounding)', () => {
    const sim = create({ weapon: swordFixture(), dummies: [{ ...moving('horizontal', 7, 8), widthTiles: 2, heightTiles: 3 }] })
    for (let chunk = 0; chunk < 50; chunk++) {
      sim.step(1999)
      const d = sim.renderState().dummies[0]
      expect(d.width).toBe(2)
      expect(d.height).toBe(3)
      expect(d.x).toBe(6 + dummyPathOffset({ axis: 'horizontal', speedTps: 7, rangeTiles: 8 }, sim.snapshot().tick))
    }
  })

  it('frame-rate independent by construction: step(1)×N, step(N), random chunks and jittered advance() agree bit for bit', () => {
    const N = 1500
    const options = (): LabSimOptions => ({
      weapon: staffFixture({ projectile: { velocityTps: 18 } }),
      settings: { ignoreMana: true },
      dummies: [moving('vertical', 9, 5), { ...moving('horizontal', 5, 6, 10), defense: 4 }],
      seed: 3,
    })
    const play = (drive: (sim: LabSim) => void) => {
      const sim = create(options())
      sim.setInput({ attacking: true })
      drive(sim)
      return { snap: sim.snapshot(), render: sim.renderState() }
    }
    const r = mulberry32(17)
    const a = play((s) => {
      for (let i = 0; i < N; i++) s.step(1)
    })
    const b = play((s) => s.step(N))
    const c = play((s) => {
      let done = 0
      while (done < N) done += s.step(Math.min(1 + Math.floor(r.next() * 41), N - done))
    })
    const j = mulberry32(5)
    const d = play((s) => {
      while (s.snapshot().tick < N) s.advance(Math.min(2 + j.next() * 70, ((N - s.snapshot().tick) * 1000) / 60))
    })
    for (const other of [b, c, d]) {
      expect(other.snap.tick).toBe(N)
      expect(other.snap).toEqual(a.snap)
      expect(other.render.dummies).toEqual(a.render.dummies)
      expect(other.render.projectiles).toEqual(a.render.projectiles)
    }
    expect(a.snap.stats.projectilesMissed).toBeGreaterThan(0)
  })

  it('every world starts it at home: reset, setDummies and a timed test (so "Run again" reproduces)', () => {
    const sim = create({ weapon: swordFixture(), dummies: [moving('horizontal', 6, 8)] })
    sim.step(37)
    expect(sim.renderState().dummies[0].x).not.toBe(6)
    sim.reset()
    expect(sim.renderState().dummies[0]).toMatchObject({ x: 6, prevX: 6 })
    sim.step(37)
    sim.startTimedTest(10)
    expect(sim.renderState().dummies[0].x).toBe(6)
    sim.step(600)
    const first = sim.snapshot().timedTest.result
    sim.startTimedTest(10)
    sim.step(600)
    expect(sim.snapshot().timedTest.result).toEqual(first)
    expect(sim.setDummies([moving('vertical', 2, 3)]).ok).toBe(true)
    expect(sim.renderState().dummies[0]).toMatchObject({ x: 6, y: 0, path: { toX: 6, toY: -3 } })
  })

  it('the auto-aim (Space, timed tests) follows it: aim = its centre at that tick, never led', () => {
    const sim = create({ weapon: swordFixture(), dummies: [moving('vertical', 6, 5)] })
    sim.setInput({ attacking: false, aim: null })
    for (let i = 0; i < 120; i++) {
      sim.step()
      const { aim, dummies } = sim.renderState()
      expect(aim).toEqual({ x: dummies[0].x, y: dummies[0].y })
    }
  })

  it('fingerprints ×2: two sims of each roster config give identical results (seeded, no shared state)', () => {
    const configs: LabSimOptions[] = [
      { weapon: bowFixture({}, { shootSpeedTps: 12 }), ammo: ammoFixture({ projectile: { velocityTps: 1, gravity: true } }), dummies: [moving('horizontal', 6, 8)], seed: 9 },
      { weapon: staffFixture(), settings: { ignoreMana: true }, dummies: [moving('vertical', 9, 5)], seed: 9 },
      { weapon: bowFixture({ projectilesPerUse: 5, spreadDegrees: 40 }), ammo: ammoFixture(), dummies: [{ x: 8, y: -3, widthTiles: 6, heightTiles: 9 }], seed: 9 },
      { weapon: swordFixture({ critPct: 10, damage: 30 }), dummies: [{ x: 2, y: 0, defense: 20 }], seed: 9 },
    ]
    for (const config of configs) {
      const results = [0, 1].map(() => {
        const sim = create(config)
        sim.startTimedTest(10)
        sim.step(600)
        return sim.snapshot().timedTest.result
      })
      expect(results[0]?.totalDamage).toBeGreaterThan(0)
      expect(results[1]).toEqual(results[0])
    }
  })
})

describe('missed projectiles (P3-S12 AC2: a moving dummy can be missed)', () => {
  it('a straight bolt at a still dummy never misses; at a vertical mover many do — each counted once, when it leaves', () => {
    const still = create({ weapon: staffFixture(), settings: { ignoreMana: true }, dummies: [{ x: 6, y: 0 }], seed: 4 })
    still.startTimedTest(10)
    still.step(600)
    const calm = still.snapshot().timedTest.result!
    expect(calm.projectilesSpawned).toBeGreaterThan(0)
    expect(calm.projectilesMissed).toBe(0)
    const mover = create({ weapon: staffFixture({ projectile: { velocityTps: 18 } }), settings: { ignoreMana: true }, dummies: [moving('vertical', 9, 5)], seed: 4 })
    mover.setInput({ attacking: true })
    const events = run(mover, 600)
    const missed = mover.snapshot().stats.projectilesMissed
    expect(missed).toBeGreaterThan(0)
    // every miss is a despawn of a projectile that never hit (out of bounds or at the end of its life)
    const hitIds = new Set(events.flatMap((e) => (e.type === 'damage' && e.sourceId.startsWith('proj:') ? [Number(e.sourceId.slice(5))] : [])))
    const unlanded = events.filter((e) => e.type === 'projectile-despawn' && !hitIds.has(e.projectileId))
    expect(unlanded).toHaveLength(missed)
    expect(unlanded.every((e) => e.type === 'projectile-despawn' && (e.reason === 'out-of-bounds' || e.reason === 'lifetime'))).toBe(true)
  })

  it('a thrown explosive whose blast reaches no dummy is a miss; one that reaches it is not', () => {
    const sim = create({ weapon: explosiveFixture({ blastRadiusTiles: 1 }), dummies: [{ x: 6, y: 0 }], seed: 2 })
    sim.setInput({ attacking: true, aim: { x: 12, y: 0 } }) // lands 5 tiles past the dummy's far face
    sim.step(25)
    sim.setInput({ attacking: false })
    run(sim, 200)
    expect(sim.snapshot().stats).toMatchObject({ projectilesSpawned: 1, explosions: 1, hits: 0, projectilesMissed: 1 })
    sim.reset()
    sim.setInput({ attacking: true, aim: null }) // lands under the dummy
    sim.step(25)
    sim.setInput({ attacking: false })
    run(sim, 200)
    expect(sim.snapshot().stats).toMatchObject({ projectilesSpawned: 1, explosions: 1, hits: 1, projectilesMissed: 0 })
  })
})

describe('Boss-Sized Dummy (P3-S12 AC1): a bigger box takes more of a multi-hit or area attack', () => {
  it('a spread fan lands more pellets on a 6×9 box than on the standard 2×3 dummy (same weapon, seed, near face)', () => {
    const fan = (dummy: DummySpec) => {
      const sim = create({ weapon: bowFixture({ projectilesPerUse: 5, spreadDegrees: 40 }), ammo: ammoFixture(), dummies: [dummy], seed: 21 })
      sim.startTimedTest(10)
      sim.step(600)
      return sim.snapshot().timedTest.result!
    }
    const standard = fan({ x: 6, y: 0 })
    const boss = fan({ x: 8, y: -3, widthTiles: 6, heightTiles: 9 }) // same near face (x 5), feet on the same ground
    expect(standard.projectilesSpawned).toBe(boss.projectilesSpawned)
    expect(boss.hits).toBeGreaterThan(standard.hits)
    expect(boss.totalDamage).toBeGreaterThan(standard.totalDamage)
    expect(boss.hits).toBe(boss.projectilesSpawned) // every pellet of the fan reaches the big box
  })

  it('an off-centre blast with falloff keeps more of its damage on the bigger box (nearer hitbox point)', () => {
    const blast = (dummy: DummySpec) => {
      // a timed fuse: it flies through the dummies and goes off at rest on the ground at x 10.5
      const sim = create({ weapon: explosiveFixture({ fuseTicks: 120, falloff: 'linear', blastRadiusTiles: 4 }), dummies: [dummy], settings: { damageVariance: false }, seed: 1 })
      sim.setInput({ attacking: true, aim: { x: 10.5, y: 0 } })
      sim.step(25)
      sim.setInput({ attacking: false })
      return run(sim, 150).find((e) => e.type === 'damage')
    }
    const standard = blast({ x: 6, y: 0 })
    const boss = blast({ x: 8, y: -3, widthTiles: 6, heightTiles: 9 })
    // the standard box's nearest point is 3.5 tiles from the blast (12% kept); the big box contains it (100%)
    expect(standard).toMatchObject({ type: 'damage', blastKeptPct: 12, amount: 12 })
    expect(boss).toMatchObject({ type: 'damage', blastKeptPct: 100, amount: 100 })
  })
})

describe('Armored Dummy (P3-S12 AC3): the verified defense formula on every hit', () => {
  const perHit = (defense: number, damage = 30, critPct = 0) => {
    const sim = create({ weapon: swordFixture({ damage, critPct, autoReuse: true }), dummies: [{ x: 2, y: 0, defense }], settings: { damageVariance: false }, seed: 6 })
    sim.setInput({ attacking: true })
    return run(sim, 300).flatMap((e) => (e.type === 'damage' ? [e] : []))
  }

  it('each hit deals ⌊damage − defense ÷ 2⌋ (minimum 1); a crit doubles it after defense', () => {
    for (const defense of [0, 1, 7, 20, 37, 59, 60, 100]) {
      const hits = perHit(defense, 30, 50)
      expect(hits.length, `defense ${defense}`).toBeGreaterThan(5)
      for (const h of hits) expect(h.amount, `defense ${defense}`).toBe(applyDefense(30, defense) * (h.crit ? 2 : 1))
      expect(hits.some((h) => h.crit) && hits.some((h) => !h.crit), `defense ${defense}`).toBe(true)
    }
    expect(applyDefense(30, 60)).toBe(1) // the floor
  })

  it('raising defense lowers every damage number (until the 1-damage floor)', () => {
    const amounts = [0, 10, 20, 40].map((defense) => perHit(defense)[0].amount)
    expect(amounts).toEqual([30, 25, 20, 10])
  })

  it('with variance on, an armored dummy takes less than the same seed’s unarmored one, hit for hit', () => {
    const run10 = (defense: number) => {
      const sim = create({ weapon: swordFixture({ damage: 30, critPct: 10, autoReuse: true }), dummies: [{ x: 2, y: 0, defense }], seed: 8 })
      sim.setInput({ attacking: true })
      return run(sim, 600).flatMap((e) => (e.type === 'damage' ? [e.amount] : []))
    }
    const bare = run10(0)
    const armored = run10(16)
    expect(armored).toHaveLength(bare.length) // same rolls (defense draws no randomness)
    armored.forEach((a, i) => expect(a).toBeLessThan(bare[i]))
  })
})

describe('labels and validation', () => {
  it('`dummy-motion` joins the approximations while a moving dummy is a target, and follows setDummies', () => {
    const sim = create({ weapon: swordFixture() })
    expect(sim.approximations.map((a) => a.id)).not.toContain('dummy-motion')
    sim.setDummies([moving('horizontal', 4, 8)])
    expect(sim.approximations.map((a) => a.id)).toContain('dummy-motion')
    sim.setDummies(dummyRow(2))
    expect(sim.approximations.map((a) => a.id)).not.toContain('dummy-motion')
    expect(sim.approximations.find((a) => a.id === 'knockback')?.detail).toContain('a Moving Dummy keeps to the path you set')
  })

  it('refuses a malformed path (invalid-dummy), keeping the current dummies', () => {
    const weapon = swordFixture()
    for (const motion of [
      { axis: 'diagonal', speedTps: 4, rangeTiles: 8 },
      { axis: 'horizontal', speedTps: 0, rangeTiles: 8 },
      { axis: 'vertical', speedTps: Number.NaN, rangeTiles: 8 },
      { axis: 'vertical', speedTps: 4, rangeTiles: 0 },
      { axis: 'horizontal', speedTps: 4, rangeTiles: Infinity },
    ]) {
      const r = createLabSim({ weapon, dummies: [{ x: 2, y: 0, motion: motion as DummySpec['motion'] }] })
      expect(r.ok, JSON.stringify(motion)).toBe(false)
      if (!r.ok) expect(r.refusal).toMatchObject({ kind: 'invalid-setup', reason: 'invalid-dummy' })
    }
    const sim = create({ weapon })
    expect(sim.setDummies([{ x: 2, y: 0, motion: { axis: 'horizontal', speedTps: -1, rangeTiles: 3 } }])).toMatchObject({ ok: false, reason: 'invalid-dummy' })
    expect(sim.renderState().dummies[0].path).toBeNull()
  })

  it('the caller’s spec is never shared: mutating it after creation changes nothing', () => {
    const spec = moving('horizontal', 6, 8)
    const sim = create({ weapon: swordFixture(), dummies: [spec] })
    spec.motion!.speedTps = 60
    sim.step(10)
    expect(sim.renderState().dummies[0].x).toBeCloseTo(7, 12) // still 6 tiles/s
  })
})
