/**
 * P3-S6 / P3-S7 HTML layer (SSR markup; the canvas is aria-hidden): the Multiple Dummies target
 * picker (UX_SPEC §3.4), the primary-target vs all-dummy readouts and results rows (PRD P3-S6 AC4),
 * the per-dummy hit strip (AC2), the equipped weapon's behavior stats (P3-S7 AC2: a returning
 * weapon's range and flight; a beam's hit rate; a pierce count), and the steer hints for a yoyo and
 * a beam. Real committed weapons with the Lab's setup.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { hasAssumptions, type Assumption, type Assumptions } from '../../../components/assumptions'
import type { Weapon } from '../../../data-access/types'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import { bossDefenses } from '../../../lab/labBossDefense'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import { BOSS_SCALES, DEFAULT_LAB_TARGET, LAB_TARGET_KINDS, RANGED_TARGET_X_TILES, ROW_COUNTS, type LabTarget } from '../../../lab/labSetup'
import { behaviorFacts, labWeapons } from '../../../lab/labWeapons'
import { ALL_BOSSES, ALL_WEAPONS, LAB_SETUP } from '../../../lab/testing/labData'
import { APPROXIMATIONS, DEFAULT_LAB_SETTINGS } from '../../../sim'
import { AttackHint, EquippedBar, ShotsCounter, StatReadouts, TargetStrip } from './Hud'
import { DEFENSE_RULE, targetAnnouncement, targetPhrase } from './settingsCopy'
import { ARMORED_DEFENSE_SETTING_ID, MOVING_SPEED_SETTING_ID, TargetSettingsPanel } from './TargetSettingsPanel'
import { ResultsSummary } from './TimedTest'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const archetypeOf = (w: Weapon) => (w.labBehavior.kind === 'archetype' ? w.labBehavior.params : null)
const pick = (test: (w: Weapon) => boolean) => list.filter(test).sort((a, b) => (a.damage ?? 0) - (b.damage ?? 0) || a.id - b.id)[0]
const returning = (variant: string) => pick((w) => archetypeOf(w)?.archetype === 'returning' && (archetypeOf(w) as { variant: string }).variant === variant && !(w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers))
const pierceStaff = pick((w) => {
  const p = archetypeOf(w)
  return p?.archetype === 'magic-bolt' && p.projectile.pierce === 1
})
const row = (count: number): LabTarget => ({ kind: 'row', count })
/** A non-empty assumption list (an EstimateLabel's tip), or a failed test. */
function tips(list: readonly Assumption[]): Assumptions {
  if (!hasAssumptions(list)) throw new Error('no assumptions')
  return list
}

