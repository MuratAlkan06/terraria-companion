/**
 * Cargo access via `action=cargofields` / `action=cargoquery` (ADR-001 D2 source #2).
 *
 * Pagination: rows are ordered by `_ID` (stable) and fetched with `limit`/`offset` until the
 * table's COUNT(*) is reached or a page comes back empty. The server-side page cap is not
 * documented on the wiki (TO-VERIFY-IN-P2 #13), so we REQUEST a large page and RECORD what
 * the server actually returns per page (`rowsPerPage`) in the fetch record.
 */
import type { WikiClient } from './client'
import { FetchError } from './client'

export type CargoRow = Record<string, string | number | null>

/** Cargo Items `type` list (`^`-delimited) contains `type` ("weapon", "tool", …). */
export const itemTypeIncludes = (row: CargoRow, type: string): boolean =>
  String(row.type ?? '')
    .split('^')
    .map((t) => t.trim())
    .includes(type)

export interface CargoFieldInfo {
  type: string
  isList?: boolean
  delimiter?: string
}

export interface CargoTableFetch {
  table: string
  fields: Record<string, CargoFieldInfo>
  selected: string[]
  cargoCount: number
  requestedLimit: number
  rowsPerPage: number[]
  rows: CargoRow[]
  fetchedAt: string // ISO date-time of the newest network fetch (or cache write) for this table
}

/** Requested page size. The observed server cap is recorded per page (TO-VERIFY #13). */
export const CARGO_REQUESTED_LIMIT = 5000

export async function cargoFields(client: WikiClient, table: string): Promise<Record<string, CargoFieldInfo>> {
  const { response } = await client.get({ action: 'cargofields', table }, `cargo/${table}/_fields`)
  const fields = (response as { cargofields?: Record<string, CargoFieldInfo> }).cargofields
  if (!fields || typeof fields !== 'object') throw new FetchError(`cargofields ${table}: unexpected response shape`)
  return fields
}

export async function cargoCount(client: WikiClient, table: string): Promise<{ count: number; fetchedAt: string }> {
  const { response, fetchedAt } = await client.get({ action: 'cargoquery', tables: table, fields: 'COUNT(*)=total' }, `cargo/${table}/_count`)
  const rows = (response as { cargoquery?: { title: { total?: unknown } }[] }).cargoquery
  const count = Number(rows?.[0]?.title?.total)
  if (!Number.isInteger(count) || count < 0) throw new FetchError(`cargo count ${table}: unexpected response ${JSON.stringify(response).slice(0, 200)}`)
  return { count, fetchedAt }
}

/**
 * Cargo returns `_pageName`-style fields only when aliased; alias every field to its own name.
 * `compact` (P2-S8, wide tables such as Equipinfo's 184 columns): plain field names are returned
 * under their own name already, so only `_ID` / `_pageName` are aliased — the fully aliased list
 * would push the GET URL past ~8 KB. (Existing tables keep the aliased form: their cached request
 * params must stay byte-identical.)
 */
function fieldList(table: string, fields: readonly string[], compact = false): string {
  return [`${table}._ID=_rowid`, `${table}._pageName=_page`, ...fields.map((f) => (compact ? f : `${table}.${f}=${f}`))].join(',')
}

export async function cargoQueryAll(
  client: WikiClient,
  table: string,
  selected: readonly string[],
  fields: Record<string, CargoFieldInfo>,
  log?: (line: string) => void,
  options: { compact?: boolean } = {},
): Promise<CargoTableFetch> {
  const { count, fetchedAt: countAt } = await cargoCount(client, table)
  const rows: CargoRow[] = []
  const rowsPerPage: number[] = []
  let newest = countAt
  for (let page = 0; rows.length < count; page += 1) {
    if (page >= 200) throw new FetchError(`cargoquery ${table}: pagination did not converge after 200 pages`)
    const offset = rows.length
    const params = {
      action: 'cargoquery',
      tables: table,
      fields: fieldList(table, selected, options.compact),
      order_by: `${table}._ID`,
      limit: String(CARGO_REQUESTED_LIMIT),
      offset: String(offset),
    }
    const { response, fetchedAt } = await client.get(params, `cargo/${table}/page-${String(offset).padStart(6, '0')}`)
    if (fetchedAt > newest) newest = fetchedAt
    const pageRows = (response as { cargoquery?: { title: CargoRow }[] }).cargoquery
    if (!Array.isArray(pageRows)) throw new FetchError(`cargoquery ${table} offset ${offset}: unexpected response shape`)
    rowsPerPage.push(pageRows.length)
    log?.(`  ${table}: page ${page} offset ${offset} -> ${pageRows.length} rows`)
    if (pageRows.length === 0) break
    for (const r of pageRows) rows.push(r.title)
  }
  return { table, fields, selected: [...selected], cargoCount: count, requestedLimit: CARGO_REQUESTED_LIMIT, rowsPerPage, rows, fetchedAt: newest }
}
