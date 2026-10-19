import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Measure real content, including headings, instead of guessing its row count. */
export function SheetContextMenu({ x, y, className = '', label, children }: {
  x: number; y: number; className?: string; label?: string; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8))
      const top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8))
      setPosition(current => current.left === left && current.top === top ? current : { left, top })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (ref.current) observer?.observe(ref.current)
    window.addEventListener('resize', place)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place) }
  }, [x, y])
  return <div ref={ref} className={`sheetContextMenu ${className}`} style={{ ...position, width: 240 }}
    role="menu" aria-label={label} onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    {children}
  </div>
}
