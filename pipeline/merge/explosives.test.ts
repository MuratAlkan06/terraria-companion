/* P3-S11: the thrown explosives' second wiki statement of their blast damage / knockback (merge/explosives.ts). */
import { describe, expect, it } from 'vitest'
import type { Article } from '../fetch/articles'
import { checkExplosiveStat, explosiveEvidence, explosiveTable, EXPLOSIVES_CLASS_PAGE, statedExplosionDamage, type ExplosiveEvidence } from './explosives'

const article = (title: string, body: string, revid = 1031784): Article => ({ title, resolvedTitle: title, revid, fetchedAt: '2026-10-13T05:00:00.000Z', html: `<div class="mw-parser-output">${body}</div>` })

/** The Explosives (class) types table, shaped like the cached revision (footnote on "Radius", hand-written cells). */
const CLASS_TABLE = article(
  EXPLOSIVES_CLASS_PAGE,
  `<p>Explosives are a type of consumable weapon.</p><table class="terraria"><tr><th>Item</th><th>Damage</th><th>Radius<sup class="reference">[1]</sup></th><th>Knockback</th><th>Notes</th></tr>
  <tr><td>Bomb<div>Internal Item ID: 166</div></td><td>100</td><td>4</td><td>8 (Very strong)</td><td></td></tr>
  <tr><td>Dynamite<div>Internal Item ID: 167</div></td><td>250</td><td>7</td><td>10 (Extremely strong)</td><td>Bounces and rolls</td></tr>
  <tr><td>Freeze Bomb<div>Internal Item ID: 5542</div></td><td>0 (to enemies) 1 (to user)</td><td>4.2</td><td>12 (Insane)</td><td></td></tr>
  <tr><td>Scarab Bomb<div>Internal Item ID: 4423</div></td><td>100</td><td>/</td><td>8 (Very strong)</td><td></td></tr></table>`,
)

describe('the Explosives (class) types table', () => {
  it('rows by item ID: the Damage / Knockback cells’ leading numbers ("8 (Very strong)" → 8; "0 (to enemies)…" → 0)', () => {
    const t = explosiveTable(CLASS_TABLE)
    expect([...(t?.rows.keys() ?? [])]).toEqual([166, 167, 5542, 4423])
    expect(t?.rows.get(166)).toMatchObject({ damage: 100, knockback: 8 })
    expect(t?.rows.get(167)).toMatchObject({ damage: 250, knockback: 10 })
    expect(t?.rows.get(5542)).toMatchObject({ damage: 0, knockback: 12 })
    expect(t?.source).toEqual({ kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Explosives_(class)', rev: 1031784, fetchedAt: '2026-10-13' })
    expect(explosiveTable(undefined)).toBeUndefined()
    expect(explosiveTable(article(EXPLOSIVES_CLASS_PAGE, '<p>No table.</p>'))).toBeUndefined()
  })
})

describe('the own article’s explosion damage sentence', () => {
  it('one stated value (classless wording too); several different values → none (never picked)', () => {
    const bomb = article('Bomb', '<p>The Bomb is an explosive that explodes 3 seconds after being thrown. The explosion also deals 100 damage to all enemies, critters, and players in the radius, but not NPCs.</p>', 1031782)
    expect(statedExplosionDamage(bomb)).toMatchObject({ value: 100, quote: 'The explosion also deals 100 damage to all enemies, critters, and players in the radius, but not NPCs.' })
    const power = article('Power Bomb', '<p>The explosion also deals 200 classless damage to all enemies, critters, and players (but not NPCs) within 8.75 tiles horizontally and vertically of the Power Bomb.</p>')
    expect(statedExplosionDamage(power)?.value).toBe(200)
    expect(statedExplosionDamage(article('X', '<p>It deals 100 damage to all enemies. In Expert Mode it deals 150 damage to all enemies.</p>'))).toBeUndefined()
    expect(statedExplosionDamage(article('Sticky Bomb', '<p>The Sticky Bomb is an explosive that functions like the Bomb.</p>'))).toBeUndefined()
  })
})

describe('checkExplosiveStat: every statement present must agree on one positive value', () => {
  const ev = (damage?: number, knockback?: number, stated?: number): ExplosiveEvidence => ({
    table: { ...(damage !== undefined ? { damage } : {}), ...(knockback !== undefined ? { knockback } : {}), cells: {} },
    tableSource: { kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Explosives_(class)', rev: 1, fetchedAt: '2026-10-13' },
    ...(stated !== undefined ? { stated: { value: stated, quote: 'q', source: { kind: 'wiki-article', url: 'https://terraria.wiki.gg/wiki/Bomb', rev: 2, fetchedAt: '2026-10-13' } } } : {}),
  })
  it('agree → the value, sourced by the table (and the article for damage)', () => {
    expect(checkExplosiveStat('damage', 100, ev(100, 8, 100))).toMatchObject({ ok: true, value: 100, sources: [{ url: expect.stringContaining('Explosives_(class)') }, { url: expect.stringContaining('/Bomb') }] })
    expect(checkExplosiveStat('knockback', 8, ev(100, 8, 100))).toMatchObject({ ok: true, value: 8, sources: [{ url: expect.stringContaining('Explosives_(class)') }] })
  })
  it('disagree → withheld with the detail; no positive pair → not this rule’s (detail null)', () => {
    expect(checkExplosiveStat('damage', 100, ev(250))).toEqual({ ok: false, detail: 'the wiki infobox states 100, the Explosives (class) table 250' })
    expect(checkExplosiveStat('damage', 100, ev(100, 8, 250))).toMatchObject({ ok: false, detail: expect.stringContaining("the weapon's article 250") })
    expect(checkExplosiveStat('damage', 0, ev(0))).toEqual({ ok: false, detail: null })
    expect(checkExplosiveStat('damage', undefined, ev(100))).toEqual({ ok: false, detail: null })
    expect(checkExplosiveStat('knockback', 8, ev(100))).toEqual({ ok: false, detail: null })
    expect(checkExplosiveStat('damage', 100, ev(0))).toEqual({ ok: false, detail: 'the wiki infobox states 100, the Explosives (class) table 0' })
  })
})

describe('explosiveEvidence (the build’s lookup)', () => {
  it('the class row + the own article’s sentence (checked verbatim through the callback); no row → undefined', () => {
    const own = article('Bomb', '<p>The explosion also deals 100 damage to all enemies, critters, and players in the radius, but not NPCs.</p>', 1031782)
    const checked: string[] = []
    const lookup = explosiveEvidence(new Map([[EXPLOSIVES_CLASS_PAGE, CLASS_TABLE], ['Bomb', own]]), (page, sentence) => checked.push(`${page}: ${sentence}`))
    expect(lookup(166, 'Bomb')).toMatchObject({ table: { damage: 100, knockback: 8 }, stated: { value: 100 } })
    expect(checked).toEqual(['Bomb: The explosion also deals 100 damage to all enemies, critters, and players in the radius, but not NPCs.'])
    expect(lookup(168, 'Grenade')).toBeUndefined() // grenades are "not considered part of the explosives class": no row
    expect(explosiveEvidence(new Map())(166, 'Bomb')).toBeUndefined()
  })
})
