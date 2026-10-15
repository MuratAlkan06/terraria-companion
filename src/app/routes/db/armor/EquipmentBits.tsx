import { ChevronDown, Search, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { cx } from '../../../../components/cx'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityColor, rarityLabel } from '../../../../components/rarity'
import { UnknownValue } from '../../../../components/UnknownValue'
import type { SpriteIndex } from '../../../../data-access/types'
import type { DamageClass, ProvSource, StatEffect } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'
import { effectPhrase } from '../../../../scoring/readinessCopy'
import { sourceTitle, stageLabel } from '../weapons/weaponDisplay'
import { classLabel, isSpecial, isStat } from './equipmentDisplay'

/**
 * Pieces shared by the armor and accessory pages (PRD P6-S1/S2; UX_SPEC §3.1, §5.3): header facts, a record's
 * rarity / stage (value or Unknown), its effects list (stat effects in the builder's words, wiki-text effects
 * quoted with their source), class badges and the "Where this data comes from" panel over several records.
 */

export const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'
export const SECTION_TITLE = 'scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-base'
export const FIELD_LABEL = 'text-xs font-semibold tracking-wide text-fg-muted uppercase'

export function HeaderFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd className="flex min-h-6 flex-wrap items-center gap-1.5">{children}</dd>
    </div>
  )
}

interface Provenanced {
  wikiUrl: string
  _prov: { unverifiedFields: readonly string[]; editorialFields: readonly string[] }
}

/** A record's rarity: the colour swatch + its label (never colour alone), or Unknown. */
export function RarityValue({ record, field = 'rarity' }: { record: Provenanced; field?: string }) {
  const view = getField(record, field)
  if (view.status === 'unverified') return <UnknownValue field={field} sourceUrl={record.wikiUrl} />
  if (view.status === 'not-applicable') return null
  const rarity = asRarity(view.value as number | string)
  if (rarity === undefined) return <span>{String(view.value)}</span>
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <span aria-hidden="true" className="size-3 border-2 border-night-950" style={{ backgroundColor: rarityColor(rarity) }} />
      {rarityLabel(rarity)}
    </span>
  )
}

/** A record's game stage, or Unknown (a stage comes from verified gating — most records have none). */
export function StageValue({ record, field = 'stage' }: { record: Provenanced; field?: string }) {
  const view = getField(record, field)
  if (view.status === 'unverified') return <UnknownValue field={field} sourceUrl={record.wikiUrl} />
  if (view.status === 'not-applicable') return null
  return <span className="font-semibold">{stageLabel(view.value as string)}</span>
}

/** Small text badge for a damage class ("Classless" for "other"), like the weapon ClassBadge. */
export function ClassChip({ cls, className }: { cls: DamageClass; className?: string }) {
  return (
    <span
      data-class={cls}
      className={cx('inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase', className)}
    >
      {classLabel(cls)}
    </span>
  )
}

/**
 * A record's effects (`field`, read through getField): stat effects in the builder's words ("+16% melee damage"),
 * wiki-text effects in quotation marks with their source when it isn't the record's own article. Unverified →
 * Unknown; a verified empty list → `empty`.
 */
export function EffectList({ record, field = 'effects', empty, className }: { record: Provenanced; field?: string; empty: string; className?: string }) {
  const view = getField(record, field)
  if (view.status === 'unverified') return <UnknownValue field={field} sourceUrl={record.wikiUrl} />
  const effects = (view.value as StatEffect[] | undefined) ?? []
  if (effects.length === 0) return <span className="text-fg-muted">{empty}</span>
  return <EffectItems effects={effects} wikiUrl={record.wikiUrl} className={className} />
}

/** The effects themselves (also the set bonus's, whose list is never Unknown in the data). */
export function EffectItems({ effects, wikiUrl, className }: { effects: readonly StatEffect[]; wikiUrl: string; className?: string }) {
  return (
    <ul className={cx('space-y-1', className)} data-effects="">
      {effects.map((e, i) =>
        isStat(e) ? (
          <li key={i} data-effect={e.stat} className="font-semibold tabular-nums">
            {effectPhrase(e)}
          </li>
        ) : isSpecial(e) ? (
          <li key={i} data-effect="special" className="flex flex-wrap items-baseline gap-x-2">
            <WikiQuote text={e.text} />
            {e.sourceUrl !== wikiUrl ? <ProvenanceLink href={e.sourceUrl} label="Source" srContext={`for “${e.text}”`} className="min-h-0" /> : null}
          </li>
        ) : null,
      )}
    </ul>
  )
}

