/**
 * Guide content model (PRD P6-S8; UX_SPEC §3.10; REQUIREMENTS §9).
 *
 * Guides are editorial prose, authored as data so every factual reference is checkable:
 * - `ent(ref, name)` — an entity in the dataset, by its SearchDoc id (`i:<itemId>`, `set:`, `boss:`,
 *   `enemy:`, `buff:`). The page resolves it against search-docs.json at runtime and links it
 *   through the same resolver as global search (src/search/links.ts): an in-app page where one
 *   exists (weapons today), else the record's own wiki article. `name` is the dataset name; the
 *   content test asserts both that the record exists and that the name matches it.
 * - `wiki(page, text, itemId?)` — a citation of a terraria.wiki.gg article, for facts the dataset
 *   has no record (or no page) for. `itemId`, when given, must name that item in item-universe.json.
 * - `guide(slug, text)` / `route(routeId, text)` — links to another guide or a registered route.
 *
 * Prose is written with the `t` tagged template: t`Craft a ${ent('i:24', 'Wooden Sword')} first.`
 */
import { WIKI_ORIGIN } from '../../../search/links'
import type { Stage } from '../../stages'

/** A dataset entity by SearchDoc id. `text` overrides the visible words (e.g. a plural). */
export interface EntityMention {
  kind: 'entity'
  ref: string
  name: string
  text?: string
}

/** A terraria.wiki.gg article cited by page title (underscores, as in its URL). */
export interface WikiMention {
  kind: 'wiki'
  page: string
  text: string
  /** The item the article is about, when it is an item (checked against item-universe.json). */
  itemId?: number
}

export interface GuideMention {
  kind: 'guide'
  slug: string
  text: string
}

export interface RouteMention {
  kind: 'route'
  routeId: string
  text: string
}

export type Mention = EntityMention | WikiMention | GuideMention | RouteMention

/** A run of prose: plain strings interleaved with links. */
export type Rich = readonly (string | Mention)[]

/** A thing that can sit in an item slot: a dataset entity, or a wiki-cited item. */
export type SlotMention = EntityMention | (WikiMention & { itemId: number })

export type Block =
  | { kind: 'p'; text: Rich }
  /** A short list of practical tips (rendered as a callout). */
  | { kind: 'tips'; items: readonly Rich[] }
  /** A plain bulleted list (facts, not advice). */
  | { kind: 'list'; items: readonly Rich[] }
  /** A row of linked ItemSlots with visible names (UX_SPEC §3.10 "ItemSlot inline links"). */
  | { kind: 'slots'; label: string; items: readonly SlotMention[] }

export interface GuideSection {
  /** Stable anchor id, unique within the guide. */
  id: string
  title: string
  blocks: readonly Block[]
}

export interface ChecklistEntry {
  /** Stable id persisted in tc.v1.checklists — never rename a shipped id. */
  id: string
  /** Plain text (no links: a checklist row is one label for one checkbox). */
  text: string
}

export interface Guide {
  slug: string
  title: string
  /** Short topic name for index cards and the page eyebrow. */
  topic: string
  /** The game stages the guide is for, in order (one stage, or a contiguous band). */
  stages: readonly [Stage, ...Stage[]]
  /** One line for the index card. */
  summary: string
  intro: readonly Rich[]
  sections: readonly GuideSection[]
  checklist: readonly ChecklistEntry[]
  /** Optional deeper explanation, collapsed by default (REQUIREMENTS §9). */
  advanced?: { title: string; blocks: readonly Block[] }
}

/** Tagged template for prose: interpolations must be mentions. */
export function t(strings: TemplateStringsArray, ...mentions: Mention[]): Rich {
  const parts: (string | Mention)[] = []
  strings.forEach((text, index) => {
    if (text !== '') parts.push(text)
    if (index < mentions.length) parts.push(mentions[index])
  })
  return parts
}

export const ent = (ref: string, name: string, text?: string): EntityMention =>
  text === undefined ? { kind: 'entity', ref, name } : { kind: 'entity', ref, name, text }

export function wiki(page: string, text: string): WikiMention
export function wiki(page: string, text: string, itemId: number): WikiMention & { itemId: number }
export function wiki(page: string, text: string, itemId?: number): WikiMention {
  return itemId === undefined ? { kind: 'wiki', page, text } : { kind: 'wiki', page, text, itemId }
}

export const guide = (slug: string, text: string): GuideMention => ({ kind: 'guide', slug, text })
export const route = (routeId: string, text: string): RouteMention => ({ kind: 'route', routeId, text })

export const p = (text: Rich): Block => ({ kind: 'p', text })
export const tips = (...items: Rich[]): Block => ({ kind: 'tips', items })
export const list = (...items: Rich[]): Block => ({ kind: 'list', items })
export const slots = (label: string, ...items: SlotMention[]): Block => ({ kind: 'slots', label, items })

/** terraria.wiki.gg article URL for a page title as it appears in the wiki's own URLs. */
export function wikiUrl(page: string): string {
  return `${WIKI_ORIGIN}/wiki/${encodeURI(page)}`
}

/** Readable article title ("Guide:Getting_started" -> "Guide:Getting started"). */
export function wikiTitle(page: string): string {
  return page.replace(/_/g, ' ')
}

/** tc.v1.checklists key for a guide's checklist (AMENDMENTS-001 A7). */
export const checklistKey = (slug: string): string => `guide:${slug}`

export const guideHref = (slug: string): string => `/guides/${slug}`

/** Every mention in a guide, in reading order (intro, sections, advanced). */
export function guideMentions(guide: Guide): Mention[] {
  const fromBlocks = (blocks: readonly Block[]): Mention[] =>
    blocks.flatMap((block) => {
      switch (block.kind) {
        case 'p':
          return mentionsIn(block.text)
        case 'tips':
        case 'list':
          return block.items.flatMap(mentionsIn)
        case 'slots':
          return [...block.items]
      }
    })
  return [
    ...guide.intro.flatMap(mentionsIn),
    ...guide.sections.flatMap((section) => fromBlocks(section.blocks)),
    ...(guide.advanced ? fromBlocks(guide.advanced.blocks) : []),
  ]
}

function mentionsIn(rich: Rich): Mention[] {
  return rich.filter((part): part is Mention => typeof part !== 'string')
}

/** Wiki articles a guide cites, unique by page, in first-cited order (the page's Sources list). */
export function citedPages(guide: Guide): string[] {
  const pages = guideMentions(guide)
    .filter((m): m is WikiMention => m.kind === 'wiki')
    .map((m) => m.page)
  return [...new Set(pages)]
}

/** Every user-visible authored string of a guide (copy audits). */
export function guideText(guide: Guide): string[] {
  const richText = (rich: Rich) =>
    rich.map((part) => (typeof part === 'string' ? part : part.kind === 'entity' ? (part.text ?? part.name) : part.text)).join('')
  const blockText = (blocks: readonly Block[]): string[] =>
    blocks.flatMap((block) => {
      switch (block.kind) {
        case 'p':
          return [richText(block.text)]
        case 'tips':
        case 'list':
          return block.items.map(richText)
        case 'slots':
          return [block.label]
      }
    })
  return [
    guide.title,
    guide.topic,
    guide.summary,
    ...guide.intro.map(richText),
    ...guide.sections.flatMap((section) => [section.title, ...blockText(section.blocks)]),
    ...guide.checklist.map((entry) => entry.text),
    ...(guide.advanced ? [guide.advanced.title, ...blockText(guide.advanced.blocks)] : []),
  ]
}
