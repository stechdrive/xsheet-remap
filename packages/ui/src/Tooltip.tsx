import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type TooltipPlacement = 'top' | 'bottom'

type TooltipPosition = {
  left: number
  top: number
  placement: TooltipPlacement
}

type TooltipStyle = CSSProperties & {
  '--tooltip-shift-x'?: string
  '--tooltip-arrow-x'?: string
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
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: () => void
}

const TOOLTIP_DELAY_MS = 120
const TOOLTIP_VIEWPORT_PADDING = 8
const TOOLTIP_MAX_WIDTH = 280
const TOOLTIP_VERTICAL_GAP = 9
const TOOLTIP_ESTIMATED_HEIGHT = 32

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
  const showTimerRef = useRef<number | null>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current === null) return
    window.clearTimeout(showTimerRef.current)
    showTimerRef.current = null
  }, [])

  const hide = useCallback(() => {
    clearShowTimer()
    setPosition(null)
  }, [clearShowTimer])

  const showForElement = useCallback((element: HTMLElement) => {
    clearShowTimer()
    if (!label || disabled) return
    showTimerRef.current = window.setTimeout(() => {
      setPosition(tooltipPositionForRect(element.getBoundingClientRect(), label))
    }, delayMs)
  }, [clearShowTimer, delayMs, disabled, label])

  useEffect(() => hide, [hide])

  useEffect(() => {
    if (disabled) clearShowTimer()
  }, [clearShowTimer, disabled])

  useEffect(() => {
    if (!position) return undefined
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [hide, position])

  const tooltip = position && !disabled
    ? createPortal(
      <TooltipBubble label={label} position={position} />,
      document.body,
    )
    : null

  return {
    tooltip,
    triggerProps: {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => showForElement(event.currentTarget),
      onPointerLeave: hide,
      onPointerDown: hide,
      onFocus: (event: FocusEvent<HTMLElement>) => showForElement(event.currentTarget),
      onBlur: hide,
    },
  }
}

function TooltipBubble({ label, position }: { label: string; position: TooltipPosition }) {
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [shiftX, setShiftX] = useState(0)

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const minLeft = TOOLTIP_VIEWPORT_PADDING
    const maxRight = window.innerWidth - TOOLTIP_VIEWPORT_PADDING
    const nextShiftX = rect.left < minLeft
      ? minLeft - rect.left
      : rect.right > maxRight
        ? maxRight - rect.right
        : 0
    setShiftX(current => current === nextShiftX ? current : nextShiftX)
  }, [label, position])

  const style: TooltipStyle = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    '--tooltip-shift-x': `${shiftX}px`,
    '--tooltip-arrow-x': `calc(50% - ${shiftX}px)`,
  }

  return (
    <span
      ref={tooltipRef}
      className={`appTooltip appTooltip-${position.placement}`}
      role="tooltip"
      style={style}
    >
      {label}
    </span>
  )
}

function tooltipPositionForRect(rect: DOMRect, label: string): TooltipPosition {
  const estimatedWidth = Math.min(
    TOOLTIP_MAX_WIDTH,
    Math.max(56, label.length * 9 + 18),
  )
  const unclampedLeft = rect.left + rect.width / 2
  const left = clamp(
    unclampedLeft,
    TOOLTIP_VIEWPORT_PADDING + estimatedWidth / 2,
    window.innerWidth - TOOLTIP_VIEWPORT_PADDING - estimatedWidth / 2,
  )
  const canPlaceAbove = rect.top >= TOOLTIP_ESTIMATED_HEIGHT + TOOLTIP_VERTICAL_GAP + TOOLTIP_VIEWPORT_PADDING
  const placement: TooltipPlacement = canPlaceAbove ? 'top' : 'bottom'
  const top = canPlaceAbove
    ? rect.top - TOOLTIP_VERTICAL_GAP
    : rect.bottom + TOOLTIP_VERTICAL_GAP
  return { left, top, placement }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return value
  return Math.min(max, Math.max(min, value))
}
