/**
 * P7-S4 licensing, credits and legal completeness: the /about/licensing page (data attribution + share-alike,
 * Re-Logic notice, takedown contact in both states, font and library credits), the root legal files (NOTICE,
 * LICENSES/, README legal section + takedown runbook) and the OFL text served from public/ — each pinned to
 * its source of truth (package.json, the installed packages, the font packages' own LICENSE files, the sprite
 * flip point the app actually fetches), plus a copy audit over every rendered sentence.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import pkg from '../../../../package.json'
import spriteIndex from '../../../../public/sprites/manifest.index.json'
import { meta } from '../../../data/meta'
import { auditCopy } from '../../../scoring/copyAudit'
import { SITE } from '../../site'
import LicensingPage, { CONTACT_PLACEHOLDER, TakedownSection } from '../LicensingPage'
import { FONT_CREDITS, LIBRARY_CREDITS, LIBRARY_LICENSES_FILE, LIBRARY_LICENSES_PATH, OFL_TEXT_PATH } from './credits'

const ROOT = '../../../../'
/** Root legal files; `LICENSE*` picks up the code license file (the owner's grant). */
const ROOT_FILES = import.meta.glob<string>(['../../../../NOTICE', '../../../../README.md', '../../../../LICENSE*', '../../../../LICENSES/*', '../../../../public/licenses/*', '../../../data/LICENSE.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const FONT_LICENSES = import.meta.glob<string>('../../../../node_modules/@fontsource*/*/LICENSE', { query: '?raw', import: 'default', eager: true })
const INSTALLED = import.meta.glob<{ name?: string; license?: string }>(['../../../../node_modules/*/package.json', '../../../../node_modules/@*/*/package.json'], {
  import: 'default',
  eager: true,
})
const SOURCES = import.meta.glob<string>(['../../../main.tsx', '../../../data-access/sources.ts', '../../../../pipeline/validate/emitted.test.ts', '../../../../vite.config.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const file = (path: string): string => {
  const text = ROOT_FILES[ROOT + path]
  if (text === undefined) throw new Error(`missing ${path}`)
  return text
}
const installed = (name: string) => INSTALLED[`${ROOT}node_modules/${name}/package.json`]
const fontLicense = (name: string) => FONT_LICENSES[`${ROOT}node_modules/${name}/LICENSE`]
const decode = (s: string) => s.replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** Visible text: block ends become spaces, inline tags vanish (so "Re-Logic’s" and "Re-Logic;" stay intact). */
const text = (html: string) =>
  decode(
    html
      .replace(/<\/(?:p|li|ul|h\d|header|section|div)>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' '),
  )
/** A Markdown section's body: from its heading to the next heading of the same or a higher level. */
function section(md: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 2
  const start = md.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`no section ${heading}`)
  const rest = md.slice(start + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next < 0 ? rest : rest.slice(0, next)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The root code license file, if present, and the license it names ("MIT License" → "MIT"). */
const CODE_LICENSE = Object.entries(ROOT_FILES).find(([k]) => /^(?:\.\.\/){4}LICENSE(?:\.[a-z]+)?$/.test(k))?.[1]
const CODE_LICENSE_NAME = CODE_LICENSE === undefined ? undefined : /^(\S+) License$/m.exec(CODE_LICENSE)?.[1]

const PAGE = renderToStaticMarkup(createElement(LicensingPage))
const PAGE_TEXT = text(PAGE)
const CONTACT = { label: 'takedown@example.org', href: 'mailto:takedown@example.org' }
const CREDITED_PACKAGES = [...FONT_CREDITS.map((f) => f.pkg), ...LIBRARY_CREDITS.flatMap((l) => l.pkgs)]

describe('/about/licensing page', () => {
  it('has every section, in order: data, Re-Logic, non-commercial, takedown, fonts, software', () => {
    expect([...PAGE.matchAll(/<h2 id="([a-z-]+)"/g)].map((m) => m[1])).toEqual(['lic-data', 'lic-relogic', 'lic-noncommercial', 'lic-takedown', 'lic-fonts', 'lic-software'])
    for (const id of ['lic-data', 'lic-relogic', 'lic-noncommercial', 'lic-takedown', 'lic-fonts', 'lic-software']) expect(PAGE).toContain(`aria-labelledby="${id}"`)
  })

  it('wiki data: verbatim ADR D3 attribution, the wiki, its contributors, the license and policy links, the changes made, the version pin', () => {
    expect(PAGE_TEXT).toContain(SITE.attribution)
    for (const href of [SITE.wikiUrl, SITE.licenseUrl, SITE.wikiCopyrightsUrl]) expect(PAGE).toContain(`href="${href}"`)
    expect(PAGE_TEXT).toContain('the wiki’s contributors')
    expect(PAGE_TEXT).toMatch(/Changes made: values are extracted from the wiki, normalized and combined/)
    expect(PAGE_TEXT).toContain('“Unknown”, never guessed')
    expect(PAGE_TEXT).toContain(`Terraria ${meta.gameVersion} (${SITE.platformLabel})`)
    expect(PAGE_TEXT).toMatch(/without warranties \(Section 5 of the license\)/)
  })

  it('share-alike: the derived data files are published under the same license, and the statement says what it does not cover', () => {
    expect(PAGE_TEXT).toContain(`Share-alike: the data files this site derives from the wiki are published under the same license, ${SITE.licenseName}.`)
    expect(PAGE_TEXT).toMatch(/non-commercial purposes if you credit the Official Terraria Wiki’s contributors, say what you changed and share your version under the same license/)
    expect(PAGE_TEXT).toContain('This covers the data only — not the sprites (below) and not the site’s source code.')
  })

  it('Re-Logic: copyright and trademarks, sprites outside the CC license, never hotlinked, takedown honored, unaffiliated', () => {
    expect(PAGE_TEXT).toContain('Terraria and Re-Logic are trademarks of Re-Logic')
    expect(PAGE_TEXT).toMatch(/not covered by the wiki’s Creative Commons license/)
    expect(PAGE_TEXT).toContain('never hotlinked from the wiki')
    expect(PAGE_TEXT).toContain('a sprite takedown request is honored')
    expect(PAGE_TEXT).toContain('It is not affiliated with, endorsed by or sponsored by Re-Logic or the Terraria Wiki.')
    // the hyphenated names never wrap (design review N3)
    expect(PAGE).not.toMatch(/[^>]Re-Logic/)
  })

  it('takedown, no contact published: the placeholder on the contact line, and the pending note below it', () => {
    expect(CONTACT_PLACEHOLDER).toBe('[contact pending — see below]')
    const html = renderToStaticMarkup(createElement(TakedownSection, { contact: null }))
    const t = text(html)
    expect(t).toContain(`Contact: ${CONTACT_PLACEHOLDER}`)
    expect(t.indexOf('Pending:')).toBeGreaterThan(t.indexOf(CONTACT_PLACEHOLDER))
    expect(t).toContain('one switch replaces every Re-Logic sprite on the site with original placeholder art')
    expect(html).not.toContain('mailto:')
    // the page renders this state while SITE.takedownContact is unset
    if (SITE.takedownContact === null) expect(PAGE_TEXT).toContain(`Contact: ${CONTACT_PLACEHOLDER}`)
  })

  it('takedown, contact published: a link to it, no placeholder', () => {
    const html = renderToStaticMarkup(createElement(TakedownSection, { contact: CONTACT }))
    expect(html).toContain(`href="${CONTACT.href}"`)
    expect(text(html)).toContain(`Contact: ${CONTACT.label}`)
    expect(html).not.toContain(CONTACT_PLACEHOLDER)
    expect(text(html)).not.toContain('Pending:')
  })

  it('fonts: each credit (name, use, copyright) and a link to the full OFL text served with the site', () => {
    for (const f of FONT_CREDITS) {
      expect(PAGE).toContain(`data-font-credit="${f.pkg}"`)
      expect(PAGE).toContain(`href="${f.url}"`)
      expect(PAGE_TEXT).toContain(`${f.family} (opens in a new tab) Used for ${f.use}. ${decode(f.copyright)}.`)
    }
    expect(OFL_TEXT_PATH).toBe('/licenses/OFL-1.1.txt')
    expect(PAGE).toContain(`href="${OFL_TEXT_PATH}"`)
    expect(PAGE_TEXT).toContain('licensed under the SIL Open Font License 1.1 and self-hosted with the site')
    expect(PAGE_TEXT).toContain('Read the full license text, with both copyright notices')
  })

  it('open-source software: every library credit with its use and license', () => {
    for (const l of LIBRARY_CREDITS) {
      expect(PAGE).toContain(`data-library-credit="${l.pkgs.join(' ')}"`)
      expect(PAGE).toContain(`href="${l.url}"`)
      expect(PAGE_TEXT).toContain(`${l.name} (opens in a new tab) — ${l.use} · ${l.license}`)
    }
    // a wrapping description keeps the link on its first line (B127 375 nit): baseline, not centred
    const rows = PAGE.match(/<li data-library-credit="[^"]+" class="[^"]*"/g) ?? []
    expect(rows).toHaveLength(LIBRARY_CREDITS.length)
    for (const row of rows) expect(row).toContain('items-baseline')
  })

  it('open-source software: links the license texts generated at build (B127), and says what the file holds', () => {
    expect(LIBRARY_LICENSES_PATH).toBe(`/${LIBRARY_LICENSES_FILE}`)
    // the file the build emits (vite.config.test.ts checks the build output itself)
    expect(SOURCES['../../../../vite.config.ts']).toContain(`export const LIBRARY_LICENSES_FILE = '${LIBRARY_LICENSES_FILE}'`)
    expect(SOURCES['../../../../vite.config.ts']).toContain('build: { license: { fileName: LIBRARY_LICENSES_FILE } }')
    expect(PAGE).toContain(`href="${LIBRARY_LICENSES_PATH}"`)
    expect(PAGE_TEXT).toContain('Read the full license texts of the bundled libraries')
    expect(PAGE_TEXT).toContain('Generated from the installed packages with each build of the site, including the packages these libraries use.')
    // tailwindcss ships no JS, so the generated file can't carry it: the page says where its text is
    expect(PAGE_TEXT).toContain('Tailwind CSS ships only as generated styles; its license text is published in its repository.')
  })

  it('every link opens safely in a new tab and every URL is absolute https or a license file served with the site', () => {
    const anchors = [...PAGE.matchAll(/<a [^>]*>/g)].map((m) => m[0])
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(a).toContain('target="_blank"')
      expect(a).toContain('rel="noopener noreferrer"')
      expect(a).toMatch(/href="(https:\/\/[^"]+|\/licenses\/OFL-1\.1\.txt|\/licenses\/third-party-software\.txt)"/)
    }
  })

  it('standalone links (credit rows, the license texts, a published contact) carry the 44px touch target (UX_SPEC §9)', () => {
    const rows = [...PAGE.matchAll(/<li data-(?:font|library)-credit="[^"]+"[^>]*><a [^>]*>/g)].map((m) => m[0])
    expect(rows).toHaveLength(FONT_CREDITS.length + LIBRARY_CREDITS.length)
    for (const row of rows) expect(row).toContain('min-h-tap')
    expect(PAGE).toMatch(new RegExp(`<a href="${OFL_TEXT_PATH}"[^>]*min-h-tap`))
    expect(PAGE).toMatch(new RegExp(`<a href="${LIBRARY_LICENSES_PATH}"[^>]*min-h-tap`))
    expect(renderToStaticMarkup(createElement(TakedownSection, { contact: CONTACT }))).toMatch(/<a href="mailto:[^"]+"[^>]*min-h-tap/)
    // the placeholder never breaks mid-phrase
    expect(renderToStaticMarkup(createElement(TakedownSection, { contact: null }))).toContain(`<strong class="whitespace-nowrap text-fg">${CONTACT_PLACEHOLDER}</strong>`)
  })

  it('copy audit: no outcome, odds or forward-promise wording in any rendered sentence (both takedown states)', () => {
    const takedownSet = text(renderToStaticMarkup(createElement(TakedownSection, { contact: CONTACT })))
    const takedownUnset = text(renderToStaticMarkup(createElement(TakedownSection, { contact: null })))
    for (const t of [...PAGE_TEXT.split(/(?<=[.:])\s/), takedownSet, takedownUnset]) expect(auditCopy(t), t).toBeUndefined()
  })
})

describe('credits match what ships', () => {
  it('every runtime dependency is credited (font or library); every credited package is a dependency', () => {
    const deps = Object.keys(pkg.dependencies)
    const all = new Set([...deps, ...Object.keys(pkg.devDependencies)])
    expect(deps.filter((d) => !CREDITED_PACKAGES.includes(d))).toEqual([])
    expect(CREDITED_PACKAGES.filter((p) => !all.has(p))).toEqual([])
    expect(new Set(CREDITED_PACKAGES).size).toBe(CREDITED_PACKAGES.length)
  })

  it('each credited license id is the one the installed package declares', () => {
    for (const l of LIBRARY_CREDITS) for (const p of l.pkgs) expect(installed(p)?.license, p).toBe(l.license)
    for (const f of FONT_CREDITS) expect(installed(f.pkg)?.license, f.pkg).toBe('OFL-1.1')
  })

  it('the credited fonts are exactly the font packages the app loads', () => {
    const main = SOURCES['../../../main.tsx'] ?? ''
    const loaded = [...main.matchAll(/import '(@fontsource[^/]*\/[^/]+)\//g)].map((m) => m[1]).sort()
    expect(loaded.length).toBeGreaterThan(0)
    expect(FONT_CREDITS.map((f) => f.pkg).sort()).toEqual(loaded)
  })

  it('each font credit’s copyright (and Reserved Font Name) comes from the font’s own license', () => {
    for (const f of FONT_CREDITS) {
      const first = (fontLicense(f.pkg) ?? '').split('\n')[0]
      expect(first.startsWith(f.copyright.split(',')[0]), f.pkg).toBe(true)
      const rfn = /Reserved Font Name "([^"]+)"/.exec(first)?.[1]
      if (rfn) expect(f.copyright).toContain(`Reserved Font Name “${rfn}”`)
    }
  })
})

describe('OFL text (LICENSES/OFL-1.1.txt, served as public/licenses/OFL-1.1.txt)', () => {
  it('the served copy is identical to the repository copy', () => {
    expect(file('public/licenses/OFL-1.1.txt')).toBe(file('LICENSES/OFL-1.1.txt'))
  })

  it('carries each bundled font’s copyright line and the full license text, verbatim from the font package', () => {
    const ofl = file('LICENSES/OFL-1.1.txt')
    for (const f of FONT_CREDITS) {
      const original = fontLicense(f.pkg)
      expect(original, f.pkg).toBeDefined()
      const [copyright, ...body] = (original ?? '').split('\n')
      expect(ofl).toContain(`${copyright}\n`)
      expect(ofl.endsWith(body.join('\n'))).toBe(true)
    }
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007')
  })
})

describe('root legal files', () => {
  it('CC BY-NC-SA 4.0 legal code is present in full', () => {
    const cc = file('LICENSES/CC-BY-NC-SA-4.0.txt')
    expect(cc.startsWith('Attribution-NonCommercial-ShareAlike 4.0 International\n')).toBe(true)
    for (const s of ['Section 3 -- License Conditions.', 'b. ShareAlike.', 'Section 5 -- Disclaimer of Warranties and Limitation of Liability.', 'Section 8 -- Interpretation.']) expect(cc).toContain(s)
  })

  it('DATA-NOTICE: source, license, changes made, share-alike terms, what it covers and excludes', () => {
    const d = file('LICENSES/DATA-NOTICE.md')
    expect(d).toContain(SITE.wikiUrl)
    expect(d).toContain(SITE.licenseUrl)
    expect(d).toContain(SITE.wikiCopyrightsUrl)
    for (const h of ['## Files covered', '## Source and attribution', '## Changes made', '## ShareAlike terms', '## Not covered by this notice', '## No warranty, no endorsement']) expect(d).toContain(h)
    expect(d).toContain('`src/data/*.json`')
    expect(d).toMatch(/Sprites and other Terraria artwork and audio\*\* — © Re-Logic/)
  })

  it('src/data/LICENSE.md: the datasets carry their own license pointer (ADR-001 D3), and its links resolve', () => {
    const pointer = ROOT_FILES['../../../data/LICENSE.md']
    expect(pointer).toBeDefined()
    expect(pointer).toContain('CC BY-NC-SA 4.0')
    expect(pointer).toContain(SITE.licenseUrl)
    expect(pointer).toContain(SITE.wikiUrl)
    const links = [...(pointer ?? '').matchAll(/\]\(\.\.\/\.\.\/([^)]+)\)/g)].map((m) => m[1])
    expect(links).toEqual(['LICENSES/DATA-NOTICE.md', 'LICENSES/CC-BY-NC-SA-4.0.txt', 'NOTICE'])
    for (const path of links) expect(ROOT_FILES[ROOT + path], path).toBeDefined()
  })

  it('NOTICE: the code-license line matches whether a LICENSE file exists and names its license; every license file it names exists; every credited package is listed', () => {
    const notice = file('NOTICE')
    expect(notice.includes('LICENSE: not yet chosen by the owner')).toBe(CODE_LICENSE === undefined)
    if (CODE_LICENSE !== undefined) {
      expect(CODE_LICENSE_NAME, 'LICENSE names its license on a "<Name> License" line').toBeDefined()
      expect(notice).toContain(`\nLICENSE: ${CODE_LICENSE_NAME}\n`)
    }
    const refs = (notice.match(/LICENSES\/[\w.-]+/g) ?? []).map((r) => r.replace(/\.$/, ''))
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(ROOT_FILES[ROOT + ref], ref).toBeDefined()
    for (const p of CREDITED_PACKAGES) expect(notice, p).toContain(p)
    for (const s of ['CC BY-NC-SA 4.0', 'trademarks of Re-Logic', 'not affiliated with', 'SIL Open Font License 1.1']) expect(notice).toContain(s)
  })

  it('the contact placeholder appears in the page, NOTICE and README exactly while no takedown contact is set; a set contact is in all three', () => {
    const contact = SITE.takedownContact
    const unset = contact === null
    expect(file('NOTICE').includes(CONTACT_PLACEHOLDER)).toBe(unset)
    expect(file('README.md').includes(CONTACT_PLACEHOLDER)).toBe(unset)
    expect(PAGE_TEXT.includes(CONTACT_PLACEHOLDER)).toBe(unset)
    if (contact !== null) {
      // the same address everywhere: NOTICE names it, README links it (Legal + runbook), the page links it as a 44px target
      expect(file('NOTICE')).toContain(`Takedown contact: ${contact.href.replace(/^mailto:/, '')}`)
      expect(section(file('README.md'), '## Legal')).toContain(`](${contact.href})`)
      expect(section(file('README.md'), '## Takedown runbook (sprites)')).toContain(`](${contact.href})`)
      expect(PAGE).toMatch(new RegExp(`<a href="${escapeRegExp(contact.href)}"[^>]*min-h-tap`))
      expect(PAGE_TEXT).toContain(`Contact: ${contact.label}`)
      expect(PAGE_TEXT).not.toContain('Pending:')
    }
  })

  it('README: a Legal section mirroring NOTICE (including the code license), linking every license file it names', () => {
    const readme = file('README.md')
    const legal = section(readme, '## Legal')
    for (const s of ['CC BY-NC-SA 4.0', 'ShareAlike', 'trademarks of Re-Logic', 'not affiliated', 'SIL OFL 1.1']) expect(legal).toContain(s)
    expect(legal.includes('Code license: not yet chosen by the owner')).toBe(CODE_LICENSE === undefined)
    if (CODE_LICENSE !== undefined) {
      expect(legal).toContain(`**Code license — ${CODE_LICENSE_NAME}.**`)
      expect(legal).toContain('[`LICENSE`](LICENSE)')
    }
    for (const ref of legal.match(/\]\((LICENSE|LICENSES\/[\w.-]+|NOTICE)\)/g) ?? []) {
      const path = ref.slice(2, -1)
      expect(ROOT_FILES[ROOT + path], path).toBeDefined()
    }
  })
})

