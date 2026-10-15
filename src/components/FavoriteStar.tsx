import { CircleAlert, Star, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useEffect, useId, useRef, useState } from 'react'
import { useFavoritesStore } from '../app/favoritesStore'
import { cx } from './cx'

/**
 * FavoriteStar (UX_SPEC §3.1, PRD P7-S1): the star toggle on EntityCards and detail headers.
 * - 44px target (UX_SPEC §9) with `aria-pressed` and a constant name ("Favorite {name}"): the
 *   pressed state — not a changing label — says whether the entity is starred.
 * - Never colour alone: starred = a solid gold star, not starred = an outline only.
 * - Every toggle is announced politely ("Added to favorites" / "Removed from favorites"). Press
 *   feedback is the shared scale(0.97) over --dur-press (UX_SPEC §12); no celebration.
 * - If the browser didn't save (full or blocked storage), a warning glyph marks the star — with a
 *   tooltip saying why on hover / keyboard focus — and the announcement says so; the change is kept
 *   for this visit (DATA_SCHEMA_SPEC §4b). The one visible explanation is FavoritesSaveNotice below.
 *
 * `FavoriteStar` binds to the shared favorites store; `FavoriteStarButton` is the bare control,
 * driven by props (the /favorites page, where every entry is starred by definition, and tests).
 */
export const FAVORITE_ADDED = 'Added to favorites'
export const FAVORITE_REMOVED = 'Removed from favorites'
export const FAVORITE_UNSAVED = 'Not saved in this browser — kept until you reload or close this tab'

export interface FavoriteStarButtonProps {
  /** The starred entity's TypedRef (`i:4956`, `boss:king-slime`); exposed as `data-favorite-ref`. */
  entityRef: string
  /** Entity name for the accessible label, e.g. "Zenith" → "Favorite Zenith". */
  name: string
  pressed: boolean
  onToggle: () => void
  /** Polite live-region text after a toggle; empty until the user acts. */
  status?: string
  /** The last save failed: show the warning glyph and describe it. */
  unsaved?: boolean
  className?: string
}

export function FavoriteStarButton({ entityRef, name, pressed, onToggle, status = '', unsaved = false, className }: FavoriteStarButtonProps) {
  const warningId = useId()
  const [tipOpen, setTipOpen] = useState(false)
  const button = (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`Favorite ${name}`}
      aria-describedby={unsaved ? warningId : undefined}
      data-favorite-ref={entityRef}
      onClick={onToggle}
      className="group/star grid min-h-tap min-w-tap place-items-center transition-[background-color,transform] duration-(--dur-press) ease-out-strong hover:bg-night-700 active:scale-[0.97]"
    >
      <Star
        aria-hidden="true"
        strokeWidth={2}
        className={cx(
          'size-6 transition-colors duration-(--dur-press) ease-out-strong',
          pressed ? 'fill-current text-accent' : 'fill-none text-fg-muted group-hover/star:text-fg',
        )}
      />
    </button>
  )
  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      {/* The warning glyph's explanation on hover / keyboard focus, only while unsaved (screen readers
          get it as the button's description). Always mounted, so the button never remounts — and never
          drops focus — when a save fails. Own provider: the star also renders outside the app shell. */}
      <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
        <Tooltip.Root open={unsaved && tipOpen} onOpenChange={setTipOpen}>
          <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
          {unsaved ? (
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                align="end"
                sideOffset={4}
                collisionPadding={8}
                data-favorite-unsaved-tip=""
                className="z-(--z-popover) max-w-[min(--spacing(64),var(--radix-tooltip-content-available-width,--spacing(64)))] border-2 border-tooltip-border bg-tooltip-bg px-3 py-1.5 font-sans text-sm text-fg shadow-pixel-drop"
              >
                {FAVORITE_UNSAVED}
              </Tooltip.Content>
            </Tooltip.Portal>
          ) : null}
        </Tooltip.Root>
      </Tooltip.Provider>
      {unsaved ? (
        <>
          <CircleAlert aria-hidden="true" strokeWidth={2.5} className="pointer-events-none absolute top-0.5 right-0.5 size-3.5 text-gate" />
          <span id={warningId} className="sr-only">
            {FAVORITE_UNSAVED}
          </span>
        </>
      ) : null}
      <span role="status" className="sr-only">
        {status}
      </span>
    </span>
  )
}

export interface FavoriteStarProps {
  entityRef: string
  name: string
  className?: string
}

