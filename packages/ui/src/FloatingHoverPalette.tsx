import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export function FloatingHoverPalette({
  label,
  valueLabel,
  className = '',
  active = false,
  children,
}: {
  label: string
  valueLabel: string
  className?: string
  active?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const paletteRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
  }

  function handlePointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || paletteRef.current?.contains(document.activeElement)) return
    close()
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && paletteRef.current?.contains(event.relatedTarget)) return
    close()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    triggerRef.current?.focus()
    close()
  }

  useEffect(() => {
    if (!open) return undefined
    function closeFromOutside(event: globalThis.PointerEvent) {
      if (event.target instanceof Node && paletteRef.current?.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    return () => window.removeEventListener('pointerdown', closeFromOutside)
  }, [open])

  return (
    <div
      ref={paletteRef}
      className={['floatingHoverPalette', className, open ? 'open' : '', active ? 'active' : ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={handlePointerLeave}
      onFocus={() => setOpen(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <Tooltip label={label} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className="floatingHoverPaletteTrigger"
          aria-label={`${label} ${valueLabel}`}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {valueLabel}
        </button>
      </Tooltip>
      <div className="floatingHoverPaletteControls">{children}</div>
    </div>
  )
}
