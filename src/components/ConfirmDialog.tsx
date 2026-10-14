import { AlertDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { buttonClass } from './buttonStyles'
import { cx } from './cx'

/**
 * ConfirmDialog (UX_SPEC §3.1, §6, §10.6): every destructive action routes through it. Radix
 * AlertDialog — modal, focus-trapped, labelled by its title and described by its body; Esc or Cancel
 * dismisses. Cancel is the default focus (Radix moves focus to AlertDialog.Cancel on open), and the
 * destructive button is a `--color-destructive` FILL with its own text token (the red fails 4.5:1 as
 * text, tokens.css). Controlled: the caller owns `open` and where focus returns on close.
 */
export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What the action does, in plain words (the dialog's description). */
  description: ReactNode
  /** Extra lines under the description (what stays untouched). */
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  /** Where focus goes when the dialog closes (default: Radix's, the element focused before it opened). */
  returnFocus?: () => HTMLElement | null | undefined
}

export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, returnFocus }: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <AlertDialog.Content
          data-confirm-dialog=""
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.()
            if (!target) return
            event.preventDefault()
            target.focus()
          }}
          className={cx(
            'fixed top-1/2 left-1/2 z-(--z-dialog) w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 border-2 border-panel-border bg-surface p-4 text-fg shadow-pixel-drop',
            'data-[state=open]:animate-fade-in',
          )}
        >
          <AlertDialog.Title className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm leading-relaxed">{description}</AlertDialog.Description>
          {children ? <div className="text-sm text-fg-muted">{children}</div> : null}
          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <AlertDialog.Cancel data-confirm-cancel="" className={buttonClass('secondary')}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              data-confirm-action=""
              onClick={onConfirm}
              className={cx(
                'inline-flex min-h-tap items-center justify-center gap-2 border-2 border-destructive bg-destructive px-4 font-semibold text-destructive-fg shadow-pixel',
                'transition-[filter,transform] duration-(--dur-press) ease-out-strong hover:brightness-110 active:scale-[0.97]',
              )}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
