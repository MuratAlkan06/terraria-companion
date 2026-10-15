/**
 * One build as text (P7-S2b; ADR D6 export/import; UX_SPEC §4(f); AMENDMENTS-016 B123(a)): the readable
 * block the builder exports, the import preview's model, and the copy-to-clipboard step. Pure, no React.
 *
 * The block: a header people can skim (the build's name, class, stage, difficulty, goal, target boss; the
 * export date, the app and game-data versions), the slots in plain words (empty slots told apart: emptied
 * by you / left empty by the recommendation, B106), the gear marked owned, then ONE `#code:` line — the
 * build itself (src/storage/transfer.ts encodeBuildCode). Only the code is read on import; the header is
 * never parsed, so editing it changes nothing.
 */
import { SLOT_COUNT } from '../../../scoring/constants'
import { ACCESSORY_SLOT_IDS, AMMO_SLOT_IDS, BUFF_SLOT_IDS, type SlotId } from '../../../scoring/recommend'
import type { ReadinessData } from '../../../scoring/readiness'
import { buildItemIds, type SavedBuild } from '../../../storage/builds'
import { buildCodeLine, encodeBuildCode, sameBuild, type BuildRecord } from '../../../storage/transfer'
import { SITE } from '../../site'
import { getStageInfo } from '../../stages'
import * as text from './buildTextCopy'
import * as copy from './loadoutCopy'
import { DEFAULTS, savedEmptiedSlots, slotLabel } from './loadoutModel'

/** How the block names things (the builder passes its data's names; tests pass their own). */
export interface BuildTextNames {
  item: (id: number) => string
  boss: (slug: string) => string
}

export interface BuildTextMeta {
  now: Date
  appVersion: string
  gameVersion: string
}

/** An item this site's data knows: a weapon, armor piece, accessory or item record, or a named item id. */
export const isKnownItem = (engine: Pick<ReadinessData, 'weapons' | 'armor' | 'accessories' | 'items' | 'nameOf'>, id: number): boolean =>
  engine.weapons.has(id) || engine.armor.has(id) || engine.accessories.has(id) || engine.items.has(id) || engine.nameOf?.(id) !== undefined

/** The names the builder's data gives: unknown ids say so with their id; an unknown boss slug says so. */
export function dataNames(page: { engine: ReadinessData; info: (id: number) => { name: string } }): BuildTextNames {
  return {
    item: (id) => (isKnownItem(page.engine, id) ? page.info(id).name : text.unknownItem(id)),
    boss: (slug) => page.engine.bosses.get(slug)?.name ?? text.bossNotInData(slug),
  }
}

/** The user's own words on one line (a line break would split the block). */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** `YYYY-MM-DD`, the user's local date (the backup file's convention). */
export function exportDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The slots in plain words, in equip-screen order. */
export function slotLines(build: BuildRecord, names: BuildTextNames): string[] {
  const s = build.slots
  const emptied = new Set<SlotId>(savedEmptiedSlots(build))
  const empty = (slot: SlotId) => (emptied.has(slot) ? text.EMPTY_EMPTIED : text.EMPTY_UNFILLED)
  const one = (slot: SlotId, id: number | null) => text.textLine(slotLabel(slot), id === null ? empty(slot) : names.item(id))
  const listed = (label: string, ids: readonly number[], group: readonly SlotId[]) => {
    const marks = group.filter((slot) => emptied.has(slot)).map((slot) => slotLabel(slot))
    return text.textLine(label, [ids.length > 0 ? ids.map(names.item).join(', ') : text.NONE, ...(marks.length > 0 ? [text.listEmptied(marks.join(', '))] : [])].join(' '))
  }
  const lines = [one('main', s.mainWeapon), one('alt', s.altWeapon)]
  if (s.helmet === null && s.chest === null && s.legs === null) lines.push(text.textLine(copy.SLOT_LABELS.armor, empty('armor')))
  else
    for (const [label, id] of [
      [text.TEXT_LABELS.helmet, s.helmet],
      [text.TEXT_LABELS.chest, s.chest],
      [text.TEXT_LABELS.legs, s.legs],
    ] as const)
      lines.push(text.textLine(label, id === null ? text.NONE : names.item(id)))
  const count = SLOT_COUNT[build.difficulty]
  ACCESSORY_SLOT_IDS.forEach((slot, i) => {
    const id = s.accessories[i] ?? null
    if (i < count) lines.push(one(slot, id))
    else if (id !== null) lines.push(text.textLine(slotLabel(slot), text.beyondSlots(names.item(id))))
  })
  lines.push(listed(text.TEXT_LABELS.ammo, s.ammo, AMMO_SLOT_IDS), listed(text.TEXT_LABELS.potions, s.buffs, BUFF_SLOT_IDS), one('summon', s.summon))
  return lines
}

