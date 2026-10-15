/**
 * Module:Projectileinfo/data → projectile stats by projectile ID (P2-S7, ammo velocity multiplier
 * cross-check).
 *
 * Verified module shape (rev 1030091, "generated at: 2026-09-13 15:45 (+00:00) from
 * Module:Projectileinfo/datagen"): `return { [0] = {defaults}, [1] = {overrides}, …, ['m1016'] = {…} }`.
 * `[0]` holds the default values; every other numeric key is a projectile whose table lists only the
 * fields that differ from the defaults (full stats = defaults ∪ overrides, like Module:Iteminfo/data).
 * String keys ("m…") are not projectile IDs and are skipped. `extraUpdates` = extra position updates
 * per tick, which the wiki's item infobox shows as "Velocity Multiplier (extraUpdates + 1)×"
 * (linked to Velocity#extraUpdates).
 */
import type { ModuleFetch } from '../fetch/modules'
import { LuaParseError, parseLua, returnedValue } from './lua'

export interface Projectile {
  id: number
  name?: string
  internalName?: string
  /** Defaults ∪ overrides. */
  stats: Readonly<Record<string, unknown>>
}

export interface Projectileinfo {
  title: string
  rev: number
  fetchedAt: string
  /** "2026-09-13 15:45 (+00:00)" from the generator header, or "" when absent. */
  generated: string
  projectiles: Map<number, Projectile>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseProjectileinfo(fetched: ModuleFetch): Projectileinfo {
  const label = fetched.title
  const top = returnedValue(parseLua(fetched.content, label), label)
  if (!isRecord(top) || !isRecord(top['0'])) throw new LuaParseError(`${label}: expected a table with defaults at [0]`)
  const defaults = top['0']
  const projectiles = new Map<number, Projectile>()
  for (const [key, value] of Object.entries(top)) {
    if (!/^\d+$/.test(key) || key === '0' || !isRecord(value)) continue
    const id = Number(key)
    const stats = { ...defaults, ...value }
    projectiles.set(id, {
      id,
      ...(typeof value.name === 'string' && value.name !== '' ? { name: value.name } : {}),
      ...(typeof stats.internalName === 'string' ? { internalName: stats.internalName } : {}),
      stats,
    })
  }
  const generated = /--\s*generated at:\s*([^\n]+)/.exec(fetched.content)?.[1]?.trim() ?? ''
  return { title: fetched.title, rev: fetched.rev, fetchedAt: fetched.fetchedAt, generated, projectiles }
}

/** extraUpdates of a projectile (undefined when the projectile or the field is unknown). */
export function extraUpdates(info: Projectileinfo, projectileId: number): number | undefined {
  const v = info.projectiles.get(projectileId)?.stats.extraUpdates
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
}
