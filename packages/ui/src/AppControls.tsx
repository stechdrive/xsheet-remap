import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clampNumber } from './sheetInteraction'
import { TooltipTarget, type TooltipTriggerProps } from './Tooltip'

const ACTION_MENU_OPEN_EVENT = 'xsheet-remap:action-menu-open'

export function IconButton({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`iconButton ${className}`.trim()} />
}

export function ActionMenu({
  label,
  children,
  ariaLabel,
  tooltipLabel,
  className = '',
  closeOnMenuItemClick = false,
  onOpenChange,
  placement = 'bottom-start',
}: {
  label: ReactNode
  children: ReactNode
  ariaLabel?: string
  tooltipLabel?: string
  className?: string
  closeOnMenuItemClick?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: 'bottom-start' | 'right-start'
}) {
  const menuId = useId()
  const menuRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  const updateMenuPosition = useCallback(() => {
    const summary = summaryRef.current
    if (!summary) return
    const summaryRect = summary.getBoundingClientRect()
    const content = contentRef.current
    const contentWidth = content?.offsetWidth || 220
    const contentHeight = content?.offsetHeight || 120
    const margin = 8
    const preferredTop = placement === 'right-start' ? summaryRect.top : summaryRect.bottom + 5
    const top = placement === 'right-start'
      ? Math.min(Math.max(margin, preferredTop), Math.max(margin, window.innerHeight - contentHeight - margin))
      : preferredTop + contentHeight > window.innerHeight - margin
        ? Math.max(margin, summaryRect.top - contentHeight - 5)
        : preferredTop
    const preferredLeft = placement === 'right-start' ? summaryRect.right + 5 : summaryRect.left
    const fallbackLeft = placement === 'right-start' ? summaryRect.left - contentWidth - 5 : summaryRect.right - contentWidth
    const left = preferredLeft + contentWidth > window.innerWidth - margin
      ? Math.max(margin, fallbackLeft)
      : Math.max(margin, preferredLeft)
    setMenuStyle({ top, left })
  }, [placement])

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
      if (!open || event.key !== 'Escape') return
      if (event.target instanceof Node && contentRef.current?.contains(event.target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
      window.requestAnimationFrame(() => summaryRef.current?.focus())
    }

    window.addEventListener(ACTION_MENU_OPEN_EVENT, closeOtherMenus)
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener(ACTION_MENU_OPEN_EVENT, closeOtherMenus)
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [menuId, open])

  useLayoutEffect(() => {
    if (!open) return undefined
    updateMenuPosition()
    const frame = window.requestAnimationFrame(() => {
      updateMenuPosition()
      if (document.activeElement === summaryRef.current) {
        contentRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')?.focus()
      }
    })
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMenuPosition)
    if (contentRef.current) resizeObserver?.observe(contentRef.current)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
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

  function handleContentKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    window.requestAnimationFrame(() => summaryRef.current?.focus())
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
          onKeyDown={handleContentKeyDown}
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

export function ScrubbableNumberInput({
  value,
  min,
  max,
  step = 1,
  pixelsPerStep = 2,
  ariaLabel,
  ariaValueText,
  disabled = false,
  className = '',
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  pixelsPerStep?: number
  ariaLabel: string
  ariaValueText?: (value: number) => string
  disabled?: boolean
  className?: string
  onChange: (value: number) => void
}) {
  const normalizedValue = normalizeScrubbableNumber(value, min, max, step)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState(String(normalizedValue))
  const focusStartValueRef = useRef(normalizedValue)
  const skipNextBlurCommitRef = useRef(false)

  function commitDraft() {
    if (!draft.trim()) {
      setDraft(String(normalizedValue))
      return
    }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(normalizedValue))
      return
    }
    const nextValue = normalizeScrubbableNumber(parsed, min, max, step)
    setDraft(String(nextValue))
    if (nextValue !== normalizedValue) onChange(nextValue)
  }

  function updateFromInput(rawValue: string) {
    setDraft(rawValue)
    if (!rawValue.trim()) return
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return
    const nextValue = normalizeScrubbableNumber(parsed, min, max, step)
    if (nextValue !== normalizedValue) onChange(nextValue)
  }

  function stepBy(direction: number, coarse: boolean) {
    if (disabled) return
    const nextValue = normalizeScrubbableNumber(
      normalizedValue + direction * step * (coarse ? 10 : 1),
      min,
      max,
      step,
    )
    setDraft(String(nextValue))
    if (nextValue !== normalizedValue) onChange(nextValue)
  }

  return (
    <input
      type="number"
      className={`scrubbableNumberInput ${className}`.trim()}
      min={min}
      max={max}
      step={step}
      value={focused ? draft : String(normalizedValue)}
      inputMode="numeric"
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText?.(normalizedValue)}
      disabled={disabled}
      onFocus={event => {
        focusStartValueRef.current = normalizedValue
        skipNextBlurCommitRef.current = false
        setFocused(true)
        setDraft(String(normalizedValue))
        event.currentTarget.select()
      }}
      onBlur={() => {
        if (skipNextBlurCommitRef.current) skipNextBlurCommitRef.current = false
        else commitDraft()
        setFocused(false)
      }}
      onChange={event => updateFromInput(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
          event.preventDefault()
          stepBy(-1, event.shiftKey)
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
          event.preventDefault()
          stepBy(1, event.shiftKey)
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          const startValue = focusStartValueRef.current
          skipNextBlurCommitRef.current = true
          setDraft(String(startValue))
          if (startValue !== normalizedValue) onChange(startValue)
          event.currentTarget.blur()
        }
      }}
      onPointerDown={event => beginScrubbableNumberDrag({
        event,
        startValue: normalizedValue,
        min,
        max,
        step,
        pixelsPerStep,
        onChange: nextValue => {
          setDraft(String(nextValue))
          onChange(nextValue)
        },
      })}
    />
  )
}

