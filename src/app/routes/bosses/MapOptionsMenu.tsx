import { Ellipsis, RotateCcw } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { cx } from '../../../components/cx'
import type { NodeState } from '../../../components/nodeMap/graph'
import { UndoToast } from '../../../components/UndoToast'
import { useProgressStore } from '../../progressStore'
import {
  RESET_CANCEL,
  RESET_CONFIRM,
  RESET_KEPT_NOTE,
  RESET_MENU_LABEL,
  RESET_NOTHING_TRACKED,
  RESET_TITLE,
  resetDescription,
  resetDone,
  RESTORED,
  UNDO_LABEL,
  UNDO_WINDOW_MS,
} from './focusCardCopy'

/**
 * The map's overflow menu (UX_SPEC §3.7 "ResetProgress (overflow)"; PRD P5-S4 AC3): one item,
 * "Reset progress…", which asks the page to open the confirmation (ResetProgressFlow). Nothing
 * tracked: the item is shown, disabled, and says why. In the toolbar from md; on phones it sits in
 * the map's corner beside the legend toggle (the toolbar row has no room for it at 375px).
 */
export function MapOptionsMenu({ onReset, triggerRef, className }: { onReset: () => void; triggerRef?: Ref<HTMLButtonElement>; className?: string }) {
  const tracked = useProgressStore((s) => Object.keys(s.progress.nodeStates).length)
  // Set as the item is chosen (before the menu's close handlers run in the same event).
  const opening = useRef(false)
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        ref={triggerRef}
        aria-label="More map options"
        title="More map options"
        data-map-options=""
        className={cx(
          'grid min-h-tap min-w-tap place-items-center border-2 border-panel-border bg-panel text-fg shadow-pixel transition-colors duration-(--dur-ui) hover:bg-night-700 data-[state=open]:bg-night-700',
          className,
        )}
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          // The confirmation takes focus as the menu closes: don't pull it back to the menu button.
          onCloseAutoFocus={(event) => {
            if (opening.current) event.preventDefault()
            opening.current = false
          }}
          className="z-(--z-popover) min-w-56 border-2 border-panel-border bg-surface p-1 text-fg shadow-pixel-drop"
        >
          <DropdownMenu.Item
            disabled={tracked === 0}
            onSelect={() => {
              opening.current = true
              onReset()
            }}
            data-reset-progress=""
            className={cx(
              'flex min-h-tap items-center gap-3 px-3 py-1 text-sm outline-none select-none',
              'data-highlighted:bg-night-700 data-highlighted:outline-2 data-highlighted:-outline-offset-2 data-highlighted:outline-ring data-highlighted:outline-solid',
              'data-disabled:text-fg-muted',
            )}
          >
            <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
            <span>
              <span className="block font-semibold">{RESET_MENU_LABEL}</span>
              {tracked === 0 ? <span className="block text-xs">{RESET_NOTHING_TRACKED}</span> : null}
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** `node` rendered into `host` when there is one, else in place. */
const inHost = (host: HTMLElement | null | undefined, node: ReactNode) => (host ? createPortal(node, host) : node)

/**
 * Reset progress (PRD P5-S4 AC3; UX_SPEC §6, §10.6): ConfirmDialog naming how many bosses are tracked
 * and that saved builds and plans are not affected, a destructive confirm, Cancel focused by default
 * → clears `nodeStates` only (the world evil stays) → a toast offering a one-shot Undo for 6s, which
 * puts the cleared marks back (the map replays their unlock cascade). Mounted once per map page, so
 * a breakpoint change never drops a pending undo; focus returns to the menu button. The toast is
 * rendered into `toastHost` — placed right after the menu button, so Tab reaches its Undo next — and
 * on phones sits above the map's corner controls instead of over them.
 */
export function ResetProgressFlow({
  open,
  onOpenChange,
  returnFocus,
  toastHost,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: () => HTMLElement | null | undefined
  toastHost?: HTMLElement | null
}) {
  const tracked = useProgressStore((s) => Object.keys(s.progress.nodeStates).length)
  const resetNodeStates = useProgressStore((s) => s.resetNodeStates)
  const restoreNodeStates = useProgressStore((s) => s.restoreNodeStates)
  const [undo, setUndo] = useState<{ states: Record<string, NodeState>; count: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const closeUndo = useCallback(() => setUndo(null), [])
  const onUndo = useCallback(() => {
    if (!undo) return
    restoreNodeStates(undo.states)
    setUndo(null)
    setAnnouncement(RESTORED)
  }, [undo, restoreNodeStates])

  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={RESET_TITLE}
        description={resetDescription(tracked)}
        confirmLabel={RESET_CONFIRM}
        cancelLabel={RESET_CANCEL}
        onConfirm={() => {
          const cleared = resetNodeStates()
          setAnnouncement('')
          setUndo({ states: cleared, count: Object.keys(cleared).length })
        }}
        returnFocus={returnFocus}
      >
        {RESET_KEPT_NOTE}
      </ConfirmDialog>
      {inHost(
        toastHost,
        <UndoToast
          open={undo !== null}
          message={undo ? resetDone(undo.count) : ''}
          undoLabel={UNDO_LABEL}
          onUndo={onUndo}
          onClose={closeUndo}
          durationMs={UNDO_WINDOW_MS}
          // Phones: above the Legend / options row in the map's bottom corner (48px + its 8px offset + 8px).
          className="max-md:bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+--spacing(16))]"
        />,
      )}
      <p role="status" className="sr-only" data-reset-announcer="">
        {announcement}
      </p>
    </>
  )
}
