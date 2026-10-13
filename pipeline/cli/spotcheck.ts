/**
 * `npm run pipeline:spotcheck` — AMENDMENTS-001 A2 AC2 / PRD P2-S2 AC2 aid: prints, for each case
 * in pipeline/spotcheck/cases.json, the emitted record(s) (names resolved) next to the matching
 * parts of the rendered wiki ARTICLE (recipe tables on the result's page, the drops section on
 * the source's page; for weapons the infobox statistics, recipe rows and the lead paragraph). Articles are fetched with the D2-etiquette client (cached under
 * pipeline/raw/spotcheck/, counted in requests.log.jsonl). Judgement stays human: the output
 * is laid out for side-by-side comparison.
 *
 *   tsx pipeline/cli/spotcheck.ts [--dataset src/data]
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { Boss, Condition, DropSource, Recipe, RecipeGroup, Weapon } from '../../src/schemas'
import { RAW_DIR, WikiClient } from '../fetch'
import { fetchArticles } from '../fetch/articles'
import { findAll, hasClass, parseHtml, type HNode } from '../parse/html'
import { stripMarkup } from '../parse/text'

const repoRoot = resolve(import.meta.dirname, '..', '..')

type Case =
  | { kind: 'recipe'; page: string; result: string; why: string }
  | { kind: 'drop'; page: string; item: string; source?: string; why: string }
  | { kind: 'weapon'; page: string; item: string; why: string }
  | { kind: 'boss'; page: string; boss: string; item: string; why: string }

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
  const weapons = load<Weapon[]>('weapons.detail.json')
  const bosses = load<Boss[]>('bosses.json')
  const cases = JSON.parse(readFileSync(join(repoRoot, 'pipeline/spotcheck/cases.json'), 'utf8')) as Case[]
  const idByName = new Map(universe.items.flatMap((i) => (i.name ? [[i.name, i.id] as const] : [])))
  const client = new WikiClient({ cacheDir: RAW_DIR })

  const n = (id: number) => names.get(id) ?? `#${id}`
  const station = (s: Recipe['stations'][number]) => (s.kind === 'item' ? n(s.itemId) : s.kind === 'group' ? (groups.get(s.groupId)?.name ?? s.groupId) : `[${conditions.get(s.condition)?.name ?? s.condition}]`)
  const recipeLine = (r: Recipe) => {
    const ings = r.ingredients.map((i) => `${i.ref.kind === 'item' ? n(i.ref.itemId) : (groups.get(i.ref.groupId)?.name ?? i.ref.groupId)} ×${i.amount}`).join(', ')
    const conds = r.conditions.length ? ` (when ${r.conditions.map((c) => conditions.get(c)?.name ?? c).join(', ')})` : ''
    return `${n(r.resultItemId)} ×${r.resultAmount} ← ${ings} @ ${r.stations.map(station).join(' + ') || 'By Hand'}${conds}  [${r.id}]`
  }
  const pct = (r?: number) => (r === undefined ? '—' : `${Number((r * 100).toPrecision(4))}%`)
  const qty = (q: DropSource['quantity']) =>
    'min' in q ? `${q.min}${q.max !== q.min ? `–${q.max}` : ''}` : Object.entries(q).map(([d, v]) => `${d} ${v.min}${v.max !== v.min ? `–${v.max}` : ''}`).join(', ') || '—'

  for (const c of cases) {
    // boss cases read the article the build already verified its quotes against (cached by the sync plan)
    const html =
      c.kind === 'boss'
        ? ((await fetchArticles(client, [c.page], 'articles')).get(c.page)?.html ?? '')
        : ((await client.get({ action: 'parse', page: c.page, prop: 'text' }, `spotcheck/${c.page.replace(/[^A-Za-z0-9._-]/g, '_')}`)).response as { parse: { text: string } }).parse.text
    const nodes = parseHtml(html)
    console.log(`\n=== ${c.kind.toUpperCase()} · ${c.kind === 'recipe' ? c.result : c.kind === 'weapon' ? c.item : c.kind === 'boss' ? `${c.boss} (drop: ${c.item})` : `${c.source ?? c.page} → ${c.item}`} · ${c.why}`)
    console.log(`    wiki: https://terraria.wiki.gg/wiki/${encodeURIComponent(c.page.replaceAll(' ', '_'))}`)
    if (c.kind === 'recipe') {
      const id = idByName.get(c.result)
      for (const r of recipes.filter((x) => x.resultItemId === id)) console.log(`  DATA  ${recipeLine(r)}`)
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
    } else if (c.kind === 'weapon') {
      const w = weapons.find((x) => x.name === c.item)
      if (!w) {
        console.log('  DATA  (no weapon record with this name)')
        continue
      }
      const shown = (v: unknown, field: string) => (v !== undefined ? String(v) : w._prov.unverifiedFields.includes(field) ? 'Unknown' : 'n/a')
      console.log(
        `  DATA  class ${shown(w.damageClass, 'damageClass')} · damage ${shown(w.damage, 'damage')} · use time (useAnimation) ${shown(w.useAnimationTicks, 'useAnimationTicks')} [useTime ${shown(w.useTimeTicks, 'useTimeTicks')}] · rarity ${shown(w.rarity, 'rarity')} · crit ${w.critPct !== undefined ? `${w.critPct + 4}% (bonus ${w.critPct})` : shown(undefined, 'critPct')} · knockback ${shown(w.knockback, 'knockback')} · autoReuse ${shown(w.autoReuse, 'autoReuse')} · mana ${shown(w.manaCost, 'manaCost')} · ammo ${shown(w.ammoClass, 'ammoClass')}`,
      )
      for (const a of w.acquisition) {
        if (a.method === 'craft') for (const rid of a.recipeIds) { const r = recipes.find((x) => x.id === rid); if (r) console.log(`  DATA  craft: ${recipeLine(r)}`) }
        else if (a.method === 'drop') for (const did of a.dropIds) { const d = drops.find((x) => x.id === did); if (d) console.log(`  DATA  drop: ${d.source.npcName} → qty ${qty(d.quantity)} | classic ${pct(d.rates.classic)} · expert ${pct(d.rates.expert)} · master ${pct(d.rates.master)}${d.conditions.length ? ` | when ${d.conditions.join(', ')}` : ''}${d._prov.unverifiedFields.length ? ` | Unknown: ${d._prov.unverifiedFields.join(', ')}` : ''}`) }
        else if (a.method === 'purchase') console.log(`  DATA  purchase: ${a.npcName}${a.priceCopper ? ` for ${a.priceCopper} copper` : ''} (conditions Unknown)`)
        else console.log(`  DATA  ${a.method}: ${JSON.stringify(a)}`)
      }
      if (w.acquisition.length === 0) console.log('  DATA  acquisition Unknown')
      console.log(`  DATA  Unknown fields: ${w._prov.unverifiedFields.join(', ') || 'none'}`)
      const kids = (x: HNode | undefined) => (x && x.type === 'el' ? x.children : [])
      const titleOf = (b: HNode) => clean(cellText(kids(findAll(kids(b), (x) => hasClass(x, 'title'))[0])))
      const box = findAll(nodes, (x) => hasClass(x, 'infobox')).find((b) => titleOf(b) === c.item)
      const statRows = box ? findAll(kids(box), (x) => x.type === 'el' && x.tag === 'tr') : []
      for (const tr of statRows) {
        const cells = (tr.type === 'el' ? tr.children : []).filter((x) => x.type === 'el' && (x.tag === 'th' || x.tag === 'td'))
        if (cells.length !== 2) continue
        const label = clean(cellText(cells[0].type === 'el' ? cells[0].children : []))
        const rarityEl = findAll([cells[1]], (x) => hasClass(x, 'rarity'))[0]
        const value = rarityEl && rarityEl.type === 'el' ? `rarity ${rarityEl.attrs['data-sort-value'] ?? '?'}` : clean(cellText(cells[1].type === 'el' ? cells[1].children : []))
        if (['Type', 'Damage', 'Knockback', 'Critical chance', 'Use time', 'Mana', 'Rarity', 'Velocity', 'Uses ammo', 'Buy'].includes(label)) console.log(`  WIKI  ${label}: ${value}`)
      }
      for (const t of findAll(nodes, (x) => hasClass(x, 'recipes'))) {
        const rows = tableRows(t)
        const full = Math.max(...rows.map((r) => r.cells))
        let inResult = false
        for (const r of rows) {
          const text = r.text.replace(/^.*?only:\s*/, '').replace(/\s*Internal Item ID: \d+/, '')
          if (r.cells === full) inResult = text.startsWith(c.item)
          if (inResult) console.log(`  WIKI  recipe: ${r.cells === full ? '' : '(cont.) '}${text}`)
        }
      }
      const lead = findAll(nodes, (x) => x.type === 'el' && x.tag === 'p').map((p) => clean(cellText(p.type === 'el' ? p.children : []))).find((t) => t.length > 40)
      if (lead) console.log(`  WIKI  lead: ${lead.slice(0, 600)}`)
    } else if (c.kind === 'boss') {
      const b = bosses.find((x) => x.id === c.boss)
      if (!b) {
        console.log('  DATA  (no boss record with this id)')
        continue
      }
      const unknown = (f: string) => (b._prov.unverifiedFields.includes(f) ? 'Unknown' : 'n/a')
      console.log(`  DATA  summon items: ${b.summon.items.map(n).join(', ') || 'none'} · conditions: ${b.summon.conditions.join(', ') || 'none'} · time: ${b.location.time ?? unknown('location.time')} · biomes: ${b.location.biomes.join(' | ')}`)
      console.log(`  DATA  summon text: ${b.summon.text ?? 'Unknown'}`)
      for (const d of ['classic', 'expert', 'master'] as const) {
        const st = b.statsByDifficulty[d]
        console.log(`  DATA  ${d}: ${st ? `hp ${st.hp} · defense ${st.defense} · contact ${st.contactDamage ?? (b._prov.unverifiedFields.includes(`statsByDifficulty.${d}.contactDamage`) ? 'Unknown' : 'n/a')}` : unknown(`statsByDifficulty.${d}`)}`)
      }
      const itemId = idByName.get(c.item)
      for (const d of drops.filter((x) => x.itemId === itemId && b.dropIds.includes(x.id))) {
        console.log(`  DATA  drop: ${d.source.npcName} → ${n(d.itemId)} qty ${qty(d.quantity)} | classic ${pct(d.rates.classic)} · expert ${pct(d.rates.expert)} · master ${pct(d.rates.master)}${d.conditions.length ? ` | when ${d.conditions.join(', ')}` : ''}${d._prov.unverifiedFields.length ? ` | Unknown: ${d._prov.unverifiedFields.join(', ')}` : ''}`)
      }
      const kids = (x: HNode | undefined) => (x && x.type === 'el' ? x.children : [])
      for (const box of findAll(nodes, (x) => hasClass(x, 'infobox')).slice(0, 2)) {
        for (const tr of findAll(kids(box), (x) => x.type === 'el' && x.tag === 'tr')) {
          const cells = (tr.type === 'el' ? tr.children : []).filter((x) => x.type === 'el' && (x.tag === 'th' || x.tag === 'td'))
          if (cells.length !== 2) continue
          const label = clean(cellText(kids(cells[0])))
          if (['Max Life', 'Defense', 'Damage', 'Environment'].includes(label)) console.log(`  WIKI  ${label}: ${clean(cellText(kids(cells[1])))}`)
        }
      }
      const seen = new Set<string>()
      for (const row of findAll(nodes, (x) => x.type === 'el' && (x.tag === 'tr' || x.tag === 'li'))) {
        const text = clean(cellText(row.type === 'el' ? row.children : []))
        if (text.startsWith(c.item) && text.length < 200 && !seen.has(text)) {
          seen.add(text)
          console.log(`  WIKI  drop row: ${text}`)
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