/** The `<input …>` tag with this id (SSR attribute order varies). */
const inputTag = (html: string, id: string) => new RegExp(`<input [^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? ''

function session(weapon: Weapon, target?: LabTarget): LabSession {
  let seed = 5
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...(target ? { target } : {}) })
  if (!created.ok) throw new Error(`${weapon.name} refused`)
  return created.session
}

function hold(s: LabSession, ticks: number): void {
  s.press('key')
  for (let i = 0; i < ticks; i++) s.frame(1000 / 60)
  s.release('key')
}

const panel = (s: LabSession, extra: Record<string, unknown> = {}) => {
  const dummies = s.sim.renderState().dummies
  return render(
    createElement(TargetSettingsPanel, {
      usesMana: false,
      dummy: dummies[0],
      dummies,
      target: s.getHud().target,
      onTargetChange: () => {},
      settings: DEFAULT_LAB_SETTINGS,
      onSettingsChange: () => {},
      locked: false,
      ...extra,
    }),
  )
}

describe('target picker (UX_SPEC §3.4; PRD P3-S6 AC1)', () => {
  it('offers the Infinite Dummy (checked by default) and Multiple Dummies, as labeled radios', () => {
    const html = panel(session(pierceStaff))
    expect(inputTag(html, 'lab-target-single')).toMatch(/type="radio".*name="lab-target".*checked=""/)
    expect(inputTag(html, 'lab-target-row')).toMatch(/type="radio".*name="lab-target"/)
    expect(inputTag(html, 'lab-target-row')).not.toContain('checked')
    expect(html).toContain('Multiple Dummies')
    expect(html).not.toContain('data-lab-setting="target-count"') // no row: no count control
    expect(html).toContain('data-target-card="single"')
    expect(html).toContain('Changing the target restarts the stats. Reset brings back the Infinite Dummy.')
  })

  it('Multiple Dummies: a 2–5 count group (the chosen one checked) and a card naming the row and its primary target', () => {
    const s = session(pierceStaff, row(3))
    const html = panel(s, { verb: 'cast' })
    expect(inputTag(html, 'lab-target-row')).toContain('checked=""')
    const counts = [...html.matchAll(/<input [^>]*id="lab-target-count-(\d)"[^>]*>/g)]
    expect(counts.map((m) => Number(m[1]))).toEqual([...ROW_COUNTS])
    expect(counts.filter((m) => m[0].includes('checked=""')).map((m) => m[1])).toEqual(['3'])
    expect(html).toContain('Dummies in the row')
    expect(html).toContain('3 Infinite Dummies')
    const xs = s.sim.renderState().dummies.map((d) => d.x)
    expect(html).toContain(`Centres ${xs.join(', ')} tiles in front of you`)
    expect(html).toContain('Dummy 1 is the primary target: Space and the timed tests aim at it.')
    expect(html).toContain('Hold Space to cast at the first dummy.')
  })

  it('locked during a timed test: every target input is disabled', () => {
    const html = panel(session(pierceStaff, row(2)), { locked: true })
    const inputs = [...html.matchAll(/<input [^>]*id="lab-target-[^"]+"[^>]*>/g)]
    expect(inputs.length).toBe(LAB_TARGET_KINDS.length + ROW_COUNTS.length) // the six targets (P3-S12 roster) + the row sizes
    for (const m of inputs) expect(m[0]).toContain('disabled=""')
  })

  it('a yoyo and a beam say how they are steered; others don’t', () => {
    expect(panel(session(returning('yoyo')), { steer: 'yoyo', verb: 'throw' })).toContain('The yoyo stays out while you hold, following the pointer within its reach; let go to call it back.')
    expect(panel(session(returning('yoyo')), { steer: 'yoyo', verb: 'throw' })).toContain('the yoyo goes to it and stays while you hold')
    expect(panel(session(pierceStaff), { steer: 'beam' })).toContain('The beam stays on while you hold and follows the pointer')
    expect(panel(session(pierceStaff))).not.toContain('data-steer-hint')
    expect(render(createElement(AttackHint, { touch: false, verb: 'throw', steer: 'yoyo' }))).toContain('Press and hold to throw — move to steer it · or hold Space')
    expect(render(createElement(AttackHint, { touch: true, verb: 'throw', steer: 'yoyo' }))).toContain('Touch and hold the arena to throw — drag to steer it')
  })
})

describe('primary target vs all dummies (PRD P3-S6 AC4) and hits per dummy (AC2)', () => {
  it('one dummy: the readouts are its own (no scope note, no primary rows, no strip data)', () => {
    const s = session(pierceStaff)
    hold(s, 60)
    const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: tips(s.assumptions), compact: false }))
    expect(html).toContain('data-stat-scope="one-dummy"')
    expect(html).not.toContain('data-stat="primary-dps"')
    expect(s.getHud().targets).toBeNull()
  })

  it('Multiple Dummies: totals over all dummies, with the primary target’s total and est. DPS apart (labeled, with their tips)', () => {
    const s = session(pierceStaff, row(3))
    hold(s, 240)
    const hud = s.getHud()
    const html = render(createElement(StatReadouts, { hud, assumptions: tips(s.assumptions), compact: false }))
    expect(html).toContain('data-stat-scope="all-dummies"')
    expect(html).toContain('Totals over all 3 dummies')
    expect(html).toContain(`data-stat="primary-total">${hud.targets!.primary.damage.toLocaleString('en-US')}<`)
    expect(html).toContain(`data-stat="primary-dps">${hud.targets!.primary.estimatedDps.toFixed(1)}<`)
    expect(html).toContain('Est. DPS (while attacking), primary target')
    expect(html).toContain('Total damage, all dummies')
    expect(html).toContain('data-estimate="estimated DPS while attacking, all dummies"')
    expect(html).toContain('data-estimate="estimated DPS while attacking, primary target"')
    // compact: the same two DPS figures, side by side, under short labels
    const compact = render(createElement(StatReadouts, { hud, assumptions: tips(s.assumptions), compact: true }))
    expect(compact).toContain('DPS, all')
    expect(compact).toContain('DPS, #1')
    expect(compact).toContain('data-stat="primary-dps"')
  })

  it('the hit strip lists every dummy, nearest first, the primary target starred and named for screen readers', () => {
    const s = session(pierceStaff, row(4))
    hold(s, 240)
    const targets = s.getHud().targets!
    const html = render(createElement(TargetStrip, { targets, compact: false }))
    expect([...html.matchAll(/data-dummy="(\d)" data-dummy-hits="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])])).toEqual(targets.dummies.map((d) => [d.number, d.hits]))
    expect(html).toContain('Dummy 1, the primary target:')
    expect(html).toContain('data-stat="dummy-damage"')
    expect(html).toContain('aria-label="Hits per dummy"')
    expect(html).toContain('pointer-events-none') // a readout: aiming passes through it
    const compact = render(createElement(TargetStrip, { targets, compact: true }))
    expect(compact).not.toContain('data-stat="dummy-damage"')
    expect(compact).toContain('data-stat="dummy-hits"')
  })

  it('a timed test’s results: all-dummy totals, the primary target’s est. DPS, and each dummy’s damage and hits', () => {
    const s = session(pierceStaff, row(3))
    s.startTimedTest(10)
    for (let i = 0; i < 600; i++) s.frame(1000 / 60)
    const result = s.getHud().timedTest.result!
    const ids = s.getHud().targets!.dummies.map((d) => d.id)
    const props = { result, weaponName: pierceStaff.name, appliesDot: false, usesMana: true, assumptions: tips(assumptionsForEstimate(s.assumptions, 'timed-test-dps')), onRunAgain: () => {}, onReset: () => {}, compact: false }
    const html = render(createElement(ResultsSummary, { ...props, dummyIds: ids }))
    expect(html).toContain('3 Infinite Dummies in a row (totals over all; dummy 1 is the primary target)')
    expect(html).toContain(`data-result="primary-dps">${(result.perDummy[ids[0]].damage / 10).toFixed(1)}<`)
    expect([...html.matchAll(/data-result="dummy" data-dummy="(\d)">([\d,]+)/g)].map((m) => [Number(m[1]), Number(m[2].replace(/,/g, ''))])).toEqual(ids.map((id, i) => [i + 1, result.perDummy[id].damage]))
    const single = render(createElement(ResultsSummary, props))
    expect(single).toContain('vs the Infinite Dummy')
    expect(single).not.toContain('data-result="primary-dps"')
  })
})

describe('the equipped weapon’s behavior stats (PRD P3-S7 AC2; P3-S6 pierce / tick rate)', () => {
  it('every returning weapon shows its throw range and its flight — one archetype, the variant in the words', () => {
    const throwers = list.filter((w) => archetypeOf(w)?.archetype === 'returning')
    expect(throwers.length).toBeGreaterThan(0)
    for (const w of throwers) {
      const p = archetypeOf(w) as { variant: string; throwRangeTiles: number }
      const facts = behaviorFacts(w)
      expect(facts.map((f) => f.key), w.name).toEqual(['range', 'flight'])
      expect(facts[0].value, w.name).toBe(`${Number(p.throwRangeTiles.toFixed(2))} tiles`)
    }
    const boomerang = render(createElement(EquippedBar, { weapon: returning('boomerang'), sprites: null, hud: session(returning('boomerang')).getHud(), compact: false }))
    expect(boomerang).toContain('data-fact="flight"')
    expect(boomerang).toContain('out &amp; back')
    expect(behaviorFacts(returning('yoyo'))[1].value).toBe('held out on a string')
    expect(behaviorFacts(returning('flail'))[1].value).toBe('out & back on a chain')
  })

  it('a piercing bolt shows how many more dummies it passes through; plain weapons add nothing', () => {
    expect(behaviorFacts(pierceStaff)).toEqual([{ key: 'pierce', label: 'Pierce', short: 'Pierce', value: '+1 dummy', shortValue: '+1' }])
    const sword = pick((w) => archetypeOf(w)?.archetype === 'swing-melee' && !(archetypeOf(w) as { emitted?: unknown }).emitted)
    expect(behaviorFacts(sword)).toEqual([])
    expect(behaviorFacts({ labBehavior: { kind: 'archetype', params: { archetype: 'piercing-beam', mode: 'channel-beam', tickRateTicks: 5 } } })).toEqual([
      { key: 'hit-rate', label: 'Hits every', short: 'Hit', value: '5 ticks', shortValue: '5t' },
    ])
  })
})

describe('dummy roster v2 in the panel and the HUD (PRD P3-S12; UX_SPEC §3.4 picker)', () => {
  const picks = bossDefenses(ALL_BOSSES)
  const gun = pick((w) => {
    const p = archetypeOf(w)
    return p?.archetype === 'bow-gun' && p.projectilesPerUse === 1 && p.spreadDegrees === 0 && !(w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers)
  })
  const sessionWith = (target: LabTarget) => {
    let seed = 9
    const created = createLabSession(gun, { seed: () => seed++, setup: LAB_SETUP, bossDefenses: picks, target })
    if (!created.ok) throw new Error('refused')
    return created.session
  }
  const panelFor = (target: LabTarget, extra: Record<string, unknown> = {}) => panel(sessionWith(target), { bossDefenses: picks, ...extra })

  it('six targets as labeled radios, in the spec’s order', () => {
    const html = panel(session(pierceStaff))
    const ids = [...html.matchAll(/<input [^>]*id="lab-target-(single|boss|moving|row|armored|debuff)"[^>]*>/g)].map((m) => m[1])
    expect(ids).toEqual([...LAB_TARGET_KINDS])
    for (const title of ['Infinite Dummy', 'Boss-Sized Dummy', 'Moving Dummy', 'Multiple Dummies', 'Armored Dummy', 'Debuff Dummy']) expect(html).toContain(title)
  })

  it('Boss-Sized: a size group of whole multiples (the chosen one checked), labeled test sizes, and a card with the engine’s box', () => {
    const html = panelFor({ kind: 'boss', scale: 3 })
    expect(inputTag(html, 'lab-target-boss')).toContain('checked=""')
    const sizes = [...html.matchAll(/<input [^>]*id="lab-target-scale-(\d)"[^>]*>/g)]
    expect(sizes.map((m) => Number(m[1]))).toEqual([...BOSS_SCALES])
    expect(sizes.filter((m) => m[0].includes('checked=""')).map((m) => m[1])).toEqual(['3'])
    expect(html).toContain('6 × 9 tiles, 3 times the Infinite Dummy')
    expect(html).toContain('Test sizes: the Infinite Dummy scaled up, not any boss’s hitbox.')
    expect(html).toContain('data-target-card="boss"')
    expect(html).toContain('Never dies or moves · defense 0 · 6 × 9 tiles')
  })

  it('Moving: the two paths and a speed slider (its value and unit) with the test-value and no-lead note; the card states the path', () => {
    const html = panelFor({ kind: 'moving', axis: 'vertical', speedTps: 7 })
    expect(inputTag(html, 'lab-target-axis-vertical')).toContain('checked=""')
    expect(inputTag(html, 'lab-target-axis-horizontal')).not.toContain('checked')
    expect(html).toContain('Away and back')
    expect(html).toContain('Up and back')
    expect(inputTag(html, MOVING_SPEED_SETTING_ID)).toMatch(/type="range" min="1" max="16" step="1"[^>]*value="7"/)
    expect(inputTag(html, MOVING_SPEED_SETTING_ID)).toContain('aria-valuetext="7 tiles/s"')
    expect(html).toContain('data-target-speed="7"')
    expect(html).toContain('Test values, not any enemy’s speed or path.')
    expect(html).toContain('without leading it')
    expect(html).toContain('data-target-card="moving"')
    expect(html).toContain('Never dies · defense 0 · 2 × 3 tiles')
    expect(html).toContain(`Starts ${RANGED_TARGET_X_TILES} tiles in front of you; rises 5 tiles and comes back down at 7 tiles/s`)
    expect(panelFor({ kind: 'moving', axis: 'horizontal', speedTps: 4 })).toContain(`travels to ${RANGED_TARGET_X_TILES + 8} tiles and back at 4 tiles/s`)
  })

  it('Armored: a defense slider (a test value) and the verified boss picks; a picked boss is named with its wiki link', () => {
    const own = panelFor({ kind: 'armored', defense: 20, bossId: null })
    expect(inputTag(own, ARMORED_DEFENSE_SETTING_ID)).toMatch(/type="range" min="0" max="100" step="1"[^>]*value="20"/)
    expect(own).toContain('A test value you choose, not any enemy’s stat')
    expect(own).toContain('Never dies or moves · defense 20 · 2 × 3 tiles')
    const rows = [...own.matchAll(/data-boss-defense="([a-z-]+)"/g)].map((m) => m[1])
    expect(rows).toEqual(picks.map((b) => b.id))
    expect([...own.matchAll(/<input [^>]*id="lab-target-boss-[^"]+"[^>]*>/g)].some((m) => m[0].includes('checked'))).toBe(false)
    expect(own).toContain('Normal-mode defense from the wiki’s NPC data')
    const plantera = picks.find((b) => b.id === 'plantera')!
    const named = panelFor({ kind: 'armored', defense: plantera.defense, bossId: plantera.id })
    expect(inputTag(named, `lab-target-boss-${plantera.id}`)).toContain('checked=""')
    expect(named).toContain('Plantera’s defense (its first form’s), as the wiki lists it.')
    expect(named).toContain(`href="${plantera.sourceUrl}"`)
    expect(named).toContain('defense 36 (Plantera’s)')
    // no boss records: the slider alone
    expect(panel(sessionWith({ kind: 'armored', defense: 20, bossId: null }))).not.toContain('data-lab-setting="target-boss-defense"')
  })

  it('Armored: the card and the slider help word the defense rule as the assumptions tip does (AMENDMENTS-016 B101c)', () => {
    expect(DEFENSE_RULE).toBe('Each hit is reduced by half the dummy defense (rounded down, never below 1).')
    expect(APPROXIMATIONS.defense.detail).toContain('Each hit is reduced by half the dummy defense, rounded down, never below 1')
    const own = panelFor({ kind: 'armored', defense: 20, bossId: null })
    expect(own).toContain('Adjustable defense: each hit is reduced by half the dummy defense (rounded down, never below 1)')
    expect(own).toContain(`A test value you choose, not any enemy’s stat — or pick a boss below. ${DEFENSE_RULE}`)
    const plantera = picks.find((b) => b.id === 'plantera')!
    expect(panelFor({ kind: 'armored', defense: plantera.defense, bossId: plantera.id })).toContain(`not its hitbox, attacks or phases. ${DEFENSE_RULE}`)
    for (const html of [own, panel(session(pierceStaff))]) {
      expect(html).not.toContain('loses half')
      expect(html).not.toContain('half of it')
    }
  })

  it('locked during a timed test: the roster’s own inputs are disabled too', () => {
    for (const target of [{ kind: 'boss', scale: 2 }, { kind: 'moving', axis: 'horizontal', speedTps: 4 }, { kind: 'armored', defense: 10, bossId: null }] as LabTarget[]) {
      const html = panelFor(target, { locked: true })
      const inputs = [...html.matchAll(/<input [^>]*id="lab-target-[^"]+"[^>]*>/g)]
      expect(inputs.length).toBeGreaterThan(LAB_TARGET_KINDS.length)
      for (const m of inputs) expect(m[0], target.kind).toContain('disabled=""')
    }
  })

  it('the test-settings heading no longer duplicates the side panel’s id (lab-settings-title)', () => {
    const html = panel(session(pierceStaff))
    expect(html).not.toContain('id="lab-settings-title"')
    expect(html).toContain('aria-labelledby="lab-test-settings-title"')
  })

  it('the Moving Dummy’s shots readout and results row; the announcer’s and the run line’s words', () => {
    const s = sessionWith({ kind: 'moving', axis: 'vertical', speedTps: 14 })
    hold(s, 300)
    const shots = s.getHud().shots!
    const html = render(createElement(ShotsCounter, { shots, compact: false }))
    expect(html).toContain(`data-stat="shots-missed">${shots.missed}<`)
    expect(html).toContain(`data-stat="shots-fired">${shots.fired}<`)
    expect(html).toContain('aria-label="Missed shots"')
    expect(html).toContain('pointer-events-none')
    expect(render(createElement(ShotsCounter, { shots: { noun: 'throw', fired: 3, missed: 1 }, compact: true }))).toContain('throws')
    s.startTimedTest(10)
    for (let i = 0; i < 600; i++) s.frame(1000 / 60)
    const result = s.getHud().timedTest.result!
    const props = { result, weaponName: gun.name, appliesDot: false, usesAmmo: true, assumptions: tips(assumptionsForEstimate(s.assumptions, 'timed-test-dps')), onRunAgain: () => {}, onReset: () => {}, compact: false }
    const summary = render(createElement(ResultsSummary, { ...props, shotNoun: 'shot', targetName: targetPhrase(s.getHud().target) }))
    expect(summary).toContain(`data-result="shots-missed">${result.projectilesMissed}<`)
    expect(summary).toContain(`data-result="shots-fired">${result.projectilesSpawned}<`)
    expect(summary).toContain('vs the Moving Dummy (up and back at 14 tiles/s)')
    expect(render(createElement(ResultsSummary, props))).not.toContain('data-result="shots-missed"')
    expect(targetAnnouncement({ kind: 'boss', scale: 4 })).toBe('Boss-Sized Dummy, 8 × 12 tiles — the stats start again from zero.')
    expect(targetAnnouncement({ kind: 'armored', defense: 36, bossId: 'plantera' }, 'Plantera')).toBe('Armored Dummy, defense 36 (Plantera’s) — the stats start again from zero.')
    expect(targetAnnouncement({ kind: 'moving', axis: 'horizontal', speedTps: 4 })).toBe('Moving Dummy, away and back at 4 tiles/s — the stats start again from zero.')
    expect(targetPhrase({ kind: 'armored', defense: 36, bossId: 'plantera' }, 'Plantera')).toBe('the Armored Dummy (defense 36, Plantera’s)')
    expect(targetPhrase({ kind: 'armored', defense: 20, bossId: null })).toBe('the Armored Dummy (defense 20)')
    expect(targetPhrase({ kind: 'row', count: 3 })).toBe('3 Infinite Dummies in a row')
    expect(targetPhrase(DEFAULT_LAB_TARGET)).toBe('the Infinite Dummy')
  })
})
