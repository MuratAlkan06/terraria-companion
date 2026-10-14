/**
 * P3-S3 HTML layer (SSR markup; the canvas is decorative): the timed-test control and its countdown,
 * the results summary (est. DPS with its EstimateLabel, hits, totals, crits; DoT rows only for a
 * DoT weapon; Run again / Reset), the aria-live completion line, the DPS graph strip (the engine's
 * per-second numbers, labeled; open by default from tablet up), the config-lock notice, the single
 * Reset's label and the test settings it restores, and where keyboard focus goes as a test starts,
 * ends, runs again and resets. Results come from real headless runs of committed weapons.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { hasAssumptions, type Assumption } from '../../../components/assumptions'
import { AssumptionsTip } from '../../../components/EstimateLabel'
import type { Weapon } from '../../../data-access/types'
import weaponsJson from '../../../data/weapons.detail.json'
import { LAB_SETUP } from '../../../lab/testing/labData'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import { createLabSession, type LabGraphHud, type LabSession } from '../../../lab/labSession'
import { defaultLabWeapon, labWeapons } from '../../../lab/labWeapons'
import { DEFAULT_LAB_SETTINGS, TICKS_PER_SECOND, type TimedTestResult } from '../../../sim'
import { DpsGraph } from './DpsGraph'
import { DPS_GRAPH_SECONDS, dpsGraphModel, dpsGraphSummary, graphOpenByDefault, niceCeiling } from './dpsGraphModel'
import { HudControls, RESET_LABEL, StatReadouts } from './Hud'
import { RESULTS_TITLE_ID, startTestId, TIMED_TEST_STATUS_ID } from './labIds'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { LockNotice, ResultsSummary, TimedTestControl } from './TimedTest'
import { completionAnnouncement, LIVE_DPS_LABEL, lockReason, testDpsLabel } from './timedTestCopy'
import { focusIsLost, timedTestFocusTarget } from './timedTestFocus'

const all = weaponsJson as Weapon[]
const sword = defaultLabWeapon(labWeapons(all, LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee'))!
const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))

function session(weapon: Weapon = sword, seed = 5): LabSession {
  let s = seed
  const created = createLabSession(weapon, { seed: () => s++ })
  if (!created.ok) throw new Error('refused')
  return created.session
}

function finishedRun(durationSec: 10 | 30 = 10): { s: LabSession; result: TimedTestResult } {
  const s = session()
  s.startTimedTest(durationSec)
  while (s.getHud().timedTest.status === 'running') s.frame(1000 / 60)
  return { s, result: s.getHud().timedTest.result! }
}

function tip(s: LabSession, estimate: 'estimated-dps' | 'timed-test-dps' | 'dps-graph') {
  const list = assumptionsForEstimate(s.assumptions, estimate)
  if (!hasAssumptions(list)) throw new Error('no assumptions')
  return list
}

const NO_PARITY_CLAIM = /in-game DPS|exact DPS|matches the game|same as (in )?the game|real DPS|true DPS|guaranteed/i

describe('TimedTestControl (10 s / 30 s, countdown)', () => {
  const idle = { status: 'idle', durationSec: null, remainingSec: 0, progress: 0, result: null } as const

  for (const compact of [false, true]) {
    it(`${compact ? 'compact' : 'full'}: two labeled start buttons (>= 44px), named for screen readers`, () => {
      const html = render(createElement(TimedTestControl, { test: idle, onStart: () => {}, compact }))
      expect([...html.matchAll(/data-start-test="(\d+)"/g)].map((m) => m[1])).toEqual(['10', '30'])
      expect(html).toContain('Start a 10-second test')
      expect(html).toContain('Start a 30-second test')
      expect(html).toContain('min-h-tap')
      expect(html).toContain('role="group" aria-label="Timed tests"')
    })
  }

  it('running: a timer with a countdown ring and the whole seconds left (counted down, never up)', () => {
    const s = session()
    s.startTimedTest(10)
    const seen: number[] = []
    for (let i = 0; i < 600; i++) {
      s.frame(1000 / 60)
      const test = s.getHud().timedTest
      if (test.status !== 'running') break
      const html = render(createElement(TimedTestControl, { test, onStart: () => {}, compact: false }))
      expect(html).toMatch(/^<div id="lab-timed-test-status" tabindex="-1" role="timer" aria-label="10-second test"/)
      expect(html).toContain('data-countdown-ring=')
      seen.push(Number(/data-test-left="(\d+)"/.exec(html)![1]))
    }
    expect(seen[0]).toBe(10)
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((v, i) => i === 0 || v <= seen[i - 1])).toBe(true)
  })
})

describe('ResultsSummary (P3-S3 AC3/AC4)', () => {
  const { s, result } = finishedRun()
  const props = { result, weaponName: sword.name, assumptions: tip(s, 'timed-test-dps'), onRunAgain: () => {}, onReset: () => {}, compact: false }
  const html = render(createElement(ResultsSummary, { ...props, appliesDot: false }))
  const value = (key: string) => new RegExp(`data-result="${key}"[^>]*>([^<]*)<`).exec(html)?.[1]

  it('names the test and shows est. DPS, total damage, hits and crits — the run’s own numbers', () => {
    expect(html).toContain('10-second test results')
    expect(value('dps')).toBe(result.estimatedDps.toFixed(1))
    expect(value('total')).toBe(result.totalDamage.toLocaleString('en-US'))
    expect(value('hits')).toBe(result.hits.toLocaleString('en-US'))
    expect(value('crits')).toBe(result.crits.toLocaleString('en-US'))
    expect(value('seed')).toBe(String(result.seed))
    expect(result.estimatedDps).toBeCloseTo(result.totalDamage / 10, 12)
  })

  it('est. DPS carries its EstimateLabel; the panel says approximate; no parity claim anywhere', () => {
    expect(html).toMatch(/data-result="dps"[^>]*>[^<]*<\/span>(<span aria-hidden="true"[^>]*>[^<]*<\/span>)?<\/span><button[^>]*data-estimate="estimated DPS over the 10-second test"[^>]*>est\./)
    expect(html).toContain('browser simulation, approximate values')
    expect(html).not.toMatch(NO_PARITY_CLAIM)
  })

  it('the two est. DPS figures are named by what they divide by: the test’s is never labeled like the live one', () => {
    expect(html).toContain(`>${testDpsLabel(10)}</dt>`)
    expect(testDpsLabel(10)).toBe('Est. DPS (over the 10s test)')
    expect(testDpsLabel(30)).toBe('Est. DPS (over the 30s test)')
    expect(LIVE_DPS_LABEL).toBe('Est. DPS (while attacking)')
    expect(html).not.toContain(LIVE_DPS_LABEL)
    const live = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: tip(s, 'estimated-dps'), compact: false }))
    expect(live).toContain(LIVE_DPS_LABEL)
    expect(live).not.toContain(testDpsLabel(10))
  })

  it('its AssumptionsTip leads with how the test measures DPS — the denominator first — then every assumption of the live estimate', () => {
    const list = tip(s, 'timed-test-dps')
    expect(list[0].id).toBe('timed-test')
    expect(list[0].title).toBe('Divided by the whole test')
    expect(list[0].detail).toMatch(/^Estimated DPS = total damage ÷ the test length/)
    expect(list.map((a) => a.id)).not.toContain('dps-while-attacking')
    expect(new Set(list.slice(1).map((a: Assumption) => a.id))).toEqual(new Set(s.assumptions.filter((a) => a.id !== 'dps-while-attacking').map((a) => a.id)))
    const tipHtml = render(createElement(AssumptionsTip, { assumptions: list, context: 'estimated DPS over the 10-second test' }))
    expect(tipHtml).toContain('exactly 600 or 1,800 ticks')
    expect(tipHtml).toContain('reproduces the result exactly')
    expect(tipHtml).not.toMatch(NO_PARITY_CLAIM)
  })

  it('DoT rows appear only when the equipped weapon applies damage over time', () => {
    expect(html).not.toContain('data-result="dot"')
    expect(html).not.toContain('DoT damage')
    const dot = render(createElement(ResultsSummary, { ...props, appliesDot: true, result: { ...result, dotDamage: 42, directDamage: result.totalDamage - 42 } }))
    expect(dot).toMatch(/data-result="dot"[^>]*>42</)
    expect(dot).toContain('Damage over time (DoT)')
    expect(dot).toContain('data-result="direct"')
  })

  it('offers Run again and Reset (real buttons); the count-up keeps the final width reserved and readable', () => {
    expect(html).toMatch(/<button[^>]*data-results-run-again=""[^>]*>.*?Run again<\/button>/)
    expect(html).toMatch(/<button[^>]*data-results-reset=""[^>]*>.*?Reset<\/button>/)
    // One accessible value (never aria-hidden, never sr-only twin): the final number, which reserves
    // the width and is only transparent while the aria-hidden count-up draws over it.
    expect(html).toMatch(/<span class="text-right \[grid-area:1\/1\] opacity-0" data-result="dps">[\d.]+<\/span><span aria-hidden="true"[^>]*data-result="dps-animated">/)
    expect(html.match(new RegExp(`>${result.estimatedDps.toFixed(1).replace('.', '\\.')}<`, 'g'))).toHaveLength(1)
    expect(html).not.toMatch(/sr-only" data-result="dps"|invisible/)
  })

  it('the completion announcement says the test, the estimate (labeled), hits and total', () => {
    expect(completionAnnouncement(result)).toBe(
      `10-second test complete. Estimated DPS ${result.estimatedDps.toFixed(1)}, labeled estimate. ${result.hits.toLocaleString('en-US')} hits, ${result.totalDamage.toLocaleString('en-US')} total damage.`,
    )
    expect(completionAnnouncement(finishedRun(30).result)).toMatch(/^30-second test complete\. Estimated DPS [\d.]+, labeled estimate\./)
  })
})

describe('DpsGraph (P3-S3 AC2): the engine’s per-second series, labeled, rolling', () => {
  function attacked(seconds: number): LabSession {
    const s = session()
    s.press('key')
    for (let i = 0; i < seconds * 60; i++) s.frame(1000 / 60)
    s.release('key')
    return s
  }

  it('bars are exactly the engine’s completed seconds, plus an outlined bar for the current second', () => {
    const s = attacked(4.5)
    const graph = s.getHud().graph
    const model = dpsGraphModel(graph)
    expect(model.bars.filter((b) => !b.partial).map((b) => b.damage)).toEqual(graph.series)
    expect(model.bars.at(-1)).toMatchObject({ partial: true, damage: graph.currentSecondDamage })
    const html = render(createElement(DpsGraph, { graph, assumptions: tip(s, 'dps-graph'), compact: false }))
    expect([...html.matchAll(/data-bar="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([...graph.series])
    expect(html).toContain('data-bar="partial"')
    expect(html).toMatch(/<svg aria-hidden="true"/)
    expect(html).toMatch(/data-estimate="damage per second graph"[^>]*>est\./)
    expect(html).toContain(`data-graph="peak">${Math.max(...graph.series, graph.currentSecondDamage).toLocaleString('en-US')}<`)
    expect(html).not.toMatch(NO_PARITY_CLAIM)
  })

  it('rolls: only the last 30 seconds are drawn, each still the engine’s number for that second', () => {
    const series = Array.from({ length: 45 }, (_, i) => i * 3)
    const graph: LabGraphHud = { series, startSecond: 0, currentSecondDamage: 7, elapsedTicks: 45 * TICKS_PER_SECOND + 20 }
    const model = dpsGraphModel(graph)
    expect(model.bars).toHaveLength(DPS_GRAPH_SECONDS)
    expect(model.bars.filter((b) => !b.partial).map((b) => b.damage)).toEqual(series.slice(-(DPS_GRAPH_SECONDS - 1)))
    expect(model.bars.at(-1)).toEqual({ second: 45, damage: 7, partial: true })
    expect(model.latest).toBe(series.at(-1))
    expect(model.scaleMax).toBe(niceCeiling(model.peak))
  })

  it('clears with the engine’s series on reset (the empty strip invites an attack)', () => {
    const s = attacked(3)
    s.reset()
    const graph = s.getHud().graph
    expect(dpsGraphModel(graph)).toMatchObject({ bars: [], peak: 0, latest: null })
    const html = render(createElement(DpsGraph, { graph, assumptions: tip(s, 'dps-graph'), compact: true }))
    expect(html).toContain('Attack to draw the graph')
    expect(html).not.toContain('data-bar=')
  })

  it('a nice axis ceiling: 1 / 2 / 5 × 10ⁿ', () => {
    expect([0, 1, 7, 12, 99, 101, 240].map(niceCeiling)).toEqual([0, 1, 10, 20, 100, 200, 500])
  })
})

describe('config lock, single Reset, test settings (P3-S2 AC3, UX_SPEC §5.7)', () => {
  it('the lock notice says why the panels are disabled and how to stop the test', () => {
    expect(lockReason(10)).toBe('Locked while the 10-second test runs. Reset stops it.')
    const html = render(createElement(LockNotice, { durationSec: 30 }))
    expect(html).toContain('Locked while the 30-second test runs. Reset stops it.')
    expect(html).toContain('data-lock-notice=""')
  })

  it('Reset is named for everything it restores; the Graph toggle reports its state', () => {
    for (const compact of [false, true]) {
      for (const graphOpen of [false, true]) {
        const html = render(createElement(HudControls, { onReset: () => {}, fullscreen: false, onToggleFullscreen: () => {}, compact, graphOpen, onToggleGraph: () => {}, graphId: 'g' }))
        expect(html.replace(/<[^>]+>/g, '')).toContain(compact ? RESET_LABEL : 'Reset the test, target and settings')
        expect(html).toMatch(new RegExp(`<button[^>]*aria-pressed="${graphOpen}"[^>]*data-lab-graph-toggle`))
      }
    }
  })

  it('the damage-variance setting is a labeled switch, on by default, disabled while locked', () => {
    const dummy = session().sim.renderState().dummies[0]
    const on = render(createElement(TargetSettingsPanel, { usesMana: false, dummy, settings: DEFAULT_LAB_SETTINGS, onSettingsChange: () => {}, locked: false }))
    expect(on).toMatch(/<input type="checkbox" role="switch" id="lab-setting-variance"[^>]*checked=""/)
    expect(on).toContain('Damage variance ±15%')
    expect(on).toContain('Reset restores the default settings')
    const locked = render(createElement(TargetSettingsPanel, { usesMana: false, dummy, settings: { ...DEFAULT_LAB_SETTINGS, damageVariance: false }, onSettingsChange: () => {}, locked: true }))
    expect(locked).toMatch(/<input type="checkbox" role="switch" id="lab-setting-variance"[^>]*disabled=""/)
    expect(locked).not.toMatch(/id="lab-setting-variance"[^>]*checked=""/)
  })

  it('live readouts during a run keep their EstimateLabels (attacks/sec and est. DPS)', () => {
    const s = session()
    s.startTimedTest(10)
    for (let i = 0; i < 200; i++) s.frame(1000 / 60)
    if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
    const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: s.assumptions, compact: false }))
    expect([...html.matchAll(/data-estimate="([^"]+)"/g)].map((m) => m[1])).toEqual(['attacks per second', 'estimated DPS while attacking'])
    expect(html).not.toMatch(NO_PARITY_CLAIM)
  })
})

describe('keyboard focus through a test’s lifecycle (design review H2)', () => {
  /** The HUD's test markup for the session's current state: the control, plus the results once finished. */
  function hudMarkup(s: LabSession): string {
    const test = s.getHud().timedTest
    const control = render(createElement(TimedTestControl, { test, onStart: () => {}, compact: false }))
    if (test.status !== 'finished' || !test.result) return control
    const results = render(
      createElement(ResultsSummary, { result: test.result, weaponName: sword.name, appliesDot: false, assumptions: tip(s, 'timed-test-dps'), onRunAgain: () => {}, onReset: () => {}, compact: false }),
    )
    return control + results
  }
  /** The element with `id` is in the markup and can take focus (a button, or tabindex −1 for a script). */
  function focusable(html: string, id: string): boolean {
    const tag = new RegExp(`<(\\w+) [^>]*id="${id}"[^>]*>`).exec(html)
    return tag !== null && (tag[1] === 'button' || /tabindex="-1"/.test(tag[0]))
  }
  const runToEnd = (s: LabSession) => {
    while (s.getHud().timedTest.status === 'running') s.frame(1000 / 60)
  }

  it('start → countdown, finish → results heading, Run again → countdown, Reset from the results → its start button', () => {
    const s = session()
    const idle = hudMarkup(s)
    for (const d of [10, 30] as const) expect(focusable(idle, startTestId(d))).toBe(true)

    // Start (the pressed button unmounts): focus moves to the countdown.
    s.startTimedTest(10)
    s.frame(1000 / 60)
    const started = timedTestFocusTarget({ kind: 'start' })
    expect(started).toBe(TIMED_TEST_STATUS_ID)
    expect(focusable(hudMarkup(s), started!)).toBe(true)
    expect(hudMarkup(s)).not.toContain(startTestId(10))

    // Finish (the countdown unmounts, focus is lost): focus moves to the results heading.
    runToEnd(s)
    const finished = timedTestFocusTarget({ kind: 'finish', focusLost: true })
    expect(finished).toBe(RESULTS_TITLE_ID)
    expect(focusable(hudMarkup(s), finished!)).toBe(true)
    expect(hudMarkup(s)).not.toContain(TIMED_TEST_STATUS_ID)
    // Focus the user moved elsewhere during the run stays there (UX_SPEC §9).
    expect(timedTestFocusTarget({ kind: 'finish', focusLost: false })).toBeNull()

    // Run again (the results unmount): back on the countdown, and on the results again after.
    expect(s.runAgain()).toBe(true)
    s.frame(1000 / 60)
    expect(focusable(hudMarkup(s), timedTestFocusTarget({ kind: 'run-again' })!)).toBe(true)
    runToEnd(s)
    expect(focusable(hudMarkup(s), timedTestFocusTarget({ kind: 'finish', focusLost: true })!)).toBe(true)

    // Reset from the results (they unmount): the start button of the test that just ran.
    s.reset()
    const reset = timedTestFocusTarget({ kind: 'results-reset', durationSec: 10 })
    expect(reset).toBe(startTestId(10))
    expect(focusable(hudMarkup(s), reset!)).toBe(true)
  })

  it('focus counts as lost only when it sits on <body> (its element was removed) or nowhere', () => {
    const body = {} as HTMLElement
    expect(focusIsLost({ body, activeElement: body })).toBe(true)
    expect(focusIsLost({ body, activeElement: null })).toBe(true)
    expect(focusIsLost({ body, activeElement: {} as Element })).toBe(false)
  })
})

describe('DPS graph visibility by layout (design review H3)', () => {
  it('open by default in every desktop three-column layout (≥ 1024, compact HUD included) and on tablets; phones keep it behind the Graph chip', () => {
    expect(graphOpenByDefault('desktop')).toBe(true)
    expect(graphOpenByDefault('tablet')).toBe(true)
    expect(graphOpenByDefault('phone')).toBe(false)
  })

  it('the graph in words says "Last second" for one bar, "Last n seconds" otherwise', () => {
    const base = { scaleMax: 10, peak: 7, latest: null, windowSeconds: DPS_GRAPH_SECONDS }
    expect(dpsGraphSummary({ ...base, bars: [{ second: 0, damage: 7, partial: true }] })).toBe('Last second: peak 7 damage in one second.')
    expect(dpsGraphSummary({ ...base, latest: 5, bars: [{ second: 0, damage: 5, partial: false }, { second: 1, damage: 7, partial: true }] })).toBe(
      'Last 2 seconds: peak 7 damage in one second, last full second 5.',
    )
    expect(dpsGraphSummary({ ...base, peak: 0, bars: [] })).toBe('No damage in the last 30 seconds.')
  })
})
