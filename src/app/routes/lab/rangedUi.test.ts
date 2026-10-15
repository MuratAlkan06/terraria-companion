/**
 * The Lab's HTML for projectile weapons (SSR markup; the canvas is aria-hidden): the contextual
 * ManaBar with the labeled B35 low-mana indicator (wiki-sourced) or the stop-at-zero notice — in the
 * card, or beside it as a callout on the compact HUD — the
 * amber "test mode" chip in the StatReadout cluster (UX_SPEC §5.7), the AmmoCounter, the ammo
 * picker (only compatible ammo: sprite, name, damage) and the results rows for ammo, mana and DoT.
 * Real committed data with the Lab's setup.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { hasAssumptions } from '../../../components/assumptions'
import type { Weapon } from '../../../data-access/types'
import { assumptionsForEstimate } from '../../../lab/labAssumptions'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import { ammoChoices, ammoClassName, RANGED_TARGET_X_TILES } from '../../../lab/labSetup'
import { attackVerb, labWeapons } from '../../../lab/labWeapons'
import { ALL_ITEMS, ALL_WEAPONS, LAB_SETUP } from '../../../lab/testing/labData'
import { APPROXIMATIONS, DEFAULT_LAB_SETTINGS, type LabSettings } from '../../../sim'
import { AmmoCounter, LOW_MANA_LABEL, LowManaCallout, ManaBar, OUT_OF_MANA_LABEL, OUT_OF_MANA_WAIT_LABEL, StatReadouts } from './Hud'
import { AMMO_EFFECTS_NOTE, ammoLoadedAnnouncement, manaSettingAnnouncement } from './settingsCopy'
import { TargetSettingsPanel } from './TargetSettingsPanel'
import { ResultsSummary } from './TimedTest'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const byName = (name: string) => list.find((w) => w.name === name)!
const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const FRAME_MS = 1000 / 60

function session(weapon: Weapon, settings?: Partial<LabSettings>): LabSession {
  let seed = 9
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...(settings ? { settings } : {}) })
  if (!created.ok) throw new Error('refused')
  return created.session
}

function hold(s: LabSession, seconds: number): void {
  s.press('key')
  for (let t = 0; t < seconds * 1000; t += FRAME_MS) s.frame(FRAME_MS)
  s.release('key')
}

const staff = list.find((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'magic-bolt')!
const bow = byName('Wooden Bow')

/** Text of an element's markup, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, '')
/** The low-mana notices in a ManaBar's markup (or a callout's): each one's kind, whether it is shown, and its words. */
function notices(html: string): { kind: string; shown: boolean; text: string }[] {
  const slot = /<div class="[^"]*" data-low-mana-slot=""(?: data-low-mana-notice="[^"]*")?>(.*)<\/div>(?:<\/section>)?$/.exec(html)?.[1] ?? ''
  return [...slot.matchAll(/<p class="([^"]*)" data-low-mana="([^"]+)" data-shown="(true|false)">(.*?)<\/p>/g)].map((m) => {
    expect(m[1].split(' ').includes('invisible')).toBe(m[3] === 'false')
    expect(m[1]).toContain('[grid-area:1/1]')
    return { kind: m[2], shown: m[3] === 'true', text: textOf(m[4]) }
  })
}

/** The four warning states of a mana weapon's HUD (none, slow cast, stop at zero waiting / stopped). */
function manaStates() {
  const base = session(staff).getHud().mana!
  return [
    { ...base, warning: false },
    { ...base, warning: true, policy: 'slow-cast' as const },
    { ...base, warning: true, policy: 'block' as const, regen: true },
    { ...base, warning: true, policy: 'block' as const, regen: false },
  ]
}

