import type { TimingReferenceGeometry } from './timingReferenceLayout'
import type { PaperPrimitive } from './canvasKitDirectModel'

export function timingReferencePrimitive(reference: TimingReferenceGeometry, style: string): PaperPrimitive {
  if (reference.ellipse) return { style, coordinateSpace: 'page-pixels',
    shape: { kind: 'ellipse', ...reference.ellipse },
    paint: { strokeWidth: reference.strokeWidthPx } }
  return { style, coordinateSpace: 'page-pixels', shape: { kind: 'polygon', points: reference.points, close: true },
    paint: { strokeWidth: reference.strokeWidthPx } }
}

export function TimingReferenceSymbol({ geometry, pageSize }: { geometry: TimingReferenceGeometry; pageSize: { widthPx: number; heightPx: number } }) {
  if (geometry.ellipse) return <ellipse className="eventSymbol eventReferenceSymbol" {...geometry.ellipse}
    transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} strokeWidth={geometry.strokeWidthPx} aria-hidden="true" />
  return <polygon className="eventSymbol eventReferenceSymbol" points={geometry.points.join(' ')}
    transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} strokeWidth={geometry.strokeWidthPx} aria-hidden="true" />
}
