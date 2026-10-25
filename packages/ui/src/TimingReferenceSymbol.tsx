import type { TimingReferenceGeometry } from './timingReferenceLayout'
import type { PaperPrimitive } from './canvasKitDirectModel'

export function timingReferencePrimitive(reference: TimingReferenceGeometry, style: string): PaperPrimitive {
  if (reference.circle) return { style, coordinateSpace: 'page-pixels',
    shape: { kind: 'ellipse', cx: reference.circle.cx, cy: reference.circle.cy, rx: reference.circle.r, ry: reference.circle.r },
    paint: { strokeWidth: reference.strokeWidthPx } }
  return { style, coordinateSpace: 'page-pixels', shape: { kind: 'polygon', points: reference.points, close: true },
    paint: { strokeWidth: reference.strokeWidthPx } }
}

export function TimingReferenceSymbol({ geometry, pageSize }: { geometry: TimingReferenceGeometry; pageSize: { widthPx: number; heightPx: number } }) {
  if (geometry.circle) return <circle className="eventSymbol eventReferenceSymbol" cx={geometry.circle.cx} cy={geometry.circle.cy} r={geometry.circle.r}
    transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} strokeWidth={geometry.strokeWidthPx} aria-hidden="true" />
  return <polygon className="eventSymbol eventReferenceSymbol" points={geometry.points.join(' ')}
    transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} strokeWidth={geometry.strokeWidthPx} aria-hidden="true" />
}