/** The block's lines above its `#code:` line. */
export function buildTextLines(build: BuildRecord, names: BuildTextNames, meta: BuildTextMeta): string[] {
  const owned = build.ownedIds ?? []
  return [
    text.TEXT_TITLE,
    text.textLine(text.TEXT_LABELS.name, oneLine(build.name)),
    text.textLine(text.TEXT_LABELS.class, copy.CLASS_NAMES[build.class]),
    text.textLine(text.TEXT_LABELS.stage, getStageInfo(build.stage).label),
    text.textLine(text.TEXT_LABELS.difficulty, text.difficultyMode(copy.DIFFICULTY_NAMES[build.difficulty])),
    text.textLine(text.TEXT_LABELS.goal, build.goal ? copy.GOAL_NAMES[build.goal] : text.goalDefault(copy.GOAL_NAMES[DEFAULTS.goal])),
    ...(build.targetBoss ? [text.textLine(text.TEXT_LABELS.boss, names.boss(build.targetBoss))] : []),
    text.textLine(text.TEXT_LABELS.exported, text.exportedLine(exportDate(meta.now), SITE.name, meta.appVersion, meta.gameVersion, SITE.platformLabel)),
    '',
    `${text.TEXT_LABELS.slots}:`,
    ...slotLines(build, names),
    text.textLine(text.TEXT_LABELS.owned, owned.length > 0 ? owned.map(names.item).join(', ') : text.NONE),
    ...(build.notes ? [text.textLine(text.TEXT_LABELS.notes, oneLine(build.notes))] : []),
  ]
}

/** The whole block: the readable lines, the note on what's read, and the `#code:` line. */
export function buildText(build: BuildRecord, names: BuildTextNames, meta: BuildTextMeta): string {
  return [...buildTextLines(build, names, meta), '', text.CODE_NOTE, buildCodeLine(encodeBuildCode(build, meta.gameVersion))].join('\n')
}

// --- the import preview ------------------------------------------------------------------------------------

export interface UnknownItemRow {
  id: number
  /** Where it sits: slot labels, and/or "gear you own". */
  where: string[]
}

/**
 * What the import preview says about a read build: its items (every one counted, unknown ids included),
 * the ids this site's data doesn't know and where each sits, its target boss when the data lacks it, and a
 * saved build here holding exactly the same thing.
 */
export interface ImportPreviewModel {
  items: number[]
  unknown: UnknownItemRow[]
  /** The target boss slug when this site's data has no such boss. */
  missingBoss?: string
  duplicateOf?: SavedBuild
}

export function importPreview(build: BuildRecord, known: (id: number) => boolean, isBoss: (slug: string) => boolean, saved: readonly SavedBuild[]): ImportPreviewModel {
  const s = build.slots
  const unknown = new Map<number, string[]>()
  const note = (id: number | null, where: string) => {
    if (id === null || known(id)) return
    const list = unknown.get(id) ?? []
    if (!list.includes(where)) list.push(where)
    unknown.set(id, list)
  }
  note(s.mainWeapon, slotLabel('main'))
  note(s.altWeapon, slotLabel('alt'))
  note(s.helmet, text.TEXT_LABELS.helmet)
  note(s.chest, text.TEXT_LABELS.chest)
  note(s.legs, text.TEXT_LABELS.legs)
  s.accessories.forEach((id, i) => note(id, slotLabel(ACCESSORY_SLOT_IDS[i])))
  for (const id of s.ammo) note(id, text.TEXT_LABELS.ammo)
  for (const id of s.buffs) note(id, text.TEXT_LABELS.potions)
  note(s.summon, slotLabel('summon'))
  for (const id of build.ownedIds ?? []) note(id, text.UNKNOWN_WHERE_OWNED)
  const duplicateOf = saved.find((b) => sameBuild(b, build))
  return {
    items: buildItemIds(build),
    unknown: [...unknown].map(([id, where]) => ({ id, where })),
    ...(build.targetBoss && !isBoss(build.targetBoss) ? { missingBoss: build.targetBoss } : {}),
    ...(duplicateOf ? { duplicateOf } : {}),
  }
}

// --- copy to the clipboard -----------------------------------------------------------------------------------

export interface ClipboardEnv {
  /** navigator.clipboard where the browser offers it (secure contexts). */
  clipboard?: Pick<Clipboard, 'writeText'> | undefined
  /** The select-and-copy fallback (older browsers, denied permission); true when it copied. */
  fallback?: () => boolean
}

/** Copies `value`: the Clipboard API first, then the fallback. Resolves to whether it was copied — never throws. */
export async function copyText(value: string, env: ClipboardEnv): Promise<boolean> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(value)
      return true
    } catch {
      // permission denied or no user gesture: try the fallback
    }
  }
  try {
    return env.fallback?.() ?? false
  } catch {
    return false
  }
}