/** Markup with what may differ by state normalized away (visibility, the live tip's button, the described-by links). */
const layoutOf = (html: string) =>
  html
    .replace(/ data-low-mana-notice="[^"]*"/g, '')
    .replace(/ invisible|data-shown="(true|false)"/g, '')
    .replace(/ id="lab-mana-notice-[^"]*"| aria-describedby="lab-mana-notice-[^"]*"/g, '')
    .replace(/<button[^>]*>(.*?)<span class="sr-only"> — show the rule and its source<\/span><\/button>/, '<span>$1</span>')
    .replace(/<span class="inline-flex[^"]*">/, '<span>')
    .replace(/ bg-night-[46]00/, '')

describe('ManaBar (UX_SPEC §3.4, P3-S5 AC1–AC3)', () => {
  it('a meter of the engine’s pool with the cost per cast and live "Mana used"', () => {
    const s = session(staff)
    hold(s, 1)
    const hud = s.getHud()
    for (const compact of [false, true]) {
      const html = render(createElement(ManaBar, { mana: hud.mana!, manaConsumed: hud.manaConsumed, compact }))
      expect(html).toContain('role="meter"')
      expect(html).toContain(`aria-valuenow="${hud.mana!.current}"`)
      expect(html).toContain(`aria-valuemax="${hud.mana!.max}"`)
      expect(html).toMatch(new RegExp(`data-stat="mana-used"[^>]*>${hud.manaConsumed}<`))
      expect(html).toContain('Cost per cast')
      expect(html).toContain('data-low-mana-notice="none"')
      expect(notices(html).filter((n) => n.shown)).toEqual([])
    }
  })

  it('below the cost at the default: "Low mana: 40% speed (game behavior)", its tip carrying the wiki-sourced rule (B35)', () => {
    const s = session(staff, { maxMana: 20, manaRegen: 'none' })
    hold(s, 4)
    const hud = s.getHud()
    expect(hud.mana).toMatchObject({ low: true, warning: true, policy: 'slow-cast', slowCasting: true })
    const html = render(createElement(ManaBar, { mana: hud.mana!, manaConsumed: hud.manaConsumed, compact: false }))
    expect(LOW_MANA_LABEL).toBe('Low mana: 40% speed (game behavior)')
    expect(notices(html).filter((n) => n.shown)).toEqual([{ kind: 'slow-cast', shown: true, text: `${LOW_MANA_LABEL} — show the rule and its source` }])
    // The closing "(game behavior)" never breaks over two lines (design review nit).
    expect(html).toContain('<span class="whitespace-nowrap">(game behavior)</span>')
    // The indicator is a toggletip trigger (button) — its content is the engine's registry entry.
    expect(html).toMatch(/<button[^>]*data-low-mana-tip=""[^>]*>/)
    expect(APPROXIMATIONS['insufficient-mana'].sourceUrl).toBe('https://terraria.wiki.gg/wiki/Mana')
    expect(APPROXIMATIONS['insufficient-mana'].detail).toMatch(/40% attack speed, as the game does since 1\.4\.5\.7/)
  })

  it('"stop at zero": the notice names the test setting — "casting waits for mana" while mana regenerates, "casting stopped" without', () => {
    for (const [manaRegen, label, kind] of [
      ['none', OUT_OF_MANA_LABEL, 'stop'],
      ['wiki-1.4.5.7', OUT_OF_MANA_WAIT_LABEL, 'stop-wait'],
    ] as const) {
      const s = session(staff, { maxMana: 20, manaRegen, insufficientMana: 'block' })
      s.press('key')
      for (let i = 0; i < 4 * 60; i++) s.frame(FRAME_MS)
      expect(s.getHud().mana).toMatchObject({ warning: true, policy: 'block', regen: manaRegen !== 'none' })
      const html = render(createElement(ManaBar, { mana: s.getHud().mana!, manaConsumed: s.getHud().manaConsumed, compact: true }))
      expect(notices(html).filter((n) => n.shown)).toEqual([{ kind, shown: true, text: label }])
      expect(html).toContain('<span class="whitespace-nowrap">(test setting)</span>')
    }
    // Named as the setting is ("Stop at zero"), labeled a test setting, in the setting's own words.
    expect(OUT_OF_MANA_WAIT_LABEL).toBe('Stop at zero: casting waits for mana (test setting)')
    expect(OUT_OF_MANA_LABEL).toBe('Stop at zero: casting stopped (test setting)')
  })

  it('the notice’s room is always laid out: every notice in one cell, in every state — so the HUD never changes height (design review B1)', () => {
    const layouts = new Set<string>()
    const shown: string[] = []
    for (const mana of manaStates()) {
      for (const compact of [false, true]) {
        const html = render(createElement(ManaBar, { mana, manaConsumed: 0, compact }))
        const all = notices(html)
        // The same three notices, the same words, stacked in the same cell — only their visibility differs.
        expect(all.map((n) => [n.kind, n.text.replace(' — show the rule and its source', '')])).toEqual([
          ['slow-cast', LOW_MANA_LABEL],
          ['stop-wait', OUT_OF_MANA_WAIT_LABEL],
          ['stop', OUT_OF_MANA_LABEL],
        ])
        expect(all.filter((n) => n.shown).length).toBeLessThanOrEqual(1)
        if (compact) shown.push(all.find((n) => n.shown)?.kind ?? 'none')
        // Normalize what may differ by state — the rest of the markup is identical.
        layouts.add(`${compact}:${layoutOf(html)}`)
      }
    }
    expect(shown).toEqual(['none', 'slow-cast', 'stop-wait', 'stop'])
    expect(layouts.size).toBe(2) // one markup per layout (full / compact), whatever the warning state
  })

  it('compact HUD: the notice leaves the card for a callout beside it — same notices, same always-laid-out room, pointing at the ManaBar, never widening its column (2× phone camera)', () => {
    const cards = new Set<string>()
    const callouts = new Set<string>()
    const shown: string[] = []
    for (const mana of manaStates()) {
      // The card keeps no notice room of its own…
      const card = render(createElement(ManaBar, { mana, manaConsumed: 0, compact: true, inlineNotice: false }))
      expect(card).not.toContain('data-low-mana-slot')
      cards.add(layoutOf(card.replace(/ bg-night-[46]00/, '')))
      // …the callout carries it: the same three notices in one cell, the shown one named on the slot.
      const html = render(createElement(LowManaCallout, { mana }))
      const all = notices(html)
      expect(all.map((n) => [n.kind, n.text.replace(' — show the rule and its source', '')])).toEqual([
        ['slow-cast', LOW_MANA_LABEL],
        ['stop-wait', OUT_OF_MANA_WAIT_LABEL],
        ['stop', OUT_OF_MANA_LABEL],
      ])
      const kind = all.find((n) => n.shown)?.kind ?? 'none'
      shown.push(kind)
      expect(html).toMatch(new RegExp(`^<div class="[^"]*" data-low-mana-slot="" data-low-mana-notice="${kind}">`))
      // As wide as the stats box above it, never wider: it has no say in the column's width.
      expect(/^<div class="([^"]*)"/.exec(html)?.[1].split(' ')).toEqual(expect.arrayContaining(['w-0', 'min-w-full']))
      // Every notice points at the ManaBar (a pixel arrowhead out of its left edge), framed in gold on the HUD surface.
      expect(html.match(/data-callout-pointer=""/g)).toHaveLength(3)
      expect(html.match(/border-gold-600[^"]*bg-night-950\/95|bg-night-950\/95[^"]*border-gold-600/g)?.length).toBeGreaterThanOrEqual(3)
      // The meter is described by the notice on show, wherever it sits.
      expect(card.includes('aria-describedby="lab-mana-notice-'), kind).toBe(kind !== 'none')
      if (kind !== 'none') {
        expect(card).toContain(`aria-describedby="lab-mana-notice-${kind}"`)
        expect(html).toContain(`id="lab-mana-notice-${kind}"`)
      }
      callouts.add(layoutOf(html))
    }
    expect(shown).toEqual(['none', 'slow-cast', 'stop-wait', 'stop'])
    expect(cards.size).toBe(1)
    expect(callouts.size).toBe(1) // one markup whatever the warning state: the HUD row never changes height
  })
})

