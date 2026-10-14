/**
 * The Lab session with summons (PRD P3-S9: minions + sentries) and whips (P3-S10: tags, the minion
 * loadout, the summoner loop), on the committed data with the Lab's setup. Weapons are picked from the
 * data by their params, never by a hand list (the dataset has no simulable sentry — B63 P-4 left every
 * sentry range missing — so the sentry flow runs on the engine's test fixture). Deterministic seeds.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import { APPROXIMATIONS, TICKS_PER_SECOND, WHIP_TAG_DURATION_TICKS, type SimEvent } from '../sim'
import { summonFixture } from '../sim/testing/fixtures'
import { assumptionsForEstimate, LAB_ASSUMPTIONS } from './labAssumptions'
import { createLabSession, type LabSession, type LabSessionOptions } from './labSession'
import { behaviorFacts, labWeapons, loadoutChoices } from './labWeapons'
import { ALL_WEAPONS, LAB_SETUP } from './testing/labData'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const paramsOf = (w: Weapon) => (w.labBehavior.kind === 'archetype' ? w.labBehavior.params : null)
const FRAME_MS = 1000 / 60
const byName = (test: (w: Weapon) => boolean) => list.filter(test).sort((a, b) => a.name.localeCompare(b.name, 'en'))
const staves = loadoutChoices(list)
const whips = byName((w) => paramsOf(w)?.archetype === 'whip')
/** A minion staff whose rate is the B63 P-3 hit cap (an upper bound), and one with no DoT. */
const hitCapStaff = staves.find((w) => w._prov.modeledFields?.some((f) => f.endsWith('#summon-hit-cap')) && !(w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers))!
const tagCritWhip = whips.find((w) => (paramsOf(w) as { tagCritPct?: number }).tagCritPct)!

function session(weapon: Weapon, options: LabSessionOptions = {}): LabSession {
  let seed = 21
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...options })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}
function frames(s: LabSession, n: number): SimEvent[] {
  const events: SimEvent[] = []
  for (let i = 0; i < n; i++) events.push(...s.frame(FRAME_MS).events)
  return events
}
/** A click (press, one frame, release) at `aim` (world tiles), or Space with `aim` null. */
function click(s: LabSession, aim: { x: number; y: number } | null): SimEvent[] {
  if (aim) s.press('pointer', aim)
  else s.press('key')
  const events = frames(s, 1)
  s.release(aim ? 'pointer' : 'key')
  return [...events, ...frames(s, 1)]
}
function hold(s: LabSession, ticks: number): SimEvent[] {
  s.press('key')
  const events = frames(s, ticks)
  s.release('key')
  return events
}

describe('the committed data the Lab equips (B61 flip: minion staves and whips)', () => {
  it('minion staves and whips are in the Lab; every loadout choice is a minion staff', () => {
    expect(staves.length).toBeGreaterThan(0)
    expect(whips.length).toBeGreaterThan(0)
    for (const w of staves) expect(paramsOf(w)).toMatchObject({ archetype: 'minion-sentry', variant: 'minion' })
    expect(hitCapStaff).toBeDefined()
    expect(tagCritWhip).toBeDefined()
  })

  it('the EquippedBar facts come from the params: a staff’s slots and attack interval, a whip’s range and tag', () => {
    const p = paramsOf(hitCapStaff) as { slotCost: number; attackRateTicks: number }
    expect(behaviorFacts(hitCapStaff)).toEqual([
      expect.objectContaining({ key: 'slots', label: 'Slots', value: `${p.slotCost} minion slot` }),
      expect.objectContaining({ key: 'hit-rate', label: 'Attacks every', value: `${p.attackRateTicks} ticks` }),
    ])
    const w = paramsOf(tagCritWhip) as { rangeTiles: number; tagDamageFlat: number; tagCritPct: number }
    expect(behaviorFacts(tagCritWhip)).toEqual([
      expect.objectContaining({ key: 'range', value: `${w.rangeTiles} tiles` }),
      expect.objectContaining({ key: 'tag', value: `+${w.tagDamageFlat} damage, ${w.tagCritPct}% crit` }),
    ])
  })
})

