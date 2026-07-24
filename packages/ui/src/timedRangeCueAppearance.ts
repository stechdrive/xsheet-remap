import type { CSSProperties } from 'react'
import {
  timedRangeCuePaint,
  type ResolvedTimedRangeCuePaint,
  type SheetTemplateTheme,
  type TimedRangeRole,
} from '@xsheet-remap/core'

type TimedRangeCuePaintStyle = CSSProperties & {
  '--timed-range-cue-fill': string
  '--timed-range-cue-hover-fill': string
  '--timed-range-cue-stroke': string
  '--timed-range-cue-text': string
}

export function timedRangeCueColumnPaint(
  theme: SheetTemplateTheme,
  role: Extract<TimedRangeRole, 'sound' | 'camera'>,
  columnIndex: number,
): ResolvedTimedRangeCuePaint {
  return timedRangeCuePaint(theme, role, columnIndex)
}

export function timedRangeCueColumnStyle(
  theme: SheetTemplateTheme,
  role: Extract<TimedRangeRole, 'sound' | 'camera'>,
  columnIndex: number,
): TimedRangeCuePaintStyle {
  const paint = timedRangeCueColumnPaint(theme, role, columnIndex)
  return {
    '--timed-range-cue-fill': colorWithOpacity(paint.fillColor, paint.fillOpacity),
    '--timed-range-cue-hover-fill': colorWithOpacity(paint.fillColor, paint.hoverOpacity),
    '--timed-range-cue-stroke': paint.strokeColor,
    '--timed-range-cue-text': paint.textColor,
  }
}

export function colorWithOpacity(color: string, opacity: number): string {
  const normalized = color.replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return color
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clampOpacity(opacity)})`
}

function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1
  return Math.min(1, Math.max(0, opacity))
}