describe('"ignore mana (test mode)": a persistent amber chip in the StatReadout cluster (UX_SPEC §5.7)', () => {
  it('shows exactly while the setting is on, for a weapon that uses mana', () => {
    for (const ignoreMana of [false, true]) {
      const s = session(staff, { ignoreMana })
      hold(s, 1)
      if (!hasAssumptions(s.assumptions)) throw new Error('no assumptions')
      const html = render(createElement(StatReadouts, { hud: s.getHud(), assumptions: s.assumptions, compact: false }))
      expect(html.includes('data-test-mode-chip'), String(ignoreMana)).toBe(ignoreMana)
      if (ignoreMana) {
        expect(html).toContain('Test mode: ignoring mana')
        // Amber and filled (never the outlined "est." chip), first in the cluster.
        expect(html).toMatch(/<section aria-label="Live stats"[^>]*><p class="[^"]*bg-gold-500[^"]*"[^>]*data-test-mode-chip=""/)
      }
    }
  })
})

describe('ammo (P3-S4 AC2/AC3): the counter and the picker', () => {
  it('the AmmoCounter names the loaded ammo with its damage and counts "Ammo used" live', () => {
    const s = session(bow)
    hold(s, 2)
    const html = render(createElement(AmmoCounter, { ammo: s.ammo!, sprites: null, used: s.getHud().ammoConsumed, compact: false }))
    expect(html).toContain(s.ammo!.name)
    // "+5 dmg" is one unbreakable unit; the separator stays with the name (design review nit: "+8 / dmg").
    expect(html).toContain(`${s.ammo!.name}<span class="font-normal text-fg-muted"> · <span class="whitespace-nowrap">+${s.ammo!.ammoStats!.damage} dmg</span></span>`)
    expect(s.getHud().ammoConsumed).toBeGreaterThan(0)
    expect(html).toMatch(new RegExp(`data-stat="ammo-used"[^>]*>${s.getHud().ammoConsumed}<`))
  })

  it('special ammo effects are disclosed: the picker help and the est. DPS tip say only damage and speed are used (design review H2)', () => {
    expect(AMMO_EFFECTS_NOTE).toBe('The Lab uses only each ammo’s damage and speed: special effects — homing, splitting, explosions, debuffs, burning — are not modeled.')
    for (const weapon of [bow, byName('Minishark')]) {
      const choices = ammoChoices(weapon, LAB_SETUP)!
      const html = render(
        createElement(TargetSettingsPanel, {
          usesMana: false,
          dummy: session(weapon).sim.renderState().dummies[0],
          settings: DEFAULT_LAB_SETTINGS,
          onSettingsChange: () => {},
          locked: false,
          ammo: { choices, selectedId: choices.defaultAmmo!.id, onSelect: () => {}, sprites: null },
        }),
      )
      expect(/<p id="lab-ammo-help"[^>]*>(.*?)<\/p>/.exec(html)?.[1]).toContain(`<span data-ammo-effects-note="">${AMMO_EFFECTS_NOTE}</span>`)
      // The same words head the bow's ammo line in every DPS tip; never in the attack-rate tip.
      const s = session(weapon)
      for (const estimate of ['estimated-dps', 'timed-test-dps', 'dps-graph'] as const) {
        expect(assumptionsForEstimate(s.assumptions, estimate).find((a) => a.id === 'ammo-effects')?.detail, estimate).toBe(AMMO_EFFECTS_NOTE)
      }
      expect(assumptionsForEstimate(s.assumptions, 'attacks-per-sec').map((a) => a.id)).not.toContain('ammo-effects')
    }
    // Magic weapons fire no ammo: no ammo line.
    expect(session(staff).assumptions.map((a) => a.id)).not.toContain('ammo-effects')
  })

  it('every ammo row shows its speed multiplier — ×1 included — so arrows and bullets read alike (design review nit)', () => {
    for (const weapon of [bow, byName('Minishark')]) {
      const choices = ammoChoices(weapon, LAB_SETUP)!
      const html = render(
        createElement(TargetSettingsPanel, {
          usesMana: false,
          dummy: session(weapon).sim.renderState().dummies[0],
          settings: DEFAULT_LAB_SETTINGS,
          onSettingsChange: () => {},
          locked: false,
          ammo: { choices, selectedId: choices.defaultAmmo!.id, onSelect: () => {}, sprites: null },
        }),
      )
      const speeds = [...html.matchAll(/data-ammo-speed="([\d.]+)">(?: · )?speed ×([\d.]+)</g)].map((m) => [Number(m[1]), Number(m[2])])
      expect(speeds).toEqual(choices.usable.map((item) => [item.ammoStats!.velocityMultiplier ?? 1, item.ammoStats!.velocityMultiplier ?? 1]))
    }
  })

  it('the picker lists only the compatible ammo — sprite, name, damage — the loaded one checked', () => {
    const choices = ammoChoices(bow, LAB_SETUP)!
    const loaded = choices.usable.at(-1)!
    const dummy = session(bow).sim.renderState().dummies[0]
    const html = render(
      createElement(TargetSettingsPanel, {
        usesMana: false,
        dummy,
        settings: DEFAULT_LAB_SETTINGS,
        onSettingsChange: () => {},
        locked: false,
        verb: attackVerb('bow-gun'),
        ammo: { choices, selectedId: loaded.id, onSelect: () => {}, sprites: null },
      }),
    )
    const options = [...html.matchAll(/data-ammo-option="(\d+)"/g)].map((m) => Number(m[1]))
    expect(options).toEqual(choices.usable.map((i) => i.id))
    const otherClass = ALL_ITEMS.filter((i) => i.ammoStats && i.ammoStats.ammoClass !== choices.ammoClass)
    for (const item of otherClass) expect(options).not.toContain(item.id)
    for (const item of choices.usable) {
      expect(html).toContain(`>${item.name.replace(/'/g, '&#x27;')}<`)
      expect(html).toContain(`data-ammo-damage="${item.ammoStats!.damage}"`)
    }
    expect(/<input type="radio" id="lab-ammo-(\d+)"[^>]*checked=""/.exec(html)?.[1]).toBe(String(loaded.id))
    expect(html).toContain(`Only ammo of the ${ammoClassName(choices)} type fits this weapon`)
    expect(html).toContain('Wooden Arrow is loaded first: the basic ammo its type is named after')
    // The ranged target's distance is stated.
    expect(html).toContain(`Centre ${RANGED_TARGET_X_TILES} tiles in front of you`)
    expect(html).toContain('Hold Space to shoot at the dummy')
  })
})

