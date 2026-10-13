/**
 * Weapon Lab HTML layer (SSR markup; the PixiJS canvas is decorative and aria-hidden): the
 * permanent disclaimer (AC1), the HUD's live numbers with their EstimateLabels (AC3, UX_SPEC §8),
 * crits marked by text not colour alone (AC5, §9), the minimal picker, the LimitationCard deep-link
 * fallback, and the weapon page's SendToLabButton entry point.
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
import { assumptionsForEstimate, labAssumptionsFor } from '../../../lab/labAssumptions'
import { createLabSession, type LabSession } from '../../../lab/labSession'
import { APPROXIMATIONS } from '../../../sim'
import {
  defaultLabWeapon,
  inGameDescription,
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
import { WeaponPicker } from './WeaponPicker'

const all = weaponsJson as Weapon[]
const byId = new Map(all.map((w) => [w.id, w]))
const list = labWeapons(all)
const sword = defaultLabWeapon(list)!

const render = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))

function session(weapon: Weapon, seed = 3): LabSession {
  const created = createLabSession(weapon, { seed: () => seed })
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
      expect([...html.matchAll(/data-estimate="([^"]+)"/g)].map((m) => m[1])).toEqual(['attacks per second', 'estimated DPS'])
      expect(html).toMatch(/data-stat="dps"[^>]*>[^<]*<\/span><button[^>]*data-estimate="estimated DPS"[^>]*>est\./)
      // Full labels are always available to screen readers, even when abbreviated on screen.
      for (const label of ['Per hit', 'Total damage', 'Hits', 'Attacks/sec', 'Est. DPS']) expect(html).toContain(label)
    })
  }

  it('the est. DPS AssumptionsTip lists every assumption (Lab modeling choices first), sourced where a rule came from the wiki', () => {
    const s = session(sword)
    const dps = assumptionsForEstimate(s.assumptions, 'estimated-dps')
    if (!hasAssumptions(dps)) throw new Error('no assumptions')
    const html = render(createElement(AssumptionsTip, { assumptions: dps, context: 'estimated DPS' }))
    expect([...html.matchAll(/data-assumption="([^"]+)"/g)].map((m) => m[1])).toEqual(s.assumptions.map((a) => a.id))
    expect(dps[0].id).toBe('swing-reach-arc')
    expect(dps[0].detail).toMatch(/Lab modeling choices, not game data\.$/)
    expect(html.match(/terraria\.wiki\.gg/g)?.length).toBeGreaterThanOrEqual(s.assumptions.filter((a) => a.sourceUrl).length)
  })

  it('the attacks/sec AssumptionsTip lists only what decides the attack rate (design review M5)', () => {
    for (const w of [sword, ...list.slice(0, 5)]) {
      const s = session(w)
      const rate = assumptionsForEstimate(s.assumptions, 'attacks-per-sec')
      if (!hasAssumptions(rate)) throw new Error('no cadence assumptions')
      const ids = rate.map((a) => a.id)
      expect(ids).toContain('cadence')
      expect(ids).toContain('fixed-tick')
      for (const unrelated of ['swing-reach-arc', 'dps-while-attacking', 'crit-base', 'defense', 'damage-variance', 'swing-geometry', 'dummy-hitbox']) {
        expect(ids, w.name).not.toContain(unrelated)
      }
      // Same order as the full list (a subset, never re-ordered).
      expect(ids).toEqual(s.assumptions.map((a) => a.id).filter((id) => ids.includes(id)))
    }
  })

  it('the attacks/sec tip speaks plain words: no game-internal names, and no "shots" for a sword', () => {
    for (const w of [sword, ...list.slice(0, 5)]) {
      const rate = assumptionsForEstimate(session(w).assumptions, 'attacks-per-sec')
      if (!hasAssumptions(rate)) throw new Error('no cadence assumptions')
      const html = render(createElement(AssumptionsTip, { assumptions: rate, context: 'attacks per second' }))
      expect(html, w.name).toContain('Attack rate = 60 ÷ use time')
      expect(html, w.name).toContain('attack animation time')
      expect(html, w.name).not.toMatch(/useAnimation|useTime|\bShots?\b/i)
    }
    // Archetypes that fire several shots in one attack keep that sentence (conditional copy).
    const bow = labAssumptionsFor('bow-gun', [APPROXIMATIONS.cadence]).find((a) => a.id === 'cadence')!
    expect(bow.detail).toMatch(/Shots inside one attack repeat at the weapon’s per-hit interval\.$/)
    expect(bow.detail).not.toMatch(/useAnimation|useTime/)
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
    const html = render(createElement(TargetSettingsPanel, { usesMana: false, dummy }))
    expect(html).toContain('Infinite Dummy')
    expect(html).toContain(`defense ${dummy.defense} · ${dummy.width} × ${dummy.height} tiles`)
  })

  it('the low-mana setting (with its wiki source) shows only for a weapon that uses mana — none of the Lab’s swords do', () => {
    const dummy = session(sword).sim.renderState().dummies[0]
    expect(list.every((w) => session(w).summary.manaCostPerUse === 0)).toBe(true)
    const swords = render(createElement(TargetSettingsPanel, { usesMana: false, dummy }))
    expect(swords).not.toContain('Low-mana casting')
    expect(swords).not.toContain('data-lab-setting')
    const mana = render(createElement(TargetSettingsPanel, { usesMana: true, dummy }))
    expect(mana).toContain('Low-mana casting')
    expect(mana).toContain('40% attack speed')
    expect(mana).toContain('href="https://terraria.wiki.gg/wiki/Mana"')
  })
})

describe('minimal weapon picker (sprite + name)', () => {
  it('one radio per equippable weapon, the equipped one checked', () => {
    const html = render(createElement(WeaponPicker, { weapons: list, equippedId: sword.id, sprites: null, onEquip: () => {}, name: 'p' }))
    const radios = [...html.matchAll(/<input type="radio" id="p-(\d+)"[^>]*>/g)]
    expect(radios.map((m) => Number(m[1]))).toEqual(list.map((w) => w.id))
    expect(radios.filter((m) => /checked=""/.test(m[0])).map((m) => Number(m[1]))).toEqual([sword.id])
    for (const w of list) expect(html).toContain(`>${w.name}<`)
    expect(html).toContain(`${list.length} swung melee weapons are simulated so far`)
  })

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
    const refused = all.find((w) => labStatus(w).kind === 'not-simulable')!
    const selection = resolveLabSelection(String(refused.id), byId, list)!
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

  it('Zenith: no verified description → says so plainly with the source link; the reason is plain language (M4)', () => {
    const zenith = all.find((w) => w.name === 'Zenith')!
    const selection = resolveLabSelection(String(zenith.id), byId, list)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('data-limitation-description="none"')
    expect(html).toContain('No verified description yet.')
    expect(html).toContain(`href="${zenith.wikiUrl}"`)
    // No forward promise (matches the weapon page's "Not simulated in the Weapon Lab").
    expect(html).toContain('This weapon’s unique behavior isn’t modeled in the Lab.')
    expect(html).not.toMatch(/modeled in the Lab yet/)
    expect(html).not.toMatch(/The wiki describes how|parameters have not been assigned/)
  })

  it('a weapon with verified tooltip text shows that text as "What it does in-game"', () => {
    const described = all.find((w) => labStatus(w).kind !== 'equippable' && inGameDescription(w))!
    const selection = resolveLabSelection(String(described.id), byId, list)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('data-limitation-description="verified"')
    expect(html).toContain(inGameDescription(described)!.split('\n')[0].replace(/'/g, '&#x27;'))
  })

  it('no LimitationCard anywhere in the dataset shows pipeline jargon as its reason', () => {
    let plain = 0
    for (const w of all) {
      const status = labStatus(w)
      if (status.kind === 'equippable') continue
      const reason = notSimulatedReason(status)
      expect(reason, w.name).not.toMatch(/parameters have not been assigned/)
      if (reason === UNASSIGNED_LIMITATION_PLAIN) plain++
    }
    expect(plain).toBeGreaterThan(0)
  })

  it('an unknown id gets a short notice, the fallback still equipped', () => {
    const selection = resolveLabSelection('999999', byId, list)!
    const html = render(createElement(LimitationCard, { notice: selection.notice!, fallback: selection.weapon, sprites: null, onBack: () => {} }))
    expect(html).toContain('No weapon with that ID')
    expect(html).toContain('999999')
    expect(html).toContain(`${sword.name} is equipped instead`)
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
    const others = all.filter((w) => labStatus(w).kind !== 'equippable')
    for (const w of others) expect(render(createElement(SendToLabButton, { weapon: w })), w.name).toBe('')
    const bow = others.find((w) => labStatus(w).kind === 'not-in-lab-yet')!
    const page = renderDetail(bow)
    expect(page).not.toContain('/lab?weapon=')
    expect(page).toContain('Not simulated in the Weapon Lab')
    expect(page).not.toMatch(/simulation coming|Until then/)
  })
})