describe('a minion staff (PRD P3-S9 AC1/AC3/AC4)', () => {
  it('a click summons a minion where it lands; it attacks on its own; the HUD counts it against the slots', () => {
    const s = session(hitCapStaff)
    const events = click(s, { x: 3, y: -1 })
    expect(events.filter((e) => e.type === 'summon')).toMatchObject([{ kind: 'minion', x: 3, y: -1 }])
    expect(s.getHud().summons).toEqual({ source: 'weapon', kind: 'minion', count: 1, slotsUsed: 1, slots: 1, loadoutName: null, replaced: 0, targets: [1] })
    expect(s.getHud().rateReadout).toBe('summon-hits')
    const later = frames(s, 600)
    const hits = later.filter((e) => e.type === 'damage')
    expect(hits.length).toBeGreaterThan(10)
    expect(hits.every((e) => e.type === 'damage' && e.source === 'minion' && !e.crit)).toBe(true) // B17: never crits
    expect(s.getHud().breakdown).toMatchObject({ weaponDamage: 0, summonDamage: s.getHud().totalDamage })
  })

  it('est. DPS and hits/sec divide by the time since the first summon (`dps-with-summons`): ≈ the stated rate', () => {
    const s = session(hitCapStaff)
    click(s, null)
    frames(s, 1200)
    const hud = s.getHud()
    const { attackRateTicks } = paramsOf(hitCapStaff) as { attackRateTicks: number }
    // every tick since it appeared (tick 0), as of the HUD's last tenth-of-a-second refresh
    expect(Math.abs(hud.attackSeconds - 1202 / TICKS_PER_SECOND)).toBeLessThanOrEqual(0.1)
    expect(hud.hitsPerSec).toBeCloseTo(TICKS_PER_SECOND / attackRateTicks, 0)
    const damage = hitCapStaff.damage ?? 0
    expect(hud.estimatedDps / ((damage * TICKS_PER_SECOND) / attackRateTicks)).toBeGreaterThan(0.85) // ±15% variance
    expect(hud.estimatedDps / ((damage * TICKS_PER_SECOND) / attackRateTicks)).toBeLessThan(1.15)
  })

  it('a slot change restarts the stats (the minion leaves); Reset clears every summon instantly', () => {
    const s = session(hitCapStaff)
    click(s, null)
    frames(s, 120)
    expect(s.getHud().hits).toBeGreaterThan(0)
    const result = s.updateSettings({ minionSlots: 3 })
    expect(result).toMatchObject({ ok: true, restarted: true })
    expect(s.getHud()).toMatchObject({ hits: 0, summons: { count: 0, slots: 3 } })
    hold(s, 200)
    expect(s.getHud().summons).toMatchObject({ count: 3, slotsUsed: 3 })
    s.reset()
    expect(s.getHud().summons).toMatchObject({ count: 0, slots: 1 })
    expect(s.sim.renderState().agents).toEqual([])
  })

  it('with the slots full a new summon replaces the oldest: the HUD counts each replacement (the UI announces it); a reset counts from zero', () => {
    const s = session(hitCapStaff)
    // past the staff's use time between presses, so each press is a new use
    const wait = hitCapStaff.useAnimationTicks! + 5
    click(s, { x: 3, y: -1 })
    frames(s, wait)
    expect(s.getHud().summons).toMatchObject({ count: 1, slotsUsed: 1, slots: 1, replaced: 0 })
    const [first] = s.sim.renderState().agents
    const events = click(s, { x: 2, y: -2 })
    expect(events.filter((e) => e.type === 'dismiss')).toMatchObject([{ agentId: first.id, reason: 'replaced' }])
    expect(s.getHud().summons).toMatchObject({ count: 1, slotsUsed: 1, replaced: 1 })
    expect(s.sim.renderState().agents.map((a) => a.id)).not.toContain(first.id)
    frames(s, wait)
    click(s, null)
    expect(s.getHud().summons?.replaced).toBe(2)
    s.reset()
    expect(s.getHud().summons).toMatchObject({ count: 0, replaced: 0 })
  })

  it('the staff’s tips: hits/sec led by `summon-hit-rate`; an UPPER-BOUND rate carries the B63 P-3 caveat verbatim', () => {
    const all = session(hitCapStaff).assumptions
    const rate = assumptionsForEstimate(all, 'summon-hits-per-sec')
    expect(rate[0].id).toBe('summon-hit-rate')
    expect(rate.map((a) => a.id)).toEqual(expect.arrayContaining(['summon-hit-cap', 'summon-slots', 'summon-attack']))
    expect(rate.find((a) => a.id === 'summon-hit-cap')?.detail).toContain('maximum rate; actual depends on minion AI pathing')
    const dps = assumptionsForEstimate(all, 'estimated-dps')
    expect(dps[0].id).toBe('dps-with-summons')
    expect(dps.map((a) => a.id)).not.toContain('dps-while-attacking')
    expect(all.map((a) => a.id)).toContain('target-reach')
    expect(all.map((a) => a.id)).not.toContain('target-distance')
  })
})

