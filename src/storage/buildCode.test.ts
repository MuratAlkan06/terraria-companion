/**
 * P7-S2b one build as text (src/storage/transfer.ts — ADR D6 export/import, AMENDMENTS-016 B123(a)/(b)):
 * the `#code:` line encodes the v2 build record deterministically and reads back exactly — every slot
 * shape, the emptied markers, the target boss, the owned list, notes, any name — through the SAME load path
 * a stored build takes (a code imports exactly when a load would). A code cut short, edited, of a newer
 * version, or not a code at all says so honestly; nothing is guessed.
 */
import { describe, expect, it } from 'vitest'
import { meta } from '../data/meta'
import { defaultReadinessSetup } from './readiness'
import { decodeEnvelope, domainVersion } from './index'
import type { SavedBuild } from './builds'
import { BUILD_CODE_LINE, buildCodeCheck, buildCodeLine, buildRecordOf, canonicalJson, encodeBuildCode, readBuildText, sameBuild, type BuildCodeRead, type BuildRecord } from './transfer'

const empty = () => defaultReadinessSetup().loadout

/** One record per slot shape the builder can save (B106 v2) — and the shapes a v1 build can hold. */
const RECORDS: Record<string, BuildRecord> = {
  full: {
    name: 'Ranged for Plantera',
    stage: 'mid-hm',
    class: 'ranged',
    difficulty: 'master',
    goal: 'boss',
    slots: { mainWeapon: 434, altWeapon: 1229, helmet: 1001, chest: 1002, legs: 1003, accessories: [1, 2, 3, 4, 5, 6, 7], ammo: [97, 1302], buffs: [288, 289, 2346], summon: 1309 },
    targetBoss: 'plantera',
    ownedIds: [434, 1229],
    emptiedSlots: [],
  },
  emptiedEverywhere: {
    name: 'Bare',
    stage: 'early-prehm',
    class: 'melee',
    difficulty: 'classic',
    goal: 'balanced',
    slots: { ...empty(), accessories: [null, null, null, null, null] },
    ownedIds: [],
    emptiedSlots: ['main', 'alt', 'armor', 'acc0', 'acc1', 'acc2', 'acc3', 'acc4', 'ammo0', 'ammo1', 'buff0', 'buff1', 'buff2', 'summon'],
  },
  partial: {
    // one armor piece, gaps between accessories, one ammo, a potion, the alt left unfilled (not emptied)
    name: 'Half & half — “quoted” \\ back',
    stage: 'early-hm',
    class: 'summon',
    difficulty: 'expert',
    goal: 'survivability',
    slots: { mainWeapon: 4913, altWeapon: null, helmet: 1001, chest: null, legs: null, accessories: [null, 2, null, 4, null, 6, null], ammo: [97], buffs: [288], summon: null },
    targetBoss: 'the-twins',
    ownedIds: [4913],
    emptiedSlots: ['acc0', 'buff2', 'summon'],
  },
  unicode: { name: 'Zenith ✨ 天 — 🗡️ build', stage: 'endgame', class: 'hybrid', difficulty: 'expert', slots: { ...empty(), mainWeapon: 4956 }, notes: 'line one\nline two', ownedIds: [], emptiedSlots: ['alt'] },
  v1Shaped: { name: 'Old one', stage: 'endgame', class: 'magic', difficulty: 'classic', slots: { ...empty(), accessories: [1, null, null, null, null] } },
  unknownIds: { name: 'From the future', stage: 'endgame', class: 'melee', difficulty: 'classic', goal: 'max-damage', slots: { ...empty(), mainWeapon: 999_999, accessories: [888_888, null, null, null, null] }, ownedIds: [777_777], emptiedSlots: [] },
}

const ok = (r: BuildCodeRead) => {
  if (!r.ok) throw new Error(`unreadable: ${JSON.stringify(r.error)}`)
  return r
}
const errorOf = (r: BuildCodeRead) => (r.ok ? 'ok' : r.error.kind)
/** A code with a VALID check over any payload (to reach the checks past the checksum). */
const codeOf = (payload: unknown, v = domainVersion('builds')) => {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const body = `tcb.${v}.${base64}`
  return `${body}.${buildCodeCheck(body)}`
}

