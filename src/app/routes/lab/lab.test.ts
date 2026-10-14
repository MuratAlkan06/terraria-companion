/**
 * Weapon Lab HTML layer (SSR markup; the PixiJS canvas is decorative and aria-hidden): the
 * permanent disclaimer (AC1), the HUD's live numbers with their EstimateLabels (AC3, UX_SPEC §8),
 * crits marked by text not colour alone (AC5, §9), the in-Lab browser's rows (P3-S2: every weapon,
 * simulated vs not marked by badge) and picker intent, the LimitationCard deep-link fallback, and
 * the weapon page's SendToLabButton entry point.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AssumptionsTip } from '../../../components/EstimateLabel'
import { hasAssumptions } from '../../../components/assumptions'
import { SendToLabButton } from '../../../components/SendToLabButton'
import type { Weapon } from '../../../data-access/types'
import weaponsJson from '../../../data/weapons.detail.json'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import { createLabSession, RATE_WINDOW_ATTACKS, type LabSession } from '../../../lab/labSession'
import { LAB_SETUP } from '../../../lab/testing/labData'
import { APPROXIMATIONS, DEFAULT_LAB_SETTINGS } from '../../../sim'
import {
  defaultLabWeapon,
  inGameDescription,
  labScopeNouns,
  labStatus,
  labWeapons,
  notSimulatedReason,
  resolveLabSelection,
  UNASSIGNED_LIMITATION_PLAIN,
} from '../../../lab/labWeapons'
import { WeaponDetailView } from '../db/weapons/WeaponDetailView'
import { EquippedBar, HudControls, StatReadouts } from './Hud'
import { LimitationCard } from './LimitationCard'
import { PickerIntent, type PickerAction } from './pickerIntent'
import { SIM_DISCLAIMER, SIM_DISCLAIMER_SHORT, SimDisclaimerBar } from './SimDisclaimerBar'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { PickerRow } from './WeaponPicker'
import { browserRows, INITIAL_BROWSER_STATE } from './browserModel'
import { LabBrowser } from './LabBrowser'
import { LIVE_DPS_LABEL, LIVE_DPS_SHORT } from './timedTestCopy'

const all = weaponsJson as Weapon[]
const byId = new Map(all.map((w) => [w.id, w]))
const list = labWeapons(all, LAB_SETUP)
/** The starter weapon the Lab falls back to (whatever archetype the data makes weakest). */
const fallback = defaultLabWeapon(list)!
/** A starter sword, for swing-specific checks. */
const sword = defaultLabWeapon(list.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee'))!
const SETTINGS = { settings: DEFAULT_LAB_SETTINGS, onSettingsChange: () => {}, locked: false }

const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))

function session(weapon: Weapon, seed = 3): LabSession {
  const created = createLabSession(weapon, { seed: () => seed, setup: LAB_SETUP })
  if (!created.ok) throw new Error('refused')
  return created.session
}

/** Swings until a hit matching `crit` lands. */
function hitUntil(s: LabSession, crit: boolean): void {
  s.press('key')
  for (let i = 0; i < 20_000; i++) {
    s.frame(1000 / 60)
    if (s.getHud().lastHit?.crit === crit) return s.release('key')
  }
  throw new Error('no such hit')
}

describe('SimDisclaimerBar (AC1, UX_SPEC §5.5)', () => {
  it('states the exact copy, permanently: a note with nothing to dismiss it', () => {
    expect(SIM_DISCLAIMER).toBe('Browser simulation — values are approximations, not Terraria engine output.')
    const html = render(createElement(SimDisclaimerBar))
    expect(html).toContain(SIM_DISCLAIMER)
    expect(html).toMatch(/^<div role="note" aria-label="Simulation disclaimer"/)
    expect(html).not.toMatch(/<button|dismiss|close/i)
  })

  it('phones show a one-line version with the same meaning; screen readers always get the exact copy (§3.4)', () => {
    const html = render(createElement(SimDisclaimerBar))
    expect(SIM_DISCLAIMER_SHORT.length).toBeLessThan(SIM_DISCLAIMER.length)
    for (const part of [/browser sim/i, /approximat/i, /not Terraria’s engine/]) expect(SIM_DISCLAIMER_SHORT).toMatch(part)
    expect(html).toContain(`<span aria-hidden="true" class="md:hidden">${SIM_DISCLAIMER_SHORT}</span>`)
    expect(html).toContain(`<span class="max-md:sr-only">${SIM_DISCLAIMER}</span>`)
  })
})