describe('ResultsSummary rows for projectile weapons', () => {
  function finished(weapon: Weapon, settings?: Partial<LabSettings>) {
    const s = session(weapon, settings)
    s.startTimedTest(10)
    for (let i = 0; i < 700; i++) s.frame(FRAME_MS)
    const assumptions = assumptionsForEstimate(s.assumptions, 'timed-test-dps')
    if (!hasAssumptions(assumptions)) throw new Error('no assumptions')
    return { s, result: s.getHud().timedTest.result!, assumptions }
  }
  const base = { onRunAgain: () => {}, onReset: () => {}, compact: false }

  it('a gun’s test counts the ammo it used', () => {
    const { result, assumptions } = finished(byName('Minishark'))
    const html = render(createElement(ResultsSummary, { ...base, result, assumptions, weaponName: 'Minishark', appliesDot: false, usesAmmo: true }))
    expect(result.ammoConsumed).toBeGreaterThan(0)
    expect(html).toMatch(new RegExp(`data-result="ammo"[^>]*>${result.ammoConsumed.toLocaleString('en-US')}<`))
    expect(html).not.toContain('data-result="mana"')
  })

  it('Frost Staff: the direct / DoT split and the mana used', () => {
    const { result, assumptions } = finished(byName('Frost Staff'))
    const html = render(createElement(ResultsSummary, { ...base, result, assumptions, weaponName: 'Frost Staff', appliesDot: true, usesMana: true }))
    expect(result.dotDamage).toBeGreaterThan(0)
    expect(html).toMatch(new RegExp(`data-result="dot"[^>]*>${result.dotDamage.toLocaleString('en-US')}<`))
    expect(html).toMatch(new RegExp(`data-result="direct"[^>]*>${result.directDamage.toLocaleString('en-US')}<`))
    // The two parts sit nested under "Total damage" (indented on a rule), right after it (design review nit).
    const labels = [...html.matchAll(/<dt class="([^"]*)"[^>]*>(?:<span aria-hidden="true">)?([^<]+)/g)].map((m) => [m[2], m[1].includes('border-l-2') && m[1].includes('pl-2.5')])
    const total = labels.findIndex(([label]) => label === 'Total damage')
    expect(labels.slice(total, total + 3)).toEqual([
      ['Total damage', false],
      ['Direct damage', true],
      ['DoT damage', true],
    ])
    expect(html).toMatch(new RegExp(`data-result="mana"[^>]*>${result.manaConsumed.toLocaleString('en-US')}<`))
    expect(html).not.toContain('data-result="ammo"')
  })

  it('the est. DPS tips of projectile weapons state the ranged target distance as a Lab choice', () => {
    const { s } = finished(bow)
    const ids = s.assumptions.map((a) => a.id)
    expect(ids[0]).toBe('target-distance')
    expect(s.assumptions[0].detail).toMatch(/Lab choice/)
    // Never on the attack-rate tip (distance doesn't change how often a weapon attacks).
    expect(assumptionsForEstimate(s.assumptions, 'attacks-per-sec').map((a) => a.id)).not.toContain('target-distance')
  })
})