describe('encode → read: the build comes back exactly', () => {
  it.each(Object.keys(RECORDS))('%s', (key) => {
    const record = RECORDS[key]
    const code = encodeBuildCode(record)
    expect(code).toMatch(/^tcb\.2\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/)
    const read = ok(readBuildText(buildCodeLine(code)))
    expect(read.build).toEqual(record)
    expect(read).toMatchObject({ v: 2, gameVersion: meta.gameVersion })
    // and through the load path a stored build takes, as the record of a saved build
    const stored = decodeEnvelope('builds', { v: 2, savedAt: '2026-10-15T00:00:00.000Z', gameVersion: meta.gameVersion, data: { builds: [{ ...read.build, buildId: 'b-roundtrip', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' }] } })
    expect(stored.ok).toBe(true)
  })

  it('deterministic: the same build always gives the same code, whatever its key order or its id and dates', () => {
    const record = RECORDS.full
    const shuffled = Object.fromEntries(Object.entries(record).reverse()) as unknown as BuildRecord
    expect(encodeBuildCode(shuffled)).toBe(encodeBuildCode(record))
    const saved: SavedBuild = { ...record, buildId: 'b-anything-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' }
    expect(encodeBuildCode(saved)).toBe(encodeBuildCode(record))
    expect(buildRecordOf(saved)).toEqual(record)
    expect(sameBuild(saved, record)).toBe(true)
    expect(sameBuild(saved, { ...record, name: 'Other' })).toBe(false)
    // canonical JSON: keys sorted at every level, arrays in order, absent keys absent
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}')
  })

  it('a different game-data version is carried, not an error (items keep their ids)', () => {
    expect(ok(readBuildText(buildCodeLine(encodeBuildCode(RECORDS.full, '1.4.4.9')))).gameVersion).toBe('1.4.4.9')
  })

  it('refuses to encode a build this site couldn’t read back (validated first, like saveDomain)', () => {
    expect(() => encodeBuildCode({ ...RECORDS.full, stage: 'nowhere' as never })).toThrow(/Not a valid build: .*stage/)
    expect(() => encodeBuildCode({ ...RECORDS.full, slots: { ...RECORDS.full.slots, accessories: [1, 2] } })).toThrow(/accessories/)
  })
})

describe('what an import reads: the #code: line only', () => {
  const code = encodeBuildCode(RECORDS.partial)

  it('the whole block, the line alone, the bare code, CRLF line ends, spaces inside the code, a lower-case lead', () => {
    const block = ['Terraria Companion build', 'Name: anything at all', 'Slots:', 'Main weapon: not read', '', buildCodeLine(code)].join('\n')
    for (const pasted of [block, buildCodeLine(code), code, `  ${code}  `, block.replace(/\n/g, '\r\n'), `${BUILD_CODE_LINE} ${code.slice(0, 40)} ${code.slice(40)}`, `#CODE: ${code}`]) {
      expect(ok(readBuildText(pasted)).build, pasted.slice(0, 30)).toEqual(RECORDS.partial)
    }
  })

  it('the readable lines are never parsed: editing them changes nothing', () => {
    const edited = ['Name: Something else', 'Main weapon: Zenith', buildCodeLine(code)].join('\n')
    expect(ok(readBuildText(edited)).build.name).toBe(RECORDS.partial.name)
  })

  it('the same code pasted twice is one build; two different codes are refused', () => {
    expect(ok(readBuildText(`${buildCodeLine(code)}\n${buildCodeLine(code)}`)).build).toEqual(RECORDS.partial)
    const two = readBuildText(`${buildCodeLine(code)}\n${buildCodeLine(encodeBuildCode(RECORDS.full))}`)
    expect(two).toEqual({ ok: false, error: { kind: 'several-codes', count: 2 } })
  })
})

describe('honest errors', () => {
  const code = encodeBuildCode(RECORDS.full)

  it('nothing pasted; not a build text (no #code: line, or another kind of code)', () => {
    expect(errorOf(readBuildText(''))).toBe('empty')
    expect(errorOf(readBuildText('  \n\t'))).toBe('empty')
    for (const t of ['Name: My build\nMain weapon: Zenith', '{"format":"terraria-companion-backup"}', '#code: abc.2.xyz', 'eyJidWlsZCI6e319']) expect(errorOf(readBuildText(t)), t).toBe('no-code')
  })

  it('truncated anywhere → damaged (never a different build)', () => {
    // every cut point, exhaustively (the code is short; a stride could step over the one cut that misreads)
    for (let cut = 4; cut < code.length; cut++) {
      const r = readBuildText(buildCodeLine(code.slice(0, cut)))
      expect(r.ok, `cut at ${cut}`).toBe(false)
      expect(errorOf(r), `cut at ${cut}`).toBe('damaged')
    }
  })

  it('one character changed anywhere in the payload or the check → damaged', () => {
    const start = code.indexOf('.', 4) + 1
    for (let i = start; i < code.length; i++) {
      if (code[i] === '.') continue
      const swapped = code[i] === 'A' ? 'B' : code[i] === '0' ? '1' : /[0-9a-f]/.test(code[i]) && i > code.lastIndexOf('.') ? (code[i] === 'f' ? 'e' : 'f') : 'A'
      const tampered = `${code.slice(0, i)}${swapped}${code.slice(i + 1)}`
      expect(errorOf(readBuildText(tampered)), `char ${i}`).toBe('damaged')
    }
  })

  it('a newer version of the site → future-version (said before anything else is checked)', () => {
    const future = code.replace(/^tcb\.2\./, 'tcb.3.')
    expect(readBuildText(future)).toEqual({ ok: false, error: { kind: 'future-version', version: 3, supported: 2 } })
    expect(readBuildText('#code: tcb.99.whatever-this-version-cannot-know')).toEqual({ ok: false, error: { kind: 'future-version', version: 99, supported: 2 } })
    expect(errorOf(readBuildText('#code: tcb.0.abc.00000000'))).toBe('damaged')
  })

  it('a well-formed code whose build fails the load path’s checks → invalid, with the validator’s message (import ⇔ load)', () => {
    const build = { ...RECORDS.full }
    const cases: [unknown, RegExp][] = [
      [{ build: { ...build, stage: 'nowhere' }, gameVersion: '1.4.5.8' }, /stage/],
      [{ build: { ...build, slots: { ...build.slots, mainWeapon: -1 } }, gameVersion: '1.4.5.8' }, /mainWeapon/],
      [{ build: { ...build, emptiedSlots: ['acc9'] }, gameVersion: '1.4.5.8' }, /emptiedSlots/],
      [{ build: { ...build, extra: true }, gameVersion: '1.4.5.8' }, /unexpected keys extra/],
      [{ build: { ...build, buildId: 'b-sneaky-01' }, gameVersion: '1.4.5.8' }, /unexpected keys buildId/],
      [{ build, gameVersion: '1.4.5.8', more: 1 }, /exactly \{ build, gameVersion \}/],
      [{ build, gameVersion: 1458 }, /gameVersion/],
      [{ build: [build], gameVersion: '1.4.5.8' }, /code\.build/],
      [[build], /expected an object/],
    ]
    for (const [payload, message] of cases) {
      const r = readBuildText(codeOf(payload))
      if (r.ok || r.error.kind !== 'invalid') throw new Error(`expected invalid for ${JSON.stringify(payload).slice(0, 60)}: ${JSON.stringify(r)}`)
      expect(r.error.failure.message).toMatch(message)
    }
    // the payload isn't JSON (with a valid check): damaged
    expect(errorOf(readBuildText(codeOf('{"build":')))).toBe('damaged')
  })

  it('an older build version reads through the migrations, as a stored one would (v1: no v2 fields)', () => {
    const v1 = { name: 'Old one', stage: 'endgame', class: 'magic', difficulty: 'classic', slots: empty() }
    const r = ok(readBuildText(codeOf({ build: v1, gameVersion: '1.4.5.8' }, 1)))
    expect(r.v).toBe(1)
    expect(r.build).toEqual(v1)
  })
})
