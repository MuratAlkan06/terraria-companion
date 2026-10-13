import { RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelLoader } from '../../../components/PixelLoader'
import { useReducedMotion } from '../../../components/useReducedMotion'
import type { ArenaHandle } from '../../../lab/arena'
import type { CameraFraming } from '../../../lab/camera'
import type { LabSession } from '../../../lab/labSession'

/**
 * PixiCanvas (UX_SPEC §3.4). PixiJS is loaded HERE, through a dynamic import, so it is a separate
 * chunk that only /lab ever requests (ADR-001 D5/D7). While it loads, the arena region shows the
 * pixel loading screen; the HUD and panels are already usable. If the renderer can't start (no
 * WebGL / canvas), a designed error state replaces the arena — the rest of the Lab keeps working.
 */
type Status = 'loading' | 'ready' | 'error'

export interface ArenaCanvasProps {
  session: LabSession
  spriteUrl: string | null
  /** CSS px covered by the HUD along the top edge; the camera frames the scene below it. */
  insetTop?: number
  /** CSS px covered by the HUD's bottom controls (phone framing keeps the fight above them). */
  insetBottom?: number
  /** `action` zooms onto the fight (phones); `scene` keeps the whole arena composition. */
  framing?: CameraFraming
}

const loadArena = () => import('../../../lab/arena')

export function ArenaCanvas({ session, spriteUrl, insetTop = 0, insetBottom = 0, framing = 'scene' }: ArenaCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ArenaHandle | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [attempt, setAttempt] = useState(0)
  const reducedMotion = useReducedMotion()
  const reducedRef = useRef(reducedMotion)
  const frameRef = useRef({ insetTop, insetBottom, framing })
  useEffect(() => {
    reducedRef.current = reducedMotion
  }, [reducedMotion])
  useEffect(() => {
    frameRef.current = { insetTop, insetBottom, framing }
    handleRef.current?.refit()
  }, [insetTop, insetBottom, framing])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    loadArena()
      .then((m) =>
        m.mountArena(host, {
          reducedMotion: () => reducedRef.current,
          insetTop: () => frameRef.current.insetTop,
          insetBottom: () => frameRef.current.insetBottom,
          framing: () => frameRef.current.framing,
        }),
      )
      .then(
        (handle) => {
          if (cancelled) return handle.destroy()
          handleRef.current = handle
          setStatus('ready')
        },
        (error: unknown) => {
          if (cancelled) return
          console.error('[lab] The arena renderer could not start.', error)
          setStatus('error')
        },
      )
    return () => {
      cancelled = true
      handleRef.current?.destroy()
      handleRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    if (status === 'ready') handleRef.current?.setSession(session, { url: spriteUrl })
  }, [status, session, spriteUrl])

  return (
    <>
      {/* touch-action: none — holding on the canvas attacks instead of scrolling the page. */}
      <div ref={hostRef} aria-hidden="true" className="absolute inset-0 touch-none select-none" data-arena-host="" data-arena-status={status} />
      {status === 'loading' ? (
        <div className="absolute inset-0 grid place-items-center bg-night-950">
          <PixelLoader label="Loading the arena…" className="py-0" />
        </div>
      ) : null}
      {status === 'error' ? (
        <div role="alert" className="absolute inset-0 grid place-items-center bg-night-950 p-4">
          <div className="max-w-md space-y-3 border-2 border-earth-600 bg-earth-900 p-4 text-center">
            <p className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">The arena couldn’t start</p>
            <p className="text-sm text-fg-muted">
              Your browser couldn’t start the graphics renderer (WebGL or canvas). The weapon stats around the arena still work.
            </p>
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() => {
                setStatus('loading')
                setAttempt((n) => n + 1)
              }}
            >
              <RotateCw aria-hidden="true" className="size-5" />
              Retry
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
