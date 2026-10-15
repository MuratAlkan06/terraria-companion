/* Weapon comparison (PRD P4-S1; UX_SPEC §1, §3.6, §5.3, §7, §8, §10.11; AMENDMENTS-015 B85(b)): the URL
 * state round trip, Unknown / classless-crit rendering against the dataset, the DPP estimate's label and
 * assumptions (SCORING_SPEC §2.2), gate badges against tracked progress, data-derived pros / cons, the
 * page states (empty, one, mixed-class, Unknown-heavy), the entry points (weapon page, nav, Lab links)
 * and the copy audit over every compare string and the rendered output (wiki text removed). AMENDMENTS-016
 * B101: the estimate's held-attack / used-up qualifier, the desktop column widths, the "Stat" corner
 * header and the link cleanup. */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Condition, ProgressionEdge, ProgressionNode, Weapon } from '../../../../data-access/types'
import conditionsJson from '../../../../data/conditions.json'
import progressionJson from '../../../../data/progression.json'
import weaponsJson from '../../../../data/weapons.detail.json'
import { offersLab } from '../../../../lab/labLinks'
import { auditCopy } from '../../../../scoring/copyAudit'
import { DPP_ASSUMPTIONS } from '../../../../scoring/constants'
import type { TrackedProgress } from '../../../../scoring/progress'
import { damagePotential, isSummonStaff, weaponProfile } from '../../../../scoring/proxies'
import { headerNavLayout, tabBarLayout } from '../../../nav'
import { APP_ROUTES, pathFor } from '../../../routes'
import { WeaponDetailView } from '../weapons/WeaponDetailView'
import { COMPARE_MAX, COMPARE_PARAM, COMPARE_PATH, compareHref, compareSearch } from './compareLinks'
import * as copy from './compareCopy'
import type { CompareData } from './compareData'
import {
  columnUnknowns,
  dppCell,
  gatingCell,
  linkCleanup,
  linkNotices,
  parseCompareParam,
  prosCons,
  recentWeaponIds,
  refWeaponId,
  resolveSelection,
  shownStatKeys,
  statCell,
  withAdded,
  withRemoved,
  withSwapped,
} from './compareModel'
import { CompareView, type CompareViewProps } from './CompareView'

const WEAPONS = weaponsJson as unknown as Weapon[]
const byId = new Map(WEAPONS.map((w) => [w.id, w]))
const weapon = (name: string): Weapon => {
  const w = WEAPONS.find((x) => x.name === name)
  if (!w) throw new Error(`fixture weapon missing: ${name}`)
  return w
}
const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const DATA: CompareData = {
  weapons: byId,
  graph: { ...progression, nodeById: new Map(progression.nodes.map((n) => [n.id, n])) },
  conditions: { byId: new Map((conditionsJson as unknown as Condition[]).map((c) => [c.id, c])) },
  sprites: null,
}
const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const defeated = (...ids: string[]): TrackedProgress => ({ worldEvil: null, nodeStates: Object.fromEntries(ids.map((id) => [id, 'defeated' as const])) })
const noop = () => {}

function wrap(node: ReactNode): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
}

function renderCompare(weapons: readonly Weapon[], progress: TrackedProgress = NONE, extra: Partial<CompareViewProps> = {}): string {
  const selection = parseCompareParam(weapons.map((w) => w.id).join(','))
  return wrap(createElement(CompareView, { selection, weapons, missing: [], data: DATA, progress, onAdd: noop, onChange: noop, onRemove: noop, ...extra }))
}

const markers = (html: string) => [...html.matchAll(/data-unknown-field="([^"]+)"/g)].map((m) => m[1])
const count = (html: string, re: RegExp) => [...html.matchAll(re)].length
/**
 * Rendered text with the wiki's own words (tooltips) removed and the shared UnknownValue marker reduced
 * to its visible word (its screen-reader wording is UX_SPEC §5.3's, audited with the component) — what
 * the copy audit reads.
 */
