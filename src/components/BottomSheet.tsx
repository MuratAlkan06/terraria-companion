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
  /** Shown under the title and announced as the dialog's description; without one the dialog has none. */
  description?: string
  children: ReactNode
  /** Sticky footer actions. */
  footer?: ReactNode
  /**
   * Always the full sheet height (85dvh) instead of fitting the content: the body then has a
   * definite height, so content can pin a header and scroll a list of its own (the Lab's browser).
   */
  fill?: boolean
  /**
   * Radix's close auto-focus (default: back to the trigger). A sheet closed because its action moved
   * focus elsewhere (e.g. the boss map's recommender jumping to a node's card) prevents it.
   */
  onCloseAutoFocus?: (event: Event) => void
  /** The close button's accessible name (default "Close <title, lower-cased>" — for a title that is a phrase). */
  closeLabel?: string
}

export function BottomSheet({ open, onOpenChange, trigger, title, description, children, footer, fill = false, onCloseAutoFocus, closeLabel }: BottomSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-sheet) bg-night-950/75 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          // No description: none at all (Radix's documented opt-out), rather than the title again as one —
          // a screen reader would announce it twice on open.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cx(
            'fixed inset-x-0 bottom-0 z-(--z-sheet) flex flex-col border-t-2 border-panel-border bg-surface text-fg shadow-pixel',
            fill ? 'h-[85dvh]' : 'max-h-[85dvh]',
            'data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
          )}
        >
          <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-3 pb-2">
            <Dialog.Title className="font-display text-base text-accent">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
              className="grid min-h-tap min-w-tap place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          {description ? <Dialog.Description className="mx-auto w-full max-w-xl px-4 text-sm text-fg-muted">{description}</Dialog.Description> : null}
          <div className="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
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
