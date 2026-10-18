import { memo, useContext, useLayoutEffect, useMemo, useRef } from 'react'
import type { NormalizedRect, SheetPage } from '@xsheet-remap/core'
import type { SheetRenderModelContext } from './sheetRenderModel'
import type { TimingRangeMovePlan, TimingRangeMoveSource } from './timingEditing'
import { timingDragGhostCellsForPage, timingDragRangeRectsForPage } from './timingRangeDragGeometry'
import { TimingCellText } from './TimingCellText'
import { TimingEventSymbol } from './TimingEventSymbol'
import { TimingReferenceSymbol } from './TimingReferenceSymbol'
import { AssetAssignedFrameCue, rangeBoundaryRect, SheetSelectionOutline } from './sheet-selection-visuals'
import { sheetRoleLabel } from './sheetInteraction'
import { SheetRenderWindowContext } from './useSheetRenderWindow'
import { sheetFrameRangeForWindow } from './sheetRenderWindowGeometry'
import { useSheetTextMetricsRevision } from './useSheetTextMetricsRevision'
import { positionDragPreview, type DragPreviewRect } from './pointerDragGhost'

function RangeFill({ rect, className }: { rect: NormalizedRect; className: string }) {
  return <rect className={className} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
}

// This lives outside the CanvasKit-backed sheet SVG. Source content stays cached;
// a translucent veil dims the entire source, including reference-only cells.
export const SheetTimingDragPreview = memo(function SheetTimingDragPreview({
  context, page, source, plan, activeOverlayPaperTrack, width, height,
}: {
  context: SheetRenderModelContext
  page: SheetPage
  source: TimingRangeMoveSource
  plan: TimingRangeMovePlan
  activeOverlayPaperTrack: string | null
  width: number
  height: number
}) {
  const renderWindow = useContext(SheetRenderWindowContext)
  const metricsRevision = useSheetTextMetricsRevision()
  const surface = { widthPx: width, heightPx: height }
  const sourceRects = useMemo(() => timingDragRangeRectsForPage(context, page, source.range, activeOverlayPaperTrack), [context, page, source, activeOverlayPaperTrack])
  const destinationRects = useMemo(() => timingDragRangeRectsForPage(context, page, {
    ...source.range,
    paperTracks: plan.destinationPaperTracks,
    frameStart: Math.max(plan.destinationFrameStart, source.displayFrameStart),
    frameEnd: Math.min(plan.destinationFrameEnd, source.displayFrameEnd),
  }, activeOverlayPaperTrack), [context, page, source, plan, activeOverlayPaperTrack])
  const cells = useMemo(() => timingDragGhostCellsForPage(context, page, source, plan, activeOverlayPaperTrack,
    sheetFrameRangeForWindow(context, renderWindow)),
  // Font loading affects fitted text without changing a snapped target.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [context, page, source, plan, activeOverlayPaperTrack, renderWindow, metricsRevision])
  const validity = plan.reason ? 'invalid' : plan.collisionCells.length > 0 ? 'collision' : 'valid'
  return <g className="timingDragPreview" data-drag-validity={validity} pointerEvents="none">
    <g className="timingDragSource">
      {sourceRects.map((rect, index) => <g key={index}>
        <RangeFill rect={rect} className="timingDragSourceVeil" />
        <SheetSelectionOutline rect={rangeBoundaryRect(rect, surface)} className="timingDragSourceOutline" />
      </g>)}
    </g>
    <g className="timingDragDestination" data-drag-frame-start={plan.destinationFrameStart} data-drag-frame-end={plan.destinationFrameEnd}>
      {destinationRects.map((rect, index) => <RangeFill key={index} rect={rect} className="timingDragRangeFill" />)}
      {cells.map(({ paperTrack, frame, item, rect, textLayout, collision }) => <g key={`${paperTrack}:${frame}`}
        className="timingDragGhostCell" data-drag-track={paperTrack} data-drag-frame={frame} data-drag-collision={collision || undefined}>
        <RangeFill rect={rect} className="timingDragCellFill" />
        {collision && <SheetSelectionOutline rect={rangeBoundaryRect(rect, surface)} className="timingDragCollisionOutline" />}
        <g className="timingDragGhostContent">
          {item.bindings?.some(binding => binding.assetId) && <AssetAssignedFrameCue rect={rect} surface={surface} />}
          {textLayout.reference && <TimingReferenceSymbol geometry={textLayout.reference} pageSize={context.pageSize} />}
          {item.kind === 'key' && item.displayLabel?.trim() && <TimingCellText layout={textLayout} rect={rect} pageSize={context.pageSize} />}
          {item.kind !== 'key' && item.kind !== 'empty' && <TimingEventSymbol kind={item.kind} rect={rect} pageSize={context.pageSize} />}
        </g>
      </g>)}
      {destinationRects.map((rect, index) => <SheetSelectionOutline key={index} rect={rangeBoundaryRect(rect, surface)} className="timingDragDestinationOutline" />)}
    </g>
  </g>
})

const INVALID_REASON = {
  'outside-sheet': '移動先のセルにポインターを合わせてください',
  'different-role': '同じ入力欄の中で移動してください',
  'outside-tracks': '選択範囲が入力列の外にはみ出しています',
  'outside-frames': '選択範囲がシートのフレーム範囲外にはみ出しています',
  'empty-source': '移動する入力がありません',
} as const

function rangeLabel(tracks: string[], start: number, end: number) {
  const frame = (value: number) => `${value < 0 ? '−' : ''}${String(Math.abs(value)).padStart(3, '0')}`
  const track = (value: string) => value || '範囲外'
  const columns = tracks.length > 1 ? `${track(tracks[0])}–${track(tracks.at(-1)!)}` : track(tracks[0] ?? '')
  return `${columns} ${frame(start)}${end === start ? '' : `–${frame(end)}`}`
}

export function TimingDragStatus({ source, plan, clientX, clientY, getTargetRect }: {
  source: TimingRangeMoveSource; plan: TimingRangeMovePlan; clientX: number; clientY: number
  getTargetRect?: () => DragPreviewRect | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const position = positionDragPreview({ x: clientX, y: clientY }, element.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }, getTargetRect?.())
    element.style.visibility = position ? '' : 'hidden'
    if (position) { element.style.left = `${position.x}px`; element.style.top = `${position.y}px` }
  }, [clientX, clientY, getTargetRect, source, plan])
  const start = rangeLabel(source.clipboard.sourcePaperTracks, source.range.frameStart, source.range.frameEnd)
  const end = plan.destinationPaperTracks.length > 0
    ? rangeLabel(plan.destinationPaperTracks, plan.destinationFrameStart, plan.destinationFrameEnd) : '移動不可'
  const offset = `${plan.frameDelta > 0 ? '+' : ''}${plan.frameDelta}F・${plan.trackDelta === 0 ? '同じ列' : `${plan.trackDelta > 0 ? '右' : '左'}${Math.abs(plan.trackDelta)}列`}`
  return <div ref={ref} className="timingDragStatus" data-drag-validity={plan.reason ? 'invalid' : plan.collisionCells.length ? 'collision' : 'valid'}
    role="status" aria-live="polite" aria-atomic="true">
    <strong>{sheetRoleLabel(source.range.role)} {start} → {end}</strong>
    <span>{offset} / {source.items.length}入力</span>
    <span>{plan.reason ? INVALID_REASON[plan.reason] : plan.collisionCells.length > 0
      ? `${plan.collisionCells.length}セルに既存の入力あり（離すと上書き確認）`
      : plan.status === 'same-target' ? '元の位置' : '離して移動・Escでキャンセル'}</span>
  </div>
}
