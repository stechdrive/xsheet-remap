import type { NormalizedRect, TimelineEventValueKind } from '@xsheet-remap/core'

export type TimingEventSymbolGeometry = {
  kind: Exclude<TimelineEventValueKind, 'cell'>
  center: { x: number; y: number }
  radiusX: number
  radiusY: number
  strokeWidth: number
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>
}

export function timingEventSymbolGeometry(
  kind: Exclude<TimelineEventValueKind, 'cell'>,
  rect: NormalizedRect,
): TimingEventSymbolGeometry {
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  const scale = kind === 'blank' ? 0.31 : 0.28
  const radiusX = rect.w * scale
  const radiusY = rect.h * scale
  const strokeWidth = Math.max(0.00055, Math.min(0.0018, Math.min(rect.w, rect.h) * 0.09))
  return {
    kind,
    center,
    radiusX,
    radiusY,
    strokeWidth,
    lines: kind === 'blank'
      ? [
          { x1: center.x - radiusX, y1: center.y - radiusY, x2: center.x + radiusX, y2: center.y + radiusY },
          { x1: center.x + radiusX, y1: center.y - radiusY, x2: center.x - radiusX, y2: center.y + radiusY },
        ]
      : [],
  }
}

export function TimingEventSymbol({
  kind,
  rect,
}: {
  kind: Exclude<TimelineEventValueKind, 'cell'>
  rect: NormalizedRect
}) {
  const geometry = timingEventSymbolGeometry(kind, rect)
  if (kind === 'blank') {
    return (
      <g className="eventSymbol eventBlankSymbol" aria-hidden="true">
        {geometry.lines.map((line, index) => (
          <line key={index} {...line} strokeWidth={geometry.strokeWidth} />
        ))}
      </g>
    )
  }
  return (
    <ellipse
      className={`eventSymbol ${kind === 'reverse' ? 'eventReverseSymbol' : 'eventInbetweenSymbol'}`}
      cx={geometry.center.x}
      cy={geometry.center.y}
      rx={geometry.radiusX}
      ry={geometry.radiusY}
      strokeWidth={geometry.strokeWidth}
      aria-hidden="true"
    />
  )
}