function beginScrubbableNumberDrag({
  event,
  startValue,
  min,
  max,
  step,
  pixelsPerStep,
  onChange,
}: {
  event: PointerEvent<HTMLInputElement>
  startValue: number
  min: number
  max: number
  step: number
  pixelsPerStep: number
  onChange: (value: number) => void
}) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const input = event.currentTarget
  const startX = event.clientX
  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  let dragging = false
  let lastValue = startValue

  function onPointerMove(moveEvent: globalThis.PointerEvent) {
    const deltaX = moveEvent.clientX - startX
    if (!dragging && Math.abs(deltaX) < 3) return
    if (!dragging) {
      dragging = true
      input.blur()
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    }
    moveEvent.preventDefault()
    const coarseMultiplier = moveEvent.shiftKey ? 10 : 1
    const deltaSteps = Math.round(deltaX / Math.max(1, pixelsPerStep))
    const nextValue = normalizeScrubbableNumber(
      startValue + deltaSteps * step * coarseMultiplier,
      min,
      max,
      step,
    )
    if (nextValue === lastValue) return
    lastValue = nextValue
    onChange(nextValue)
  }

  function stopDrag() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
    window.removeEventListener('pointercancel', stopDrag)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function normalizeScrubbableNumber(value: number, min: number, max: number, step: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const safeValue = Number.isFinite(value) ? value : min
  const steppedValue = min + Math.round((safeValue - min) / safeStep) * safeStep
  const precision = Math.max(0, (String(safeStep).split('.')[1] ?? '').length)
  return Number(clampNumber(steppedValue, min, max).toFixed(precision))
}

export function PanelResizeHandle({
  label,
  value,
  min,
  max,
  defaultValue,
  side = 'right',
  resizeEnabled = true,
  dockToggle,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue?: number
  side?: 'left' | 'right'
  resizeEnabled?: boolean
  dockToggle?: {
    label: string
    tooltipLabel: string
    controls: string
    expanded: boolean
    icon: ReactNode
    onToggle: () => void
  }
  onChange: (value: number) => void
}) {
  const keyboardStep = side === 'left' ? 24 : -24

  function moveBy(delta: number) {
    onChange(clampNumber(value + delta, min, max))
  }

  const resizeHandle = resizeEnabled ? (
    <div
      className="panelResizeHandle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={event => {
        if (defaultValue !== undefined && event.detail >= 2) {
          event.preventDefault()
          event.stopPropagation()
          onChange(clampNumber(defaultValue, min, max))
          return
        }
        beginPanelResize(event, value, min, max, side, onChange)
      }}
      onDoubleClick={event => {
        if (defaultValue === undefined) return
        event.preventDefault()
        event.stopPropagation()
        onChange(clampNumber(defaultValue, min, max))
      }}
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
  ) : null

  if (!dockToggle) return resizeHandle

  return (
    <div className={`panelResizeRail${resizeEnabled ? '' : ' collapsed'}`}>
      {resizeHandle}
      <TooltipTarget label={dockToggle.tooltipLabel}>
        {tooltipProps => (
          <button
            type="button"
            className="panelResizeToggle"
            aria-label={dockToggle.label}
            aria-controls={dockToggle.controls}
            aria-expanded={dockToggle.expanded}
            onClick={dockToggle.onToggle}
            {...tooltipProps}
          >
            {dockToggle.icon}
          </button>
        )}
      </TooltipTarget>
    </div>
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
