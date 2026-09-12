import { Children, useMemo, useState, type ReactNode } from 'react'
import { sheetTimingRoleForEvent, type SheetHit } from '@xsheet-remap/core'
import { CanvasKitModelLayer } from './CanvasKitModelLayer'
import type { DirectPaperModel, PaperPrimitive } from './canvasKitDirectModel'
import type { SheetEventRectRenderItem } from './sheet-layers-hit-geometry'
import { assetAssignedMarkerPoints, type SheetSelectionSurface } from './sheet-selection-visuals'
import { timingEventSymbolGeometry } from './TimingEventSymbol'
import { clampTextFontSizePx } from './sheetTextLayout'
import { createSheetRenderGroups } from './sheetRenderGroups'

type Props = {
  items: SheetEventRectRenderItem[]; pageSize: DirectPaperModel['pageSize']; surface: SheetSelectionSurface
  dragging?: SheetHit; pending?: SheetHit; ready?: boolean; children: ReactNode
}
const groupKey = (item: SheetEventRectRenderItem) => `${sheetTimingRoleForEvent(item.event)}:${item.event.paperTrack}:${Math.floor(item.event.frame / 128)}`

export function TimingEventModelLayer(props: Props) {
  const [groupItems] = useState(() => createSheetRenderGroups<SheetEventRectRenderItem>())
  const groups = useMemo(() => groupItems(props.items, groupKey), [groupItems, props.items])
  const nativeItems = Children.toArray(props.children)
  const nativeByItem = new Map(props.items.map((item, index) => [item, nativeItems[index]]))
  return <>{[...groups].map(([key, items]) => <TimingEventChunk key={key} {...props} items={items}
    dragging={items.some(item => eventHitKey(item) === hitKey(props.dragging)) ? props.dragging : undefined}
    pending={items.some(item => eventHitKey(item) === hitKey(props.pending)) ? props.pending : undefined}>
    {items.map(item => nativeByItem.get(item))}
  </TimingEventChunk>)}</>
}

function eventHitKey(item: SheetEventRectRenderItem) { return `${sheetTimingRoleForEvent(item.event)}:${item.event.paperTrack}:${item.event.frame}` }

function TimingEventChunk({ items, pageSize, surface, dragging, pending, ready, children }: Props) {
  const draggingKey = hitKey(dragging), pendingKey = hitKey(pending)
  const pendingReady = Boolean(pendingKey && ready)
  const model = useMemo<DirectPaperModel>(() => {
    const styles: DirectPaperModel['styles'] = {}
    const primitives: PaperPrimitive[] = []
    for (const item of items) {
      const { event, eventKind, displayLabel, rect, hasAssetBinding, fontSizePx } = item
      const key = `${sheetTimingRoleForEvent(event)}:${event.paperTrack}:${event.frame}`
      const state = [key === draggingKey ? 'timelineEventDragSource' : 'timelineEventHandle',
        key === pendingKey ? 'timelineEventDragPending' : '', key === pendingKey && pendingReady ? 'timelineEventDragReady' : ''].filter(Boolean).join(' ')
      const style = (className: string, tag: 'rect' | 'path' | 'text') => {
        const id = `${state}:${className}`
        styles[id] = { className, tag, contextClassName: state }
        return id
      }
      primitives.push({ style: style(hasAssetBinding ? 'eventRect assetAssignedEventRect' : 'eventRect', 'rect'),
        shape: { kind: 'rect', rect: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, rx: .002, ry: .002 } })
      if (hasAssetBinding) primitives.push({ style: style('assetAssignedEventMarker', 'path'), shape: { kind: 'polygon',
        points: assetAssignedMarkerPoints(rect, surface).split(/[\s,]+/).map(Number), close: true } })
      if (eventKind === 'cell') {
        if (displayLabel.trim()) primitives.push({ style: style('eventText', 'text'), text: {
          value: displayLabel, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, size: clampTextFontSizePx(fontSizePx), anchor: 'middle', baseline: 'central',
        } })
      } else {
        const geometry = timingEventSymbolGeometry(eventKind, rect)
        const symbolStyle = style(`eventSymbol ${eventKind === 'blank' ? 'eventBlankSymbol' : eventKind === 'reverse' ? 'eventReverseSymbol' : 'eventInbetweenSymbol'}`, 'path')
        if (eventKind === 'blank') for (const line of geometry.lines) primitives.push({ style: symbolStyle,
          shape: { kind: 'path', d: `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}` }, paint: { strokeWidth: geometry.strokeWidth } })
        else primitives.push({ style: symbolStyle, shape: { kind: 'ellipse', cx: geometry.center.x, cy: geometry.center.y, rx: geometry.radiusX, ry: geometry.radiusY },
          paint: { strokeWidth: geometry.strokeWidth } })
      }
    }
    return { pageSize, styles, primitives }
    // Surface dimensions determine only the fixed-size asset corner marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, pageSize, surface.widthPx, surface.heightPx, draggingKey, pendingKey, pendingReady])
  return <CanvasKitModelLayer model={model} className="timingEventGraphics" preserveNative fallback={() => children} />
}
function hitKey(hit: SheetHit | undefined) { return hit ? `${hit.role}:${hit.paperTrack}:${hit.frame}` : '' }
