import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'

export type ResizeAxis = 'x' | 'y'

export interface Resizable {
  size: number
  onResizeStart: (e: ReactMouseEvent) => void
}

/**
 * Drag-to-resize state for a panel, persisted to localStorage under `key`.
 * `axis` 'x' resizes width (col-resize), 'y' resizes height (row-resize).
 */
export function useResizable(
  key: string,
  initial: number,
  min: number,
  max: number,
  axis: ResizeAxis = 'x'
): Resizable {
  const [size, setSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(key))
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial
  })

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const start = axis === 'x' ? e.clientX : e.clientY
      const startSize = size
      let latest = startSize
      const cls = axis === 'x' ? 'resizing' : 'resizing-v'
      const onMove = (ev: MouseEvent): void => {
        const pos = axis === 'x' ? ev.clientX : ev.clientY
        latest = Math.min(max, Math.max(min, startSize + pos - start))
        setSize(latest)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.classList.remove(cls)
        localStorage.setItem(key, String(latest))
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      document.body.classList.add(cls)
    },
    [size, min, max, key, axis]
  )

  return { size, onResizeStart }
}