describe('HUD (AC3 live stats, §8 estimates)', () => {
  for (const compact of [false, true]) {
    it(`${compact ? 'compact' : 'full'}: per-hit, total, hits, attacks/sec and est. DPS, each estimate with an EstimateLabel`, () => {
      const s = session(sword)
      hitUntil(s, false)
      const hud = s.getHud()
      if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
      const html = render(createElement(StatReadouts, { hud, assumptions: s.assumptions, compact }))
      const stat = (name: string) => new RegExp(`data-stat="${name}"[^>]*>([^<]*)<`).exec(html)?.[1]
      expect(stat('per-hit')).toBe(String(hud.lastHit!.amount))
      expect(stat('total')).toBe(hud.totalDamage.toLocaleString('en-US'))
      expect(stat('hits')).toBe(String(hud.hits))
      expect(stat('attacks-per-sec')).toBe(hud.attacksPerSec.toFixed(2))
      expect(stat('dps')).toBe(hud.estimatedDps.toFixed(1))
      // Derived numbers (and only those) carry the "est." chip, right after the number.
      expect([...html.matchAll(/data-estimate="([^"]+)"/g)].map((m) => m[1])).toEqual(['attacks per second', 'estimated DPS while attacking'])
      expect(html).toMatch(/data-stat="dps"[^>]*>[^<]*<\/span><button[^>]*data-estimate="estimated DPS while attacking"[^>]*>est\./)
      // Full labels are always available to screen readers, even when abbreviated on screen.
      for (const label of ['Per hit', 'Total damage', 'Hits', 'Attacks/sec', LIVE_DPS_LABEL]) expect(html).toContain(label)
      // The live figure says what it divides by (it is not the timed test's figure).
      expect(html).toContain(compact ? `<span aria-hidden="true">${LIVE_DPS_SHORT}</span>` : `>${LIVE_DPS_LABEL}</dt>`)
    })
  }

  it('the est. DPS AssumptionsTip leads with what it divides by, then every other assumption (Lab modeling choices first), sourced where a rule came from the wiki', () => {
    const s = session(sword)
    const dps = assumptionsForEstimate(s.assumptions, 'estimated-dps')
    if (!hasAssumptions(dps)) throw new Error('no assumptions')
    const html = render(createElement(AssumptionsTip, { assumptions: dps, context: 'estimated DPS while attacking' }))
    const ids = [...html.matchAll(/data-assumption="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['dps-while-attacking', ...s.assumptions.map((a) => a.id).filter((id) => id !== 'dps-while-attacking')])
    expect(dps[0]).toMatchObject({ title: 'Divided by the time spent attacking' })
    expect(dps[0].detail).toMatch(/^Estimated DPS = total damage ÷ the time spent in whole attacks/)
    expect(dps[1].id).toBe('swing-reach-arc')
    expect(dps[1].detail).toMatch(/Lab modeling choices, not game data\.$/)
    expect(html.match(/terraria\.wiki\.gg/g)?.length).toBeGreaterThanOrEqual(s.assumptions.filter((a) => a.sourceUrl).length)
  })

  it('the attacks/sec AssumptionsTip leads with how it is measured, then only what decides the attack rate (design review M5)', () => {
    for (const w of [sword, ...list.slice(0, 5)]) {
      const s = session(w)
      const rate = assumptionsForEstimate(s.assumptions, 'attacks-per-sec')
      if (!hasAssumptions(rate)) throw new Error('no cadence assumptions')
      const ids = rate.map((a) => a.id)
      // Counted from the latest attacks the engine made (design review P3-S4/S5 H3).
      expect(ids[0]).toBe('attack-rate')
      expect(rate[0].detail).toMatch(new RegExp(`^Attacks/sec = the latest ${RATE_WINDOW_ATTACKS} attacks ÷ the time they took`))
      expect(ids).toContain('cadence')
      expect(ids).toContain('fixed-tick')
      for (const unrelated of ['swing-reach-arc', 'dps-while-attacking', 'crit-base', 'defense', 'damage-variance', 'swing-geometry', 'dummy-hitbox', 'target-distance', 'ammo-effects']) {
        expect(ids, w.name).not.toContain(unrelated)
      }
      // The rest: the full list's order (a subset, never re-ordered).
      expect(ids.slice(1)).toEqual(s.assumptions.map((a) => a.id).filter((id) => ids.includes(id)))
      // The measurement rule is the attack rate's alone: no DPS tip carries it.
      for (const estimate of ['estimated-dps', 'timed-test-dps', 'dps-graph'] as const) expect(assumptionsForEstimate(s.assumptions, estimate).map((a) => a.id)).not.toContain('attack-rate')
    }
  })

  it('a yoyo’s readout is Hits/sec (it is one attack while held out), its tip led by how hits/sec is counted', () => {
    const yoyo = list
      .filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'returning' && w.labBehavior.params.variant === 'yoyo' && !w.labBehavior.modifiers)
      .sort((a, b) => (a.damage ?? 0) - (b.damage ?? 0) || a.id - b.id)[0]
    const s = session(yoyo)
    s.press('key')
    for (let i = 0; i < 240; i++) s.frame(1000 / 60)
    const hud = s.getHud()
    expect(hud.rateReadout).toBe('hits')
    if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
    for (const compact of [false, true]) {
      const html = render(createElement(StatReadouts, { hud, assumptions: s.assumptions, compact }))
      const stat = (name: string) => new RegExp(`data-stat="${name}"[^>]*>([^<]*)<`).exec(html)?.[1]
      expect(stat('hits-per-sec')).toBe(hud.hitsPerSec.toFixed(2))
      expect(Number(stat('hits-per-sec'))).toBeGreaterThan(4)
      expect(html).not.toContain('data-stat="attacks-per-sec"')
      expect(html).toContain('Hits/sec')
      expect(html).not.toContain('Attacks/sec')
      if (compact) expect(html).toContain('<span aria-hidden="true">Hits/s</span>')
      expect([...html.matchAll(/data-estimate="([^"]+)"/g)].map((m) => m[1])).toEqual(['hits per second', 'estimated DPS while attacking'])
    }
    const tip = assumptionsForEstimate(s.assumptions, 'hits-per-sec')
    expect(tip.map((a) => a.id).slice(0, 1)).toEqual(['hit-rate'])
    expect(tip[0].detail).toMatch(/^A yoyo stays out — one long attack — .*Hits\/sec = hits ÷ the time spent attacking/)
    // what decides the hit rate: how the time out is counted and the yoyo's re-hit interval
    expect(tip.map((a) => a.id)).toEqual(expect.arrayContaining(['attack-until-back', 'yoyo-control']))
    expect(tip.map((a) => a.id)).not.toContain('attack-rate')
    expect(s.assumptions.find((a) => a.id === 'attack-until-back')?.detail).toContain('for a yoyo the Lab shows hits per second rather than attacks per second')
  })

  it('the attacks/sec tip shows the engine registry’s attack-rate rule verbatim, in plain words (no game-internal names)', () => {
    for (const w of [sword, ...list.slice(0, 5)]) {
      const rate = assumptionsForEstimate(session(w).assumptions, 'attacks-per-sec')
      if (!hasAssumptions(rate)) throw new Error('no cadence assumptions')
      expect(rate.find((a) => a.id === 'cadence'), w.name).toEqual(APPROXIMATIONS.cadence)
      const html = render(createElement(AssumptionsTip, { assumptions: rate, context: 'attacks per second' }))
      expect(html, w.name).toContain('Attack rate = 60 ÷ use time')
      expect(html, w.name).toContain('how long the attack animation lasts')
      expect(html, w.name).not.toMatch(/useAnimation|useTime/i)
    }
  })

  it('the est. DPS tip labels a formula thrust reach as modeled, and cites a wiki-stated one instead (AMENDMENTS-012 B56)', () => {
    const tip = (name: string) => {
      const w = list.find((x) => x.name === name)!
      const dps = assumptionsForEstimate(session(w).assumptions, 'estimated-dps')
      if (!hasAssumptions(dps)) throw new Error('no assumptions')
      return render(createElement(AssumptionsTip, { assumptions: dps, context: 'estimated DPS' }))
    }
    const glaive = tip('Adamantite Glaive')
    expect(glaive).not.toMatch(/no thrust reach|Thrust reach is modeled/)
    expect(glaive).toContain('maximum range of approximately 11.03 tiles')
    expect(glaive).toContain('href="https://terraria.wiki.gg/wiki/Adamantite_Glaive"')
    const shortsword = tip('Iron Shortsword')
    expect(shortsword).toContain('Thrust reach is modeled')
    expect(shortsword).toMatch(/no thrust reach for this weapon/)
    expect(shortsword).not.toContain('maximum range of approximately')
  })

  it('a crit is marked with the word "Crit" next to the per-hit number (not colour alone)', () => {
    const s = session([...list].sort((a, b) => (b.critPct ?? 0) - (a.critPct ?? 0))[0], 11)
    hitUntil(s, true)
    if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
    const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: s.assumptions, compact: false }))
    expect(html).toMatch(/data-stat="per-hit"[^>]*>\d+<span[^>]*>Crit<\/span>/)
  })

  it('before any hit, per-hit reads "no hits yet" to screen readers (never a bare dash)', () => {
    const s = session(sword)
    if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
    expect(render(createElement(StatReadouts, { hud: s.getHud(), assumptions: s.assumptions, compact: true }))).toContain('no hits yet')
  })

  it('EquippedBar always names the weapon with its base stats', () => {
    const s = session(sword)
    for (const compact of [false, true]) {
      const html = render(createElement(EquippedBar, { weapon: sword, sprites: null, hud: s.getHud(), compact }))
      expect(html).toContain(sword.name)
      expect(html).toContain('Equipped: ')
      for (const label of ['Damage', 'Use time', 'Crit']) expect(html).toContain(label)
      expect(html).toContain(`${s.summary.critChancePct}%`)
    }
  })

  it('long names wrap over lines (no one-line truncation) and carry the full name as a title (M3)', () => {
    const longest = [...list].sort((a, b) => b.name.length - a.name.length)[0]
    for (const compact of [false, true]) {
      const html = render(createElement(EquippedBar, { weapon: longest, sprites: null, hud: session(longest).getHud(), compact }))
      const name = /<p class="([^"]*)" title="([^"]*)"><span class="sr-only">Equipped: <\/span>/.exec(html)
      expect(name?.[1]).toContain(compact ? 'line-clamp-3' : 'line-clamp-2')
      expect(name?.[1]).not.toMatch(/\btruncate\b/)
      expect(name?.[2]).toBe(longest.name)
    }
  })

  it('Reset and Fullscreen are labelled buttons at every size', () => {
    for (const compact of [false, true]) {
      for (const fullscreen of [false, true]) {
        const html = render(createElement(HudControls, { onReset: () => {}, fullscreen, onToggleFullscreen: () => {}, compact }))
        expect(html).toMatch(/<button[^>]*data-lab-reset[^>]*>.*(Reset)/s)
        expect(html).toContain(fullscreen ? 'Exit fullscreen' : 'Fullscreen')
        expect(html).toContain('min-h-tap')
      }
    }
  })

  it('the target panel describes the sim’s own dummy (size and defense from the engine)', () => {
    const dummy = session(sword).sim.renderState().dummies[0]
    const html = render(createElement(TargetSettingsPanel, { usesMana: false, dummy, ...SETTINGS }))
    expect(html).toContain('Infinite Dummy')
    expect(html).toContain(`defense ${dummy.defense} · ${dummy.width} × ${dummy.height} tiles`)
  })

  it('the low-mana setting (with its wiki source) shows only for a weapon that uses mana — none of the Lab’s swords do', () => {
    const dummy = session(sword).sim.renderState().dummies[0]
    const swordList = list.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')
    expect(swordList.every((w) => session(w).summary.manaCostPerUse === 0)).toBe(true)
    const swords = render(createElement(TargetSettingsPanel, { usesMana: false, dummy, ...SETTINGS }))
    expect(swords).not.toContain('Low-mana casting')
    expect(swords).not.toContain('data-lab-setting="low-mana"')
    expect(swords).not.toContain('Ignore mana')
    const mana = render(createElement(TargetSettingsPanel, { usesMana: true, dummy, ...SETTINGS }))
    expect(mana).toContain('Low-mana casting')
    expect(mana).toContain('40% attack speed')
    expect(mana).toContain('href="https://terraria.wiki.gg/wiki/Mana"')
  })

  it('mana settings (P3-S5): max mana, the B35 default (game behavior) vs the labeled stop-at-zero setting, regen, and the labeled test mode', () => {
    const dummy = session(sword).sim.renderState().dummies[0]
    const html = render(createElement(TargetSettingsPanel, { usesMana: true, dummy, ...SETTINGS }))
    // Max mana: a labeled slider showing the current capacity.
    expect(html).toMatch(/<input id="lab-setting-max-mana" type="range" min="20" max="400" step="20"[^>]*value="200"/)
    expect(html).toContain('data-max-mana="200"')
    // Low-mana casting: two labeled choices, the default (slow cast) checked and called game behavior.
    const policy = (value: string) => new RegExp(`<input type="radio" id="lab-low-mana-${value}"[^>]*>`).exec(html)?.[0] ?? ''
    expect(policy('slow-cast')).toContain('checked=""')
    expect(policy('block')).not.toContain('checked=""')
    expect(html).toContain('Keep casting at 40% attack speed')
    expect(html).toContain('Game behavior since 1.4.5.7 · default')
    expect(html).toContain('Stop at zero')
    expect(html).toContain('Test setting: casting waits until mana covers the cost')
    // Ignore mana: a labeled switch (role="switch") called a test mode, off by default.
    expect(html).toMatch(/<input type="checkbox" role="switch" id="lab-setting-ignore-mana"(?![^>]*checked)[^>]*>/)
    expect(html).toContain('Ignore mana (test mode)')
    expect(html).toContain('A test mode, not game behavior')
    expect(html).toMatch(/<input type="checkbox" role="switch" id="lab-setting-mana-regen"[^>]*checked=""/)
    // Choosing "stop at zero" checks it.
    const block = render(createElement(TargetSettingsPanel, { usesMana: true, dummy, ...SETTINGS, settings: { ...DEFAULT_LAB_SETTINGS, insufficientMana: 'block' as const } }))
    expect(/<input type="radio" id="lab-low-mana-block"[^>]*>/.exec(block)?.[0]).toContain('checked=""')
  })
})

