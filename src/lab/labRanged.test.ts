/**
 * The Lab session headless for projectile weapons — PRD P3-S4 (bows/guns + ammo), P3-S5 (magic bolts
 * + mana, AMENDMENTS-008 B35) and the damage-over-time wiring (AMENDMENTS-012 follow-up). Real
 * committed weapons, ammo and buffs with the Lab's own setup; fixed seeds (the engine is
 * deterministic). Weapons are picked from the data by their params, never by a hand list.
 */
import { describe, expect, it } from 'vitest'
import type { Item, Weapon } from '../data-access/types'
import { createLabSim, DEFAULT_DUMMY, DEFAULT_LAB_SETTINGS, TICKS_PER_SECOND, type LabSettings, type SimEvent } from '../sim'
import { createLabSession, MANA_WARNING_CLEAR_TICKS, RATE_WINDOW_ATTACKS, type LabSession } from './labSession'
import { ammoChoices, ammoClassOf, labDummiesFor, RANGED_TARGET_X_TILES, resolveAmmo } from './labSetup'
import { labWeapons } from './labWeapons'
import { ALL_ITEMS, ALL_WEAPONS, LAB_SETUP } from './testing/labData'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const FRAME_MS = 1000 / 60
const params = (w: Weapon) => {
  if (w.labBehavior.kind !== 'archetype') throw new Error('no params')
  return w.labBehavior.params
}
const ofArchetype = (archetype: string) => list.filter((w) => params(w).archetype === archetype)
const guns = ofArchetype('bow-gun')
const bolts = ofArchetype('magic-bolt')
const byName = (name: string) => list.find((w) => w.name === name)!

