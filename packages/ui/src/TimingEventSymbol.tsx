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
  pageSize: { widthPx: number; heightPx: number },
): TimingEventSymbolGeometry {
  const center = { x: (rect.x + rect.w / 2) * pageSize.widthPx, y: (rect.y + rect.h / 2) * pageSize.heightPx }
  const w = rect.w * pageSize.widthPx, h = rect.h * pageSize.heightPx, short = Math.min(w, h)
  const strokeWidth = Math.min(1.8, short * .055)
  // Page pixels, including the pen width, must have the same scale on both axes.
  const radius = Math.max(0, (short * .45 - strokeWidth) / 2)
  const radiusX = kind === 'blank' ? w * .31 : radius
  const radiusY = kind === 'blank' ? h * .31 : radius
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
  pageSize,
}: {
  kind: Exclude<TimelineEventValueKind, 'cell'>
  rect: NormalizedRect
  pageSize: { widthPx: number; heightPx: number }
}) {
  const geometry = timingEventSymbolGeometry(kind, rect, pageSize)
  const transform = `scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`
  if (kind === 'blank') {
    return (
      <g className="eventSymbol eventBlankSymbol" transform={transform} aria-hidden="true">
        {geometry.lines.map((line, index) => (
          <line key={index} {...line} strokeWidth={geometry.strokeWidth} />
        ))}
      </g>
    )
  }
  return (
    <ellipse
      className={`eventSymbol ${kind === 'reverse' ? 'eventReverseSymbol' : 'eventInbetweenSymbol'}`}
      transform={transform}
      cx={geometry.center.x}
      cy={geometry.center.y}
      rx={geometry.radiusX}
      ry={geometry.radiusY}
      strokeWidth={geometry.strokeWidth}
      aria-hidden="true"
    />
  )
}
