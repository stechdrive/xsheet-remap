import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clampNumber } from './sheetInteraction'
import { TooltipTarget, type TooltipTriggerProps } from './Tooltip'

const ACTION_MENU_OPEN_EVENT = 'xsheet-remap:action-menu-open'

export function ActionMenu({
  label,
  children,
  ariaLabel,
  tooltipLabel,
  className = '',
  closeOnMenuItemClick = false,
}: {
  label: ReactNode
  children: ReactNode
  ariaLabel?: string
  tooltipLabel?: string
  className?: string
  closeOnMenuItemClick?: boolean
}) {
  const menuId = useId()
  const menuRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)

  const updateMenuPosition = useCallback(() => {
    const summary = summaryRef.current
    if (!summary) return
    const summaryRect = summary.getBoundingClientRect()
    const content = contentRef.current
    const contentWidth = content?.offsetWidth ?? 220
    const contentHeight = content?.offsetHeight ?? 120
    const margin = 8
    const preferredTop = summaryRect.bottom + 5
    const top = preferredTop + contentHeight > window.innerHeight - margin
      ? Math.max(margin, summaryRect.top - contentHeight - 5)
      : preferredTop
    const left = Math.min(
      Math.max(margin, summaryRect.left),
      Math.max(margin, window.innerWidth - contentWidth - margin),
    )
    setMenuStyle({ top, left })
  }, [])

  useEffect(() => {
    function closeOtherMenus(event: Event) {
      if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
    }

    function closeFromOutside(event: globalThis.PointerEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener(ACTION_MENU_OPEN_EVENT, closeOtherMenus)
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener(ACTION_MENU_OPEN_EVENT, closeOtherMenus)
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuId])

  useLayoutEffect(() => {
    if (!open) return undefined
    updateMenuPosition()
    const frame = window.requestAnimationFrame(updateMenuPosition)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  function toggleOpen(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setOpen(current => {
      const nextOpen = !current
      if (nextOpen) window.dispatchEvent(new CustomEvent(ACTION_MENU_OPEN_EVENT, { detail: menuId }))
      return nextOpen
    })
  }

  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    if (!closeOnMenuItemClick) return
    const target = event.target as Element
    if (target.closest('[data-action-menu-keep-open]')) return
    if (target.closest('label.fileButton')) return
    if (target.closest('button')) setOpen(false)
  }

  function handleContentChange(event: FormEvent<HTMLDivElement>) {
    if (!closeOnMenuItemClick) return
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return
    if (target.closest('[data-action-menu-keep-open]')) return
    if (target.closest('label.fileButton')) window.setTimeout(() => setOpen(false), 0)
  }

  function renderSummary(tooltipProps?: TooltipTriggerProps) {
    return (
      <summary
        ref={summaryRef}
        aria-label={ariaLabel}
        {...tooltipProps}
        onClick={event => {
          tooltipProps?.onPointerDown()
          toggleOpen(event)
        }}
      >
        {label}
      </summary>
    )
  }

  return (
    <details ref={menuRef} className={`actionMenu ${className}`.trim()} open={open}>
      {tooltipLabel
        ? (
          <TooltipTarget label={tooltipLabel} disabled={open}>
            {tooltipProps => renderSummary(tooltipProps)}
          </TooltipTarget>
          )
        : renderSummary()}
      {open && createPortal(
        <div
          ref={contentRef}
          className={`actionMenuContent actionMenuPortalContent ${className}`.trim()}
          style={menuStyle ?? { top: 0, left: 0, visibility: 'hidden' }}
          onClick={handleContentClick}
          onChange={handleContentChange}
        >
          {children}
        </div>,
        document.body,
      )}
    </details>
  )
}

export function ToolbarGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`toolbarGroup ${className}`.trim()}>{children}</div>
}

export function PanelResizeHandle({
  label,
  value,
  min,
  max,
  side = 'right',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  side?: 'left' | 'right'
  onChange: (value: number) => void
}) {
  const keyboardStep = side === 'left' ? 24 : -24

  function moveBy(delta: number) {
    onChange(clampNumber(value + delta, min, max))
  }

  return (
    <div
      className="panelResizeHandle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={event => beginPanelResize(event, value, min, max, side, onChange)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          moveBy(-keyboardStep)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          moveBy(keyboardStep)
        }
      }}
    />
  )
}

function beginPanelResize(
  event: PointerEvent<HTMLElement>,
  startWidth: number,
  min: number,
  max: number,
  side: 'left' | 'right',
  onChange: (value: number) => void,
) {
  event.preventDefault()
  const startX = event.clientX
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  function viewportMax() {
    return Math.max(min, Math.min(max, window.innerWidth - 320))
  }

  function onPointerMove(moveEvent: globalThis.PointerEvent) {
    const delta = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX
    onChange(clampNumber(startWidth + delta, min, viewportMax()))
  }

  function stopResize() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}
