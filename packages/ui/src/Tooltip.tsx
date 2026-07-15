import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

type TooltipAnchorRect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>

type TooltipPosition = {
  left: number
  top: number
  placement: TooltipPlacement
  arrowOffset: number
}

type TooltipStyle = CSSProperties & {
  '--tooltip-arrow-offset'?: string
}

type TooltipProps = {
  label: string
  children: ReactNode
  delayMs?: number
  disabled?: boolean
}

type TooltipTargetProps = {
  label: string
  children: (props: TooltipTriggerProps) => ReactNode
  delayMs?: number
  disabled?: boolean
}

export type TooltipTriggerProps = {
  'aria-describedby'?: string
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: () => void
}

const TOOLTIP_DELAY_MS = 120
const TOOLTIP_VIEWPORT_PADDING = 8
const TOOLTIP_GAP = 9
const TOOLTIP_ARROW_PADDING = 9
const TOOLTIP_PLACEMENT_ORDER: TooltipPlacement[] = ['top', 'bottom', 'right', 'left']

export function Tooltip({ label, children, delayMs = TOOLTIP_DELAY_MS, disabled = false }: TooltipProps) {
  const { tooltip, triggerProps } = useTooltip(label, delayMs, disabled)

  return (
    <span className="appTooltipTrigger" {...triggerProps}>
      {children}
      {tooltip}
    </span>
  )
}

export function TooltipTarget({ label, children, delayMs = TOOLTIP_DELAY_MS, disabled = false }: TooltipTargetProps) {
  const { tooltip, triggerProps } = useTooltip(label, delayMs, disabled)
  return (
    <>
      {children(triggerProps)}
      {tooltip}
    </>
  )
}

function useTooltip(label: string, delayMs: number, disabled: boolean) {
  const tooltipId = useId()
  const showTimerRef = useRef<number | null>(null)
  const [anchorRect, setAnchorRect] = useState<TooltipAnchorRect | null>(null)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current === null) return
    window.clearTimeout(showTimerRef.current)
    showTimerRef.current = null
  }, [])

  const hide = useCallback(() => {
    clearShowTimer()
    setAnchorRect(null)
  }, [clearShowTimer])

  const showForElement = useCallback((element: HTMLElement) => {
    clearShowTimer()
    if (!label || disabled) return
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null
      setAnchorRect(element.getBoundingClientRect())
    }, delayMs)
  }, [clearShowTimer, delayMs, disabled, label])

  useEffect(() => () => clearShowTimer(), [clearShowTimer])

  useEffect(() => {
    if (disabled || !label) clearShowTimer()
  }, [clearShowTimer, disabled, label])

  useEffect(() => {
    if (!anchorRect) return undefined

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') hide()
    }

    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [anchorRect, hide])

  const tooltip = anchorRect && !disabled
    ? createPortal(
      <TooltipBubble id={tooltipId} label={label} anchorRect={anchorRect} />,
      document.body,
    )
    : null

  return {
    tooltip,
    triggerProps: {
      'aria-describedby': anchorRect && !disabled ? tooltipId : undefined,
      onPointerEnter: (event: PointerEvent<HTMLElement>) => showForElement(event.currentTarget),
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event: FocusEvent<HTMLElement>) => showForElement(event.currentTarget),
      onBlur: hide,
    },
  }
}

function TooltipBubble({ id, label, anchorRect }: { id: string; label: string; anchorRect: TooltipAnchorRect }) {
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element) return undefined
    const tooltipElement = element

    function updatePosition() {
      const rect = tooltipElement.getBoundingClientRect()
      const nextPosition = calculateTooltipPosition(
        anchorRect,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      setPosition(current => sameTooltipPosition(current, nextPosition) ? current : nextPosition)
    }

    updatePosition()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updatePosition)
    observer.observe(tooltipElement)
    return () => observer.disconnect()
  }, [anchorRect, label])

  const style: TooltipStyle = position
    ? {
      left: `${position.left}px`,
      top: `${position.top}px`,
      '--tooltip-arrow-offset': `${position.arrowOffset}px`,
    }
    : { left: '0px', top: '0px' }

  return (
    <span
      ref={tooltipRef}
      id={id}
      className={position ? `appTooltip appTooltip-${position.placement}` : 'appTooltip appTooltip-measuring'}
      role="tooltip"
      style={style}
    >
      {label}
    </span>
  )
}

