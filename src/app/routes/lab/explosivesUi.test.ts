/**
 * P3-S11 HTML layer + session model (SSR markup; the canvas is aria-hidden): thrown explosives in the
 * Lab — the explosives equipped from the committed data, the "Explosives used" counter, the latest
 * blast's per-dummy damage with its falloff label, the EquippedBar's blast / fuse facts, the controls
 * hint and the results row — and the Debuff Dummy target: its picker entry, its active-debuffs panel
 * (icon, name, damage per second, a time-left bar) with the Frost Staff and the Imp Staff, the
 * "Debuffs applied" stat (AC2) live and in the results. Real committed weapons with the Lab's setup.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { hasAssumptions } from '../../../components/assumptions'
import type { Weapon } from '../../../data-access/types'
import { ARENA_LAYOUT } from '../../../lab/art/arenaArt'
import { DEBUFF_TINT_TOKENS } from '../../../lab/debuffVisuals'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import type { LabTarget } from '../../../lab/labSetup'
import { behaviorFacts, labStatus, labWeapons } from '../../../lab/labWeapons'
import { ALL_WEAPONS, LAB_SETUP } from '../../../lab/testing/labData'
import { DEFAULT_LAB_SETTINGS, GROUND_Y_TILES } from '../../../sim'
import { BlastReadout, ConsumableCounter, DebuffPanel, EquippedBar, StatReadouts } from './Hud'
import { dpsCeiling } from './hudStyles'
import { targetAnnouncement, targetPhrase } from './settingsCopy'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { ResultsSummary } from './TimedTest'

const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const byName = (name: string): Weapon => {
  const w = ALL_WEAPONS.find((x) => x.name === name)
  if (!w) throw new Error(`${name} missing`)
  return w
}
const list = labWeapons(ALL_WEAPONS, LAB_SETUP)

function session(weapon: Weapon, target?: LabTarget): LabSession {
  let seed = 11
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...(target ? { target } : {}), settings: { damageVariance: false } })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

/** Hold attack (pointer at `aim`, or Space when null) for `ticks`, then let go and run `after` more ticks. */
function play(s: LabSession, aim: { x: number; y: number } | null, ticks: number, after = 0): void {
  if (aim) s.press('pointer', aim)
  else s.press('key')
  for (let i = 0; i < ticks; i++) s.frame(1000 / 60)
  s.release(aim ? 'pointer' : 'key')
  for (let i = 0; i < after; i++) s.frame(1000 / 60)
}