function session(weapon: Weapon, options: { ammo?: Item | null; settings?: Partial<LabSettings>; seed?: number } = {}): LabSession {
  let s = options.seed ?? 7
  const created = createLabSession(weapon, {
    seed: () => s++,
    setup: LAB_SETUP,
    ammoId: options.ammo?.id ?? null,
    ...(options.settings ? { settings: options.settings } : {}),
  })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

/** Holds Space (auto-aim at the dummy) for `seconds` of 60 fps frames; returns every event. */
function hold(s: LabSession, seconds: number): SimEvent[] {
  const events: SimEvent[] = []
  s.press('key')
  for (let t = 0; t < seconds * 1000 - 1e-6; t += FRAME_MS) events.push(...s.frame(FRAME_MS).events)
  s.release('key')
  return events
}

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>
const only = <T extends SimEvent['type']>(events: SimEvent[], type: T) => events.filter((e): e is Of<T> => e.type === type)
const direct = (events: SimEvent[]) => only(events, 'damage').filter((e) => e.source !== 'dot')
const speedOf = (e: Of<'projectile-spawn'>) => Math.hypot(e.vx, e.vy)
const DEG = 180 / Math.PI

describe('P3-S4 AC2: the ammo picker lists only compatible ammo, as the engine accepts it', () => {
  it('every bow and gun: exactly the items of its ammo class, usable ones fire in the engine, by damage then id', () => {
    expect(guns.length).toBeGreaterThan(0)
    for (const w of guns) {
      const choices = ammoChoices(w, LAB_SETUP)!
      const ammoClass = ammoClassOf(w)!
      expect(choices.ammoClass).toBe(ammoClass)
      const compatible = ALL_ITEMS.filter((i) => i.ammoStats?.ammoClass === ammoClass).map((i) => i.id)
      const listed = [...choices.usable.map((i) => i.id), ...choices.refused.map((r) => r.item.id)]
      expect(new Set(listed), w.name).toEqual(new Set(compatible))
      expect(listed).toHaveLength(compatible.length)
      expect(choices.usable.length, w.name).toBeGreaterThan(0)
      for (const item of choices.usable) {
        expect(item.ammoStats?.ammoClass).toBe(ammoClass)
        expect(createLabSim({ weapon: w, ammo: item, buffs: LAB_SETUP.buffs }).ok, `${w.name} + ${item.name}`).toBe(true)
      }
      const order = choices.usable.map((i) => [i.ammoStats!.damage!, i.id] as const)
      expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    }
  })

  it('no ammo of another class ever appears (a gun never offers arrows)', () => {
    const bullets = guns.find((w) => /musket/.test(ammoClassOf(w)!))!
    const arrows = guns.find((w) => /arrow/.test(ammoClassOf(w)!))!
    expect(ammoChoices(bullets, LAB_SETUP)!.usable.some((i) => /arrow/i.test(i.name))).toBe(false)
    expect(ammoChoices(arrows, LAB_SETUP)!.usable.every((i) => i.ammoStats!.ammoClass === ammoClassOf(arrows))).toBe(true)
  })

  it('the default is the class’s namesake — the basic tier its type is named after (Wooden Arrow, Musket Ball)', () => {
    const names = new Set(guns.map((w) => ammoChoices(w, LAB_SETUP)!.defaultAmmo!.name))
    expect(names).toEqual(new Set(['Wooden Arrow', 'Musket Ball']))
    for (const w of guns) {
      const choices = ammoChoices(w, LAB_SETUP)!
      expect(choices.defaultAmmo!.slug, w.name).toBe(choices.ammoClass)
      // An unknown or incompatible pick loads the default.
      expect(resolveAmmo(w, LAB_SETUP, 999_999)).toBe(choices.defaultAmmo)
      expect(session(w).ammo).toBe(choices.defaultAmmo)
    }
    expect(ammoChoices(byName(list.find((w) => params(w).archetype === 'swing-melee')!.name), LAB_SETUP)).toBeNull()
  })
})

describe('P3-S4 AC1–AC3: shots travel to the dummy, ammo changes damage and speed, "Ammo used" counts', () => {
  const bow = guns.find((w) => /arrow/.test(ammoClassOf(w)!) && params(w).archetype === 'bow-gun' && (params(w) as { spreadDegrees: number }).spreadDegrees === 0 && (params(w) as { projectilesPerUse: number }).projectilesPerUse === 1)!

  it('projectile weapons face the ranged dummy; a straight shot flies to its near face and stops there', () => {
    expect(labDummiesFor('bow-gun')?.[0].x).toBe(RANGED_TARGET_X_TILES)
    expect(labDummiesFor('magic-bolt')?.[0].x).toBe(RANGED_TARGET_X_TILES)
    expect(labDummiesFor('swing-melee')).toEqual([{ ...DEFAULT_DUMMY }]) // melee: the engine's own point-blank dummy
    const s = session(bow)
    const dummy = s.sim.renderState().dummies[0]
    expect(dummy.x).toBe(RANGED_TARGET_X_TILES)
    const events = hold(s, 2)
    const shots = only(events, 'projectile-spawn')
    const hits = direct(events)
    expect(shots.length).toBeGreaterThan(1)
    // Fired at the weapon's use time (one shot per attack).
    expect(shots.length).toBe(only(events, 'use-start').length)
    for (const shot of shots) expect([shot.x, shot.y]).toEqual([0, 0])
    for (const hit of hits) expect(hit.x).toBeCloseTo(dummy.x - dummy.width / 2, 9)
    // Each arrow despawns at the dummy (pierce spent), never flying on.
    const ended = only(events, 'projectile-despawn')
    expect(ended.length).toBeGreaterThan(0)
    for (const e of ended) expect(e.reason).toBe('pierce-exhausted')
    // ...after travelling: a shot takes several ticks to cross the gap.
    const firstShot = shots[0]
    const firstEnd = ended.find((e) => e.projectileId === firstShot.projectileId)!
    expect(firstEnd.tick - firstShot.tick).toBeGreaterThan(2)
  })

  it('switching ammo changes the damage per hit (weapon + ammo) and how fast shots fly — from data', () => {
    const choices = ammoChoices(bow, LAB_SETUP)!
    const weakest = choices.usable[0]
    const strongest = choices.usable.at(-1)!
    expect(strongest.ammoStats!.damage!).toBeGreaterThan(weakest.ammoStats!.damage!)
    const speeds = new Map<number, number>()
    for (const ammo of [weakest, strongest]) {
      const s = session(bow, { ammo, settings: { damageVariance: false } })
      expect(s.ammo).toBe(ammo)
      expect(s.summary.baseHitDamage).toBe(bow.damage! + ammo.ammoStats!.damage!)
      const events = hold(s, 2)
      const normal = direct(events).filter((e) => !e.crit)
      expect(normal.length).toBeGreaterThan(0)
      for (const e of normal) expect(e.amount).toBe(bow.damage! + ammo.ammoStats!.damage!)
      const shot = only(events, 'projectile-spawn')[0]
      speeds.set(ammo.id, speedOf(shot))
      // Speed = (weapon + ammo bonus) × multiplier (the engine's labeled `ammo` rule).
      const expected = (bow.shootSpeedTps! + (ammo.ammoStats!.velocityBonusTps ?? 0)) * (ammo.ammoStats!.velocityMultiplier ?? 1)
      expect(speedOf(shot)).toBeCloseTo(expected, 9)
    }
    // A faster ammo exists among the arrows (e.g. a ×2 multiplier) and visibly flies faster.
    const fastest = [...choices.usable].sort((a, b) => (b.ammoStats!.velocityMultiplier ?? 1) - (a.ammoStats!.velocityMultiplier ?? 1))[0]
    const fast = speedOf(only(hold(session(bow, { ammo: fastest }), 1), 'projectile-spawn')[0])
    expect(fast).toBeGreaterThan(speeds.get(weakest.id)!)
  })

  it('"Ammo used" counts every shot live and resets with the stats (and is in a timed test’s result)', () => {
    const s = session(bow)
    const seen: number[] = []
    s.subscribe(() => seen.push(s.getHud().ammoConsumed))
    const shots = only(hold(s, 3), 'projectile-spawn').length
    expect(s.getHud().ammoConsumed).toBe(shots)
    expect(new Set(seen).size).toBeGreaterThan(2)
    s.reset()
    expect(s.getHud().ammoConsumed).toBe(0)
    expect(s.startTimedTest(10)).toBe(true)
    for (let i = 0; i < 700; i++) s.frame(FRAME_MS)
    const result = s.getHud().timedTest.result!
    expect(result.ammoConsumed).toBeGreaterThan(0)
    expect(result.ammoConsumed).toBe(result.uses)
  })
})

describe('P3-S4 AC4: spread and multi-shot from params', () => {
  it('a multi-shot gun fires its projectilesPerUse per shot, fanned evenly across its spread (Quad-Barrel Shotgun: 8)', () => {
    const shotgun = guns.reduce((a, b) => ((params(b) as { projectilesPerUse: number }).projectilesPerUse > (params(a) as { projectilesPerUse: number }).projectilesPerUse ? b : a))
    const p = params(shotgun) as { projectilesPerUse: number; spreadDegrees: number }
    expect(shotgun.name).toBe('Quad-Barrel Shotgun')
    expect(p.projectilesPerUse).toBe(8)
    const events = hold(session(shotgun), 1)
    const firstTick = only(events, 'use-start')[0].tick
    const volley = only(events, 'projectile-spawn').filter((e) => e.tick === firstTick)
    expect(volley).toHaveLength(p.projectilesPerUse)
    const angles = volley.map((e) => Math.atan2(e.vy, e.vx) * DEG).sort((a, b) => a - b)
    expect(angles[0]).toBeCloseTo(-p.spreadDegrees / 2, 6)
    expect(angles.at(-1)!).toBeCloseTo(p.spreadDegrees / 2, 6)
    for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(p.spreadDegrees / (p.projectilesPerUse - 1), 6)
    // At the ranged dummy the outer pellets miss — the fan is seen flying past (one ammo per shot).
    expect(direct(events).filter((e) => e.tick < firstTick + 30).length).toBeLessThan(p.projectilesPerUse)
  })

  it('Minishark’s modeled 10° slight spread (B47): single shots scatter within ±5° of the aim', () => {
    const minishark = byName('Minishark')
    expect((params(minishark) as { spreadDegrees: number }).spreadDegrees).toBe(10)
    const shots = only(hold(session(minishark), 3), 'projectile-spawn')
    expect(shots.length).toBeGreaterThan(10)
    const angles = shots.map((e) => Math.atan2(e.vy, e.vx) * DEG)
    for (const a of angles) expect(Math.abs(a)).toBeLessThanOrEqual(5 + 1e-9)
    expect(new Set(angles.map((a) => a.toFixed(3))).size).toBeGreaterThan(5)
  })
})

describe('P3-S5: mana — cost per cast, capacity, the B35 slow-cast default, stop at zero, ignore mana', () => {
  const staff = bolts[0]

  it('magic weapons show a mana pool; each cast deducts the weapon’s cost; "Mana used" counts', () => {
    expect(bolts.length).toBeGreaterThan(0)
    const s = session(staff)
    const mana = s.getHud().mana!
    expect(mana).toMatchObject({ current: DEFAULT_LAB_SETTINGS.maxMana, max: DEFAULT_LAB_SETTINGS.maxMana, costPerUse: staff.manaCost, low: false, ignoreMana: false })
    s.press('key')
    s.frame(FRAME_MS)
    expect(s.getHud().mana!.current).toBe(DEFAULT_LAB_SETTINGS.maxMana - staff.manaCost!)
    expect(s.getHud().manaConsumed).toBe(staff.manaCost)
    s.release('key')
    // Weapons without a mana cost have no ManaBar.
    expect(session(guns[0]).getHud().mana).toBeNull()
  })

  it('the max-mana setting changes the capacity; Reset restores the default, full', () => {
    const s = session(staff)
    expect(s.updateSettings({ maxMana: 60 }).ok).toBe(true)
    expect(s.getHud().mana).toMatchObject({ max: 60, current: 60 })
    s.reset()
    expect(s.getHud().mana).toMatchObject({ max: DEFAULT_LAB_SETTINGS.maxMana, current: DEFAULT_LAB_SETTINGS.maxMana })
  })

  it('default (game behavior, B35): below the cost, casting continues at 40% speed — use time × 2.5 — and the HUD says so', () => {
    const s = session(staff, { settings: { maxMana: 20, manaRegen: 'none' } })
    expect(s.getHud().settings.insufficientMana).toBe('slow-cast')
    const events = hold(s, 6)
    const uses = only(events, 'use-start')
    const paid = Math.floor(20 / staff.manaCost!)
    expect(uses.slice(0, paid).every((e) => !e.slowCast)).toBe(true)
    const slow = uses.slice(paid)
    expect(slow.length).toBeGreaterThan(0)
    for (const e of slow) {
      expect(e.slowCast).toBe(true)
      expect(e.durationTicks).toBe(Math.floor(staff.useAnimationTicks! * 2.5))
    }
    expect(only(events, 'use-blocked')).toHaveLength(0)
    const hud = s.getHud()
    expect(hud.mana).toMatchObject({ low: true, policy: 'slow-cast', slowCasting: true, current: 20 - paid * staff.manaCost! })
    expect(hud.manaConsumed).toBe(paid * staff.manaCost!)
  })

  it('"stop at zero" (labeled test setting): casting stops below the cost', () => {
    const s = session(staff, { settings: { maxMana: 20, manaRegen: 'none', insufficientMana: 'block' } })
    const events = hold(s, 6)
    expect(only(events, 'use-start')).toHaveLength(Math.floor(20 / staff.manaCost!))
    expect(only(events, 'use-blocked').length).toBeGreaterThan(0)
    expect(s.getHud().mana).toMatchObject({ low: true, policy: 'block', slowCasting: false })
  })

  it('"ignore mana (test mode)": the pool stays full, never slows or stops, and every cast is still counted', () => {
    const s = session(staff, { settings: { maxMana: 20, manaRegen: 'none', ignoreMana: true } })
    const events = hold(s, 6)
    const uses = only(events, 'use-start')
    expect(uses.every((e) => !e.slowCast)).toBe(true)
    expect(uses.length).toBeGreaterThan(Math.floor(20 / staff.manaCost!))
    expect(s.getHud().mana).toMatchObject({ current: 20, ignoreMana: true, low: false })
    expect(s.getHud().manaConsumed).toBe(uses.length * staff.manaCost!)
  })

  it('regeneration (1.4.5.7+ formula) refills the pool while idle; the HUD follows it', () => {
    const s = session(staff, { settings: { maxMana: 40 } })
    hold(s, 2)
    const low = s.getHud().mana!.current
    expect(low).toBeLessThan(40)
    for (let i = 0; i < 600; i++) s.frame(FRAME_MS)
    expect(s.getHud().mana!.current).toBeGreaterThan(low)
  })
})

describe('design review P3-S4/S5: the live attack rate, the latched low-mana warning, mana-mode restarts', () => {
  const diamond = byName('Diamond Staff')
  const staff = bolts[0]
  it('H3: attacks/sec is counted from the latest attacks — slow casts bring it to the slowed rate within a few casts, as the chip says; full-speed weapons keep their nominal rate', () => {
    const s = session(staff, { settings: { maxMana: 20, manaRegen: 'none' } })
    const nominal = s.summary.nominalAttacksPerSec
    const delay = s.summary.reuseDelayTicks
    expect(s.getHud().attacksPerSec).toBe(nominal) // before the first attack: the weapon's own rate
    const rates: { slow: boolean; rate: number; window: number[] }[] = []
    const window: number[] = []
    s.press('key')
    for (let f = 0; f < 15 * 60; f++) {
      for (const e of s.frame(FRAME_MS).events) {
        if (e.type !== 'use-start') continue
        window.push(e.durationTicks + delay)
        if (window.length > RATE_WINDOW_ATTACKS) window.shift()
        rates.push({ slow: e.slowCast, rate: s.getHud().attacksPerSec, window: [...window] })
      }
    }
    // Every reading: the latest attacks ÷ the ticks they took (each use time + the cooldown).
    for (const r of rates) expect(r.rate).toBeCloseTo((r.window.length * TICKS_PER_SECOND) / r.window.reduce((a, b) => a + b, 0), 9)
    const firstSlow = rates.findIndex((r) => r.slow)
    expect(firstSlow).toBeGreaterThan(0)
    expect(rates.slice(0, firstSlow).every((r) => Math.abs(r.rate - nominal) < 1e-9)).toBe(true)
    // RATE_WINDOW_ATTACKS slow casts in, it IS the slowed rate: use time × 2.5 (B35), the cooldown unscaled (40% of nominal, give or take a tick).
    const slowed = TICKS_PER_SECOND / (Math.floor(staff.useAnimationTicks! * 2.5) + delay)
    expect(rates[firstSlow + RATE_WINDOW_ATTACKS - 1].rate).toBeCloseTo(slowed, 9)
    expect(slowed / nominal).toBeCloseTo(0.4, 1)
    // Ignoring mana (or a weapon without mana): exactly the nominal rate.
    const free = session(staff, { settings: { ignoreMana: true } })
    hold(free, 5)
    expect(free.getHud().attacksPerSec).toBeCloseTo(nominal, 9)
    const cooldown = guns.find((w) => (w.reuseDelayTicks ?? 0) > 0)
    if (cooldown) {
      const c = session(cooldown)
      hold(c, 5)
      expect(c.getHud().attacksPerSec, cooldown.name).toBeCloseTo(c.summary.nominalAttacksPerSec, 9)
    }
  })

  it('the live est. DPS divides by whole attack cycles — use time + cooldown — so a cooldown gun held down reads like its timed test (Clockwork Assault Rifle)', () => {
    const clockwork = byName('Clockwork Assault Rifle')
    const delay = clockwork.reuseDelayTicks!
    expect(delay).toBeGreaterThan(0)
    const s = session(clockwork, { settings: { damageVariance: false } })
    const events = hold(s, 30)
    const starts = only(events, 'use-start')
    const hud = s.getHud()
    expect(hud.attackSeconds).toBeCloseTo(starts.reduce((n, e) => n + e.durationTicks + delay, 0) / TICKS_PER_SECOND, 9)
    expect(hud.estimatedDps).toBeCloseTo(hud.totalDamage / hud.attackSeconds, 9)
    // Held for 30 s, the cycles fill the whole time (the last one may run past it by under one cycle).
    const cycle = (clockwork.useAnimationTicks! + delay) / TICKS_PER_SECOND
    expect(hud.attackSeconds).toBeGreaterThanOrEqual(30 - 1e-9)
    expect(hud.attackSeconds).toBeLessThan(30 + cycle)
    // The 30-second test on the same settings: the live figure agrees within a few percent (crit rolls,
    // the last cycle's shots in flight) — dividing by use time alone overstated it by (use + cooldown) ÷ use.
    const t = session(clockwork, { settings: { damageVariance: false } })
    t.startTimedTest(30)
    for (let i = 0; i < 31 * 60; i++) t.frame(FRAME_MS)
    const timed = t.getHud().timedTest.result!.estimatedDps
    expect(Math.abs(hud.estimatedDps / timed - 1)).toBeLessThan(0.05)
    expect((clockwork.useAnimationTicks! + delay) / clockwork.useAnimationTicks!).toBeGreaterThan(2)
  })

  it('B1/M: Diamond Staff drained with regeneration — once low, the warning stays on through every regen-funded cast (never blinks)', () => {
    const s = session(diamond)
    expect(s.getHud().settings).toMatchObject({ insufficientMana: 'slow-cast', manaRegen: 'wiki-1.4.5.7', maxMana: 200 })
    const seen: { warning: boolean; low: boolean; slow: boolean }[] = []
    s.subscribe(() => {
      const m = s.getHud().mana!
      seen.push({ warning: m.warning, low: m.low, slow: m.slowCasting })
    })
    s.press('key')
    for (let i = 0; i < 40 * 60; i++) s.frame(FRAME_MS)
    const first = seen.findIndex((h) => h.warning)
    expect(first).toBeGreaterThan(0)
    const after = seen.slice(first)
    // The pool does rise past the cost between casts (regen-funded full-speed casts happen)…
    expect(after.some((h) => !h.low)).toBe(true)
    expect(after.some((h) => !h.slow)).toBe(true)
    // …but the warning never flickers off while the drain goes on.
    expect(after.every((h) => h.warning)).toBe(true)
    s.release('key')
  })

  it('the warning clears only after the pool has covered the cost for at least a second — and a reset clears it at once', () => {
    const s = session(diamond, { settings: { maxMana: 40 } })
    // One frame per tick: 12 s holding attack, then 10 s idle while the pool refills.
    const frames: { low: boolean; warning: boolean }[] = []
    s.press('key')
    for (let f = 0; f < 22 * 60; f++) {
      if (f === 12 * 60) s.release('key')
      s.frame(FRAME_MS)
      const m = s.getHud().mana!
      frames.push({ low: m.low, warning: m.warning })
    }
    const raised = frames.findIndex((m) => m.warning)
    const cleared = frames.findIndex((m, i) => i > raised && !m.warning)
    expect(raised).toBeGreaterThan(0)
    expect(cleared).toBeGreaterThan(12 * 60) // never while the drain went on
    const lastLow = frames.slice(0, cleared).findLastIndex((m) => m.low)
    // Covered for a whole second (and longer than the slowest — slowed — cast) before it clears, never sooner.
    const slowCastTicks = Math.floor(diamond.useAnimationTicks! * 2.5)
    expect(cleared - lastLow).toBeGreaterThanOrEqual(Math.max(MANA_WARNING_CLEAR_TICKS, slowCastTicks + 1))
    // …and promptly then (the ManaBar samples the pool every tenth of a second).
    expect(cleared - lastLow).toBeLessThanOrEqual(Math.max(MANA_WARNING_CLEAR_TICKS, slowCastTicks + 1) + 12)
    expect(frames.slice(cleared).every((m) => !m.warning)).toBe(true)
    // Reset: off immediately (a fresh, full pool).
    const r = session(diamond, { settings: { maxMana: 20 } })
    hold(r, 6)
    expect(r.getHud().mana!.warning).toBe(true)
    r.reset()
    expect(r.getHud().mana).toMatchObject({ warning: false, low: false })
    // Ignoring mana: never warned.
    const t = session(diamond, { settings: { maxMana: 20, ignoreMana: true } })
    hold(t, 6)
    expect(t.getHud().mana).toMatchObject({ warning: false, low: false })
  })

  it('stop at zero with regeneration: casting waits — the warning holds while attack is held', () => {
    const s = session(diamond, { settings: { maxMana: 20, insufficientMana: 'block' } })
    const states: boolean[] = []
    s.subscribe(() => states.push(s.getHud().mana!.warning))
    const events = hold(s, 20)
    expect(only(events, 'use-blocked').length).toBeGreaterThan(0)
    // Regeneration funds casts while it waits…
    expect(only(events, 'use-start').length).toBeGreaterThan(Math.floor(20 / diamond.manaCost!))
    const first = states.indexOf(true)
    expect(states.slice(first).every(Boolean)).toBe(true)
    expect(s.getHud().mana).toMatchObject({ warning: true, policy: 'block', regen: true })
  })

  it('M6: changing a mana setting restarts the stats, pool and dummy with the new settings — like switching ammo; other settings don’t', () => {
    const s = session(diamond)
    hold(s, 3)
    expect(s.getHud().hits).toBeGreaterThan(0)
    let cleared = 0
    s.onReset(() => cleared++)
    const variance = s.updateSettings({ damageVariance: false })
    expect(variance).toMatchObject({ ok: true, restarted: false })
    expect(s.getHud().hits).toBeGreaterThan(0)
    for (const patch of [{ insufficientMana: 'block' as const }, { manaRegen: 'none' as const }, { ignoreMana: true }, { maxMana: 240 }]) {
      hold(s, 2)
      expect(s.getHud().totalDamage).toBeGreaterThan(0)
      const result = s.updateSettings(patch)
      expect(result, JSON.stringify(patch)).toMatchObject({ ok: true, restarted: true })
      const hud = s.getHud()
      expect(hud).toMatchObject({ totalDamage: 0, hits: 0, manaConsumed: 0, attackSeconds: 0, lastHit: null, resets: 0 })
      expect(hud.settings).toMatchObject(patch)
      expect(hud.mana).toMatchObject({ current: hud.settings.maxMana, max: hud.settings.maxMana, warning: false })
    }
    expect(cleared).toBe(4)
    // The same value again is no change.
    expect(s.updateSettings({ maxMana: 240 })).toMatchObject({ ok: true, restarted: false })
    // A weapon without mana: mana settings carry over silently, no restart.
    const bow = session(guns[0])
    hold(bow, 2)
    expect(bow.updateSettings({ insufficientMana: 'block' })).toMatchObject({ ok: true, restarted: false })
    expect(bow.getHud().hits).toBeGreaterThan(0)
    // Locked while a timed test runs: refused, nothing restarts.
    expect(s.startTimedTest(10)).toBe(true)
    s.frame(FRAME_MS)
    expect(s.updateSettings({ insufficientMana: 'slow-cast' })).toMatchObject({ ok: false, reason: 'config-locked' })
  })
})

describe('P3-S5 AC4: two magic bolts differ observably, purely from data (Frost Staff vs the others)', () => {
  const frost = byName('Frost Staff')
  const others = bolts.filter((w) => w !== frost)

  it('speed, cost, damage and the debuff come from each record', () => {
    expect(others.length).toBeGreaterThan(0)
    const shotSpeed = (w: Weapon) => speedOf(only(hold(session(w), 1), 'projectile-spawn')[0])
    for (const other of others) {
      const a = params(frost) as { projectile: { velocityTps: number } }
      const b = params(other) as { projectile: { velocityTps: number } }
      expect(shotSpeed(frost)).toBeCloseTo(a.projectile.velocityTps, 6)
      expect(shotSpeed(other)).toBeCloseTo(b.projectile.velocityTps, 6)
      const differs = a.projectile.velocityTps !== b.projectile.velocityTps || frost.manaCost !== other.manaCost || frost.damage !== other.damage
      expect(differs, other.name).toBe(true)
      expect(session(other).summary.manaCostPerUse).toBe(other.manaCost)
    }
    expect(session(frost).summary.manaCostPerUse).toBe(frost.manaCost)
  })
})

describe('damage over time: the buff registry makes the DoT weapons run (AMENDMENTS-012 follow-up)', () => {
  const frost = byName('Frost Staff')

  it('Frost Staff applies its debuff; DoT ticks add to the total (not to hits) and show in a timed test’s result', () => {
    const s = session(frost, { settings: { ignoreMana: true } })
    const events = hold(s, 3)
    expect(only(events, 'debuff-applied').length).toBeGreaterThan(0)
    const dot = only(events, 'damage').filter((e) => e.source === 'dot')
    expect(dot.length).toBeGreaterThan(0)
    for (const e of dot) expect(e.crit).toBe(false)
    const hud = s.getHud()
    expect(hud.dotDamage).toBe(dot.reduce((n, e) => n + e.amount, 0))
    expect(hud.totalDamage).toBe(hud.directDamage + hud.dotDamage)
    expect(hud.hits).toBe(direct(events).length)
    s.reset()
    expect(s.startTimedTest(10)).toBe(true)
    for (let i = 0; i < 700; i++) s.frame(FRAME_MS)
    const result = s.getHud().timedTest.result!
    expect(result.dotDamage).toBeGreaterThan(0)
    expect(result.directDamage + result.dotDamage).toBe(result.totalDamage)
    expect(result.debuffsApplied).toBeGreaterThan(0)
    expect(result.manaConsumed).toBeGreaterThan(0)
  })

  it('the DoT swords simulate too (Stylish Scissors, Brand of the Inferno)', () => {
    for (const name of ['Stylish Scissors', 'Brand of the Inferno']) {
      const events = hold(session(byName(name)), 30)
      expect(only(events, 'damage').some((e) => e.source === 'dot'), name).toBe(true)
    }
  })

  it('timed tests take exactly 600 ticks for projectile weapons too', () => {
    const s = session(byName('Minishark'))
    s.startTimedTest(10)
    for (let i = 0; i < 700; i++) s.frame(FRAME_MS)
    expect(s.getHud().timedTest.result!.ticks).toBe(10 * TICKS_PER_SECOND)
  })
})
