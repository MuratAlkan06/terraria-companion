/**
 * Cargo NPCs + DropSource[] → Enemy[] (AMENDMENTS-001 A5).
 *
 * - Membership: NPCs rows whose `type` list contains an enemy type (enemy, undead/flying/
 *   burrowing/etherian Enemy, slime, aquatic, goblin) and none of boss / boss Part (P2-S6
 *   bosses), critter / gold Critter, nPC (town NPCs), projectile NPC, furniture, background
 *   object. Rows sharing a `nameraw` are one enemy (all npc ids merged); the id is the name's
 *   slug. Negative variant netIDs are kept (AMENDMENTS-003 B10: npcIds are nonzero ints).
 * - biomes: the NPCs `environment` cell is semi-structured — "/" separates alternatives and
 *   "+" joins requirements ("Surface+Night/Space+Night"). Emitted verbatim per alternative
 *   ("Surface + Night"); an empty cell → absent + listed.
 * - stage: not derivable from Cargo → absent + listed (P2-S6 gating derivation).
 * - dropIds: derived with `deriveEnemyDropIds` (the validate rule, single definition).
 */
import type { DropSource, Enemy, ProvSource } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import { slugify, stripMarkup } from '../parse/text'
import { deriveEnemyDropIds } from '../validate/integrity'
import { isoDate, makeProv } from './prov'

const ENEMY_TYPES = new Set(['enemy', 'undead Enemy', 'flying Enemy', 'burrowing Enemy', 'etherian Enemy', 'slime', 'aquatic', 'goblin'])
const NON_ENEMY_TYPES = new Set(['boss', 'boss Part', 'critter', 'gold Critter', 'nPC', 'projectile NPC', 'furniture', 'background object'])

const str = (v: CargoRow[string]) => (v === null || v === undefined ? '' : String(v))

export interface EnemyLedger {
  npcRows: number
  enemyRows: number
  enemies: number
  slugCollisions: string[]
}

export function buildEnemies(npcRows: readonly CargoRow[], drops: readonly DropSource[], npcsFetchedAt: string, dropsFetchedAt: string): { enemies: Enemy[]; ledger: EnemyLedger } {
  const ledger: EnemyLedger = { npcRows: npcRows.length, enemyRows: 0, enemies: 0, slugCollisions: [] }
  const groups = new Map<string, { name: string; page: string; ids: Set<number>; envs: string[] }>()
  for (const row of npcRows) {
    const types = str(row.type).split('^').map((t) => t.trim()).filter(Boolean)
    if (!types.some((t) => ENEMY_TYPES.has(t)) || types.some((t) => NON_ENEMY_TYPES.has(t))) continue
    ledger.enemyRows += 1
    const name = stripMarkup(str(row.nameraw))
    const id = slugify(name)
    if (id === '') continue
    const g = groups.get(id) ?? { name, page: str(row._page), ids: new Set<number>(), envs: [] }
    if (g.name !== name) ledger.slugCollisions.push(`${g.name} / ${name}`)
    const npcId = Number(str(row.npcid))
    if (Number.isInteger(npcId) && npcId !== 0) g.ids.add(npcId)
    const env = stripMarkup(str(row.environment))
    if (env !== '' && !g.envs.includes(env)) g.envs.push(env)
    groups.set(id, g)
  }

  const enemies: Enemy[] = []
  for (const [id, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const unverified = ['stage']
    const npcIds = [...g.ids].sort((a, b) => a - b)
    if (npcIds.length === 0) unverified.push('npcIds')
    const biomes = [...new Set(g.envs.flatMap((e) => e.split('/').map((alt) => alt.split('+').map((p) => p.trim()).filter(Boolean).join(' + '))))].filter(Boolean)
    if (biomes.length === 0) unverified.push('biomes')
    const wikiUrl = wikiPageUrl(g.page || g.name)
    const enemy: Enemy = {
      id,
      ...(npcIds.length > 0 ? { npcIds } : {}),
      name: g.name,
      ...(biomes.length > 0 ? { biomes } : {}),
      dropIds: [],
      wikiUrl,
      _prov: makeProv([{ kind: 'cargo:NPCs', url: wikiUrl, fetchedAt: isoDate(npcsFetchedAt) }], unverified),
    }
    enemy.dropIds = deriveEnemyDropIds(enemy, drops).sort()
    if (enemy.dropIds.length > 0) {
      const dropSrc: ProvSource = { kind: 'cargo:Drops', url: wikiUrl, fetchedAt: isoDate(dropsFetchedAt) }
      enemy._prov = makeProv([...enemy._prov.sources, dropSrc], unverified)
    }
    enemies.push(enemy)
  }
  ledger.enemies = enemies.length
  return { enemies, ledger }
}
