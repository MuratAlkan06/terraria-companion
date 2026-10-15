/**
 * Gap-report sections of the AMENDMENTS-014 B70 P4-prep slice: potion corpus, B68/B78 gating expansion
 * (deltas against the pre-slice derivation on the SAME data), B52 variant classes, B54 StatKind flips and
 * the stale-gap-forced boss gear (AMENDMENTS-015 B83b). Pure: everything is read from the build's
 * products; nothing here changes a record.
 */
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, DropSource, GatedBy, Item, StatEffect, StatKind, Weapon } from '../../src/schemas'
import { containerKey, dropArticleUrl, type GatingDeriver, type GatingResult } from '../merge/gating'
import type { PotionBuild } from '../merge/potions'
import type { AcquisitionSources } from '../merge/sources'

/** AMENDMENTS-011 B54: the 11 pre-approved StatKinds this slice lands. */
export const B54_KINDS = ['fishing-power-flat', 'ammo-save-pct', 'knockback-pct', 'tag-effect-slots', 'lava-immunity-ticks', 'melee-scale-pct', 'tile-reach-flat', 'potion-cooldown-pct', 'armor-penetration-flat', 'minion-knockback', 'whip-speed-pct'] as const satisfies readonly StatKind[]

/** The suggested-gear picks before this slice (bosses.json of 2026-10-14, pinned by the boss-page tests). */
export const PRE_SLICE_GEAR_PICKS: Readonly<Record<string, Readonly<Partial<Record<string, readonly string[]>>>>> = {
  'queen-slime': { summon: ['Firecracker'] },
  'the-twins': { ranged: ['Clockwork Assault Rifle'], summon: ['Firecracker'] },
  'the-destroyer': { summon: ['Firecracker'] },
  'skeletron-prime': { ranged: ['Clockwork Assault Rifle'] },
  plantera: { summon: ['Firecracker'] },
  golem: { ranged: ['Venus Magnum'], magic: ['Leaf Blower'], summon: ['Vulgar Display of Flower'] },
  'empress-of-light': { summon: ['Vulgar Display of Flower'] },
  'duke-fishron': { summon: ['Firecracker'] },
  'lunatic-cultist': { melee: ['Possessed Hatchet'] },
  'moon-lord': { summon: ['Vulgar Display of Flower', 'Firecracker'] },
}

/** Gating-underived counts of the gap report before this slice (2026-10-14, SCORING_SPEC §1.4 / AMENDMENTS-014 B68). */
export const PRE_SLICE_REPORTED = { gatingUnderived: 1097, weaponsDerived: 47, weapons: 488 } as const

type Record_ = Weapon | ArmorPiece | Accessory | Item

export interface B70ReportInput {
  weapons: readonly Weapon[]
  armor: readonly ArmorPiece[]
  accessories: readonly Accessory[]
  items: readonly Item[]
  armorSets: readonly ArmorSet[]
  buffs: readonly Buff[]
  bosses: readonly Boss[]
  drops: readonly DropSource[]
  derive: GatingDeriver
  /** The pre-slice derivation: recipes + boss drops only (no vendor / container / gatherable sources). */
  deriveBaseline: (itemId: number) => GatingResult
  withheldIds: ReadonlySet<number>
  sources: AcquisitionSources
  potions: PotionBuild
  stageOrder: Readonly<Record<string, number>>
}

const ungated = (g: GatedBy) => g.bosses.length === 0 && g.conditions.length === 0
const esc = (t: string) => t.replaceAll('|', '\\|').replaceAll('\n', ' / ')
const listed = (xs: readonly string[], max = 12) => (xs.length === 0 ? 'none' : `${xs.slice(0, max).join('; ')}${xs.length > max ? `; … (+${xs.length - max})` : ''}`)
const gateText = (g: GatedBy) => `${g.stage}${g.bosses.length ? ` · ${g.bosses.join(', ')}` : ''}${g.conditions.length ? ` · [${g.conditions.join(', ')}]` : ''}`

