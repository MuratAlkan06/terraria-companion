import { Tooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { rarityColor, rarityLabel, type Rarity } from './rarity'

/**
 * RarityText — rarity-tinted name (UX_SPEC §3.1). Colour comes from the `--rarity-*` tokens
 * (dark-bg adjusted, >= 4.5:1 on night-950/900/800). Rarity is never conveyed by colour alone:
 * with `tooltip` the rarity label shows on hover, and pages must also show the label as text
 * somewhere nearby (list rows and detail headers do).
 */
export interface RarityTextProps {
  rarity: Rarity | undefined
  children: ReactNode
  tooltip?: boolean
  className?: string
}

export function RarityText({ rarity, children, tooltip = false, className }: RarityTextProps) {
  const text = (
    <span
      data-rarity={rarity}
      className={cx('text-shadow-pixel', rarity === undefined && 'text-fg', className)}
      style={rarity === undefined ? undefined : { color: rarityColor(rarity) }}
    >
      {children}
    </span>
  )
  if (!tooltip || rarity === undefined) return text

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{text}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-(--z-popover) border-2 border-tooltip-border bg-tooltip-bg px-3 py-1.5 font-sans text-sm text-fg shadow-pixel-drop"
        >
          Rarity: {rarityLabel(rarity)}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
