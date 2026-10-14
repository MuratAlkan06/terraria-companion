import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from './cx'

/**
 * UndoToast (UX_SPEC §5.7, §6): after a destructive action whose result isn't otherwise offered
 * back, a toast with a ONE-SHOT Undo for `durationMs` (reset progress: 6s). It never steals focus;
 * the polite status region stays mounted so its message is announced when it appears. Pointer or
 * keyboard focus inside holds it open (the countdown restarts when they leave); Undo or the close
 * button hands focus back to where it was before it entered the toast.
 */
export interface UndoToastProps {
  open: boolean
  message: string
  undoLabel: string
  onUndo: () => void
  /** The window ran out or the toast was dismissed: the undo is gone. */
  onClose: () => void
  durationMs: number
  /** Extra classes for the positioning container (e.g. a page lifting it clear of its own corner controls). */
  className?: string
}

export function UndoToast({ open, message, undoLabel, onUndo, onClose, durationMs, className }: UndoToastProps) {
  const [held, setHeld] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open || held) return
    const timer = window.setTimeout(onClose, durationMs)
    return () => window.clearTimeout(timer)
  }, [open, held, onClose, durationMs])

  const finish = (action: () => void) => {
    const back = returnFocus.current
    setHeld(false)
    action()
    if (back?.isConnected) back.focus()
  }

  return (
    // Centred above the tab bar (bottom-centre from lg): clear of corner controls such as a map's zoom buttons.
    <div
      className={cx(
        'pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+--spacing(3))] z-(--z-toast) flex justify-center px-4 lg:bottom-6 lg:px-6',
        className,
      )}
    >
      <div role="status" className="w-full max-w-sm">
        {open ? (
          <div
            data-undo-toast=""
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onFocus={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) returnFocus.current = event.relatedTarget as HTMLElement | null
              setHeld(true)
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false)
            }}
            className="pointer-events-auto flex animate-fade-in items-center gap-2 border-2 border-panel-border bg-surface-raised py-1 pl-3 text-sm text-fg shadow-pixel-drop"
          >
            <p className="min-w-0 flex-1 py-2">{message}</p>
            <button
              type="button"
              data-undo-action=""
              onClick={() => finish(onUndo)}
              className="inline-flex min-h-tap shrink-0 items-center gap-1.5 px-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              {undoLabel}
            </button>
            <button
              type="button"
              onClick={() => finish(onClose)}
              className="grid min-h-tap min-w-tap shrink-0 place-items-center text-fg-muted transition-colors duration-(--dur-press) hover:text-fg"
            >
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