describe('a sentry staff (PRD P3-S9 AC2; engine fixture — no dataset sentry is simulable)', () => {
  it('places the sentry exactly at the click point, where it stays; the HUD counts sentries against sentry slots', () => {
    const s = session(summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', attackRateTicks: 20, sentryRangeTiles: 10 }))
    click(s, { x: 1.5, y: -2 })
    frames(s, 300)
    expect(s.sim.renderState().agents).toMatchObject([{ kind: 'sentry', x: 1.5, y: -2, prevX: 1.5, prevY: -2 }])
    expect(s.getHud().summons).toMatchObject({ source: 'weapon', kind: 'sentry', count: 1, slots: 1 })
    expect(s.getHud().hits).toBeGreaterThan(5)
    expect(s.assumptions.map((a) => a.id)).toContain('sentry-placement')
  })
})

describe('a whip with the minion loadout (PRD P3-S10 AC1–AC3: the summoner loop)', () => {
  const loadout = staves.find((w) => (paramsOf(w) as { aiClass: string }).aiClass !== 'ranged-shot')!

  it('the loadout’s minions are out from the start, as many as the slots hold; changing the slots refills them', () => {
    const s = session(tagCritWhip, { loadout, settings: { minionSlots: 3 } })
    frames(s, 1)
    expect(s.loadout).toBe(loadout)
    expect(s.getHud().summons).toEqual({ source: 'loadout', kind: 'minion', count: 3, slotsUsed: 3, slots: 3, loadoutName: loadout.name, replaced: 0, targets: [1] })
    expect(s.updateSettings({ minionSlots: 5 })).toMatchObject({ ok: true, restarted: true })
    frames(s, 1)
    expect(s.getHud().summons).toMatchObject({ count: 5, slots: 5 })
  })

  it('the whip tags the dummy (4 s, shown with its time left); tagged minion hits carry the tag bonus; damage is split by source', () => {
    const s = session(tagCritWhip, { loadout })
    frames(s, 60)
    expect(s.getHud().tags).toEqual([])
    const swung = hold(s, 40)
    expect(swung.some((e) => e.type === 'tag-applied')).toBe(true)
    const [tag] = s.getHud().tags
    expect(tag).toMatchObject({ dummyId: 'dummy-0', number: 1 })
    expect(tag.remainingSec).toBeGreaterThan(3)
    expect(tag.remainingSec).toBeLessThanOrEqual(WHIP_TAG_DURATION_TICKS / TICKS_PER_SECOND)
    const after = frames(s, 120)
    expect(after.some((e) => e.type === 'damage' && e.source === 'minion' && (e.tagBonus ?? 0) > 0)).toBe(true)
    const b = s.getHud().breakdown!
    expect(b.weaponDamage).toBeGreaterThan(0)
    expect(b.summonDamage).toBeGreaterThan(0)
    expect(b.tagBonusDamage).toBeGreaterThan(0)
    expect(b.weaponDamage + b.summonDamage + b.dotDamage).toBe(s.getHud().totalDamage)
    frames(s, WHIP_TAG_DURATION_TICKS)
    expect(s.getHud().tags).toEqual([]) // the tag ran out
  })

  it('the HUD says which dummy the summons attack (design review M2): the nearest, then the one the whip struck last', () => {
    const s = session(tagCritWhip, { loadout, settings: { minionSlots: 2 } })
    expect(s.setTarget({ kind: 'row', count: 3 })).toBe(true)
    frames(s, 10)
    const numberOf = (id: string) => s.sim.renderState().dummies.findIndex((d) => d.id === id) + 1
    const engineTargets = () => [...new Set(s.sim.renderState().agents.flatMap((a) => (a.targetId ? [numberOf(a.targetId)] : [])))].sort((a, b) => a - b)
    expect(s.getHud().summons?.targets).toEqual([1]) // nearest to you
    const seen = new Set<number>()
    s.press('key')
    for (let i = 0; i < 240; i++) {
      const tags = s.frame(FRAME_MS).events.filter((e) => e.type === 'tag-applied')
      const hud = s.getHud().summons!
      // always the engine's own targets, as row numbers
      expect(hud.targets).toEqual(engineTargets())
      if (tags.length > 0) expect(hud.targets).toEqual([numberOf(tags.at(-1)!.dummyId)]) // the dummy struck last
      for (const n of hud.targets) seen.add(n)
    }
    s.release('key')
    expect(seen.size).toBeGreaterThan(1) // it moved off the nearest dummy
  })

  it('who dealt the latest hit: the whip’s own or a minion’s, as the engine’s last direct hit', () => {
    const s = session(tagCritWhip, { loadout })
    const sources = new Set<string>()
    s.press('key')
    for (let i = 0; i < 300; i++) {
      const hits = s.frame(FRAME_MS).events.filter((e) => e.type === 'damage' && e.source !== 'dot')
      const last = hits.at(-1)
      if (!last || last.type !== 'damage') continue
      const hud = s.getHud().lastHit!
      expect(hud.amount).toBe(last.amount)
      expect(hud.source).toBe(last.source === 'minion' || last.source === 'sentry' ? last.source : 'weapon')
      sources.add(hud.source)
    }
    s.release('key')
    expect(sources).toEqual(new Set(['weapon', 'minion']))
  })

  it('tips: the whip and summon mechanics follow the modeling choices, before the generic engine entries (design review M6)', () => {
    for (const s of [session(tagCritWhip, { loadout }), session(hitCapStaff)]) {
      const ids = s.assumptions.map((a) => a.id)
      const summoner = ids.filter((id) => /^(whip-swing|whip-tag|summon-slots|summon-attack|summon-target|minion-(melee-contact|ground-melee|hover-strike|ranged-shot)|sentry-placement)$/.test(id))
      expect(summoner.length).toBeGreaterThan(2)
      const lastChoice = Math.max(...s.assumptions.flatMap((a, i) => ('ruling' in a && a.ruling) || a.id === 'target-reach' || a.id === 'minion-loadout' ? [i] : []))
      const firstGeneric = Math.min(...['fixed-tick', 'crit-base', 'defense', 'knockback', 'dummy-hitbox'].map((id) => ids.indexOf(id)).filter((i) => i >= 0))
      for (const id of summoner) {
        expect(ids.indexOf(id), id).toBeGreaterThan(lastChoice)
        expect(ids.indexOf(id), id).toBeLessThan(firstGeneric)
      }
      // the est. DPS tip: its rule, the modeling choices, then the summoner mechanics, then the rest
      const dps = assumptionsForEstimate(s.assumptions, 'estimated-dps').map((a) => a.id)
      expect(dps[0]).toBe('dps-with-summons')
      expect(dps.indexOf('summon-attack')).toBeLessThan(dps.indexOf('defense'))
    }
  })

  it('a timed test runs the whole loop: the minions out from tick 0, the whip held, a per-source result', () => {
    const s = session(tagCritWhip, { loadout, settings: { minionSlots: 2 } })
    expect(s.startTimedTest(10)).toBe(true)
    frames(s, 610)
    const result = s.getHud().timedTest.result!
    expect(result.breakdown.weaponDamage).toBeGreaterThan(0)
    expect(result.breakdown.summonDamage).toBeGreaterThan(0)
    expect(result.breakdown.tagBonusDamage).toBeGreaterThan(0)
    expect(result.breakdown.weaponDamage + result.breakdown.summonDamage + result.breakdown.dotDamage).toBe(result.totalDamage)
  })

  it('its tips list the loadout setup, the whip tag (4 s, wiki-sourced), the loadout’s rate convention and its class model', () => {
    const ids = session(tagCritWhip, { loadout }).assumptions.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['minion-loadout', 'dps-with-summons', 'whip-arc', 'whip-swing', 'whip-tag', 'summon-slots']))
    expect(ids.some((id) => id.startsWith('minion-') && id !== 'minion-loadout')).toBe(true)
    expect(APPROXIMATIONS['whip-tag']).toMatchObject({ sourceUrl: 'https://terraria.wiki.gg/wiki/Whips' })
    expect(LAB_ASSUMPTIONS['minion-loadout'].detail).toContain('Reset clears the loadout')
    // without a loadout a whip is not a summons session
    const alone = session(tagCritWhip)
    expect(alone.getHud().summons).toBeNull()
    expect(alone.assumptions.map((a) => a.id)).toContain('dps-while-attacking')
  })
})