describe('thrown explosives in the Lab (PRD P3-S11 AC1)', () => {
  it('the verified thrown explosives equip; launchers, the Grenade (impact or fuse) and the shaped / harmless bombs stay limitations', () => {
    const explosives = list.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'explosive-aoe').map((w) => w.name)
    expect(explosives).toEqual(expect.arrayContaining(['Bomb', 'Dynamite', 'Power Bomb', 'Sticky Bomb', 'Bomb Fish', 'Wet Bomb']))
    expect(explosives).toHaveLength(15)
    for (const name of ['Grenade', 'Scarab Bomb', 'Freeze Bomb', 'Rocket Launcher']) expect(labStatus(byName(name), LAB_SETUP).kind, name).toBe('not-simulable')
    expect(byName('Grenade').labBehavior).toMatchObject({ reason: expect.stringContaining('on impact or on a fuse, not both') })
  })

  it('one Bomb at the middle of a row: one blast, every dummy within 4 tiles hit once, no falloff — "Explosives used" counts the throw', () => {
    const s = session(byName('Bomb'), { kind: 'row', count: 3 })
    expect(s.explosive).toEqual({ blastRadiusTiles: 4, trigger: 'timed', fuseTicks: 180, falloff: 'none' })
    expect(s.summary.consumable).toBe(true)
    play(s, { x: 9, y: 0 }, 1, 200)
    const hud = s.getHud()
    expect(hud.consumablesUsed).toBe(1)
    expect(hud.ammoConsumed).toBe(0)
    expect(hud.lastBlast).toEqual({
      index: 1,
      radiusTiles: 4,
      falloff: 'none',
      dummies: [
        { id: 'dummy-0', number: 1, amount: 100, crit: false, keptPct: 100 },
        { id: 'dummy-1', number: 2, amount: 100, crit: false, keptPct: 100 },
        { id: 'dummy-2', number: 3, amount: 100, crit: false, keptPct: 100 },
      ],
    })
    expect(hud.totalDamage).toBe(300)
    // aimed at the first dummy (Space), the far one is 5 tiles from the blast: outside
    const space = session(byName('Bomb'), { kind: 'row', count: 3 })
    play(space, null, 1, 200)
    expect(space.getHud().lastBlast?.dummies.map((d) => d.amount)).toEqual([100, 100, null])
    // the readout: its number, radius, the falloff label, each dummy's share ("outside" in words)
    const html = render(createElement(BlastReadout, { blast: space.getHud().lastBlast!, explosive: space.explosive!, dummyNumbers: [1, 2, 3], compact: false }))
    expect(html).toContain('Blast 1')
    expect(html).toContain('4-tile radius')
    expect(html).toContain('no falloff: full damage inside')
    expect(html).toContain('data-blast-amount="outside"')
    expect(html).toContain('Dummy 3: </span><span class="text-fg-muted">outside</span>')
    // a reset forgets the blast and the count
    space.reset()
    expect(space.getHud()).toMatchObject({ lastBlast: null, consumablesUsed: 0 })
  })

  it('a 10 s timed test: 24 throws = 24 explosives used, fewer blasts (the last ones are still on their fuses)', () => {
    const s = session(byName('Bomb'))
    s.startTimedTest(10)
    for (let i = 0; i < 600; i++) s.frame(1000 / 60)
    const result = s.getHud().timedTest.result
    expect(result).toMatchObject({ consumablesUsed: 24, uses: 24, ammoConsumed: 0, explosions: 17 })
    expect(s.getHud().lastBlast?.index).toBe(17)
    const html = render(
      createElement(ResultsSummary, { result: result!, weaponName: 'Bomb', appliesDot: false, usesItems: true, assumptions: [{ id: 'x', title: 't', detail: 'd' }], onRunAgain: () => {}, onReset: () => {}, compact: false }),
    )
    expect(html).toContain('Explosives used')
    expect(html).toContain('data-result="explosives-used">24<')
    // throws vs hits, on the row itself (design review P3-S11 #8): the 7 still on their fuses
    expect(html).toMatch(/data-result="unexploded">\(7 unexploded at test end\)</)
    expect(html).not.toContain('Ammo used')
    // every throw gone off: no note
    const all = render(
      createElement(ResultsSummary, { result: { ...result!, explosions: 24 }, weaponName: 'Bomb', appliesDot: false, usesItems: true, assumptions: [{ id: 'x', title: 't', detail: 'd' }], onRunAgain: () => {}, onReset: () => {}, compact: false }),
    )
    expect(all).not.toContain('unexploded')
  })

  it('the latest-blast readout keeps its room from the start (design review P3-S11 #2): "No blast yet", the same box when the first blast lands', () => {
    for (const count of [1, 3, 5]) {
      const target: LabTarget = count === 1 ? { kind: 'single' } : { kind: 'row', count }
      const s = session(byName('Bomb'), target)
      const numbers = Array.from({ length: count }, (_, i) => i + 1)
      expect(s.getHud().lastBlast).toBeNull()
      const props = { explosive: s.explosive!, dummyNumbers: numbers, compact: true, strip: true }
      const before = render(createElement(BlastReadout, { blast: null, ...props }))
      expect(before).toContain('No blast yet')
      expect(before).toContain('data-blast-readout="0"')
      expect(before.match(/data-blast-amount="pending"/g)).toHaveLength(count)
      play(s, null, 1, 200)
      const after = render(createElement(BlastReadout, { blast: s.getHud().lastBlast, ...props }))
      expect(after).toContain('Blast 1')
      // the reserved room is the same markup before and after: the widest readout for these dummies
      const room = (html: string) => /<div aria-hidden="true" class="invisible[^"]*" data-blast-room="">([\s\S]*?)<\/div><div class="\[grid-area:1\/1\]/.exec(html)?.[1]
      expect(room(before)).toBeDefined()
      expect(room(after)).toBe(room(before))
      expect(room(before)?.match(/9,999/g)).toHaveLength(count + 1) // "Blast 9,999" + one share per dummy
      expect(room(before)?.match(/>outside</g)).toHaveLength(count) // …or "outside", whichever is wider
    }
    // the Lab lays it out for a thrown explosive from the first frame, phone and desktop alike (no blast needed)
    expect(session(byName('Bomb')).getHud().lastBlast).toBeNull()
  })

  it('the HUD: the counter, the EquippedBar’s blast and fuse, the controls hint — all from the params', () => {
    expect(render(createElement(ConsumableCounter, { used: 12, compact: false }))).toMatch(/Explosives used.*data-stat="explosives-used">12</)
    expect(behaviorFacts(byName('Bomb'))).toEqual([
      { key: 'blast', label: 'Blast', short: 'Blast', value: '4-tile radius, no falloff', shortValue: '4 tiles' },
      { key: 'trigger', label: 'Fuse', short: 'Fuse', value: '3 s', shortValue: '3s', spoken: '3 seconds' },
    ])
    expect(behaviorFacts(byName('Dynamite'))[0].value).toBe('7.8-tile radius, no falloff')
    const s = session(byName('Dynamite'))
    const bar = render(createElement(EquippedBar, { weapon: byName('Dynamite'), sprites: null, hud: s.getHud(), compact: false }))
    expect(bar).toContain('data-fact="blast"')
    expect(bar).toContain('5 s')
    // classless: never crits (B85(b), labeled classless-crit) — in words, not a bare "0%"
    expect(bar).toMatch(/data-fact="crit"><dt>Crit<\/dt><dd[^>]*><span aria-hidden="true">never<\/span><span class="sr-only">never: classless damage can’t deal critical hits<\/span>/)
    expect(bar).not.toMatch(/Crit<\/dt><dd[^>]*>0%/)
    // the compact bar: tiles spelled out beside "Use 40t" (ticks), and every abbreviated value spoken in full
    const compactBar = render(createElement(EquippedBar, { weapon: byName('Dynamite'), sprites: null, hud: s.getHud(), compact: true }))
    expect(compactBar).toContain('<span aria-hidden="true">7.8 tiles</span><span class="sr-only">7.8-tile radius, no falloff</span>')
    expect(compactBar).toContain('<span aria-hidden="true">40t</span><span class="sr-only">40 ticks</span>')
    expect(compactBar).toContain('<span aria-hidden="true">5s</span><span class="sr-only">5 seconds</span>')
    expect(bar).toContain('<span aria-hidden="true">5 s</span><span class="sr-only">5 seconds</span>')
    // a weapon that can crit keeps its percentage
    const sword = createLabSession(byName('Wooden Sword'), { setup: LAB_SETUP, seed: () => 1 })
    if (!sword.ok) throw new Error('refused')
    expect(render(createElement(EquippedBar, { weapon: byName('Wooden Sword'), sprites: null, hud: sword.session.getHud(), compact: false }))).toMatch(/Crit<\/dt><dd[^>]*>\d+%/)
    const dummies = s.sim.renderState().dummies
    const panelHtml = render(
      createElement(TargetSettingsPanel, { usesMana: false, dummy: dummies[0], dummies, target: s.getHud().target, settings: DEFAULT_LAB_SETTINGS, onSettingsChange: () => {}, locked: false, verb: 'throw', explosive: s.explosive }),
    )
    expect(panelHtml).toContain('data-steer-hint="explosive"')
    expect(panelHtml).toContain('lands on the ground below where you aim and goes off 5 seconds after the throw')
    expect(panelHtml).toContain('within its 7.8-tile radius once')
    expect(s.assumptions.map((a) => a.id)).toEqual(expect.arrayContaining(['explosive-throw', 'explosive-fuse', 'blast-area', 'explosive-consumable', 'square-blast-radius', 'classless-crit']))
  })

  it('compact Multiple Dummies: the DPS values keep the room of the most they can read (to 999.9) from the first frame, so the first blast never re-wraps the EquippedBar', () => {
    const s = session(byName('Bomb'), { kind: 'row', count: 4 })
    const hud = s.getHud()
    const assumptions = s.assumptions
    if (!hasAssumptions(assumptions)) throw new Error('no assumptions')
    // 100 × 1.15 (top of the roll) × 4 dummies × 2.4 throws/s, no crits (classless)
    expect(dpsCeiling(hud)).toBeCloseTo(100 * 1.15 * 4 * 2.4, 6)
    const room = (html: string) => html.match(/<span aria-hidden="true" class="invisible \[grid-area:1\/1\]">([^<]*)<\/span>/g) ?? []
    const before = render(createElement(StatReadouts, { hud, assumptions, compact: true }))
    expect(room(before)).toHaveLength(2) // all dummies, the primary target
    expect(before).toContain('>999.9</span>')
    play(s, null, 1, 200)
    const after = render(createElement(StatReadouts, { hud: s.getHud(), assumptions, compact: true }))
    expect(room(after)).toEqual(room(before))
    expect(s.getHud().estimatedDps).toBeGreaterThan(99.9) // the climb the room was kept for
    // one dummy (DPS spans the box) or the full HUD: no room kept
    expect(room(render(createElement(StatReadouts, { hud: session(byName('Bomb')).getHud(), assumptions, compact: true })))).toHaveLength(0)
    expect(room(render(createElement(StatReadouts, { hud, assumptions, compact: false })))).toHaveLength(0)
  })

  it('the arena’s ground line is the engine’s (a thrown explosive lands where the art draws the ground)', () => {
    expect(ARENA_LAYOUT.groundY).toBe(GROUND_Y_TILES)
  })
})

