import { useMemo, type ReactNode } from 'react'
import { CanvasKitModelLayer } from './CanvasKitModelLayer'
import type { DirectPaperModel } from './canvasKitDirectModel'
import type { SheetInputTextRenderItem } from './sheetRenderModel'
import { TimingReferenceSymbol, timingReferencePrimitive } from './TimingReferenceSymbol'

export function TimingReferenceOnlyLayer({ items, pageSize, children }: { items: SheetInputTextRenderItem[]; pageSize: DirectPaperModel['pageSize']; children?: ReactNode }) {
  const model = useMemo<DirectPaperModel>(() => ({ pageSize,
    styles: { reference: { tag: 'path', className: 'eventSymbol eventReferenceSymbol' } },
    primitives: items.flatMap(item => item.textLayout.reference ? [timingReferencePrimitive(item.textLayout.reference, 'reference')] : []),
  }), [items, pageSize])
  return <g className="timingReferenceOnlyLayer"><CanvasKitModelLayer className="timingReferenceGraphics" model={model} preserveNative fallback={() => children ?? items.map(item =>
    item.textLayout.reference && <TimingReferenceSymbol key={item.eventId} geometry={item.textLayout.reference} pageSize={pageSize} />)} /></g>
}