describe('mana settings restart the stats, said like an ammo switch (design review M6)', () => {
  it('the announcer names the change and says the stats start again — in the ammo switch’s words', () => {
    expect(ammoLoadedAnnouncement('Wooden Arrow')).toBe('Wooden Arrow loaded — the stats start again from zero.')
    expect(manaSettingAnnouncement({ insufficientMana: 'block' })).toBe('Stop at zero — the stats start again from zero.')
    expect(manaSettingAnnouncement({ insufficientMana: 'slow-cast' })).toBe('Keep casting at 40% attack speed — the stats start again from zero.')
    expect(manaSettingAnnouncement({ ignoreMana: true })).toBe('Ignore mana (test mode) on — the stats start again from zero.')
    expect(manaSettingAnnouncement({ manaRegen: 'none' })).toBe('Mana regeneration off — the stats start again from zero.')
    expect(manaSettingAnnouncement({ maxMana: 240 })).toBe('Max mana 240 — the stats start again from zero.')
  })

  it('the mana section says so, and its slider is the brand’s square pixel slider (no round thumb)', () => {
    const html = render(
      createElement(TargetSettingsPanel, { usesMana: true, dummy: session(staff).sim.renderState().dummies[0], settings: DEFAULT_LAB_SETTINGS, onSettingsChange: () => {}, locked: false }),
    )
    expect(html).toMatch(/data-mana-restart-note="">.*Changing a mana setting restarts the stats, with a full pool\./)
    const slider = (/<input id="lab-setting-max-mana"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '').replace(/&amp;/g, '&')
    expect(slider).toContain('appearance-none')
    for (const engine of ['webkit-slider-thumb', 'moz-range-thumb']) expect(slider).toContain(`[&::-${engine}]:rounded-none`)
    expect(slider).not.toMatch(/\baccent-/)
  })
})