/** Verbatim wiki text in quotation marks (excluded from our copy audit, like the boss pages' quotes). */
export function WikiQuote({ text, className }: { text: string; className?: string }) {
  return (
    <span data-wiki-text="" className={cx('whitespace-pre-line italic', className)}>
      “{text}”
    </span>
  )
}

interface Sourced {
  name: string
  sprite?: string
  _prov: { sources: readonly ProvSource[] }
}

/**
 * "Where this data comes from" over every record a page shows (a set and its pieces): each distinct source once
 * (kind + page + revision), then each record's sprite with its wiki file page.
 */
export function SourcesPanel({ records, sprites, summary, spriteCredit }: { records: readonly Sourced[]; sprites: SpriteIndex | null; summary: string; spriteCredit: string }) {
  const seen = new Set<string>()
  const sources: ProvSource[] = []
  for (const r of records) {
    for (const s of r._prov.sources) {
      const key = `${s.kind}|${s.url}|${s.rev ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      sources.push(s)
    }
  }
  const spriteFiles = sprites?.fallbackMode ? [] : records.flatMap((r) => (r.sprite ? [{ name: r.name, entry: sprites?.byPath.get(r.sprite) }] : [])).filter((x) => x.entry)
  return (
    <details className="group border-2 border-panel-border bg-surface px-4 py-2 text-sm">
      <summary className="flex min-h-tap items-center justify-between gap-3 font-semibold text-fg-muted group-open:text-fg [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform duration-(--dur-ui) ease-out-strong group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 pt-2 pb-2">
        {sources.map((source, i) => {
          const { label, page } = sourceTitle(source)
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2" data-source-kind={source.kind}>
              <span>
                {label}
                {page ? (
                  <>
                    : <span className="font-semibold">{page}</span>
                  </>
                ) : null}
              </span>
              {source.rev ? <span className="text-fg-muted tabular-nums">rev {source.rev}</span> : null}
              <span className="text-fg-muted tabular-nums">fetched {source.fetchedAt}</span>
              <ProvenanceLink href={source.url} srContext={page ? `(${label}: ${page})` : `(${label})`} />
            </li>
          )
        })}
        {spriteFiles.length > 0 ? (
          <li className="space-y-1">
            <span>{spriteCredit}</span>
            <ul className="flex flex-wrap gap-x-4">
              {spriteFiles.map((s) => (
                <li key={s.name}>
                  <ProvenanceLink href={s.entry?.wikiFileUrl ?? ''} label={`${s.name} sprite`} srContext="(wiki file page)" />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </details>
  )
}

/**
 * A list's name filter (`?q=`; the encyclopedia's own pattern): every typed word must start a word of the name.
 * Instant, never animated (UX_SPEC §12); follows the URL when it changes elsewhere (Clear all, Back).
 */
export function NameFilter({ value, onChange, label, placeholder, clearLabel, maxLength }: { value: string; onChange: (q: string) => void; label: string; placeholder: string; clearLabel: string; maxLength: number }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    if (value.trim() !== text.trim()) setText(value)
  }
  return (
    <div className="max-w-md space-y-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
        <input
          id={id}
          type="search"
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value)
            onChange(event.target.value)
          }}
          className={cx(
            'min-h-tap w-full border-2 border-panel-border bg-slot py-2 pr-12 pl-10 text-fg shadow-pixel placeholder:text-stone-500',
            'focus-visible:outline-fg focus-visible:ring-2 focus-visible:ring-night-950 [&::-webkit-search-cancel-button]:hidden',
          )}
        />
        {text ? (
          <button
            type="button"
            onClick={() => {
              setText('')
              onChange('')
            }}
            className="absolute top-1/2 right-0 grid min-h-tap min-w-tap -translate-y-1/2 place-items-center text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{clearLabel}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
