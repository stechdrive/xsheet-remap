import { memo, useMemo, useState } from 'react'
import { CanvasKitModelLayer } from './CanvasKitModelLayer'
import type { DirectPaperModel } from './canvasKitDirectModel'
import { sheetContinuationPathData, type SheetContinuationRenderItem } from './sheetRenderModel'
import { createSheetRenderGroups } from './sheetRenderGroups'

export const TimingContinuationLayer = memo(function TimingContinuationLayer({ items, pageSize }: {
  items: SheetContinuationRenderItem[]; pageSize: DirectPaperModel['pageSize']
}) {
  const [groupItems] = useState(() => createSheetRenderGroups<SheetContinuationRenderItem>())
  const groups = useMemo(() => groupItems(items, item => `${item.role}:${item.paperTrack}`), [groupItems, items])
  return <>{[...groups].map(([key, group]) => <ContinuationChunk key={key} items={group} pageSize={pageSize} />)}</>
})

const ContinuationChunk = memo(function ContinuationChunk({ items, pageSize }: {
  items: SheetContinuationRenderItem[]; pageSize: DirectPaperModel['pageSize']
}) {
  const model = useMemo<DirectPaperModel>(() => {
    const styles: DirectPaperModel['styles'] = {}
    const primitives = items.map(item => {
      const style = `${item.kind}:${item.strokeWidth}`
      // Match computed SVG presentation values, including the engine's numeric precision.
      styles[style] = { tag: 'path', className: `timingContinuationLine timingContinuation${item.kind === 'wave' ? 'Wave' : 'Straight'}`, strokeWidth: item.strokeWidth }
      return { style, shape: { kind: 'path' as const, d: sheetContinuationPathData(item.path) } }
    })
    return { pageSize, styles, primitives }
  }, [items, pageSize])
  return <CanvasKitModelLayer model={model} className="timingContinuations" ariaHidden fallback={() => items.map((item, index) => <path
    key={`${item.eventId}:${index}`} className={`timingContinuationLine timingContinuation${item.kind === 'wave' ? 'Wave' : 'Straight'}`}
    d={sheetContinuationPathData(item.path)} strokeWidth={item.strokeWidth} />)} />
})