function ownText(html: string): string {
  return html
    .replace(/<p[^>]*data-wiki-text=""[^>]*>[\s\S]*?<\/p>/g, ' ')
    .replace(/<(button|span)[^>]*data-unknown-field="[^"]*"[^>]*>Unknown<span class="sr-only">[^<]*<\/span><\/\1>/g, ' Unknown ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}
/** A comparison must never name a winner or rank weapons (descriptive only). */
const VERDICT = /\b(?:winners?|better|worse|stronger|strongest|weaker|weakest|superior|inferior|outperforms?|beats?|top pick|recommended|ranked|ranking)\b/i

// Fixtures, chosen from the data (snapshot 2026-10-13): see each describe for why.
const CAR = weapon('Clockwork Assault Rifle') // ranged gun, gated by the Wall of Flesh (SCORING_SPEC §9.1)
const ZENITH = weapon('Zenith') // melee, gating Unknown
const DYNAMITE = weapon('Dynamite') // classless explosive, consumable
const BLADE_STAFF = weapon('Blade Staff') // summon staff
const COIN_GUN = weapon('Coin Gun') // Unknown-heavy: damage, knockback, gating, stage
const STAR_WRATH = weapon('Star Wrath') // gated by Moon Lord
const COPPER = weapon('Copper Shortsword') // no gate, no resource
const FLAMELASH = weapon('Flamelash') // magic, mana

describe('URL state (PRD P4-S1 AC5; UX_SPEC §10.11 /compare?w=)', () => {
  it('serializes ids in column order with literal commas and parses them back (round trip)', () => {
    const ids = [4956, 757, 1308]
    expect(compareSearch(ids)).toBe('?w=4956,757,1308')
    expect(compareHref(ids)).toBe('/compare?w=4956,757,1308')
    expect(compareSearch([])).toBe('')
    const back = new URLSearchParams(compareSearch(ids)).get(COMPARE_PARAM)
    expect(parseCompareParam(back).ids).toEqual(ids)
    // an encoded comma (what URLSearchParams.set would write) restores the same comparison
    expect(parseCompareParam(new URLSearchParams('w=4956%2C757').get(COMPARE_PARAM)).ids).toEqual([4956, 757])
  })

  it('counts what it does not keep: malformed parts, duplicates, ids past the maximum', () => {
    expect(COMPARE_MAX).toBe(3)
    const sel = parseCompareParam(' abc, 4956,4956,0,757,,1308,99,1.5')
    expect(sel).toEqual({ ids: [4956, 757, 1308], malformed: 3, duplicates: 1, overflow: 1 })
    expect(parseCompareParam(null)).toEqual({ ids: [], malformed: 0, duplicates: 0, overflow: 0 })
    expect(parseCompareParam('')).toEqual({ ids: [], malformed: 0, duplicates: 0, overflow: 0 })
  })

  it('add / remove / swap keep column order, never duplicate and never exceed the maximum', () => {
    expect(withAdded([1, 2], 3)).toEqual([1, 2, 3])
    expect(withAdded([1, 2, 3], 4)).toEqual([1, 2, 3])
    expect(withAdded([1, 2], 2)).toEqual([1, 2])
    expect(withRemoved([1, 2, 3], 2)).toEqual([1, 3])
    expect(withSwapped([1, 2, 3], 2, 9)).toEqual([1, 9, 3])
    expect(withSwapped([1, 2, 3], 2, 3)).toEqual([1, 2, 3])
    expect(withSwapped([1, 2], 7, 9)).toEqual([1, 2])
  })

  it('resolves ids against the dataset; ids it lacks are reported, not dropped silently', () => {
    const sel = parseCompareParam(`${CAR.id},999999,${ZENITH.id}`)
    const { weapons, missing } = resolveSelection(sel.ids, byId)
    expect(weapons.map((w) => w.name)).toEqual([CAR.name, ZENITH.name])
    expect(missing).toEqual([999999])
    expect(linkNotices(sel, missing)).toEqual([copy.missingIds([999999])])
    expect(linkNotices(parseCompareParam('1,1,x,2,3,4'), [])).toEqual([copy.overflowIds(3), copy.DUPLICATE_IDS, copy.MALFORMED_IDS])
    const html = wrap(createElement(CompareView, { selection: sel, weapons, missing, data: DATA, progress: NONE }))
    expect(html).toContain('data-compare-note="link"')
    expect(ownText(html)).toContain('999999')
  })

  it('a link naming what isn’t compared: its notices, then the canonical link of what is (AMENDMENTS-016 B101d)', () => {
    const sel = parseCompareParam(`${CAR.id},999999,${CAR.id},abc,${ZENITH.id}`)
    const resolved = resolveSelection(sel.ids, byId)
    expect(linkCleanup(sel, resolved)).toEqual({ notices: [copy.missingIds([999999]), copy.DUPLICATE_IDS, copy.MALFORMED_IDS], search: `?w=${CAR.id},${ZENITH.id}` })
    // the canonical link has nothing to clean, so the rewrite happens once
    const canonical = parseCompareParam(new URLSearchParams(`?w=${CAR.id},${ZENITH.id}`).get(COMPARE_PARAM))
    expect(linkCleanup(canonical, resolveSelection(canonical.ids, byId))).toBeUndefined()
    // nothing valid at all: the link becomes the bare page; past the maximum: the first three
    const none = parseCompareParam('abc,999999')
    expect(linkCleanup(none, resolveSelection(none.ids, byId))?.search).toBe('')
    const four = parseCompareParam(`${CAR.id},${ZENITH.id},${DYNAMITE.id},${COPPER.id}`)
    expect(linkCleanup(four, resolveSelection(four.ids, byId))).toEqual({ notices: [copy.overflowIds(3)], search: `?w=${CAR.id},${ZENITH.id},${DYNAMITE.id}` })
  })

  it('after the rewrite the page keeps showing the notices it was handed (the canonical selection has none of its own)', () => {
    const canonical = parseCompareParam(`${CAR.id},${ZENITH.id}`)
    const notices = [copy.missingIds([999999])]
    const html = renderCompare([CAR, ZENITH], NONE, { selection: canonical, notices })
    expect(html).toContain('data-compare-note="link"')
    expect(ownText(html)).toContain(copy.missingIds([999999]))
    expect(renderCompare([CAR, ZENITH], NONE, { selection: canonical, notices: [] })).not.toContain('data-compare-note="link"')
  })

  it('a restored link renders its weapons as columns in the link’s order', () => {
    const sel = parseCompareParam(`${ZENITH.id},${CAR.id},${DYNAMITE.id}`)
    const html = renderCompare(resolveSelection(sel.ids, byId).weapons)
    expect(html).toContain(`data-compare-table="${ZENITH.id},${CAR.id},${DYNAMITE.id}"`)
    expect([...html.matchAll(/data-column="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([ZENITH.id, CAR.id, DYNAMITE.id])
  })

  it('the deep link targets the registered /compare route', () => {
    expect(pathFor('compare')).toBe(COMPARE_PATH)
  })
})

describe('Unknown rendering (REQUIREMENTS §13, UX_SPEC §5.3)', () => {
  // Fields the comparison displays (stat rows + gating + acquisition + tooltip).
  const DISPLAYED = new Set(['damageClass', 'damage', 'critPct', 'useAnimationTicks', 'knockback', 'autoReuse', 'manaCost', 'ammoClass', 'maxStack', 'stage', 'rarity', 'gatedBy', 'acquisition', 'behaviorText'])

  it('every weapon: Unknown markers sit exactly on its unverified displayed fields, and the badge counts them', () => {
    for (const w of WEAPONS) {
      const html = renderCompare([w])
      const shown = markers(html)
      const expected = columnUnknowns(w, shownStatKeys([w]), gatingCell(w, DATA.graph, new Set())).map((u) => u.key)
      expect(shown, w.name).toEqual(expected)
      for (const field of w._prov.unverifiedFields) if (DISPLAYED.has(field)) expect(shown, `${w.name}: ${field}`).toContain(field)
      for (const field of shown) expect(w._prov.unverifiedFields, `${w.name}: ${field} is not unverified`).toContain(field)
      expect(html.includes('Partially verified'), w.name).toBe(shown.length > 0)
    }
  })

  it('an Unknown cell is hatched and says only "Unknown" — never 0, a dash or a filled-in value', () => {
    const html = renderCompare([COIN_GUN, CAR])
    const cell = /<td class="([^"]*)" data-cell="damage:905">([\s\S]*?)<\/td>/.exec(html)
    expect(cell).not.toBeNull()
    expect(cell?.[1]).toContain('bg-hatch-unknown')
    expect(ownText(cell?.[2] ?? '').trim()).toBe('Unknown')
    expect(statCell(COIN_GUN, 'damage')).toEqual({ kind: 'unknown', field: 'damage' })
  })

  it('Unknown-heavy: the page says so, the estimate names the missing input, nothing is estimated from it', () => {
    const html = renderCompare([COIN_GUN, CAR])
    const unknowns = columnUnknowns(COIN_GUN, shownStatKeys([COIN_GUN, CAR]), gatingCell(COIN_GUN, DATA.graph, new Set()))
    expect(unknowns.length).toBeGreaterThanOrEqual(3)
    expect(html).toContain(`data-compare-note="unknown-heavy:${COIN_GUN.id}"`)
    expect(html).not.toContain(`data-compare-note="unknown-heavy:${CAR.id}"`)
    expect(dppCell(COIN_GUN)).toEqual({ kind: 'missing', fields: ['Damage'] })
    expect(ownText(html)).toContain(copy.dppMissingReason(['Damage']))
  })
})

describe('classless and summon crit: NOT APPLICABLE, not Unknown (AMENDMENTS-015 B85(b), B17/B64)', () => {
  it('every classless and summon weapon reads crit as not applicable; no other class does', () => {
    for (const w of WEAPONS) {
      const cell = statCell(w, 'crit')
      if (w.damageClass === 'other' || w.damageClass === 'summon') expect(cell.kind, w.name).toBe('not-applicable')
      else expect(cell.kind, w.name).not.toBe('not-applicable')
    }
  })

  it('beside a weapon that crits, a classless column says "Not applicable" with the reason — no Unknown marker', () => {
    const html = renderCompare([ZENITH, DYNAMITE])
    expect(html).toContain('data-row="crit"')
    const cell = new RegExp(`data-cell="crit:${DYNAMITE.id}">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? ''
    expect(cell).toContain('data-not-applicable="critPct"')
    expect(ownText(cell)).toContain(copy.NOT_APPLICABLE)
    expect(ownText(cell)).toContain(copy.CRIT_NA_CLASSLESS)
    expect(cell).not.toContain('data-unknown-field')
    expect(new RegExp(`data-cell="crit:${ZENITH.id}">[\\s\\S]*?%`).test(html)).toBe(true)
  })

  it('with only classless / summon weapons the crit row (and its footnote) is omitted', () => {
    const html = renderCompare([DYNAMITE, BLADE_STAFF])
    expect(html).not.toContain('data-row="crit"')
    expect(ownText(html)).not.toContain(copy.NOTE_CRIT)
    expect(shownStatKeys([DYNAMITE, BLADE_STAFF])).not.toContain('crit')
  })
})

describe('damage-rate estimate: SCORING_SPEC §2.2 DPP, labeled with assumptions (UX_SPEC §8)', () => {
  it('Clockwork Assault Rifle: 122.4 (the §9.1 golden), base assumptions verbatim, scored without ammo', () => {
    const cell = dppCell(CAR)
    if (cell.kind !== 'estimate') throw new Error('expected an estimate')
    expect(cell.text).toBe('122.4')
    expect(cell.assumptions[0]).toMatchObject({ id: 'dpp-base', detail: DPP_ASSUMPTIONS })
    expect(cell.assumptions.map((a) => a.id)).toEqual(['dpp-base', 'dpp-formula', 'dpp-rate', 'dpp-crit', 'dpp-ammo', 'dpp-proxy'])
    expect(cell.assumptions.find((a) => a.id === 'dpp-formula')?.detail).toBe(copy.assumptionFormula('17', '6.92', '1.04', '122.4'))
    expect(cell.assumptions.find((a) => a.id === 'dpp-rate')?.detail).toBe(copy.assumptionRate('12 ticks + 14 reuse delay', 26, 3, '6.92'))
  })

  it('the formula tip reads with one "×" per factor — never a doubled "× ×" (AMENDMENTS-016 B101d)', () => {
    const cell = dppCell(CAR)
    if (cell.kind !== 'estimate') throw new Error('expected an estimate')
    expect(cell.assumptions.find((a) => a.id === 'dpp-formula')?.detail).toBe('17 damage per hit × 6.92 hits per second × 1.04 for critical hits ≈ 122.4 per second.')
    for (const w of WEAPONS) {
      const c = dppCell(w)
      if (c.kind === 'estimate') for (const a of c.assumptions) expect(a.detail, `${w.name}: ${a.id}`).not.toMatch(/×\s*×/)
    }
  })

  it('every weapon: an estimate equals the shared proxy and always carries a populated tip; summon staffs and missing inputs get none', () => {
    for (const w of WEAPONS) {
      const cell = dppCell(w)
      const profile = weaponProfile(w)
      if (isSummonStaff(w)) {
        expect(cell.kind, w.name).toBe('summon')
      } else if (!profile.ok) {
        expect(cell, w.name).toMatchObject({ kind: 'missing' })
        if (cell.kind === 'missing') expect(cell.fields.length, w.name).toBeGreaterThan(0)
      } else {
        if (cell.kind !== 'estimate') throw new Error(`${w.name}: expected an estimate`)
        expect(cell.value, w.name).toBe(damagePotential(profile))
        expect(cell.assumptions[0].detail, w.name).toBe(DPP_ASSUMPTIONS)
        expect(cell.assumptions.every((a) => a.title !== '' && a.detail !== ''), w.name).toBe(true)
        expect(cell.assumptions.some((a) => a.id === 'dpp-ammo'), w.name).toBe(profile.ammoClass !== undefined)
      }
    }
  })

  it('the rendered number is followed by its EstimateLabel; every "est." on the page belongs to an estimate cell', () => {
    const html = renderCompare([CAR, ZENITH, BLADE_STAFF])
    const estimates = [CAR, ZENITH].map((w) => dppCell(w)).filter((c) => c.kind === 'estimate')
    expect(count(html, /data-estimate="/g)).toBe(estimates.length)
    expect(/data-dpp="122\.4">122\.4<\/span>\s*<button[^>]*data-estimate="damage per second of Clockwork Assault Rifle"/.test(html)).toBe(true)
    const staff = new RegExp(`data-dpp-cell="${BLADE_STAFF.id}">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? ''
    expect(staff).toContain('data-dpp-none="summon"')
    expect(staff).not.toContain('data-estimate')
    expect(ownText(staff)).toContain(copy.DPP_SUMMON_REASON)
  })

  it('classless crit adds nothing and cites the wiki rule; summon whips add nothing either', () => {
    const cell = dppCell(DYNAMITE)
    if (cell.kind !== 'estimate') throw new Error('expected an estimate')
    expect(cell.assumptions.find((a) => a.id === 'dpp-crit')).toMatchObject({ detail: copy.ASSUMPTION_CRIT_CLASSLESS, sourceUrl: 'https://terraria.wiki.gg/wiki/Critical_hit' })
    const whip = WEAPONS.find((w) => w.damageClass === 'summon' && !isSummonStaff(w) && weaponProfile(w).ok)
    if (!whip) throw new Error('no estimable summon weapon')
    const whipCell = dppCell(whip)
    expect(whipCell.kind === 'estimate' && whipCell.assumptions.find((a) => a.id === 'dpp-crit')?.detail).toBe(copy.ASSUMPTION_CRIT_SUMMON)
  })
})

describe('held-attack / used-up qualifier on the estimate (AMENDMENTS-016 B101a)', () => {
  const estimate = (w: Weapon) => {
    const cell = dppCell(w)
    if (cell.kind !== 'estimate') throw new Error(`${w.name}: expected an estimate`)
    return cell
  }
  const tip = (w: Weapon, id: string) => estimate(w).assumptions.find((a) => a.id === id)?.detail
  const CAVEAT_TIPS = ['dpp-clicks', 'dpp-usage', 'dpp-explosive']
  const BOMB = weapon('Bomb') // classless explosive, consumable, 25-tick use
  const MINISHARK = weapon('Minishark') // auto-reuse gun
  const KATANA = weapon('Katana') // auto-reuse melee swing
  const POISONED_KNIFE = weapon('Poisoned Knife') // consumable with auto-reuse

  it('Dynamite and Bomb keep the uniform §2.2 number and gain the in-cell line: one click per throw, usage, blast and fuse', () => {
    expect(estimate(DYNAMITE).text).toBe('375.0') // 250 × 60 ÷ 40, unchanged
    expect(estimate(DYNAMITE).qualifier).toBe('One click per throw · uses 1.5/s · blast and fuse not counted')
    expect(estimate(BOMB).qualifier).toBe('One click per throw · uses 2.4/s · blast and fuse not counted')
  })

  it('their tips: a click every use (no auto-reuse), the usage rate, and what an explosive’s rate leaves out', () => {
    expect(tip(DYNAMITE, 'dpp-clicks')).toBe('Assumes a click every 40 ticks — it has no auto-reuse, so holding attack doesn’t repeat it.')
    expect(tip(BOMB, 'dpp-clicks')).toBe('Assumes a click every 25 ticks — it has no auto-reuse, so holding attack doesn’t repeat it.')
    expect(tip(DYNAMITE, 'dpp-usage')).toBe('Each use spends one from the stack, so attacking at this rate uses 1.5 per second.')
    expect(tip(BOMB, 'dpp-usage')).toBe('Each use spends one from the stack, so attacking at this rate uses 2.4 per second.')
    expect(tip(DYNAMITE, 'dpp-explosive')).toBe(copy.ASSUMPTION_EXPLOSIVE)
    // the caveats sit right after the rate they qualify; §2.2's base string stays first and verbatim
    expect(estimate(DYNAMITE).assumptions.map((a) => a.id)).toEqual(['dpp-base', 'dpp-formula', 'dpp-rate', 'dpp-clicks', 'dpp-usage', 'dpp-explosive', 'dpp-crit', 'dpp-proxy'])
  })

  it('Clockwork Assault Rifle, Minishark and an auto-reuse melee swing get no qualifier and no caveat tips', () => {
    for (const w of [CAR, MINISHARK, KATANA]) {
      expect(estimate(w).qualifier, w.name).toBeUndefined()
      expect(estimate(w).assumptions.filter((a) => CAVEAT_TIPS.includes(a.id)), w.name).toEqual([])
    }
    expect(KATANA.damageClass).toBe('melee')
  })

  it('each caveat comes from its own verified field: no auto-reuse alone, used up alone', () => {
    // a weapon without auto-reuse needs a click per attack, melee too (the Lab's own `auto-reuse` approximation)
    expect(estimate(COPPER).qualifier).toBe('One click per attack')
    expect(tip(COPPER, 'dpp-clicks')).toBe(copy.assumptionClicks(13))
    // used up but auto-reused: only the usage rate
    expect(estimate(POISONED_KNIFE).qualifier).toBe('Uses 4/s')
    expect(tip(POISONED_KNIFE, 'dpp-clicks')).toBeUndefined()
  })

  it('every weapon: the line appears exactly when a caveat tip does, and each part matches its tip', () => {
    for (const w of WEAPONS) {
      const cell = dppCell(w)
      if (cell.kind !== 'estimate') continue
      const ids = cell.assumptions.map((a) => a.id).filter((id) => CAVEAT_TIPS.includes(id))
      expect(cell.qualifier !== undefined, w.name).toBe(ids.length > 0)
      const line = (cell.qualifier ?? '').toLowerCase()
      expect(line.includes('one click per'), w.name).toBe(ids.includes('dpp-clicks'))
      expect(/uses [\d.]+\/s/.test(line), w.name).toBe(ids.includes('dpp-usage'))
      expect(line.includes(copy.QUALIFIER_EXPLOSIVE), w.name).toBe(ids.includes('dpp-explosive'))
      // the rules read verified fields only (an Unknown auto-reuse has no estimate at all, §1.3)
      expect(ids.includes('dpp-clicks'), w.name).toBe(w.autoReuse === false && !w._prov.unverifiedFields.includes('autoReuse'))
      expect(ids.includes('dpp-usage'), w.name).toBe(typeof w.maxStack === 'number' && !w._prov.unverifiedFields.includes('maxStack'))
      expect(ids.includes('dpp-explosive'), w.name).toBe(w.tags.includes('explosives'))
    }
  })

  it('renders as the cell’s secondary line under the number and its "est." — Dynamite beside Clockwork without', () => {
    const html = renderCompare([DYNAMITE, CAR])
    const dyn = new RegExp(`data-dpp-cell="${DYNAMITE.id}">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? ''
    expect(dyn).toMatch(/data-estimate="damage per second of Dynamite"[\s\S]*<span class="mt-0.5 block text-xs text-fg-muted" data-dpp-qualifier="">One click per throw · uses 1.5\/s · blast and fuse not counted<\/span>/)
    const car = new RegExp(`data-dpp-cell="${CAR.id}">([\\s\\S]*?)</td>`).exec(html)?.[1] ?? ''
    expect(car).toContain('data-dpp="122.4"')
    expect(car).not.toContain('data-dpp-qualifier')
  })
})

describe('layout and table semantics (AMENDMENTS-016 B101b, B101d)', () => {
  const columnClasses = (html: string) => [...html.matchAll(/<th scope="col" data-column="\d+" class="([^"]*)"/g)].map((m) => m[1])

  it('desktop: one or two weapons share the width beside the rail (no dead band); three keep a third each', () => {
    const lg = { 1: 'lg:w-[calc(100cqw-11rem)]', 2: 'lg:w-[calc((100cqw-11rem)/2)]', 3: 'lg:w-[calc((100cqw-11rem)/3)]' } as const
    const sets = { 1: [CAR], 2: [CAR, ZENITH], 3: [CAR, ZENITH, DYNAMITE] } as const
    for (const n of [1, 2, 3] as const) {
      const classes = columnClasses(renderCompare(sets[n]))
      expect(classes, `${n} weapons`).toHaveLength(n)
      for (const c of classes) {
        // phone + tablet widths unchanged at every count (375: one per view; 768: two per view)
        expect(c).toContain('w-[calc(100cqw-7.5rem)]')
        expect(c).toContain('md:w-[calc((100cqw-10rem)/2)]')
        expect(c.match(/lg:w-\S+/g), `${n} weapons`).toEqual([lg[n]])
      }
    }
    // the desktop rail (lg:w-44 = 11rem) plus n columns is exactly the frame's width
    expect(renderCompare([CAR])).toMatch(/<th scope="col" class="sticky left-0 z-\[1\] w-30 bg-panel md:w-40 lg:w-44 /)
  })

  it('the top-left corner is a real column header for the stat labels (th scope=col, screen-reader text "Stat")', () => {
    const html = renderCompare([CAR, ZENITH])
    expect(html).toMatch(/<th scope="col" class="[^"]*" data-stat-corner=""><span class="sr-only">Stat<\/span><\/th>/)
    expect(html).not.toMatch(/<td[^>]*><span class="sr-only">Stat<\/span><\/td>/)
  })
})

describe('gate badges against TRACKED progress (SCORING_SPEC §2.4; UX_SPEC §8, §10.5)', () => {
  const gatingHtml = (w: Weapon, progress: TrackedProgress) => {
    const html = renderCompare([w], progress)
    return /data-row="gating">([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? ''
  }

  it('Clockwork Assault Rifle: a Wall of Flesh badge (linked to its page) until it is marked defeated', () => {
    const before = gatingHtml(CAR, NONE)
    expect(before).toContain('data-gate="Wall of Flesh"')
    expect(before).toContain('href="/bosses/wall-of-flesh"')
    const after = gatingHtml(CAR, defeated('wall-of-flesh'))
    expect(after).not.toContain('data-gate=')
    expect(ownText(after)).toContain(copy.gateMet('Wall of Flesh'))
    expect(gatingCell(CAR, DATA.graph, new Set(['wall-of-flesh']))).toEqual({ kind: 'met', bosses: ['wall-of-flesh'], conditions: [] })
  })

  it('Star Wrath shows its Moon Lord gate; a skipped boss is not a defeat', () => {
    expect(gatingHtml(STAR_WRATH, NONE)).toContain('data-gate="Moon Lord"')
    expect(gatingHtml(STAR_WRATH, { worldEvil: null, nodeStates: { 'moon-lord': 'skipped' } })).toContain('data-gate="Moon Lord"')
  })

  it('Unknown gating stays Unknown — never shown as open, never badged', () => {
    const html = gatingHtml(ZENITH, defeated('moon-lord'))
    expect(html).toContain('data-unknown-field="gatedBy"')
    expect(html).not.toContain('data-gate=')
    expect(html).not.toContain(copy.GATE_NONE)
  })

  it('ungated weapons say so; world conditions are requirement chips, never a block', () => {
    expect(ownText(gatingHtml(COPPER, NONE))).toContain(copy.GATE_NONE)
    const night = WEAPONS.find((w) => w.gatedBy && !w._prov.unverifiedFields.includes('gatedBy') && w.gatedBy.bosses.length === 0 && w.gatedBy.conditions.includes('night'))
    if (!night) throw new Error('no night-gated weapon')
    const html = gatingHtml(night, NONE)
    expect(html).toContain(`data-condition-chip="${DATA.conditions.byId.get('night')?.name}"`)
    expect(ownText(html)).toContain(copy.GATE_NONE)
  })

  it('a milestone gate resolves to the boss that opens it (Hardmode → Wall of Flesh)', () => {
    const hm = WEAPONS.find((w) => w.gatedBy && !w._prov.unverifiedFields.includes('gatedBy') && w.gatedBy.bosses.includes('hardmode'))
    if (!hm) return // no weapon gated on the milestone itself in this snapshot
    const cell = gatingCell(hm, DATA.graph, new Set())
    expect(cell.kind === 'gated' && cell.missing).toContain('wall-of-flesh')
  })
})

describe('pros / cons: data-derived, per weapon (PRD P4-S1 AC3)', () => {
  it('reads resources, auto-reuse, explosives and consumables from verified fields', () => {
    expect(prosCons(CAR).cons).toContain(copy.conAmmo('Bullets'))
    const mana = FLAMELASH.manaCost as number
    expect(prosCons(FLAMELASH).cons).toContain(copy.conMana(mana))
    expect(prosCons(COPPER).pros).toContain(copy.PRO_NO_RESOURCE)
    const dyn = prosCons(DYNAMITE)
    expect(dyn.pros).toContain(copy.PRO_EXPLOSIVE)
    expect(dyn.cons).toEqual(expect.arrayContaining([copy.conConsumable(DYNAMITE.maxStack as number), copy.CON_CLASSLESS]))
    expect(dyn.pros).not.toContain(copy.PRO_NO_RESOURCE) // used up on use: a resource
  })

  it('never derives a line from an Unknown field', () => {
    for (const w of WEAPONS) {
      const { pros, cons } = prosCons(w)
      const unverified = new Set(w._prov.unverifiedFields)
      if (unverified.has('autoReuse')) expect(pros, w.name).not.toContain(copy.PRO_AUTO_REUSE)
      if (unverified.has('autoReuse')) expect(cons, w.name).not.toContain(copy.CON_NO_AUTO_REUSE)
      if (unverified.has('manaCost') || unverified.has('ammoClass')) expect(pros, w.name).not.toContain(copy.PRO_NO_RESOURCE)
    }
  })
})

describe('page states (UX_SPEC §5; brief: empty, one weapon, Unknown-heavy, mixed-class)', () => {
  it('none picked: the guided empty state with Add and Browse, no table', () => {
    const html = renderCompare([])
    expect(ownText(html)).toContain(copy.EMPTY_TITLE)
    expect(html).toContain('id="compare-add"')
    expect(html).toContain('href="/weapons"')
    expect(html).not.toContain('data-compare-table')
  })

  it('one weapon: the prompt to add a second, with its column already shown', () => {
    const html = renderCompare([CAR])
    expect(html).toContain('data-compare-state="one"')
    expect(ownText(html)).toContain(copy.ONE_TITLE)
    expect(html).toContain(`data-compare-table="${CAR.id}"`)
    expect(count(html, /id="compare-add"/g)).toBe(1)
  })

  it('two weapons: count + Add; three: the maximum, no Add', () => {
    const two = renderCompare([CAR, ZENITH])
    expect(ownText(two)).toContain(copy.countLine(2, 3))
    expect(two).toContain('id="compare-add"')
    const three = renderCompare([CAR, ZENITH, DYNAMITE])
    expect(ownText(three)).toContain(copy.countLine(3, 3))
    expect(three).not.toContain('id="compare-add"')
    expect(count(three, /id="compare-change-\d+"/g)).toBe(3)
    expect(count(three, /id="compare-remove-\d+"/g)).toBe(3)
  })

  it('mixed classes get the gear note; one class does not', () => {
    const mixed = renderCompare([ZENITH, FLAMELASH, DYNAMITE])
    expect(mixed).toContain('data-compare-note="mixed-class"')
    expect(ownText(mixed)).toContain(copy.mixedClassBody('melee, magic and classless'))
    expect(renderCompare([ZENITH, COPPER])).not.toContain('data-compare-note="mixed-class"')
  })

  it('no cell singles out a weapon: no winner styling, no relative wording', () => {
    const html = renderCompare([CAR, ZENITH, DYNAMITE])
    expect(html).not.toMatch(/data-(?:winner|best|highest|leader)/)
    expect(ownText(html)).not.toMatch(VERDICT)
  })
})

describe('entry points: weapon page, nav, Lab (UX_SPEC §2, §3.3, §3.6)', () => {
  it('every weapon page has "Compare" → /compare?w=:id', () => {
    for (const w of [CAR, ZENITH, COIN_GUN]) {
      const html = wrap(createElement(WeaponDetailView, { weapon: w, sprites: null, acquisitionData: undefined, acquisition: null }))
      expect(html, w.name).toContain(`href="/compare?w=${w.id}"`)
      expect(html).toContain(`data-compare-link="${w.id}"`)
    }
  })

  it('/compare is a lazy route in the phone "More" sheet (UX_SPEC §2) and the desktop header’s "More" menu (B99b)', () => {
    const route = APP_ROUTES.find((r) => r.id === 'compare')
    if (!route) throw new Error('no compare route')
    expect(route.path).toBe('/compare')
    expect((route.Component as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.lazy'))
    expect(route.nav?.surfaces).toEqual(['header', 'more'])
    expect(tabBarLayout().more.map((i) => i.to)).toContain('/compare')
    expect(headerNavLayout().inline.map((i) => i.to)).not.toContain('/compare')
    expect(headerNavLayout().more.map((i) => i.to)).toContain('/compare')
  })

  it('sim-capable weapons link to the Lab with themselves equipped; the rest say they aren’t simulated', () => {
    const html = renderCompare([CAR, ZENITH, DYNAMITE])
    for (const w of [CAR, ZENITH, DYNAMITE]) {
      if (offersLab(w)) expect(html, w.name).toContain(`href="/lab?weapon=${w.id}"`)
      else expect(html, w.name).not.toContain(`href="/lab?weapon=${w.id}"`)
    }
    expect(offersLab(ZENITH)).toBe(false)
    expect(ownText(html)).toContain(copy.LAB_NOT_SIMULATED)
    expect(html).toContain(`data-send-to-lab="${CAR.id}"`)
  })

  it('the picker’s starter list: recently viewed weapons only, newest first, deduplicated, capped', () => {
    expect(refWeaponId('i:4956')).toBe(4956)
    expect(refWeaponId('boss:plantera')).toBeUndefined()
    const refs = ['boss:plantera', `i:${CAR.id}`, 'i:999999', `i:${CAR.id}`, `i:${ZENITH.id}`, ...WEAPONS.slice(0, 20).map((w) => `i:${w.id}`)]
    const ids = recentWeaponIds(byId, () => refs)
    expect(ids.slice(0, 2)).toEqual([CAR.id, ZENITH.id])
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(ids.length)
    expect(recentWeaponIds(byId, () => [])).toEqual([])
  })
})

describe('copy audit (SCORING_SPEC §8.4; UX_SPEC §10.3; descriptive comparison)', () => {
  /** Representative calls of every template in the copy module (a new template must be added here). */
  const SAMPLES: Record<string, () => string[]> = {
    countLine: () => [copy.countLine(1, 3), copy.countLine(3, 3)],
    changeSr: () => [copy.changeSr('Zenith')],
    removeSr: () => [copy.removeSr('Zenith')],
    announceAdded: () => [copy.announceAdded('Zenith', 1), copy.announceAdded('Zenith', 3)],
    announceRemoved: () => [copy.announceRemoved('Zenith', 0), copy.announceRemoved('Zenith', 1), copy.announceRemoved('Zenith', 2)],
    announceSwapped: () => [copy.announceSwapped('Zenith', 'Terra Blade')],
    mixedClassBody: () => [copy.mixedClassBody('melee and magic')],
    unknownHeavy: () => [copy.unknownHeavy('Coin Gun', 4)],
    missingIds: () => [copy.missingIds([1]), copy.missingIds([1, 2])],
    overflowIds: () => [copy.overflowIds(3)],
    swipeHint: () => [copy.swipeHint(3)],
    ticks: () => [copy.ticks(20)],
    critPercent: () => [copy.critPercent(4)],
    consumableYes: () => [copy.consumableYes(9999)],
    andList: () => [copy.andList(['a']), copy.andList(['a', 'b', 'c'])],
    dppMissingReason: () => [copy.dppMissingReason(['Damage']), copy.dppMissingReason(['Damage', 'Auto-reuse'])],
    dppContext: () => [copy.dppContext('Zenith')],
    assumptionFormula: () => [copy.assumptionFormula('17', '6.92', '1.04', '122.4')],
    qualifierUsage: () => [copy.qualifierUsage('1.5')],
    dppQualifier: () => [copy.dppQualifier([copy.QUALIFIER_CLICK_THROW, copy.qualifierUsage('1.5'), copy.QUALIFIER_EXPLOSIVE]), copy.dppQualifier([copy.QUALIFIER_CLICK_ATTACK])],
    assumptionClicks: () => [copy.assumptionClicks(40)],
    assumptionUsage: () => [copy.assumptionUsage('1.5')],
    assumptionRate: () => [copy.assumptionRate('12 ticks + 14 reuse delay', 26, 3, '6.92'), copy.assumptionRate('20 ticks', 20, 1, '3')],
    cadenceText: () => [copy.cadenceText(20, true, 0), copy.cadenceText(12, false, 14)],
    assumptionCrit: () => [copy.assumptionCrit(4)],
    gateMet: () => [copy.gateMet('Wall of Flesh')],
    conMana: () => [copy.conMana(8)],
    conAmmo: () => [copy.conAmmo('Bullets')],
    conConsumable: () => [copy.conConsumable(9999)],
    SOURCE_SR: () => [copy.SOURCE_SR('Zenith')],
    pickerTitle: () => [copy.pickerTitle('add'), copy.pickerTitle('swap', 'Zenith')],
    pickerCount: () => [copy.pickerCount(1), copy.pickerCount(5)],
    pickerNone: () => [copy.pickerNone('zen')],
    pickerRecentCount: () => [copy.pickerRecentCount(1), copy.pickerRecentCount(8)],
  }

  function allCopy(): string[] {
    const out: string[] = []
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'string') out.push(value)
      else if (typeof value === 'function') {
        const sample = SAMPLES[key]
        if (!sample) throw new Error(`copy.${key}: add representative calls to SAMPLES`)
        out.push(...sample())
      } else if (typeof value === 'object' && value) out.push(...Object.values(value as Record<string, string>))
    }
    return out
  }

  it('every compare string passes the outcome / forward-promise audit and names no winner', () => {
    const strings = allCopy()
    expect(strings.length).toBeGreaterThan(80)
    for (const s of strings) {
      expect(auditCopy(s), s).toBeUndefined()
      expect(s, s).not.toMatch(VERDICT)
    }
  })

  it('the rendered pages pass it too (wiki tooltips excluded)', () => {
    const pages = [
      renderCompare([]),
      renderCompare([COIN_GUN]),
      renderCompare([CAR, ZENITH, DYNAMITE]),
      renderCompare([FLAMELASH, BLADE_STAFF, STAR_WRATH], defeated('wall-of-flesh')),
    ]
    for (const html of pages) {
      const text = ownText(html)
      expect(auditCopy(text), auditCopy(text)).toBeUndefined()
      expect(text).not.toMatch(VERDICT)
    }
  })
})
