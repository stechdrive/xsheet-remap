import { memo, useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react'
import type { CutProject, SheetHit, SheetPage } from '@xsheet-remap/core'
import type { SheetEventRectRenderItem } from './sheet-layers-hit-geometry'
import type { SheetInputTextRenderItem, SheetRenderModelGeometry } from './sheetRenderModel'
import { sheetTimelineEventHit, type TimelineHitEvent } from './sheetTimelineEventHit'
import { sameSheetHitCell } from './timingEditing'
import { AssetAssignedFrameCue } from './sheet-selection-visuals'
import { TimingReferenceOnlyLayer } from './TimingReferenceOnlyLayer'
import { TimingReferenceSymbol } from './TimingReferenceSymbol'
import { TimingEventModelLayer } from './TimingEventModelLayer'
import { TimingEventSymbol } from './TimingEventSymbol'
import { TimingCellText } from './TimingCellText'

type PointerHandlers = {
  onPointerDown: (event: PointerEvent<SVGGElement>, item: TimelineHitEvent, page: SheetPage) => void
  onPointerMove: (event: PointerEvent<SVGGElement>) => void
  onPointerUp: (event: PointerEvent<SVGGElement>) => void
  onPointerCancel: (event: PointerEvent<SVGGElement>) => void
}
type ContentProps = {
  project: CutProject
  geometry: SheetRenderModelGeometry
  page: SheetPage
  items: SheetEventRectRenderItem[]
  references: SheetInputTextRenderItem[]
  width: number
  height: number
  dragging?: SheetHit
  pending?: SheetHit
  ready?: boolean
}

// Input handlers must see the latest selection/tool state, while a hover or
// selection-only update must not reconcile every native cell and text node.
export function SheetTimingEventLayer({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...content }: ContentProps & PointerHandlers) {
  const latest = useRef({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel })
  useLayoutEffect(() => {
    latest.current = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  }, [onPointerDown, onPointerMove, onPointerUp, onPointerCancel])
  const handlers = useMemo<PointerHandlers>(() => ({
    onPointerDown: (...args) => latest.current.onPointerDown(...args),
    onPointerMove: event => latest.current.onPointerMove(event),
    onPointerUp: event => latest.current.onPointerUp(event),
    onPointerCancel: event => latest.current.onPointerCancel(event),
  }), [])
  return <TimingEventContent {...content} handlers={handlers} />
}

const TimingEventContent = memo(function TimingEventContent({
  project, geometry, page, items, references, width, height, dragging, pending, ready, handlers,
}: ContentProps & { handlers: PointerHandlers }) {
  const surface = useMemo(() => ({ widthPx: width, heightPx: height }), [width, height])
  const hits = useMemo(() => items.map(item => sheetTimelineEventHit(project, geometry, item.event, page)),
    [project, geometry, items, page])
  const pageSize = geometry.pageSize
  return <>
    <TimingReferenceOnlyLayer items={references} pageSize={pageSize}>
      {references.map(item => <g key={item.eventId}
        data-reference-track={item.paperTrack} data-reference-frame={item.frame} data-reference-role={item.sheetRole}
        onPointerDown={event => handlers.onPointerDown(event, item, page)}
        onPointerMove={handlers.onPointerMove} onPointerUp={handlers.onPointerUp} onPointerCancel={handlers.onPointerCancel}>
        <rect className="eventReferenceHit" x={item.rect.x} y={item.rect.y} width={item.rect.w} height={item.rect.h} fill="transparent" stroke="none" pointerEvents="all" />
        {item.textLayout.reference && <TimingReferenceSymbol geometry={item.textLayout.reference} pageSize={pageSize} />}
      </g>)}
    </TimingReferenceOnlyLayer>
    <TimingEventModelLayer items={items} pageSize={pageSize} surface={surface} dragging={dragging} pending={pending} ready={ready}>
      {items.map(({ event, eventKind, displayLabel, rect, hasAssetBinding, textLayout }, index) => {
        const hit = hits[index]
        const isDragging = Boolean(dragging && sameSheetHitCell(dragging, hit))
        const isPending = Boolean(pending && sameSheetHitCell(pending, hit))
        const className = [
          isDragging ? 'timelineEventDragSource' : 'timelineEventHandle',
          isPending ? 'timelineEventDragPending' : '',
          isPending && ready ? 'timelineEventDragReady' : '',
        ].filter(Boolean).join(' ')
        return <g key={event.eventId} className={className}
          data-timeline-event-track={hit?.paperTrack} data-timeline-event-role={hit?.role} data-timeline-event-frame={hit?.frame}
          onPointerDown={hit ? pointerEvent => handlers.onPointerDown(pointerEvent, event, page) : undefined}
          onPointerMove={handlers.onPointerMove} onPointerUp={handlers.onPointerUp} onPointerCancel={handlers.onPointerCancel}>
          {textLayout.overflow && <title>{displayLabel}</title>}
          <rect className={hasAssetBinding ? 'eventRect assetAssignedEventRect' : 'eventRect'} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="0.002" />
          {hasAssetBinding && <AssetAssignedFrameCue rect={rect} surface={surface} />}
          {textLayout.reference && <TimingReferenceSymbol geometry={textLayout.reference} pageSize={pageSize} />}
          {eventKind === 'cell' && displayLabel.trim() && <TimingCellText layout={textLayout} rect={rect} pageSize={pageSize} />}
          {eventKind !== 'cell' && <TimingEventSymbol kind={eventKind} rect={rect} pageSize={pageSize} />}
        </g>
      })}
    </TimingEventModelLayer>
  </>
})
