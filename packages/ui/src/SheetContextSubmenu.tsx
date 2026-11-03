import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export function navigateContextMenu(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const menu = event.currentTarget
  if ((event.target as Element).closest('[role="menu"]') !== menu) return
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    .filter(item => item.closest('[role="menu"]') === menu)
  if (!items.length) return
  event.preventDefault(); event.stopPropagation()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next].focus()
}

/** Click/touch and keyboard access; measured flyout stays inside the viewport. */
export function SheetContextSubmenu({ label, disabled = false, children }: {
  label: string; disabled?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const focusFirst = useRef(false)
  const id = useId()
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(), box = menu.current?.getBoundingClientRect()
      if (!anchor || !box) return
      const left = anchor.right + box.width <= window.innerWidth - 8 ? anchor.right - 1 : anchor.left - box.width + 1
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8)) })
    }
    place()
    if (focusFirst.current) { menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); focusFirst.current = false }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  return <div className="sheetContextSubmenu"
    onPointerEnter={event => { if (event.pointerType === 'mouse' && !disabled) setOpen(true) }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') setOpen(false) }}
    onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    onKeyDown={event => {
      if (open && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
      }
    }}>
    <button ref={trigger} type="button" className="sheetContextSubmenuTrigger" role="menuitem"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => setOpen(true)} onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation()
          if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
          else { focusFirst.current = true; setOpen(true) }
        }
      }}><span>{label}</span><span className="sheetContextSubmenuArrow" aria-hidden="true">›</span></button>
    {open && <div ref={menu} id={id} className="sheetContextSubmenuMenu" role="menu" aria-label={label}
      style={position} onKeyDown={navigateContextMenu}>{children}</div>}
  </div>
}
