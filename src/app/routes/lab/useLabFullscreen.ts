import { useCallback, useEffect, useRef } from 'react'
import { useShellChrome } from '../../shell/shellChrome'

/**
 * Lab fullscreen (UX_SPEC §2/§3.4 FullscreenToggle): hides the shell chrome (header, footer, tab
 * bar) and, where the browser allows, also enters native fullscreen. Esc restores — natively the
 * browser exits fullscreen (we follow `fullscreenchange`); in the chrome-only mode (e.g. iOS
 * Safari, no element fullscreen) our own Esc handler does. Leaving the Lab always restores.
 */
function openLayerPresent(): boolean {
  // An open dialog / popover handles its own Esc first.
  return document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]') !== null
}

export function useLabFullscreen(): { fullscreen: boolean; toggle: () => void; exit: () => void } {
  const fullscreen = useShellChrome((s) => s.immersive)
  const setImmersive = useShellChrome((s) => s.setImmersive)
  const native = useRef(false)

  const exit = useCallback(() => {
    setImmersive(false)
    if (native.current && document.fullscreenElement) document.exitFullscreen().catch(() => {})
    native.current = false
  }, [setImmersive])

  const enter = useCallback(() => {
    setImmersive(true)
    const root = document.documentElement
    if (typeof root.requestFullscreen === 'function' && document.fullscreenEnabled) {
      root.requestFullscreen({ navigationUI: 'hide' }).then(
        () => {
          native.current = true
        },
        () => {
          native.current = false
        },
      )
    }
  }, [setImmersive])

  const toggle = useCallback(() => (useShellChrome.getState().immersive ? exit() : enter()), [enter, exit])

  useEffect(() => {
    if (!fullscreen) return
    const onChange = () => {
      if (native.current && !document.fullscreenElement) {
        native.current = false
        setImmersive(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !openLayerPresent()) exit()
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen, exit, setImmersive])

  // Leaving the Lab restores the shell.
  useEffect(() => exit, [exit])

  return { fullscreen, toggle, exit }
}