export function b70Sections(input: B70ReportInput): { title: string; lines: string[] }[] {
  const { derive, sources } = input
  // pre-slice rule for one emitted record: the deriver without the B68/B78 sources, then the P2-S2 vendor
  // adjustment (a purchase route's conditions were Unknown, so only a gate-free derived route stayed exact)
  const baselineOk = (r: Record_): boolean => {
    if (input.withheldIds.has(r.id)) return false
    const b = input.deriveBaseline(r.id)
    if (!b.ok) return false
    return !r.acquisition.some((a) => a.method === 'purchase') || ungated(b.gatedBy)
  }
  const ammo = input.items.filter((i) => i.category === 'ammo')
  const potions = input.items.filter((i) => i.category === 'potion')
  const families: [string, readonly Record_[]][] = [
    ['weapons', input.weapons],
    ['armor pieces', input.armor],
    ['accessories', input.accessories],
    ['ammo items (+ dual-role weapons counted as weapons)', ammo],
    ['potions (new in this slice)', potions],
  ]
  const deltaRows = families.map(([name, rs]) => {
    const before = rs.filter(baselineOk).length
    const now = rs.filter((r) => r.gatedBy).length
    const lost = rs.filter((r) => baselineOk(r) && !r.gatedBy)
    return { name, total: rs.length, before, now, lost }
  })
  const oldFamilies = deltaRows.slice(0, 4)
  const underivedBefore = oldFamilies.reduce((n, r) => n + r.total - r.before, 0)
  const underivedNowOld = oldFamilies.reduce((n, r) => n + r.total - r.now, 0)
  const underivedPotions = potions.filter((p) => !p.gatedBy).length
  const all: Record_[] = [...input.weapons, ...input.armor, ...input.accessories, ...input.items]
  const sufficientOnly = all.filter((r) => !r.gatedBy).flatMap((r) => {
    const s = derive.sufficient(r.id)
    return s ? [`${r.name} (${gateText(s)})`] : []
  })
  const weaponStages = Object.keys(input.stageOrder).map((st) => `${st} ${input.weapons.filter((w) => w.gatedBy?.stage === st).length}`).join(', ')
  const newlyDerived = (rs: readonly Record_[]) => rs.filter((r) => r.gatedBy && !baselineOk(r)).map((r) => `${r.name} (${gateText(r.gatedBy as GatedBy)})`)

  // containers: drop records each registered container gates
  const containerDrops = new Map<string, number>()
  for (const d of input.drops) {
    const url = dropArticleUrl(d)
    if (!url) continue
    const key = containerKey(d.source.npcName, url)
    if (sources.containers.has(key)) containerDrops.set(key, (containerDrops.get(key) ?? 0) + 1)
  }

  // ---- potions ----
  const pb = input.potions
  const recon = pb.reconciliation
  const tableRows = recon.filter((r) => r.group.startsWith('Buff potions table'))
  const emittedTable = tableRows.filter((r) => r.outcome === 'emitted').length
  const navRows = recon.filter((r) => !r.group.startsWith('Buff potions table'))
  const grantsOf = (i: Item) => (i.buffGrants ?? []).map((g) => `${g.buffId}${typeof g.durationTicks === 'number' ? ` ${g.durationTicks}t` : g.durationTicks ? ` ${g.durationTicks.minTicks}–${g.durationTicks.maxTicks}t` : ''}`).join(', ')

  // ---- B54 flips ----
  type Effectful = { name: string; effects: readonly StatEffect[] }
  const effectSources: [string, Effectful[]][] = [
    ['armor pieces', input.armor.map((p) => ({ name: p.name, effects: p.effects }))],
    ['set bonuses', input.armorSets.flatMap((s) => s.variants.map((v) => ({ name: `${s.name} (${v.helmetId})`, effects: v.setBonus })))],
    ['accessories', input.accessories.map((a) => ({ name: a.name, effects: a.effects }))],
    ['buffs', input.buffs.map((b) => ({ name: b.name, effects: b.effects }))],
  ]
  const flipRows = B54_KINDS.map((kind) => {
    const per = effectSources.map(([label, recs]) => {
      const hits = recs.filter((r) => r.effects.some((e) => e.kind === 'stat' && e.stat === kind))
      return { label, n: hits.length, names: hits.map((h) => h.name) }
    })
    return { kind, per, total: per.reduce((n, p) => n + p.n, 0) }
  })

  // ---- B52 ----
  // hybrid (≥ 2 classes) and class-less variants — the B52 rows a reviewer checks
  const hybrids = input.armorSets.flatMap((s) => s.variants.filter((v) => (v.classes?.length ?? 1) > 1 || v.class === 'other').map((v) => ({ set: s.name, helmet: v.helmetId, cls: v.class, classes: v.classes ?? [v.class] })))

  // ---- forced gear ----
  const weaponName = new Map(input.weapons.map((w) => [w.id, w.name]))
  const gearRows = input.bosses.flatMap((b) => {
    const before = PRE_SLICE_GEAR_PICKS[b.id] ?? {}
    const entries = b.suggestedEquipment ?? []
    if (!b.suggestedEquipment) return [`| ${b.name} | — | Unknown (whole field: no quoted tip names a weapon verified obtainable before the fight) | — |`]
    return ['melee', 'ranged', 'magic', 'summon'].map((cls) => {
      const picks = entries.filter((g) => g.class === cls).flatMap((g) => g.weapons.map((w) => weaponName.get(w) ?? `i:${w}`))
      const was = before[cls] ?? []
      const status = picks.length === 0 ? 'Unknown (per-class gap)' : picks.join(', ')
      const wholeBefore = !(b.id in PRE_SLICE_GEAR_PICKS)
      const change = wholeBefore ? (picks.length ? 'NEW (stale whole-field gap forced)' : 'Unknown, now per class (was the whole field)') : picks.join() === was.join() ? 'unchanged' : was.length === 0 ? 'NEW (stale per-class gap forced)' : `was ${was.join(', ')}`
      return `| ${b.name} | ${cls} | ${status} | ${change} |`
    })
  })

  return [
    {
      title: 'P4-prep gating expansion — deltas (AMENDMENTS-014 B68, AMENDMENTS-015 B78)',
      lines: [
        `Before = the §7b derivation of this same data WITHOUT the new sources (recipes + boss drops only, a vendor route Unknown) — it reproduces the previous report (${PRE_SLICE_REPORTED.weaponsDerived}/${PRE_SLICE_REPORTED.weapons} weapons, ${PRE_SLICE_REPORTED.gatingUnderived} gating-underived records). After = with the reviewed vendor availability + shop rows (overlays/vendors.json, parse/shops.ts), the container registry (overlays/containers.json), the gatherable base-material registry (overlays/gatherables.json) and the either-or / sufficient-bound rules (merge/gating.ts header).`,
        '',
        '| Records | Total | gatedBy derived before | after | Δ | lost (derived before, Unknown now) |',
        '|---|---:|---:|---:|---:|---|',
        ...deltaRows.map((r) => `| ${r.name} | ${r.total} | ${r.before} | ${r.now} | ${r.now - r.before >= 0 ? '+' : ''}${r.now - r.before} | ${r.lost.length === 0 ? 'none' : esc(listed(r.lost.map((x) => x.name)))} |`),
        '',
        `Gating-underived records (the gaps.json kind): ${underivedBefore} → ${underivedNowOld} for the pre-existing collections (${underivedNowOld - underivedBefore}), + ${underivedPotions} new potion records still Unknown = ${underivedNowOld + underivedPotions} in gaps.json.`,
        `Derived weapons by stage: ${weaponStages}.`,
        `Underived records with a known SUFFICIENT gate (a route that works, but another route's gating is unknown, so the minimum is not stated): ${sufficientOnly.length} — ${esc(listed(sufficientOnly, 20))}.`,
        '',
        `Newly derived weapons (${newlyDerived(input.weapons).length}): ${esc(listed(newlyDerived(input.weapons), 400))}`,
        '',
        `Newly derived ammo (${newlyDerived(ammo).length}): ${esc(listed(newlyDerived(ammo), 100))}`,
      ],
    },
    {
      title: 'P4-prep gating sources — vendors, containers, gatherable materials (B68 / B78)',
      lines: [
        'Vendors (overlays/vendors.json): a purchase route derives only when the NPC\'s availability is honestly derivable AND the item\'s shop-table row has a reviewed Availability text; the NPC\'s own move-in rule is its gate (conditions; "has one of these items" = the minimum over them; "another NPC present").',
        '',
        '| NPC | Availability | Shop rows (parsed) | Rows with a reviewed availability | Why |',
        '|---|---|---:|---:|---|',
        ...sources.report.shops.map((s) => `| [${s.npc}](${s.url}) | ${s.status === 'derivable' ? `derivable${(sources.npcs.get(s.npc)?.conditions.length ?? 0) > 0 ? ` (${sources.npcs.get(s.npc)?.conditions.join(', ')})` : ' (no progression gate)'}` : 'not derivable'} | ${s.rows} | ${s.status === 'derivable' ? s.mapped : '—'} | ${esc(s.why)} |`),
        '',
        `Vendor routes of all Cargo Items rows: ${[...sources.report.routeOutcomes].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`,
        `Availability texts of derivable NPCs left Unknown (rows): ${esc(listed([...sources.report.unmappedTexts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `"${t || '(empty)'}" ${n}`), 25))}.`,
        '',
        'Containers (overlays/containers.json; matched by source name AND the Drops row\'s article — secret-seed chest rows never match):',
        '',
        '| Container | Article | Conditions | Drop records gated |',
        '|---|---|---|---:|',
        ...sources.report.containers.map((c) => `| ${c.container} | ${c.url} | ${c.conditions.join(', ') || 'none'} | ${containerDrops.get(containerKey(c.container, c.url)) ?? 0} |`),
        '',
        `World-specific chest loot (the chest tables' "(in worlds with …)"): ${[...sources.containerItemConditions].map(([id, cs]) => `i:${id} → ${cs.join(', ')}`).join('; ')}; exhaustive either-or groups: ${sources.exhaustive.map((g) => g.join(' | ')).join('; ')}.`,
        '',
        `Gatherable base materials (${sources.report.gatherables.length}, overlays/gatherables.json — each a quoted, gate-free early pre-Hardmode route unless conditioned): ${esc(sources.report.gatherables.map((g) => `${g.item}${g.conditions.length ? ` [${g.conditions.join(', ')}]` : ''}`).join(', '))}.`,
      ],
    },
    {
      title: 'Potion corpus (AMENDMENTS-014 B70)',
      lines: [
        `Cargo Items rows typed "potion" (not "food"): ${pb.identification.typedRows}; emitted potions: ${potions.length} (category "potion"); excluded: ${pb.identification.excluded.length}. Reconciled against the wiki's Buff potions article table (${pb.buffPotionsRows} rows, ${pb.buffPotionsUrl}): ${emittedTable}/${tableRows.length} emitted; the others are excluded with the reason below. Navbox groups (Health, Mana, Flasks, Tipsy) not on that table: ${navRows.filter((r) => r.outcome === 'emitted').length}/${navRows.length} emitted.`,
        '',
        `Fields: healLife ${potions.filter((p) => p.healLife !== undefined).length} (Unknown ${potions.filter((p) => p._prov.unverifiedFields.includes('healLife')).length}), healMana ${potions.filter((p) => p.healMana !== undefined).length}, with buffGrants ${potions.filter((p) => p.buffGrants).length}, gatedBy derived ${potions.filter((p) => p.gatedBy).length} (stages: ${Object.keys(input.stageOrder).map((st) => `${st} ${potions.filter((p) => p.gatedBy?.stage === st).length}`).join(', ')}).`,
        '',
        '| Cross-check | Agree | Mismatch (withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...[...pb.crossCheck].map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
        '',
        '| Wiki list row | Group | Outcome | buffGrants / heal |',
        '|---|---|---|---|',
        ...recon.map((r) => {
          const rec = r.ref ? potions.find((p) => `i:${p.id}` === r.ref) : undefined
          return `| ${esc(r.name)} | ${esc(r.group)} | ${esc(r.outcome)}${r.ref ? ` (${r.ref})` : ''} | ${rec ? esc(`${grantsOf(rec)}${rec.healLife ? ` · heals ${rec.healLife}` : ''}${rec.healMana ? ` · mana ${rec.healMana}` : ''}`) : '—'} |`
        }),
        '',
        `Buff registry: ${input.buffs.length} buffs (${input.buffs.filter((b) => b.effects.length > 0).length} with verified effects: ${input.buffs.reduce((n, b) => n + b.effects.filter((e) => e.kind === 'stat').length, 0)} stat + ${input.buffs.reduce((n, b) => n + b.effects.filter((e) => e.kind === 'special').length, 0)} special; the rest Unknown).`,
      ],
    },
    {
      title: 'Armor-set variant classes (AMENDMENTS-011 B52)',
      lines: [
        `Every variant now carries classes[] beside the kept single class (one release; consumers read classes ?? [class]). Single-class variants: [class]; classless: ["other"]; hybrids: the quoted article description's classes, equal to the variant's stat class signals (checked). ${input.armorSets.reduce((n, s) => n + s.variants.filter((v) => v.classes).length, 0)}/${input.armorSets.reduce((n, s) => n + s.variants.length, 0)} variants carry classes.`,
        '',
        '| Set | Helmet | class (kept) | classes |',
        '|---|---:|---|---|',
        ...hybrids.map((h) => `| ${h.set} | ${h.helmet} | ${h.cls} | ${h.classes.join(', ')} |`),
      ],
    },
    {
      title: 'StatKind extension landed (AMENDMENTS-011 B54) — special → stat flips',
      lines: [
        'The 11 pre-approved kinds are in the closed StatKind enum; lines that state their value are stats now (an effect line that also states an unmodeled part keeps that part as a quoted special); lines without a value stay specials ("no value/unit rows stay Unknown"). SCORING_SPEC §2.3 rows: the scoring constants module (src/scoring/constants.ts) does not exist yet — the rows land with it at P4-S1/S2 (constants v1).',
        '',
        '| StatKind | Records with the stat | armor pieces | set bonuses | accessories | buffs | Examples |',
        '|---|---:|---:|---:|---:|---:|---|',
        ...flipRows.map((r) => `| ${r.kind} | ${r.total} | ${r.per.map((p) => p.n).join(' | ')} | ${esc(listed(r.per.flatMap((p) => p.names), 4))} |`),
        '',
        `Total records flipped: ${flipRows.reduce((n, r) => n + r.total, 0)}.`,
      ],
    },
    {
      title: 'Suggested gear forced by the gating expansion (AMENDMENTS-015 B78 / B83b)',
      lines: [
        'B83(b): gear needs a quoted wiki recommendation AND passing E_SUGGESTION_GATING; a class (or the whole field) goes stale once the boss\'s own quoted tips name a weapon that passes. The gating expansion made pre-Hardmode weapons pass, so these picks were authored from the bosses\' existing quoted tips (overlays/bosses.json); classes whose tips name no passing weapon stay Unknown with their reason.',
        '',
        '| Boss | Class | Suggested weapons | Change |',
        '|---|---|---|---|',
        ...gearRows,
      ],
    },
  ]
}