describe('takedown runbook (README; ADR D3, AMENDMENTS-016 B112(b))', () => {
  const runbook = section(file('README.md'), '## Takedown runbook (sprites)')

  it('names manifest.index.json as the flip point — the file the app fetches, which carries the flag', () => {
    expect(runbook).toContain('**Flip point: `public/sprites/manifest.index.json`.**')
    expect(SOURCES['../../../data-access/sources.ts']).toContain('sprites/manifest.index.json')
    expect(typeof spriteIndex.fallbackMode).toBe('boolean')
    expect(runbook).toContain('`"fallbackMode":true`')
  })

  it('covers removing the binaries, rebuilding, verifying, re-flipping after a pipeline rebuild and the contact', () => {
    for (const s of ['find public/sprites -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +', 'npm run build', 'npm run pipeline:build', 'npm run pipeline:sprites', 'Takedown contact:']) expect(runbook).toContain(s)
  })

  it('every file and script it names exists', () => {
    expect(runbook).toContain('`pipeline/validate/emitted.test.ts`')
    expect(SOURCES['../../../../pipeline/validate/emitted.test.ts']).toMatch(/fallbackMode\)\.toBe\(false\)/)
    for (const script of runbook.match(/npm run [\w:]+/g) ?? []) expect(Object.keys(pkg.scripts), script).toContain(script.slice('npm run '.length))
  })
})
