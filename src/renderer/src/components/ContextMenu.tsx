import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu within the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (x + rect.width > window.innerWidth) nx = Math.max(4, window.innerWidth - rect.width - 4)
    if (y + rect.height > window.innerHeight) ny = Math.max(4, window.innerHeight - rect.height - 4)
    setPos({ x: nx, y: ny })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const run = (item: MenuItem): void => {
    if (item.disabled || !item.onClick) return
    onClose()
    item.onClick()
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i): ReactNode =>
        item.separator ? (
          <div key={i} className="context-sep" />
        ) : (
          <button
            key={i}
            className={'context-item' + (item.danger ? ' danger' : '')}
            disabled={item.disabled}
            onClick={() => run(item)}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
