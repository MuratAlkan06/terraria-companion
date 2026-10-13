/**
 * `npm run pipeline:spotcheck` — AMENDMENTS-001 A2 AC2 aid: prints, for each case in
 * pipeline/spotcheck/cases.json, the emitted record(s) (names resolved) next to the matching
 * rows of the rendered wiki ARTICLE (recipe tables on the result's page, the drops section on
 * the source's page). Articles are fetched with the D2-etiquette client (cached under
 * pipeline/raw/spotcheck/, counted in requests.log.jsonl). Judgement stays human: the output
 * is laid out for side-by-side comparison.
 *
 *   tsx pipeline/cli/spotcheck.ts [--dataset src/data]
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Condition, DropSource, Recipe, RecipeGroup } from '../../src/schemas'
import { RAW_DIR, WikiClient } from '../fetch'
import { findAll, hasClass, parseHtml, type HNode } from '../parse/html'
import { stripMarkup } from '../parse/text'

const repoRoot = resolve(import.meta.dirname, '..', '..')

type Case = { kind: 'recipe'; page: string; result: string; why: string } | { kind: 'drop'; page: string; item: string; source?: string; why: string }

const PLATFORM_NOTE = /\((?:Desktop, Console(?:, Old-gen console)? and Mobile versions|Desktop version, Console version, and Mobile version)\)/g
const MODE_LABEL: Record<string, string> = { 'm-normal': 'classic', 'm-expert-master': 'expert+master', 'm-expert': 'expert', 'm-master': 'master' }

/** Cell text with per-difficulty spans labelled ("classic 1% · expert+master 1.99%"). */
function cellText(nodes: readonly HNode[]): string {
  const parts: string[] = []
  for (const n of nodes) {
    if (n.type === 'text') parts.push(n.text)
    else if (n.type === 'br') parts.push(' / ')
    else if (n.classes.includes('m-journey') && !n.classes.includes('m-normal')) continue
    else {
      const label = n.classes.map((c) => MODE_LABEL[c]).find(Boolean)
      const inner = cellText(n.children)
      parts.push(label ? ` [${label}: ${stripMarkup(inner)}] ` : inner)
    }
  }
  return parts.join('')
}

const clean = (s: string) => stripMarkup(s).replace(PLATFORM_NOTE, '').replace(/\s+/g, ' ').trim()