describe('in-Lab browser rows (P3-S2 AC1/AC2: every weapon selectable, simulated vs not marked)', () => {
  const rows = browserRows(all, LAB_SETUP)

  it('the browser intro states what the Lab simulates now — no forward promise ("so far")', () => {
    const html = render(
      createElement(LabBrowser, { rows, state: INITIAL_BROWSER_STATE, onStateChange: () => {}, selectedId: fallback.id, equippedId: fallback.id, sprites: null, onSelect: () => {}, name: 'p' }),
    )
    const intro = /<p id="p-scope"[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? ''
    expect(intro).toContain(`(the Lab simulates ${labScopeNouns()})`)
    expect(intro).not.toMatch(/so far|\byet\b/)
  })
  const renderRow = (row: (typeof rows)[number], extra: Partial<Parameters<typeof PickerRow>[0]> = {}) =>
    render(
      createElement(PickerRow, {
        row,
        index: 0,
        total: rows.length,
        name: 'p',
        checked: false,
        equipped: false,
        sprites: null,
        intent: new PickerIntent(),
        onSelect: () => {},
        ...extra,
      }),
    )
  const radio = (html: string) => /<input type="radio"[^>]*>/.exec(html)?.[0] ?? ''

  it('a simulated row: a radio with its "n of N" position, the name, base damage and a "Simulated" badge (icon + word)', () => {
    const row = rows.find((r) => r.simulated)!
    const html = renderRow(row, { index: 4, checked: true, equipped: true })
    expect(radio(html)).toContain(`id="p-${row.weapon.id}"`)
    expect(radio(html)).toContain('aria-posinset="5"')
    expect(radio(html)).toContain(`aria-setsize="${rows.length}"`)
    expect(radio(html)).toContain('checked=""')
    expect(html).toContain(`>${row.weapon.name}<`)
    expect(html).toMatch(/data-sim-badge="simulated"[^>]*><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Simulated<\/span>/)
    expect(html).toContain('>Equipped<')
    expect(html).toContain('data-lab-row="simulated"')
  })

  it('a not-simulated row is just as selectable (choosing it shows its card), marked "Not simulated" with a dashed frame + icon', () => {
    const row = rows.find((r) => !r.simulated)!
    const html = renderRow(row, { checked: true })
    expect(radio(html)).not.toMatch(/disabled/)
    expect(html).toMatch(/data-sim-badge="not-simulated"[^>]*>.*?Not simulated<\/span>/)
    expect(html).toContain('border-dashed')
    // Checked but not equipped: "Shown" (its card is on show), never "Equipped".
    expect(html).toContain('>Shown<')
    expect(html).not.toContain('>Equipped<')
  })

  it('unverified damage reads "Unknown" (never blank or 0)', () => {
    const row = rows.find((r) => r.weapon.damage === undefined)!
    expect(renderRow(row)).toContain('data-unknown-field="damage"')
  })

  it('rarity text never sits on a light fill (contrast rule): checked and unchecked rows use night-800 surfaces', () => {
    const row = rows[0]
    for (const checked of [false, true]) expect(renderRow(row, { checked })).not.toContain('bg-night-700')
  })
})

describe('weapon picker intent (radio semantics kept from P3-S1)', () => {
  // The browser's native event order for each way of choosing a row (WCAG 3.2.2: browsing with
  // arrow keys must not close the phone sheet; a deliberate pick does). `up` carries whether the
  // focused radio is checked at keyup (arrow keys check as they move, so it usually is).
  describe('arrow keys browse; click, tap, Space and Enter pick (the sheet closes only on a pick)', () => {
    type Step = readonly ['down' | 'up', string, boolean?] | readonly ['pointer' | 'click']
    const run = (steps: readonly Step[]) => {
      const intent = new PickerIntent()
      const commits: number[] = []
      steps.forEach((step, i) => {
        let action: PickerAction = null
        if (step[0] === 'down') action = intent.keyDown(step[1])
        else if (step[0] === 'up') action = intent.keyUp(step[1], step[2] ?? true)
        else if (step[0] === 'pointer') intent.pointerDown()
        else action = intent.click()
        if (action === 'commit') commits.push(i)
      })
      return commits
    }
    const arrow = (key: string): Step[] => [['down', key], ['click'], ['up', key]]

    it('ArrowDown ×3 (each move fires a click on the newly checked radio) never commits', () => {
      expect(run([...arrow('ArrowDown'), ...arrow('ArrowDown'), ...arrow('ArrowDown')])).toEqual([])
      for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowRight']) expect(run(arrow(key)), key).toEqual([])
      // A held arrow key: repeated keydowns, each with its move, one keyup.
      expect(run([['down', 'ArrowDown'], ['click'], ['down', 'ArrowDown'], ['click'], ['down', 'ArrowDown'], ['click'], ['up', 'ArrowDown']])).toEqual([])
    })

    it('a click or tap on a row commits — the equipped row too, and right after browsing with arrows', () => {
      expect(run([['pointer'], ['click']])).toEqual([1])
      expect(run([...arrow('ArrowDown'), ['pointer'], ['click']])).toEqual([4])
      // A lost keyup (window blur mid-press) doesn't swallow the next tap.
      expect(run([['down', 'ArrowDown'], ['click'], ['pointer'], ['click']])).toEqual([3])
    })

    it('Enter commits on keydown', () => {
      expect(run([...arrow('ArrowDown'), ['down', 'Enter']])).toEqual([3])
      expect(run([['down', 'Enter']])).toEqual([0])
    })

    it('Space commits on release: on the checked radio at keyup (no click follows), else with the click that checks it', () => {
      expect(run([...arrow('ArrowDown'), ['down', ' '], ['up', ' ', true]])).toEqual([4])
      expect(run([['down', ' '], ['up', ' ', false], ['click']])).toEqual([2])
      // Space pressed while an arrow is still held is a pick too.
      expect(run([['down', 'ArrowDown'], ['click'], ['down', ' '], ['up', ' ', true]])).toEqual([3])
    })

    it('Tab, Escape and other keys never commit', () => {
      expect(run([['down', 'Tab'], ['up', 'Tab'], ['down', 'Escape'], ['up', 'Escape'], ['down', 'Home'], ['up', 'Home']])).toEqual([])
    })
  })
})

describe('LimitationCard (deep-link fallback, UX_SPEC §8 anatomy)', () => {
  it('names the weapon, says what it does in-game (sourced) and why it isn’t simulated, and links to its page', () => {
    const refused = all.find((w) => labStatus(w, LAB_SETUP).kind === 'not-simulable')!
    const selection = resolveLabSelection(String(refused.id), byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain(refused.name)
    expect(html).toContain('Not simulated in the Lab')
    expect(html).toContain('What it does in-game')
    expect(html).toContain('Why it isn’t simulated')
    expect(html).toContain(`href="/weapons/${refused.id}"`)
    expect(html).toContain('Open weapon page')
    expect(html).toContain('Back to weapons')
    expect(html).toContain(`${selection.weapon.name}</span> is equipped instead`)
  })

  it('launchers: the regenerated data says plainly where the explosion comes from — no pipeline terms (design review P3-S4/S5 M5)', () => {
    const launchers = all.filter((w) => w.tags.includes('launchers') && w.labBehavior.kind === 'limitation' && w.ammoClass !== undefined)
    expect(launchers.map((w) => w.name)).toEqual(expect.arrayContaining(['Rocket Launcher', 'Grenade Launcher', 'Stynger', 'Nail Gun']))
    for (const w of all) {
      if (w.labBehavior.kind === 'limitation') expect(w.labBehavior.reason, w.name).not.toMatch(/explosive parameters|carry no ammunition/)
    }
    const rocket = byId.get(all.find((w) => w.name === 'Rocket Launcher')!.id)!
    expect(rocket.labBehavior).toMatchObject({ reason: "Launchers get their explosion from the rocket ammo, which the Lab doesn't model." })
    const selection = resolveLabSelection(String(rocket.id), byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('Launchers get their explosion from the rocket ammo, which the Lab doesn&#x27;t model.')
    const nailGun = all.find((w) => w.name === 'Nail Gun')!
    expect(nailGun.labBehavior).toMatchObject({ reason: "This launcher gets its explosion from the ammo it fires, which the Lab doesn't model." })
  })

  it('Zenith: no verified description → says so plainly with the source link; the reason is plain language (M4)', () => {
    const zenith = all.find((w) => w.name === 'Zenith')!
    const selection = resolveLabSelection(String(zenith.id), byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('data-limitation-description="none"')
    expect(html).toContain('No verified description yet.')
    expect(html).toContain(`href="${zenith.wikiUrl}"`)
    // No forward promise (matches the weapon page's "Not simulated in the Weapon Lab").
    expect(html).toContain('This weapon’s unique behavior isn’t modeled in the Lab.')
    expect(html).not.toMatch(/modeled in the Lab yet/)
    expect(html).not.toMatch(/The wiki describes how|parameters have not been assigned/)
  })

  it('Volcano: no verified description, but its reason describes the behavior → the card points below instead of contradicting it', () => {
    const volcano = all.find((w) => w.name === 'Volcano')!
    expect(inGameDescription(volcano)).toBeUndefined()
    const selection = resolveLabSelection(String(volcano.id), byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('data-limitation-description="none"')
    expect(html).toContain('No separate description verified — see below.')
    expect(html).not.toContain('No verified description yet.')
    expect(html).toContain('Hits create an explosion that damages the target and two more enemies')
  })

  it('Light Disc: "Why it isn’t simulated" no longer repeats the facts "What it does in-game" already gives (design review P5-S1)', () => {
    const disc = all.find((w) => w.name === 'Light Disc')!
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    const runs = (s: string) => new Set(words(s).flatMap((_, i, ws) => (i + 4 <= ws.length ? [ws.slice(i, i + 4).join(' ')] : [])))
    const described = runs(inGameDescription(disc)!)
    const status = labStatus(disc, LAB_SETUP)
    expect(status.kind).toBe('not-simulable')
    const reason = notSimulatedReason(status as Exclude<typeof status, { kind: 'equippable' }>)
    expect([...runs(reason)].filter((run) => described.has(run))).toEqual([])
    expect(reason).toMatch(/\bmodeled\b/)
  })

  it('a weapon with verified tooltip text shows that text as "What it does in-game"', () => {
    const described = all.find((w) => labStatus(w, LAB_SETUP).kind !== 'equippable' && inGameDescription(w))!
    const selection = resolveLabSelection(String(described.id), byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('data-limitation-description="verified"')
    expect(html).toContain(inGameDescription(described)!.split('\n')[0].replace(/'/g, '&#x27;'))
  })

  it('no LimitationCard anywhere in the dataset shows pipeline jargon as its reason', () => {
    let plain = 0
    for (const w of all) {
      const status = labStatus(w, LAB_SETUP)
      if (status.kind === 'equippable') continue
      const reason = notSimulatedReason(status)
      expect(reason, w.name).not.toMatch(/parameters have not been assigned/)
      if (reason === UNASSIGNED_LIMITATION_PLAIN) plain++
    }
    expect(plain).toBeGreaterThan(0)
  })

  it('an unknown id gets a short notice, the fallback still equipped', () => {
    const selection = resolveLabSelection('999999', byId, list, LAB_SETUP)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('No weapon with that ID')
    expect(html).toContain('999999')
    expect(html).toContain(`${fallback.name} is equipped instead`)
  })
})

describe('weapon detail → Lab (SendToLabButton, UX_SPEC §3.3)', () => {
  const renderDetail = (weapon: Weapon) =>
    render(createElement(WeaponDetailView, { weapon, sprites: null, acquisitionData: undefined, acquisition: null }))

  it('simulable weapons get an active "Test in Weapon Lab" link to /lab?weapon=:id', () => {
    for (const w of list) {
      const html = render(createElement(SendToLabButton, { weapon: w }))
      const tag = /^<a [^>]*>/.exec(html)?.[0] ?? ''
      expect(tag).toContain(`href="/lab?weapon=${w.id}"`)
      expect(tag).toContain('data-send-to-lab=""')
      expect(tag).not.toMatch(/disabled/)
      expect(html).toMatch(/Test in Weapon Lab<\/a>$/)
    }
    const page = renderDetail(sword)
    expect(page).toContain(`href="/lab?weapon=${sword.id}"`)
    expect(page).toContain('Simulated in the Weapon Lab')
    expect(page).not.toContain('Not simulated in the Weapon Lab')
  })

  it('weapons the Lab can’t equip have no button (absent, never disabled) and say so — no "coming" promise', () => {
    const others = all.filter((w) => labStatus(w, LAB_SETUP).kind !== 'equippable')
    for (const w of others) expect(render(createElement(SendToLabButton, { weapon: w })), w.name).toBe('')
    const page = renderDetail(others[0])
    expect(page).not.toContain('/lab?weapon=')
    expect(page).toContain('Not simulated in the Weapon Lab')
    expect(page).not.toMatch(/simulation coming|Until then/)
  })
})