/** The star bound to the shared favorites store (tc.v1.favorites): one toggle updates every surface. */
export function FavoriteStar({ entityRef, name, className }: FavoriteStarProps) {
  const pressed = useFavoritesStore((s) => s.refs.includes(entityRef))
  const unsaved = useFavoritesStore((s) => s.persistError)
  const setFavorite = useFavoritesStore((s) => s.setFavorite)
  const [status, setStatus] = useState('')

  const onToggle = () => {
    const favorited = !pressed
    const saved = setFavorite(entityRef, favorited)
    const done = favorited ? FAVORITE_ADDED : FAVORITE_REMOVED
    setStatus(saved ? done : `${done}. ${FAVORITE_UNSAVED}.`)
  }

  return (
    <FavoriteStarButton
      entityRef={entityRef}
      name={name}
      pressed={pressed}
      onToggle={onToggle}
      status={status}
      unsaved={unsaved}
      className={className}
    />
  )
}

export const FAVORITES_NOT_SAVING = 'Favorites aren’t saving in this browser — changes last until you reload or close this tab.'
/** UX_SPEC §5.7 toast timing; paused while the pointer or keyboard focus is on the notice. */
export const FAVORITES_NOTICE_MS = 4000

export interface FavoritesSaveNoticeViewProps {
  open: boolean
  onDismiss: () => void
  /** Pause / resume the auto-dismiss (pointer over it, focus inside it). */
  onHold?: (held: boolean) => void
}

/**
 * The notice itself: a fixed toast above the mobile tab bar (bottom-right from lg). The polite status
 * region stays mounted so its text is announced when it appears; it never takes focus (UX_SPEC §5.7).
 */
export function FavoritesSaveNoticeView({ open, onDismiss, onHold }: FavoritesSaveNoticeViewProps) {
  // Where keyboard focus was before it entered the notice: Dismiss hands it back there, not to <body>.
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+--spacing(3))] z-(--z-toast) flex justify-center px-4 lg:bottom-6 lg:justify-end lg:px-6">
      <div role="status" className="w-full max-w-sm">
        {open ? (
          <div
            data-favorites-notice=""
            onMouseEnter={() => onHold?.(true)}
            onMouseLeave={() => onHold?.(false)}
            onFocus={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) returnFocus.current = event.relatedTarget as HTMLElement | null
              onHold?.(true)
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHold?.(false)
            }}
            className="pointer-events-auto flex animate-fade-in items-start gap-2 border-2 border-earth-600 bg-earth-900 py-1 pl-3 text-sm text-fg shadow-pixel-drop"
          >
            <CircleAlert aria-hidden="true" strokeWidth={2.5} className="mt-3 size-4 shrink-0 text-gate" />
            <p className="min-w-0 flex-1 py-2">{FAVORITES_NOT_SAVING}</p>
            <button
              type="button"
              onClick={() => {
                const back = returnFocus.current
                onDismiss()
                if (back?.isConnected) back.focus()
              }}
              className="grid min-h-tap min-w-tap shrink-0 place-items-center text-fg-muted transition-colors duration-(--dur-press) hover:text-fg"
            >
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Dismiss this notice</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * FavoritesSaveNotice (mounted once, in the app shell): when a favorites save fails — the change is
 * kept for this tab only — ONE visible notice says so, since the star that was pressed can't explain
 * it in place (UX_SPEC §5.7: a toast when the result isn't visible in place). It shows once per run
 * of failed saves (store `persistWarnings`), auto-dismisses after 4s unless held, and can be
 * dismissed; the stars keep their warning glyphs + tooltips meanwhile.
 */
export function FavoritesSaveNotice() {
  const runs = useFavoritesStore((s) => s.persistWarnings)
  // The last run already shown (or under way when this mounted — e.g. back from /favorites, which
  // said so inline): only a NEW run of failed saves opens the notice.
  const [acknowledged, setAcknowledged] = useState(runs)
  const [held, setHeld] = useState(false)
  const open = runs > acknowledged

  useEffect(() => {
    if (!open || held) return
    const timer = window.setTimeout(() => setAcknowledged(runs), FAVORITES_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [open, held, runs])

  return (
    <FavoritesSaveNoticeView
      open={open}
      onDismiss={() => {
        setAcknowledged(runs)
        setHeld(false)
      }}
      onHold={setHeld}
    />
  )
}