/** Table rows as "cell | cell"; rowspan continuation rows (fewer cells) are flagged. */
function tableRows(table: HNode): { text: string; cells: number }[] {
  return findAll(table.type === 'el' ? table.children : [], (n) => n.type === 'el' && n.tag === 'tr').map((tr) => {
    const cells = (tr.type === 'el' ? tr.children : []).filter((c) => c.type === 'el' && (c.tag === 'td' || c.tag === 'th'))
    return { text: cells.map((c) => clean(cellText(c.type === 'el' ? c.children : []))).join(' | '), cells: cells.length }
  })
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { dataset: { type: 'string' } }, strict: true })
  const dir = resolve(values.dataset ?? join(repoRoot, 'src/data'))
  const load = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T
  const universe = load<{ items: { id: number; name?: string; internalName: string }[] }>('item-universe.json')
  const names = new Map(universe.items.map((i) => [i.id, i.name ?? i.internalName]))
  const recipes = load<Recipe[]>('recipes.json')
  const groups = new Map(load<RecipeGroup[]>('recipe-groups.json').map((g) => [g.id, g]))
  const conditions = new Map(load<Condition[]>('conditions.json').map((c) => [c.id, c]))
  const drops = load<DropSource[]>('drops.json')
  const cases = JSON.parse(readFileSync(join(repoRoot, 'pipeline/spotcheck/cases.json'), 'utf8')) as Case[]
  const idByName = new Map(universe.items.flatMap((i) => (i.name ? [[i.name, i.id] as const] : [])))
  const client = new WikiClient({ cacheDir: RAW_DIR })

  const n = (id: number) => names.get(id) ?? `#${id}`
  const station = (s: Recipe['stations'][number]) => (s.kind === 'item' ? n(s.itemId) : s.kind === 'group' ? (groups.get(s.groupId)?.name ?? s.groupId) : `[${conditions.get(s.condition)?.name ?? s.condition}]`)
  const pct = (r?: number) => (r === undefined ? '—' : `${Number((r * 100).toPrecision(4))}%`)
  const qty = (q: DropSource['quantity']) =>
    'min' in q ? `${q.min}${q.max !== q.min ? `–${q.max}` : ''}` : Object.entries(q).map(([d, v]) => `${d} ${v.min}${v.max !== v.min ? `–${v.max}` : ''}`).join(', ') || '—'

  for (const c of cases) {
    const { response } = await client.get({ action: 'parse', page: c.page, prop: 'text' }, `spotcheck/${c.page.replace(/[^A-Za-z0-9._-]/g, '_')}`)
    const html = (response as { parse: { text: string } }).parse.text
    const nodes = parseHtml(html)
    console.log(`\n=== ${c.kind.toUpperCase()} · ${c.kind === 'recipe' ? c.result : `${c.source ?? c.page} → ${c.item}`} · ${c.why}`)
    console.log(`    wiki: https://terraria.wiki.gg/wiki/${encodeURIComponent(c.page.replaceAll(' ', '_'))}`)
    if (c.kind === 'recipe') {
      const id = idByName.get(c.result)
      for (const r of recipes.filter((x) => x.resultItemId === id)) {
        const ings = r.ingredients.map((i) => `${i.ref.kind === 'item' ? n(i.ref.itemId) : (groups.get(i.ref.groupId)?.name ?? i.ref.groupId)} ×${i.amount}`).join(', ')
        console.log(`  DATA  ${n(r.resultItemId)} ×${r.resultAmount} ← ${ings} @ ${r.stations.map(station).join(' + ') || 'By Hand'}  [${r.id}]`)
      }
      let printed = 0
      for (const t of findAll(nodes, (x) => hasClass(x, 'recipes'))) {
        const rows = tableRows(t)
        const full = Math.max(...rows.map((r) => r.cells))
        let inResult = false
        for (const r of rows) {
          // "<versions> only:" prefixes and "Internal Item ID: N" are presentation, not recipe data
          const text = r.text.replace(/^.*?only:\s*/, '').replace(/\s*Internal Item ID: \d+/, '')
          if (r.cells === full) inResult = text.startsWith(c.result)
          if (inResult) {
            printed += 1
            console.log(`  WIKI  ${r.cells === full ? '' : '  (cont.) '}${text}`)
          }
        }
      }
      if (printed === 0) {
        // list pages (e.g. "Chests") show recipes in their own tables: fall back to any row starting with the result
        for (const t of findAll(nodes, (x) => x.type === 'el' && x.tag === 'table')) {
          for (const r of tableRows(t)) {
            const text = r.text.replace(/\s*Internal Item ID: \d+/, '')
            if (text.startsWith(`${c.result} |`) && /\d/.test(text)) console.log(`  WIKI  ${text}`)
          }
        }
      }
    } else {
      const id = idByName.get(c.item)
      for (const d of drops.filter((x) => x.itemId === id && (!c.source || x.source.npcName.startsWith(c.source)))) {
        console.log(`  DATA  ${d.source.npcName}${d.source.npcIds ? ` (ids ${d.source.npcIds.join(',')})` : ''} → ${n(d.itemId)} qty ${qty(d.quantity)} | classic ${pct(d.rates.classic)} · expert ${pct(d.rates.expert)} · master ${pct(d.rates.master)}${d.conditions.length ? ` | when ${d.conditions.join(', ')}` : ''}${d._prov.unverifiedFields.length ? ` | Unknown: ${d._prov.unverifiedFields.join(', ')}` : ''}`)
      }
      // any table row / list item of the article that names the item (drop infobox lists, segment tables, loot tables)
      const seen = new Set<string>()
      for (const row of findAll(nodes, (x) => x.type === 'el' && (x.tag === 'tr' || x.tag === 'li'))) {
        const text = clean(cellText(row.type === 'el' ? row.children : []))
        if (text.includes(c.item) && text.length < 400 && !seen.has(text)) {
          seen.add(text)
          console.log(`  WIKI  ${text}`)
        }
      }
    }
  }
  console.log(`\nnetwork requests this run: ${client.stats.networkRequests} (cache hits ${client.stats.cacheHits})`)
  return 0
}

process.exitCode = await main()
