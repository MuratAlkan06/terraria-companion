import { cx } from './cx'
import { PixelPanel } from './PixelPanel'

/**
 * Pixel loading screen (UX_SPEC §5.1, AMENDMENTS-001 A12) — shown while a lazy
 * route chunk loads. Blocks pulse in sequence; static under reduced motion.
 */
const BLOCKS = ['bg-forest-500', 'bg-earth-500', 'bg-stone-500', 'bg-night-400', 'bg-gold-400'] as const

export function PixelLoader({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('mx-auto w-full max-w-7xl px-4 py-10 md:px-6', className)}>
      <PixelPanel role="status" aria-live="polite" className="flex min-h-40 flex-col items-center justify-center gap-4">
        <div aria-hidden="true" className="flex gap-2">
          {BLOCKS.map((color, index) => (
            <span
              key={color}
              className={cx('size-4 border-2 border-night-950 motion-safe:animate-pixel-march', color)}
              style={{ animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
        <p className="text-sm text-fg-muted">{label}</p>
      </PixelPanel>
    </div>
  )
}
