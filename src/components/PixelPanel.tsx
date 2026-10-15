import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cx } from './cx'

/**
 * PixelPanel — the base zero-radius container of the kit (ADR D4, UX_SPEC §3.1).
 * 2px token border + pixel bevel; tone picks a brand surface.
 */
export type PixelPanelTone = 'night' | 'stone' | 'earth' | 'forest' | 'gold'

const TONE_CLASSES: Record<PixelPanelTone, string> = {
  night: 'bg-panel border-panel-border',
  stone: 'bg-stone-900 border-stone-700',
  earth: 'bg-earth-900 border-earth-600',
  forest: 'bg-forest-900 border-forest-700',
  gold: 'bg-panel border-gold-500',
}

type PanelElement = 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer'

export type PixelPanelProps<E extends PanelElement = 'div'> = {
  as?: E
  tone?: PixelPanelTone
  /** Default padding scale; set false to manage padding yourself. */
  padded?: boolean
  className?: string
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<E>, 'className' | 'children'>

export function PixelPanel<E extends PanelElement = 'div'>({
  as,
  tone = 'night',
  padded = true,
  className,
  children,
  ...rest
}: PixelPanelProps<E>) {
  const Component: ElementType = as ?? 'div'
  return (
    <Component
      className={cx('border-2 text-fg shadow-pixel', TONE_CLASSES[tone], padded && 'p-4 md:p-6', className)}
      {...rest}
    >
      {children}
    </Component>
  )
}
