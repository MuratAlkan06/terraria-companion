import { useEffect, useState, type RefObject } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Live border-box size of an element (CSS px, rounded), or undefined before the first measurement
 * (and without a DOM). The Lab sizes its HUD to the arena itself — the arena's width depends on
 * which side panels are open, not only on the viewport — and frames the scene below the HUD.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize | undefined {
  const [size, setSize] = useState<ElementSize | undefined>(undefined)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0]
      const width = Math.round(box ? box.inlineSize : entry.contentRect.width)
      const height = Math.round(box ? box.blockSize : entry.contentRect.height)
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
