import { Popover } from 'radix-ui'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * Toggletip — a short explanation attached to an inline label (UX_SPEC §5.3/§9: "hover/tap
 * tooltip"). Opens on mouse hover (closes on leave, keeps focus where it was) and is pinned open
 * by tap, click or Enter/Space; Esc closes and returns focus. The trigger keeps the inline line
 * box but gets a >= 44px tap target (UX_SPEC §9).
 *
 * Used by UnknownValue and CuratedLabel. Must not sit inside a link or another button (no nested
 * interactive content): inside a clickable card, use the stretched-link pattern instead.
 */
export interface ToggletipProps {
  /** Trigger content: short inline text, including any sr-only context. */
  label: ReactNode
  /** Popover body. */
  children: ReactNode
  /** Trigger look (the marker / label styling). */
  className?: string
  /** `data-*` attributes for the trigger, e.g. audit hooks. */
  data?: Record<`data-${string}`, string>
  /** Replaces the popover's default size classes (e.g. a wider, scrollable tip). */
  contentClassName?: string
}

const CONTENT_SIZE = 'w-max max-w-[min(--spacing(72),var(--radix-popover-content-available-width,--spacing(72)))]'

const HOVER_CLOSE_DELAY_MS = 150

export function Toggletip({ label, children, className, data, contentClassName }: ToggletipProps) {
  const [open, setOpen] = useState(false)
  // Opened by mouse hover (closes on leave, keeps focus on the trigger) vs pinned by click/tap/key.
  const hoverOpened = useRef(false)
  // A hover-close must not return focus to the trigger (that would scroll the page to it).
  const closingFromHover = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)

  const cancelClose = () => window.clearTimeout(closeTimer.current)
  useEffect(() => cancelClose, [])

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelClose()
    if (!open) {
      hoverOpened.current = true
      setOpen(true)
    }
  }
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !hoverOpened.current) return
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      hoverOpened.current = false
      closingFromHover.current = true
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        hoverOpened.current = false
        setOpen(next)
      }}
    >
      <Popover.Trigger
        {...data}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          // A click on a hover-opened tip pins it open instead of toggling it shut.
          if (hoverOpened.current) {
            event.preventDefault()
            hoverOpened.current = false
          }
        }}
        className={cx(
          'relative cursor-help',
          // >= 44 × 44px tap target, centred, without changing the inline line box (UX_SPEC §9):
          // short triggers such as the "est." chip get the full width too.
          "before:absolute before:top-1/2 before:left-1/2 before:h-tap before:w-[max(100%,var(--spacing-tap))] before:-translate-1/2 before:content-['']",
          className,
        )}
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            if (hoverOpened.current) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            if (closingFromHover.current) event.preventDefault()
            closingFromHover.current = false
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={onPointerLeave}
          className={cx(
            'z-(--z-popover) border-2 border-tooltip-border bg-tooltip-bg px-3 py-2 text-sm text-fg shadow-pixel-drop',
            contentClassName ?? CONTENT_SIZE,
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
