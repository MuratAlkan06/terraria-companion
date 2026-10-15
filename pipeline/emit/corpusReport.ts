/**
 * Gap-report sections of the P6-S0 item-corpus slice: corpus identification + count reconciliation
 * against the wiki's Cargo Items table and Module:Iteminfo/data, the category rules, the field
 * cross-checks, the crafting-tree closure, the AMENDMENTS-004 B20 fishing routes and the pipeline
 * next-touch queue items this slice closes (B84 Hellforge caption + drops together + the no-stated-
 * quantity ruling proposal, B83(f) stats reasons, B93(ii), B96(d)). Pure: everything is read from the
 * build's products; nothing here changes a record.
 */
import type { Accessory, ArmorPiece, Boss, DropSource, GapEntry, Item, ItemDetailIndex, ProgressionEdge, Weapon } from '../../src/schemas'
import type { CorpusBuild } from '../merge/corpus'
import { CATEGORY_RULES } from '../merge/corpus'
import type { FishingRoutesReport } from '../merge/fishing'
import type { FishingCatches } from '../parse/fishing'
import type { ClosureReport } from '../validate/closure'

type AnyItem = Weapon | ArmorPiece | Accessory | Item

export interface CorpusReportInput {
  cargoRows: number
  corpus: CorpusBuild
  weapons: readonly Weapon[]
  armor: readonly ArmorPiece[]
  accessories: readonly Accessory[]
  items: readonly Item[]
  /** Ammo + potion records (the B70 / P2-S7 builders). */
  ammoPotionIds: ReadonlySet<number>
  universe: readonly { id: number; internalName: string; name?: string }[]
  stageGaps: readonly GapEntry[]
  closure: ClosureReport
  fishing: { catches: FishingCatches; report: FishingRoutesReport; url: string; rev: number }
  drops: readonly DropSource[]
  bosses: readonly Boss[]
  edges: readonly ProgressionEdge[]
  itemIndex: ItemDetailIndex
  /** Gating derived before / after the fishing routes joined the deriver (report evidence). */
  fishingGatingDelta: { name: string; before: string; after: string }[]
}

const esc = (t: string) => t.replaceAll('|', '\\|').replaceAll('\n', ' / ')
const listed = (xs: readonly string[], max = 12) => (xs.length === 0 ? 'none' : `${xs.slice(0, max).join('; ')}${xs.length > max ? `; … (+${xs.length - max})` : ''}`)
const COINS: Readonly<Record<number, string>> = { 71: 'Copper Coin', 72: 'Silver Coin', 73: 'Gold Coin', 74: 'Platinum Coin' }

