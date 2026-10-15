/**
 * AMENDMENTS-016 B125(b)/(f), rendered: set-aside copies as the data page and the shared QuarantineNotice
 * show them. The app-wide quarantine store reads localStorage once when it is created (server rendering
 * uses that first state), so this file seeds a localStorage-like store BEFORE any import: one copy of this
 * browser's builds that failed to load, and one builds part and one plans part of an imported backup file.
 * (Vitest gives every test file its own globals and modules: nothing here reaches the other files.)
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QuarantineNotice } from '../../../components/QuarantineNotice'
import { DOMAIN_KEYS, storageKey } from '../../../storage'
import { wrapCopy } from '../../../storage/quarantine'
import { DATA, envelopeText, memoryBackend } from '../../../storage/testing/storageFixtures'
import { readStored } from '../../../storage/transfer'
import { useQuarantineStore } from '../../quarantineStore'
import { StoredSection } from './DataPage'

const SEED = vi.hoisted(() => {
  const FILE = 'terraria-companion-backup-2026-10-14.json'
  const origin = { kind: 'import', fileName: FILE, exportedAt: '2026-10-14T10:00:00.000Z' }
  // Written by hand (the wrapper's documented v1 shape, src/storage/quarantine.ts): imports aren't available yet.
  const wrapped = (raw: string) => JSON.stringify({ format: 'terraria-companion-set-aside', v: 1, origin, raw })
  const entries: Record<string, string> = {
    'tc.quarantine.builds.2026-10-15T08:00:00.000Z': '{"v":1,',
    'tc.quarantine.builds.2026-10-15T09:00:00.000Z': wrapped('{"v":9}'),
    'tc.quarantine.plans.2026-10-15T09:00:00.000Z': wrapped('{"v":9}'),
  }
  const map = new Map(Object.entries(entries))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  return { FILE, origin, entries }
})

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const PLANS_SENTENCE = 'Your saved plans couldn’t be read, so the whole saved set was set aside (not deleted).'
const FILE_SENTENCE = 'Part of a backup file couldn’t be read, so it was set aside (not restored, not deleted). Nothing saved in this browser was changed by it.'

describe('seeded copies', () => {
  it('the hand-written seed is exactly what setAside writes for an imported part (the store lists all three, with origins)', () => {
    expect(SEED.entries['tc.quarantine.plans.2026-10-15T09:00:00.000Z']).toBe(wrapCopy('{"v":9}', SEED.origin as never))
    expect(useQuarantineStore.getInitialState().records.map((r) => `${r.domain}:${r.origin.kind}`)).toEqual(['builds:local', 'builds:import', 'plans:import'])
  })
})

describe('QuarantineNotice: a backup file’s part never reads as this browser’s damage (B125(b))', () => {
  it('only a file’s part: the file’s sentence, never the surface’s sentence about saved data here', () => {
    const html = renderToStaticMarkup(createElement(QuarantineNotice, { domains: ['plans'], message: PLANS_SENTENCE }))
    expect(text(html)).toContain(FILE_SENTENCE)
    expect(html).not.toContain(PLANS_SENTENCE)
    // one copy: its actions sit on the notice; Discard carries the app's destructive trigger mark (trash icon)
    expect(html).toMatch(/data-quarantine-discard=""><svg[^>]*lucide-trash[\s\S]*?<\/svg>Discard permanently<\/button>/)
    expect(html).toMatch(/data-quarantine-restore="">Try restore<\/button>/)
  })

  it('this browser’s copy and a file’s part together: each in its own words', () => {
    const html = renderToStaticMarkup(createElement(QuarantineNotice, { domains: ['builds'], message: 'Some saved builds couldn’t be read and were set aside (not deleted).' }))
    expect(text(html)).toContain(`Some saved builds couldn’t be read and were set aside (not deleted). ${FILE_SENTENCE}`)
  })
})

describe('Saved in this browser: rows acknowledge their set-aside copies (B125(f))', () => {
  it('"Nothing saved" says the copies exist; a readable row counts them too; the others stay plain', () => {
    const b = memoryBackend({ [storageKey('plans')]: envelopeText(DATA.plans) })
    const t = text(renderToStaticMarkup(createElement(StoredSection, { stored: DOMAIN_KEYS.map((d) => readStored(d, b)) })))
    expect(t).toContain('Saved builds Loadouts saved from the builder Nothing saved · 2 set-aside copies (in the notice at the top of this page)')
    expect(t).toMatch(/Plans Item plans with owned amounts and checked steps 1 plan · \d+ bytes · saved [^·]+ · 1 set-aside copy \(in the notice at the top of this page\)/)
    expect(t).toContain('Settings Your game stage Nothing saved Boss progress')
    expect(t).toContain('Set-aside copies: 3')
  })
})
