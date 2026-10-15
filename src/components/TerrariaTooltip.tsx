import { cx } from './cx'
import { rarityColor, rarityLabel, type Rarity } from './rarity'

/**
 * TerrariaTooltip — in-game style item tooltip (ADR D4 kit, UX_SPEC §3.1).
 * Presentational only: ItemSlot wraps it in a hover/focus popover, and pages may
 * render it inline. All strings render as plain text (AMENDMENTS-001 A15).
 */
export type TooltipTone = 'default' | 'muted' | 'positive' | 'negative' | 'flavor'

export interface TooltipLine {
  text: string
  tone?: TooltipTone
}

export interface TerrariaTooltipData {
  name: string
  rarity?: Rarity
  lines?: readonly TooltipLine[]
  /** Small trailing note, e.g. provenance or a "sample values" disclaimer. */
  footnote?: string
}

export interface TerrariaTooltipProps extends TerrariaTooltipData {
  id?: string
  className?: string
}

const TONE_CLASSES: Record<TooltipTone, string> = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  positive: 'text-success',
  negative: 'text-negative',
  flavor: 'italic text-fg-muted',
}

export function TerrariaTooltip({ name, rarity, lines = [], footnote, id, className }: TerrariaTooltipProps) {
  return (
    <div
      id={id}
      // Max 18rem, shrunk to the space Radix measured beside the trigger when inside a
      // Tooltip.Content (inherited CSS var) so it never clips at 375px; inline it stays 18rem.
      className={cx(
        'w-max max-w-[min(--spacing(72),var(--radix-tooltip-content-available-width,--spacing(72)))] border-2 border-tooltip-border bg-tooltip-bg/95 px-3 py-2 text-sm leading-snug shadow-pixel-drop',
        className,
      )}
    >
      <p
        className="font-semibold text-shadow-pixel"
        style={rarity === undefined ? undefined : { color: rarityColor(rarity) }}
      >
        {name}
      </p>
      {lines.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {lines.map((line, index) => (
            <li key={index} className={TONE_CLASSES[line.tone ?? 'default']}>
              {line.text}
            </li>
          ))}
        </ul>
      ) : null}
      {rarity === undefined ? null : <p className="mt-2 text-xs text-fg-muted">Rarity: {rarityLabel(rarity)}</p>}
      {footnote ? <p className="mt-2 border-t border-border pt-2 text-xs text-fg-muted">{footnote}</p> : null}
    </div>
  )
}