export function calculateTooltipPosition(
  anchorRect: TooltipAnchorRect,
  tooltipSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
): TooltipPosition {
  const availableSpace: Record<TooltipPlacement, number> = {
    top: anchorRect.top - TOOLTIP_VIEWPORT_PADDING - TOOLTIP_GAP,
    bottom: viewportSize.height - TOOLTIP_VIEWPORT_PADDING - TOOLTIP_GAP - anchorRect.bottom,
    left: anchorRect.left - TOOLTIP_VIEWPORT_PADDING - TOOLTIP_GAP,
    right: viewportSize.width - TOOLTIP_VIEWPORT_PADDING - TOOLTIP_GAP - anchorRect.right,
  }
  const requiredSpace: Record<TooltipPlacement, number> = {
    top: tooltipSize.height,
    bottom: tooltipSize.height,
    left: tooltipSize.width,
    right: tooltipSize.width,
  }
  const placement = TOOLTIP_PLACEMENT_ORDER.find(candidate => availableSpace[candidate] >= requiredSpace[candidate])
    ?? TOOLTIP_PLACEMENT_ORDER.reduce((best, candidate) => (
      availableSpace[candidate] - requiredSpace[candidate] > availableSpace[best] - requiredSpace[best]
        ? candidate
        : best
    ))
  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top + anchorRect.height / 2
  const maxLeft = Math.max(TOOLTIP_VIEWPORT_PADDING, viewportSize.width - TOOLTIP_VIEWPORT_PADDING - tooltipSize.width)
  const maxTop = Math.max(TOOLTIP_VIEWPORT_PADDING, viewportSize.height - TOOLTIP_VIEWPORT_PADDING - tooltipSize.height)

  if (placement === 'top' || placement === 'bottom') {
    const left = clamp(anchorCenterX - tooltipSize.width / 2, TOOLTIP_VIEWPORT_PADDING, maxLeft)
    const top = clamp(
      placement === 'top'
        ? anchorRect.top - TOOLTIP_GAP - tooltipSize.height
        : anchorRect.bottom + TOOLTIP_GAP,
      TOOLTIP_VIEWPORT_PADDING,
      maxTop,
    )
    return {
      left,
      top,
      placement,
      arrowOffset: clamp(anchorCenterX - left, TOOLTIP_ARROW_PADDING, Math.max(TOOLTIP_ARROW_PADDING, tooltipSize.width - TOOLTIP_ARROW_PADDING)),
    }
  }

  const left = clamp(
    placement === 'left'
      ? anchorRect.left - TOOLTIP_GAP - tooltipSize.width
      : anchorRect.right + TOOLTIP_GAP,
    TOOLTIP_VIEWPORT_PADDING,
    maxLeft,
  )
  const top = clamp(anchorCenterY - tooltipSize.height / 2, TOOLTIP_VIEWPORT_PADDING, maxTop)
  return {
    left,
    top,
    placement,
    arrowOffset: clamp(anchorCenterY - top, TOOLTIP_ARROW_PADDING, Math.max(TOOLTIP_ARROW_PADDING, tooltipSize.height - TOOLTIP_ARROW_PADDING)),
  }
}

function sameTooltipPosition(current: TooltipPosition | null, next: TooltipPosition) {
  return current?.left === next.left
    && current.top === next.top
    && current.placement === next.placement
    && current.arrowOffset === next.arrowOffset
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
