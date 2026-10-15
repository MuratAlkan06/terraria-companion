/**
 * Loadout builder view helpers (PRD P4-S2 AC5 "standard Terraria-style tooltip"; UX_SPEC §3.1, §5.3):
 * record lookups and the tooltip lines of any item the builder shows. Verified values only; a field
 * that reads Unknown says "Unknown" — never a blank or a guess. No React.
 */
import type { TerrariaTooltipData, TooltipLine } from '../../../components/TerrariaTooltip'
import { asRarity } from '../../../components/rarity'
import type { Accessory, ArmorPiece, Item, StatEffect, Weapon } from '../../../schemas'
import { getField } from '../../../schemas/getField'
import { BASE_CRIT_PCT } from '../../../scoring/constants'
import { effectPhrase } from '../../../scoring/readinessCopy'
import type { BuilderData } from '../../../scoring/recommend'
import { CLASS_LABELS } from '../db/weapons/weaponDisplay'
import { tooltip as t } from './loadoutCopy'

export type BuilderRecord = Weapon | ArmorPiece | Accessory | Item

export function recordOf(data: BuilderData, id: number): BuilderRecord | undefined {
  return data.weapons.get(id) ?? data.armor.get(id) ?? data.accessories.get(id) ?? data.items.get(id)
}

const known = (record: unknown, path: string) => {
  const view = getField(record, path)
  return view.status === 'verified' || view.status === 'editorial' ? view.value : view.status === 'unverified' ? 'unknown' : undefined
}

function effectLines(effects: unknown): TooltipLine[] {
  if (effects === 'unknown') return [{ text: t.effectsUnknown, tone: 'muted' }]
  if (!Array.isArray(effects)) return []
  return (effects as StatEffect[]).map((e) => (e.kind === 'stat' ? { text: effectPhrase(e), tone: e.value < 0 ? 'negative' : 'positive' } : { text: e.text }))
}

/** Can the builder place this item (a weapon, an armor piece, an accessory, ammo or a potion)? Owned gear is limited to these. */
export function ownable(data: BuilderData, id: number): boolean {
  const r = recordOf(data, id)
  if (!r) return false
  if (r.type === 'weapon' || r.type === 'armor' || r.type === 'accessory') return true
  return r.ammoStats !== undefined || r.category === 'potion'
}

/** The TerrariaTooltip of an item: name, rarity and its verified stat lines. */
export function tooltipFor(data: BuilderData, id: number): TerrariaTooltipData | undefined {
  const r = recordOf(data, id)
  if (!r) return undefined
  const lines: TooltipLine[] = []
  const rarity = asRarity(r.rarity)
  if (r.type === 'weapon') {
    const damage = known(r, 'damage')
    const cls = known(r, 'damageClass')
    const clsWord = typeof cls === 'string' && cls !== 'unknown' ? CLASS_LABELS[cls as NonNullable<Weapon['damageClass']>].toLowerCase() : t.unknown
    lines.push({ text: typeof damage === 'number' ? t.damage(damage, clsWord) : t.damageUnknown })
    const crit = known(r, 'critPct')
    if (typeof crit === 'number') lines.push({ text: t.crit(BASE_CRIT_PCT + crit) })
    const use = known(r, 'useAnimationTicks')
    lines.push({ text: typeof use === 'number' ? t.useTime(use) : t.useTimeUnknown, tone: 'muted' })
    const behavior = known(r, 'behaviorText')
    if (typeof behavior === 'string' && behavior !== 'unknown') for (const line of behavior.split('\n').filter(Boolean)) lines.push({ text: line, tone: /^\s*['‘]/.test(line) ? 'flavor' : 'default' })
  } else if (r.type === 'armor') {
    const defense = known(r, 'defense')
    lines.push({ text: typeof defense === 'number' ? t.defense(defense) : t.defenseUnknown })
    lines.push(...effectLines(known(r, 'effects')))
  } else if (r.type === 'accessory') {
    const wing = known(r, 'wingStats.flightTimeTicks')
    if (typeof wing === 'number') lines.push({ text: t.flight((wing / 60).toFixed(1)) })
    lines.push(...effectLines(known(r, 'effects')))
  } else {
    const ammoDamage = known(r, 'ammoStats.damage')
    if (r.ammoStats) lines.push({ text: typeof ammoDamage === 'number' ? t.ammoDamage(ammoDamage) : t.ammoDamageUnknown })
    const heal = known(r, 'healLife')
    if (typeof heal === 'number') lines.push({ text: t.heals(heal) })
    for (const g of (known(r, 'buffGrants') as Item['buffGrants'] | undefined) ?? []) {
      const buff = data.buffs.get(g.buffId)
      if (!buff || buff.isDebuff) continue
      lines.push({ text: t.grants(buff.name) })
      lines.push(...effectLines(known(buff, 'effects')))
    }
  }
  return { name: r.name, ...(rarity !== undefined ? { rarity } : {}), lines, footnote: t.source }
}

/** Sprite inputs of an item for SpriteImg (weapons get their class silhouette as placeholder). */
export function spriteOf(data: BuilderData, id: number): { src: string | undefined; damageClass?: string; placeholder?: 'material' } {
  const r = recordOf(data, id)
  if (!r) return { src: undefined, placeholder: 'material' }
  return r.type === 'weapon' ? { src: r.sprite, damageClass: r.damageClass } : { src: r.sprite, placeholder: 'material' }
}