describe('the Debuff Dummy (PRD P3-S11 AC3) and "Debuffs applied" (AC2)', () => {
  it('a target-picker entry; the card and the announcer name it', () => {
    const s = session(byName('Frost Staff'), { kind: 'debuff' })
    expect(s.getHud().target).toEqual({ kind: 'debuff' })
    const dummies = s.sim.renderState().dummies
    expect(dummies).toHaveLength(1)
    const html = render(
      createElement(TargetSettingsPanel, { usesMana: true, dummy: dummies[0], dummies, target: s.getHud().target, onTargetChange: () => {}, settings: DEFAULT_LAB_SETTINGS, onSettingsChange: () => {}, locked: false }),
    )
    expect(html).toMatch(/<input [^>]*id="lab-target-debuff"[^>]*checked=""/)
    expect(html).toContain('One dummy that lists its active debuffs and their time left')
    expect(html).toContain('data-target-card="debuff"')
    expect(html).toContain('>Debuff Dummy<')
    expect(targetAnnouncement({ kind: 'debuff' })).toBe('Debuff Dummy, listing its active debuffs — the stats start again from zero.')
    expect(targetPhrase({ kind: 'debuff' })).toBe('the Debuff Dummy')
    // switching to it from the Infinite Dummy restarts the stats, like any target change
    const other = session(byName('Frost Staff'))
    expect(other.getHud().debuffDummy).toBeNull()
    expect(other.setTarget({ kind: 'debuff' })).toBe(true)
    expect(other.getHud().debuffDummy).toMatchObject({ debuffs: [], weaponApplies: true, applies: [{ buffId: 'frostbite', name: 'Frostbite', dps: 25 }], dotDamage: 0 })
  })

  it('the panel keeps its room from the start (the stable-HUD pattern): "No debuffs yet", a row per debuff the weapon applies, the same box when Frostbite lands and runs out', () => {
    const s = session(byName('Frost Staff'), { kind: 'debuff' })
    const room = (html: string) => /<ul aria-hidden="true" class="invisible[^"]*" data-debuff-room="(\d+)">([\s\S]*?)<\/ul>/.exec(html)
    for (const strip of [false, true]) {
      const props = { compact: strip, strip }
      const before = render(createElement(DebuffPanel, { panel: s.getHud().debuffDummy!, applied: s.getHud().debuffsApplied, ...props }))
      expect(before).toContain('No debuffs yet.')
      expect(before).toContain('data-debuff-panel="0"')
      expect(room(before)?.[1]).toBe('1')
      expect(room(before)?.[2]).toContain('Frostbite')
      expect(room(before)?.[2]).not.toContain('role="meter"') // the reserved copy is no second meter
      // shown and reserved share one grid cell
      expect(before).toMatch(/<p class="text-fg-muted \[grid-area:1\/1\]" data-debuffs-none="">No debuffs yet\.<\/p>/)
      const fresh = session(byName('Frost Staff'), { kind: 'debuff' })
      play(fresh, null, 30)
      const during = render(createElement(DebuffPanel, { panel: fresh.getHud().debuffDummy!, applied: fresh.getHud().debuffsApplied, ...props }))
      expect(during).toContain('data-debuff-panel="1"')
      expect(during).toMatch(/<ul class="space-y-1 \[grid-area:1\/1\]"><li data-debuff="frostbite"/)
      expect(room(during)?.[0]).toBe(room(before)?.[0])
      for (let i = 0; i < 480; i++) fresh.frame(1000 / 60)
      const after = render(createElement(DebuffPanel, { panel: fresh.getHud().debuffDummy!, applied: fresh.getHud().debuffsApplied, ...props }))
      expect(after).toContain('None active right now.')
      expect(room(after)?.[0]).toBe(room(before)?.[0])
    }
    // the Imp Staff's own On Fire! — and a whip carrying it as its loadout reserves it once
    expect(session(byName('Imp Staff'), { kind: 'debuff' }).getHud().debuffDummy?.applies).toEqual([{ buffId: 'on-fire', name: 'On Fire!', dps: 4 }])
    const whip = list.find((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'whip')!
    const created = createLabSession(whip, { setup: LAB_SETUP, seed: () => 1, target: { kind: 'debuff' }, loadout: byName('Imp Staff') })
    if (!created.ok) throw new Error('refused')
    expect(created.session.getHud().debuffDummy?.applies.map((d) => d.buffId)).toEqual(['on-fire'])
  })

  it('Frost Staff: Frostbite with its damage per second and a 7 s bar counting down; applied counted; it expires off the list', () => {
    const s = session(byName('Frost Staff'), { kind: 'debuff' })
    play(s, null, 30)
    const panel = s.getHud().debuffDummy
    expect(panel?.debuffs).toHaveLength(1)
    const [frostbite] = panel!.debuffs
    expect(frostbite).toMatchObject({ buffId: 'frostbite', name: 'Frostbite', dps: 25, durationSec: 7 })
    expect(frostbite.remainingSec).toBeGreaterThan(6)
    expect(frostbite.remainingSec).toBeLessThanOrEqual(7)
    expect(frostbite.fraction).toBeCloseTo(frostbite.remainingSec / 7, 9)
    expect(s.getHud().debuffsApplied).toBeGreaterThan(0)
    // two seconds later the bar has run down by two seconds (no new casts)
    const before = frostbite.remainingSec
    for (let i = 0; i < 120; i++) s.frame(1000 / 60)
    expect(s.getHud().debuffDummy?.debuffs[0].remainingSec).toBeCloseTo(before - 2, 1)
    expect(s.getHud().debuffDummy?.dotDamage).toBeGreaterThan(0)
    const html = render(createElement(DebuffPanel, { panel: s.getHud().debuffDummy!, applied: s.getHud().debuffsApplied, compact: false }))
    expect(html).toContain('Frostbite')
    expect(html).toContain('25<span aria-hidden="true">/s</span>')
    expect(html).toMatch(/role="meter"[^>]*aria-label="Frostbite, time left"/)
    expect(html).toMatch(/aria-valuetext="\d\.\d of 7\.0 seconds left"/)
    expect(html).toContain('data-stat="debuffs-applied"')
    expect(html).toContain('<svg') // the debuff's icon (pixel art)
    // its kind's glyph — a snowflake for Frostbite — and the bar in that glyph's tint (design review P3-S11 #4)
    expect(html).toContain('data-debuff="frostbite" data-debuff-glyph="frost"')
    expect(html).toMatch(/class="block h-full bg-night-200"/)
    expect(`bg-${DEBUFF_TINT_TOKENS.frost}`).toBe('bg-night-200')
    // after the 7 s run out, nothing is active
    for (let i = 0; i < 420; i++) s.frame(1000 / 60)
    expect(s.getHud().debuffDummy?.debuffs).toEqual([])
  })

  it('Imp Staff (a summon’s DoT, a random 3–6 s duration): On Fire! with its own bar', () => {
    const s = session(byName('Imp Staff'), { kind: 'debuff' })
    play(s, null, 300)
    const fire = s.getHud().debuffDummy?.debuffs.find((d) => d.buffId === 'on-fire')
    expect(fire).toMatchObject({ name: 'On Fire!', dps: 4 })
    expect(fire!.durationSec).toBeGreaterThanOrEqual(3)
    expect(fire!.durationSec).toBeLessThanOrEqual(6)
    // a flame, not Frostbite's snowflake; its bar gold (the flame's tint), the name in words beside it
    const html = render(createElement(DebuffPanel, { panel: s.getHud().debuffDummy!, applied: s.getHud().debuffsApplied, compact: true, strip: true }))
    expect(html).toContain('data-debuff="on-fire" data-debuff-glyph="flame"')
    expect(html).toMatch(/class="block h-full bg-gold-400"/)
    expect(`bg-${DEBUFF_TINT_TOKENS.flame}`).toBe('bg-gold-400')
    expect(html).toContain('On Fire!')
  })

  it('a weapon with no debuff: the panel says it applies none; "Debuffs applied" shows in the results only for a DoT weapon', () => {
    const s = session(byName('Bomb'), { kind: 'debuff' })
    expect(s.getHud().debuffDummy).toMatchObject({ debuffs: [], weaponApplies: false, applies: [] })
    const none = render(createElement(DebuffPanel, { panel: s.getHud().debuffDummy!, applied: 0, compact: true, strip: true }))
    expect(none).toContain('None — this weapon applies no debuff.')
    expect(none).toContain('data-debuff-room="0"') // nothing to reserve: no debuff will come
    const frost = session(byName('Frost Staff'), { kind: 'debuff' })
    frost.startTimedTest(10)
    for (let i = 0; i < 600; i++) frost.frame(1000 / 60)
    const result = frost.getHud().timedTest.result!
    expect(result.debuffsApplied).toBeGreaterThan(0)
    const html = render(
      createElement(ResultsSummary, { result, weaponName: 'Frost Staff', appliesDot: true, usesMana: true, targetName: targetPhrase({ kind: 'debuff' }), assumptions: [{ id: 'x', title: 't', detail: 'd' }], onRunAgain: () => {}, onReset: () => {}, compact: false }),
    )
    expect(html).toContain('Frost Staff vs the Debuff Dummy')
    expect(html).toContain(`data-result="debuffs-applied">${result.debuffsApplied}<`)
    expect(html).toContain('DoT damage')
  })
})