export function corpusSections(input: CorpusReportInput): { title: string; lines: string[] }[] {
  const { corpus } = input
  const idn = corpus.identification
  const byKind = new Map<string, number>()
  for (const e of idn.excluded) {
    const k = e.reason.includes('set infobox') ? 'set infobox row (no item)' : e.kind === 'sync-lag-1457' ? 'item ID not in Module:Iteminfo/data' : e.kind === 'source-mismatch' ? 'item ID belongs to another Iteminfo name' : e.reason.startsWith('duplicate') ? 'duplicate row of an emitted item' : 'no item ID on the wiki'
    byKind.set(k, (byKind.get(k) ?? 0) + 1)
  }
  const byCategory = new Map<string, number>()
  for (const i of corpus.items) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1)
  const all: AnyItem[] = [...input.weapons, ...input.armor, ...input.accessories, ...input.items]
  const emittedIds = new Set(all.map((r) => r.id))
  const declared = new Map(input.stageGaps.filter((g) => g.field === 'id').map((g) => [g.ref, g]))
  const universeNotEmitted = input.universe.filter((u) => !emittedIds.has(u.id))
  const universeDeclared = universeNotEmitted.filter((u) => declared.has(`i:${u.id}`))
  const noCargoRow = input.stageGaps.filter((g) => g.field === 'id' && g.detail.includes('no Cargo Items row'))
  const nameOf = new Map(input.universe.map((u) => [u.id, u.name ?? u.internalName]))
  const xc = [...corpus.crossCheck]
  const corpusGated = corpus.items.filter((i) => i.gatedBy).length
  const stageCounts = ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame'].map((s) => `${s} ${corpus.items.filter((i) => i.gatedBy?.stage === s).length}`).join(', ')
  const withAcq = corpus.items.filter((i) => i.acquisition.length > 0).length

  // ---- closure ----
  const refsBy = (kind: string) => input.closure.refs.filter((r) => r.fromRef.startsWith(kind)).length
  const declaredRefs = [...input.closure.declared].sort((a, b) => a - b).map((id) => `${nameOf.get(id) ?? `item ${id}`} (${id}): ${(declared.get(`i:${id}`)?.detail ?? '').replace(/^Cargo Items row \d+ not emitted as [a-z ]+: /, '').replace(/^[^:]*\(item \d+\): /, '')}`)

  // ---- fishing ----
  const fishedRecords = all.filter((r) => r.acquisition.some((a) => a.method === 'fishing'))
  const fishedBy = (rs: readonly AnyItem[]) => rs.filter((r) => r.acquisition.some((a) => a.method === 'fishing')).length
  const unknownFishCond = fishedRecords.filter((r) => r.acquisition.some((a, i) => a.method === 'fishing' && r._prov.unverifiedFields.includes(`acquisition.${i}.conditions`)))
  const taggedNoRoute = input.stageGaps.filter((g) => g.field === 'acquisition' && g.detail.includes('"Fishing catches" article lists no catch'))

  // ---- queue items ----
  const hellforge = input.drops.filter((d) => d.itemId === 221 && d.source.bossId === 'skeletron')
  const together = input.drops.filter((d) => d.dropsWith)
  const qtyUnknown = input.drops.filter((d) => d._prov.unverifiedFields.some((f) => f === 'quantity' || f.startsWith('quantity.')))
  const kindOf = (id: number) => (COINS[id] ? 'coins' : input.weapons.some((w) => w.id === id) ? 'weapon' : input.armor.some((a) => a.id === id) ? 'armor piece' : input.accessories.some((a) => a.id === id) ? 'accessory' : input.items.find((i) => i.id === id)?.category ?? 'not emitted')
  const qtyByKind = new Map<string, DropSource[]>()
  for (const d of qtyUnknown) qtyByKind.set(kindOf(d.itemId), [...(qtyByKind.get(kindOf(d.itemId)) ?? []), d])
  const statsGaps = input.stageGaps.filter((g) => g.field === 'statsByDifficulty' && g.detail.includes('No single verified value per difficulty'))
  const mechEdges = input.edges.filter((e) => e.to === 'all-mechanical-bosses')
  const coreFile = input.itemIndex.files[0]
  const coreCorpus = input.items.filter((i) => coreFile.ids.includes(i.id) && !input.ammoPotionIds.has(i.id))

  return [
    {
      title: 'Item corpus — identification and count reconciliation (P6-S0)',
      lines: [
        'Verifiable wiki sources: the Cargo Items table (one row per item infobox on terraria.wiki.gg) and Module:Iteminfo/data (the game\'s item list as the wiki transcribes it). Every Cargo row is accounted for, and every Iteminfo item is an emitted record or a declared gap.',
        '',
        '| Cargo Items rows | Count |',
        '|---|---:|',
        `| rows fetched (Cargo COUNT(*)) | ${input.cargoRows} |`,
        `| − rows of items another collection emits (weapons / ammo / potions / armor / accessories) | ${idn.elsewhere} |`,
        ...[...byKind].sort().map(([k, n]) => `| − excluded: ${k} (one gap entry each) | ${n} |`),
        `| **= corpus items emitted (items collection, P6-S0)** | **${corpus.items.length}** ${input.cargoRows - idn.elsewhere - idn.excluded.length === corpus.items.length ? '(reconciles)' : '(DOES NOT RECONCILE)'} |`,
        '',
        '| Module:Iteminfo/data items | Count |',
        '|---|---:|',
        `| items in the module (universe) | ${input.universe.length} |`,
        `| emitted: weapons ${input.weapons.length} + armor ${input.armor.length} + accessories ${input.accessories.length} + items ${input.items.length} (ammo + potions ${input.ammoPotionIds.size}, corpus ${corpus.items.length}) | ${emittedIds.size} |`,
        `| not emitted, declared gap — item carried only by an excluded Cargo row | ${universeDeclared.length - noCargoRow.length} |`,
        `| not emitted, declared gap — no Cargo Items row at all | ${noCargoRow.length} |`,
        `| **= accounted for** | **${emittedIds.size + universeDeclared.length}** ${emittedIds.size + universeDeclared.length === input.universe.length ? '(reconciles)' : '(DOES NOT RECONCILE)'} |`,
        '',
        `- No Cargo Items row (newest 1.4.5 furniture and unused IDs; not emitted, gap each): ${listed(noCargoRow.map((g) => g.detail.replace(/: Module:Iteminfo.*$/, '')), 60)}`,
        `- Excluded rows: ${listed(idn.excluded.map((e) => e.reason), 40)}`,
        '',
        `Corpus records: ${corpus.items.length}; with ≥ 1 acquisition route ${withAcq} (Unknown acquisition ${corpus.items.length - withAcq}); verified ${corpus.items.filter((i) => i._prov.verified).length}; derived gatedBy ${corpusGated} (${stageCounts}); with a wiki sprite (manifest) ${corpus.sprites.length}.`,
      ],
    },
    {
      title: 'Item corpus — categories (first matching rule over the wiki infobox type list)',
      lines: [
        '| # | Category | Rule (Cargo Items `type` / tag) | Items |',
        '|---:|---|---|---:|',
        ...CATEGORY_RULES.map((r, i) => `| ${i + 1} | ${r.category} | ${esc([r.types ? `type ∈ {${r.types.join(', ')}}` : '', r.tags ? `tag ∈ {${r.tags.join(', ')}}` : '', r.fished ? 'fished' : ''].filter(Boolean).join(' or ') || 'otherwise')} — ${esc(r.why)} | ${byCategory.get(r.category) ?? 0} |`),
        '',
        'The full infobox type list stays in each record\'s `tags` (slugged), so "crafting-material", "light-source", "crate" … filter across categories. Ammo (79) and potions (66) keep their own builders\' categories.',
      ],
    },
    {
      title: 'Item corpus — fields and cross-checks',
      lines: [
        '| Field | Agree | Mismatch (value withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...xc.map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
        '',
        `toolStats on ${corpus.items.filter((i) => i.toolStats).length} items (pickaxe ${corpus.items.filter((i) => i.toolStats?.pickaxePowerPct).length}, axe ${corpus.items.filter((i) => i.toolStats?.axePowerPct).length}, hammer ${corpus.items.filter((i) => i.toolStats?.hammerPowerPct).length}, fishing pole ${corpus.items.filter((i) => i.toolStats?.fishingPowerPct).length}); baitPowerPct on ${corpus.items.filter((i) => i.baitPowerPct).length}; buffGrants on ${corpus.items.filter((i) => i.buffGrants).length} (food), Unknown on ${corpus.items.filter((i) => i._prov.unverifiedFields.includes('buffGrants')).length} (pets / light pets: their buffs are outside the A4-bounded registry); summonsBossNode on ${corpus.items.filter((i) => i.summonsBossNode).length}; hookStats Unknown on ${corpus.items.filter((i) => i._prov.unverifiedFields.includes('hookStats')).length}; mountStats Unknown on ${corpus.items.filter((i) => i._prov.unverifiedFields.includes('mountStats')).length}; maxStack on ${corpus.items.filter((i) => i.maxStack).length} consumable items (B7: non-consumables report 9999 in both sources).`,
      ],
    },
    {
      title: 'Crafting-tree closure (P6-S0, manifest itemClosure)',
      lines: [
        `Every item reference of the recipes (${refsBy('rcp:')} references: results, item ingredients, item stations), recipe groups (${refsBy('grp:')} members) and drops (${refsBy('drop:')} items) — ${input.closure.refs.length} references to ${input.closure.emitted.size + input.closure.declared.size + input.closure.undeclared.size} distinct items — resolves to an emitted record or a declared gap; validate fails otherwise (E_DANGLING_REF).`,
        '',
        '| Referenced items | Distinct |',
        '|---|---:|',
        `| emitted record (weapons / armor / accessories / items) | ${input.closure.emitted.size} |`,
        `| declared gap (stage gap on i:<id>, field "id") | ${input.closure.declared.size} |`,
        `| **unresolved (neither)** | **${input.closure.undeclared.size}** |`,
        '',
        `- Declared: ${listed(declaredRefs, 40)}`,
      ],
    },
    {
      title: 'Fishing routes (AMENDMENTS-004 B20)',
      lines: [
        `Source: the "Fishing catches" article (${input.fishing.url}, rev ${input.fishing.rev}) — ${input.fishing.catches.definitions.size} condition definitions, ${input.fishing.report.rows} catch rows (${input.fishing.report.itemRows} with items), ${input.fishing.report.items} distinct items. Skipped: ${[...input.fishing.report.skipped].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`,
        '',
        `Records with a fishing route: ${fishedRecords.length} — weapons ${fishedBy(input.weapons)}, armor ${fishedBy(input.armor)}, accessories ${fishedBy(input.accessories)}, items ${fishedBy(input.items)}. Routes with Unknown conditions (an unmapped label): ${unknownFishCond.length} records; unmapped labels: ${[...input.fishing.report.unmapped].map(([k, n]) => `"${k}" ${n}`).join(', ') || 'none'}.`,
        '',
        `Gating: a fishing route never derives a gate (blocker fishing-route-ungated). Records whose gatedBy changed when fishing joined the deriver: ${input.fishingGatingDelta.length === 0 ? 'none (every fished record was already Unknown, or has a gate-free route)' : listed(input.fishingGatingDelta.map((d) => `${d.name}: ${d.before} → ${d.after}`), 30)}.`,
        '',
        `Tagged as fished by the wiki but not in any catch table (gap each, acquisition hint): ${listed(taggedNoRoute.map((g) => g.detail.replace(/:.*$/, '')), 30)}.`,
      ],
    },
    {
      title: 'Pipeline next-touch queue closed by P6-S0',
      lines: [
        `- **Skeletron's Hellforge caption (AMENDMENTS-015 B84):** condition hellforge-absent ("Hellforge not present", conditions overlay) matches both the drop-list caption "When Hellforge is not present" and the Cargo note "when a Hellforge is not present; see conditions". Skeletron → Hellforge now: ${hellforge.map((d) => `${d.id} conditions [${d.conditions.join(', ')}]${d._prov.unverifiedFields.includes('conditions') ? ' (Unknown)' : ''}`).join('; ') || 'no record'}.`,
        `- **"Drops together" linkage (B84 / B66 candidate):** \`DropSource.dropsWith\` (additive, symmetric, validated) on ${together.length} records of the bundled cells (${listed(together.map((d) => `${d.source.npcName}: i:${d.itemId} ↔ ${(d.dropsWith ?? []).join(', ')}`), 20)}).`,
        `- **Boss stats parse reasons (B83(f)):** wholly Unknown stats from unparseable health / defense cells now carry their reason as a missing-field gap on statsByDifficulty (the page's "Stats not verified" line shows it): ${listed(statsGaps.map((g) => g.detail.replace(/\.$/, '')))}.`,
        `- **Mechanical bosses quote (B93(ii)):** the three mech → all-mechanical-bosses edges now quote "${mechEdges[0]?.note ?? '—'}" (a whole sentence; the display-side CUT_AT_END pin no longer matches any edge).`,
        `- **Special:Search links (B96(d)):** items.detail.json now also holds every item a boss record references (summon + prep-checklist items, ${coreCorpus.length} corpus records: ${listed(coreCorpus.map((i) => i.name), 40)}), so the boss pages and the readiness checker resolve them to their own wiki article — the Suspicious Looking Eye included — instead of the wiki search.`,
        '',
        '**No-stated-quantity ruling proposal (B84 queue; NOT applied — needs an orchestrator ruling).** Drop records whose wiki cell states no quantity keep quantity Unknown today. By item kind:',
        '',
        '| Item kind | Records | Examples |',
        '|---|---:|---|',
        ...[...qtyByKind].sort((a, b) => b[1].length - a[1].length).map(([k, ds]) => `| ${k} | ${ds.length} | ${esc(listed(ds.map((d) => `${d.source.npcName} → ${input.items.find((i) => i.id === d.itemId)?.name ?? input.weapons.find((w) => w.id === d.itemId)?.name ?? input.armor.find((a) => a.id === d.itemId)?.name ?? input.accessories.find((a) => a.id === d.itemId)?.name ?? COINS[d.itemId] ?? `i:${d.itemId}`}`), 4))} |`),
        '',
        'Proposal: (1) coins and every consumable / stackable item (materials, placeables, potions, ammo) stay Unknown — a stack size is a real, unstated number, never defaulted; (2) equipment (weapons, armor, accessories) and corpus items whose Module:Iteminfo/data consumable flag is false (vanity, tools, pets, mounts …) cannot be used up or split, so a drop entry with no stated quantity could be ruled quantity 1, derived from the item kind and provenance-noted — or kept Unknown. Not applied here: a category-aware default is an orchestrator ruling (AMENDMENTS-015 B84).',
      ],
    },
  ]
}
