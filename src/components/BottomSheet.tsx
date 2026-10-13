import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Bottom sheet (UX_SPEC §2 "More" sheet pattern, §7 mobile filters): Radix Dialog anchored to
 * the bottom edge, focus-trapped, dismissible by its close button, Esc, or the overlay
 * (never gesture-only, UX_SPEC §9). Slides in 260ms / out 180ms; static under reduced motion.
 */
export interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The element that opens the sheet (rendered as Dialog.Trigger asChild). */
  trigger: ReactNode
  title: string
  description?: string
  children: ReactNode
  /** Sticky footer actions. */
  footer?: ReactNode
}

export function BottomSheet({ open, onOpenChange, trigger, title, description, children, footer }: BottomSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-sheet) bg-night-950/75 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cx(
            'fixed inset-x-0 bottom-0 z-(--z-sheet) flex max-h-[85dvh] flex-col border-t-2 border-panel-border bg-surface text-fg shadow-pixel',
            'data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
          )}
        >
          <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-3 pb-2">
            <Dialog.Title className="font-display text-base text-accent">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={`Close ${title.toLowerCase()}`}
              className="grid min-h-tap min-w-tap place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className={description ? 'mx-auto w-full max-w-xl px-4 text-sm text-fg-muted' : 'sr-only'}>
            {description ?? title}
          </Dialog.Description>
          <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
          {footer ? (
            <div className="border-t-2 border-panel-border bg-surface pb-safe">
              <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-3">{footer}</div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
