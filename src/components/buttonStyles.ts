import { cx } from './cx'

/**
 * Shared button/link-button styling: zero-radius, pixel bevel, >= 44px target,
 * scale(0.97) press feedback over --dur-press (UX_SPEC §12).
 */
export type ButtonVariant = 'primary' | 'secondary'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-forest-400 bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'border-border-strong bg-surface-raised text-fg hover:bg-night-700',
}

export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cx(
    'inline-flex min-h-tap items-center justify-center gap-2 border-2 px-4 font-semibold shadow-pixel',
    'transition-[background-color,transform] duration-(--dur-press) ease-out-strong active:scale-[0.97]',
    VARIANT_CLASSES[variant],
    className,
  )
}
