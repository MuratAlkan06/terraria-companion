/**
 * P3-S9 / P3-S10 HTML layer (SSR markup; the canvas is aria-hidden): the summons readout (count vs
 * slots, whip tags with their time left — icon AND words — and damage by source), the slot settings
 * and the minion loadout picker in the Target & settings panel, the summon controls copy, the timed
 * test's per-source rows, and the live readouts' summon wording. Real committed weapons, Lab setup.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { hasAssumptions, type Assumptions } from '../../../components/assumptions'
import type { Weapon } from '../../../data-access/types'
import { createLabSession, type LabSession, type LabSessionOptions } from '../../../lab/labSession'
import { labWeapons, loadoutChoices } from '../../../lab/labWeapons'
import { ALL_WEAPONS, LAB_SETUP } from '../../../lab/testing/labData'
import { DEFAULT_LAB_SETTINGS, type TimedTestResult } from '../../../sim'
import { summonFixture } from '../../../sim/testing/fixtures'
import type { LabSummonsHud } from '../../../lab/labSession'
import { AttackHint, EquippedBar, StatReadouts, SummonsPanel } from './Hud'
import { replacedAnnouncement, resetAnnouncement } from './settingsCopy'
import { MINION_SLOTS_SETTING, SENTRY_SLOTS_SETTING, TargetSettingsPanel, type SummonSettingsProps } from './TargetSettingsPanel'
import { ResultsSummary } from './TimedTest'
import { LIVE_DPS_SUMMON_LABEL, LIVE_DPS_SUMMON_SHORT } from './timedTestCopy'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const staves = loadoutChoices(list)
const staff = staves[0]
const whip = list.find((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'whip')!
const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const inputTag = (html: string, id: string) => new RegExp(`<input [^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? ''
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’')

function session(weapon: Weapon, options: LabSessionOptions = {}): LabSession {
  let seed = 31
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...options })
  if (!created.ok) throw new Error(`${weapon.name} refused`)
  return created.session
}
function hold(s: LabSession, ticks: number): void {
  s.press('key')
  for (let i = 0; i < ticks; i++) s.frame(1000 / 60)
  s.release('key')
}
function tips(all: LabSession['assumptions']): Assumptions {
  if (!hasAssumptions(all)) throw new Error('no assumptions')
  return all
}
const panel = (s: LabSession, summons: SummonSettingsProps) => {
  const dummies = s.sim.renderState().dummies
  return render(
    createElement(TargetSettingsPanel, {
      usesMana: false,
      dummy: dummies[0],
      dummies,
      settings: DEFAULT_LAB_SETTINGS,
      onSettingsChange: () => {},
      locked: false,
      verb: 'whip',
      summons,
    }),
  )
}

describe('summons readout (PRD P3-S9 AC1/AC3, P3-S10 AC1)', () => {
  it('a staff: how many are out against the slots, in words', () => {
    const s = session(staff)
    hold(s, 2)
    const hud = s.getHud()
    const html = render(createElement(SummonsPanel, { summons: hud.summons, tags: hud.tags, breakdown: hud.breakdown, whip: false, compact: false }))
    expect(html).toContain('data-summon-count="1"')
    expect(text(html)).toContain('Minions 1 · slots 1/1')
    // one wording for everyone: no hidden "slots used" beside a visible "slots" (design review nit)
    expect(text(html).match(/slots/g)).toHaveLength(1)
    expect(html).not.toContain('slots used')
    expect(html).not.toContain('data-whip-tags') // no whip, no tag row
  })

  it('a whip with the loadout: the tagged dummy with its time left (icon and words, never colour alone) and the damage split', () => {
    const s = session(whip, { loadout: staff, settings: { minionSlots: 2 } })
    hold(s, 40)
    for (let i = 0; i < 60; i++) s.frame(1000 / 60)
    const hud = s.getHud()
    for (const strip of [false, true]) {
      const html = render(createElement(SummonsPanel, { summons: hud.summons, tags: hud.tags, breakdown: hud.breakdown, whip: true, compact: strip, strip }))
      expect(html).toContain('data-whip-tags="1"')
      expect(text(html)).toMatch(/Tagged\s*#1\s*dummy 1 \d\.\ds left/) // visible "#1 3.0s", read as "dummy 1 3.0s left"
      expect(html).toContain('data-stat="weapon-damage"')
      expect(html).toContain('data-stat="summon-damage"')
      expect(html).toContain('data-stat="tag-bonus"')
      expect(html).toContain(`data-summon-count="2"`)
      expect(html).toContain(strip ? 'data-summons-panel="strip"' : 'data-summons-panel="column"')
    }
    // the column names the loadout; no tag yet reads "No dummy tagged"
    const fresh = session(whip, { loadout: staff }).getHud()
    const html = render(createElement(SummonsPanel, { summons: fresh.summons, tags: fresh.tags, breakdown: fresh.breakdown, whip: true, compact: false }))
    expect(text(html)).toContain(staff.name)
    expect(text(html)).toContain('No dummy tagged')
  })

  it('with Multiple Dummies it says which dummy the summons attack, in words beside an icon (design review M2)', () => {
    const base: LabSummonsHud = { source: 'weapon', kind: 'minion', count: 2, slotsUsed: 2, slots: 2, loadoutName: null, replaced: 0, targets: [3] }
    const panelFor = (summons: LabSummonsHud, multipleDummies: boolean, strip = false) =>
      render(createElement(SummonsPanel, { summons, tags: [], breakdown: null, whip: false, multipleDummies, compact: strip, strip }))
    for (const strip of [false, true]) {
      const html = panelFor(base, true, strip)
      expect(html).toContain('data-summon-attacking="3"')
      expect(text(html)).toMatch(/Attacking\s*#3\s*dummy 3/) // visible "Attacking #3", read "Attacking dummy 3"
      expect(html).toMatch(/<svg[^>]*lucide-crosshair/)
    }
    expect(text(panelFor({ ...base, targets: [1, 3] }, true))).toContain('dummies 1 and 3')
    // one dummy: nothing to tell apart; no summon out: nothing to say
    expect(panelFor(base, false)).not.toContain('data-summon-attacking')
    expect(panelFor({ ...base, count: 0, slotsUsed: 0, targets: [] }, true)).not.toContain('data-summon-attacking')
    // a sentry with no dummy in its range says so; a minion between targets says nothing
    expect(text(panelFor({ ...base, kind: 'sentry', targets: [] }, false))).toContain('No dummy in range')
    expect(panelFor({ ...base, targets: [] }, true)).not.toContain('data-summon-attacking')
  })

  it('the strip names the minions’ damage “Minions”, never the cryptic “Min” (design review M3)', () => {
    const s = session(whip, { loadout: staff })
    hold(s, 40)
    const hud = s.getHud()
    const html = render(createElement(SummonsPanel, { summons: hud.summons, tags: hud.tags, breakdown: hud.breakdown, whip: true, compact: true, strip: true }))
    expect(html).toMatch(/data-fact="summon-damage"><dt><span aria-hidden="true">Minions<\/span><span class="sr-only">Minion damage<\/span>/)
    expect(html).not.toContain('>Min<')
  })

  it('nothing for a weapon without summons or a whip', () => {
    const sword = list.find((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')!
    const hud = session(sword).getHud()
    expect(render(createElement(SummonsPanel, { summons: hud.summons, tags: hud.tags, breakdown: hud.breakdown, whip: false, compact: false }))).toBe('')
  })
})

describe('Target & settings: slots and the minion loadout (PRD P3-S9 AC1, P3-S10)', () => {
  it('a minion staff: minion slots 1–11 as labeled radios, 1 (the wiki default) checked; the summon controls copy', () => {
    const html = panel(session(staff), { kind: 'minion', loadout: null })
    for (let n = 1; n <= 11; n++) expect(inputTag(html, `${MINION_SLOTS_SETTING}-${n}`)).toMatch(/type="radio"/)
    expect(inputTag(html, `${MINION_SLOTS_SETTING}-1`)).toContain('checked')
    expect(inputTag(html, `${MINION_SLOTS_SETTING}-12`)).toBe('')
    expect(html).toContain('data-summon-hint="minion"')
    expect(text(html)).toContain('summon a minion there')
    expect(text(html)).toContain('Press Space to summon a minion beside you.')
    expect(html).toContain('https://terraria.wiki.gg/wiki/Minion-summoning_weapons')
  })

  it('a sentry staff: sentry slots 1–6; placing copy says it stays where you click', () => {
    const html = panel(session(summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', sentryRangeTiles: 10 })), { kind: 'sentry', loadout: null })
    expect(inputTag(html, `${SENTRY_SLOTS_SETTING}-6`)).toMatch(/type="radio"/)
    expect(inputTag(html, `${SENTRY_SLOTS_SETTING}-7`)).toBe('')
    expect(text(html)).toContain('place a sentry exactly there: it never moves')
    expect(text(html)).toContain('Press Space to place a sentry 2 tiles in front of you.')
  })

  it('a whip: the minion loadout — None (checked) and every minion staff the Lab equips — labeled a test setup; the tag rule in the controls', () => {
    const s = session(whip)
    const html = panel(s, { kind: null, loadout: { choices: staves, selectedId: null, onSelect: () => {}, sprites: null } })
    expect(html).toContain('Minion loadout (test setup)')
    expect(inputTag(html, 'lab-loadout-none')).toContain('checked')
    for (const w of staves) expect(inputTag(html, `lab-loadout-${w.id}`)).toMatch(/type="radio".*name="lab-loadout"/)
    expect(text(html)).toContain('In-game you summon them before switching to the whip')
    expect(html).toContain('data-steer-hint="whip"')
    expect(text(html)).toContain('tagged for 4 seconds')
    expect(text(html)).toContain('the minion loadout is cleared')
    const chosen = panel(s, { kind: null, loadout: { choices: staves, selectedId: staff.id, onSelect: () => {}, sprites: null } })
    expect(inputTag(chosen, `lab-loadout-${staff.id}`)).toContain('checked')
  })

  it('a whip: the minion slots come before the long loadout list (on a phone they were buried under it)', () => {
    const html = panel(session(whip), { kind: null, loadout: { choices: staves, selectedId: null, onSelect: () => {}, sprites: null } })
    const slots = html.indexOf('data-lab-setting="minion-slots"')
    const loadoutList = html.indexOf('data-lab-setting="loadout"')
    expect(slots).toBeGreaterThan(0)
    expect(loadoutList).toBeGreaterThan(slots)
    // the slots' help stays with the slots
    expect(html.indexOf(`id="${MINION_SLOTS_SETTING}-help"`)).toBeLessThan(loadoutList)
  })
})

describe('live readouts and hints with summons', () => {
  it('a staff reads Summon hits/sec and Est. DPS (since summoning), each tip led by its own rule', () => {
    const s = session(staff)
    hold(s, 2)
    const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: tips(s.assumptions), compact: false }))
    expect(text(html)).toContain('Summon hits/sec')
    expect(text(html)).toContain('Est. DPS (since summoning)')
    expect(html).toContain('show the assumptions behind the summon hits per second')
    expect(html).toContain('show the assumptions behind the estimated DPS since summoning')
  })

  it('the compact HUD’s short label never reads summons-only: the figure is everything dealt (design review High)', () => {
    expect(LIVE_DPS_SUMMON_SHORT).toBe('Est. DPS (+summons)')
    expect(LIVE_DPS_SUMMON_SHORT).not.toMatch(/\(summons\)/)
    for (const s of [session(staff), session(whip, { loadout: staff })]) {
      hold(s, 40)
      const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: tips(s.assumptions), compact: true }))
      expect(html).toContain(`<span aria-hidden="true">${LIVE_DPS_SUMMON_SHORT}</span><span class="sr-only">${LIVE_DPS_SUMMON_LABEL}</span>`)
      expect(text(html)).not.toMatch(/DPS \(summons\)/)
    }
  })

  it('a mixed run (whip + minion loadout): the per-hit label says whose hit it was — in the label, so the number’s cell never grows', () => {
    const s = session(whip, { loadout: staff })
    const seen = new Set<string>()
    s.press('key')
    for (let i = 0; i < 300; i++) {
      s.frame(1000 / 60)
      const hud = s.getHud()
      if (!hud.lastHit) continue
      const compact = i % 2 === 0
      const html = render(createElement(StatReadouts, { hud, assumptions: tips(s.assumptions), compact }))
      const word = hud.lastHit.source === 'weapon' ? 'whip' : hud.lastHit.source
      const shown = `${word.charAt(0).toUpperCase()}${word.slice(1)} hit`
      expect(html).toContain(`<span aria-hidden="true">${shown}</span><span class="sr-only">Per hit, from the ${word}</span>`)
      // the value: the number (and a crit badge), nothing else
      expect(html).toMatch(new RegExp(`data-stat="per-hit" data-source="${hud.lastHit.source}"[^>]*>\\d+(<span[^>]*>Crit</span>)?</span>`))
      seen.add(word)
    }
    s.release('key')
    expect(seen).toEqual(new Set(['whip', 'minion']))
    // a staff alone (every hit is its summons') or before any hit: plain "Per hit"
    const alone = session(staff)
    hold(alone, 120)
    const html = render(createElement(StatReadouts, { hud: alone.getHud(), assumptions: tips(alone.assumptions), compact: false }))
    expect(html).toContain('>Per hit</dt>')
    expect(html).not.toContain('data-source=')
    expect(render(createElement(StatReadouts, { hud: session(whip, { loadout: staff }).getHud(), assumptions: tips(s.assumptions), compact: false }))).toContain('>Per hit</dt>')
  })

  it('the EquippedBar shows a staff’s slots and attack interval, a whip’s range and tag', () => {
    const staffBar = text(render(createElement(EquippedBar, { weapon: staff, sprites: null, hud: session(staff).getHud(), compact: false })))
    expect(staffBar).toMatch(/Slots1 minion slot/)
    expect(staffBar).toMatch(/Attacks every\d+ ticks/)
    const whipBar = text(render(createElement(EquippedBar, { weapon: whip, sprites: null, hud: session(whip).getHud(), compact: false })))
    expect(whipBar).toMatch(/Range\d+ tiles/)
    expect(whipBar).toMatch(/Tag\+\d+ damage/)
  })

  it('first-use hint: click (or tap) to summon or place — not “hold”', () => {
    expect(text(render(createElement(AttackHint, { touch: false, verb: 'summon', summon: 'minion' })))).toBe('Click the arena to summon a minion there · or press Space')
    expect(text(render(createElement(AttackHint, { touch: true, verb: 'summon', summon: 'sentry' })))).toBe('Tap the arena to place a sentry there')
    expect(text(render(createElement(AttackHint, { touch: false, verb: 'whip' })))).toBe('Press and hold to whip · or hold Space')
  })
})

describe('announcements (aria-live, polite)', () => {
  it('a summon replacing the oldest is said, with the slots (design review M1)', () => {
    expect(replacedAnnouncement('minion', 1, '2', 2)).toBe('Oldest minion replaced — 2/2 slots.')
    expect(replacedAnnouncement('sentry', 1, '1', 1)).toBe('Oldest sentry replaced — 1/1 slots.')
    expect(replacedAnnouncement('minion', 2, '3', 3)).toBe('2 oldest minions replaced — 3/3 slots.')
  })

  it('Reset says what it cleared: a staff’s summons, or the whip’s minion loadout', () => {
    const base = { weaponName: 'Flinx Staff', stopped: false, summonsCleared: false, loadoutCleared: false }
    expect(resetAnnouncement(base)).toBe('Reset: stats, target and default settings restored — Flinx Staff is ready.')
    expect(resetAnnouncement({ ...base, summonsCleared: true })).toBe('Reset: stats, target and default settings restored, summons cleared — Flinx Staff is ready.')
    expect(resetAnnouncement({ ...base, weaponName: 'Leather Whip', summonsCleared: true, loadoutCleared: true, stopped: true })).toBe(
      'Test stopped. Reset: stats, target and default settings restored, minion loadout cleared — Leather Whip is ready.',
    )
  })
})

describe('timed-test results by source (PRD P3-S9 AC3, P3-S10 AC3)', () => {
  const base = (breakdown: TimedTestResult['breakdown']): TimedTestResult => ({
    durationSec: 10,
    ticks: 600,
    seed: 1,
    estimatedDps: 100,
    totalDamage: breakdown.weaponDamage + breakdown.summonDamage + breakdown.dotDamage,
    directDamage: breakdown.weaponDamage + breakdown.summonDamage,
    dotDamage: breakdown.dotDamage,
    hits: breakdown.weaponHits + breakdown.summonHits,
    crits: 3,
    uses: 20,
    projectilesSpawned: 0,
    projectilesMissed: 0,
    attacksPerSec: 2,
    ammoConsumed: 0,
    consumablesUsed: 0,
    explosions: 0,
    manaConsumed: 0,
    debuffsApplied: 0,
    dpsSeries: [],
    perDummy: {},
    breakdown,
    eventDigest: 'x',
  })
  const props = { weaponName: 'Kaleidoscope', appliesDot: false, assumptions: tips(session(whip).assumptions), onRunAgain: () => {}, onReset: () => {}, compact: false }

  it('whip + minions: the total split into whip damage, minion damage and the tag’s share of it (and DoT when any)', () => {
    const result = base({ weaponDamage: 3293, weaponHits: 20, summonDamage: 4959, summonHits: 42, tagBonusDamage: 1177, dotDamage: 12 })
    const html = render(createElement(ResultsSummary, { ...props, result, sources: { weapon: 'Whip', summons: 'Minion' } }))
    expect(text(html)).toContain('Whip damage3,293')
    expect(text(html)).toContain('Minion damage4,959')
    expect(text(html)).toContain('+1,177')
    expect(html).toContain('data-result="dot"')
  })

  it('a staff: only its summons (no weapon row, no tag row); without summons the result is unchanged', () => {
    const result = base({ weaponDamage: 0, weaponHits: 0, summonDamage: 1518, summonHits: 42, tagBonusDamage: 0, dotDamage: 0 })
    const html = render(createElement(ResultsSummary, { ...props, result, sources: { weapon: null, summons: 'Minion' } }))
    expect(text(html)).toContain('Minion damage1,518')
    expect(html).not.toContain('data-result="weapon-damage"')
    expect(html).not.toContain('data-result="tag-bonus"')
    expect(render(createElement(ResultsSummary, { ...props, result }))).not.toContain('data-result="summon-damage"')
  })
})
