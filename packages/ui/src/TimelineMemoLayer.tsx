import { useMemo, useRef, useState, type PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimelineInkMemo, TimelineMemoPlacement, TimelineMemoPoint, TimelineMemoStroke } from '@xsheet-remap/core'
import type { EditMode } from './appTypes'
import {
  timelineMemoAnchorCellForPage,
  timelineMemoAnchorConnectorPoints,
  timelineMemoAnchorHitRect,
  timelineMemoAnchorMarkerRect,
  timelineMemoPointFromPagePoint,
  timelineMemoSegmentsForPage,
  timelineMemoStrokePath,
  type TimelineMemoSegment,
} from './timelineMemoGeometry'
import { sheetCellCornerTrianglePoints } from './sheetCellCornerMarker'

type MemoInteraction = {
  pointerId: number
  mode: 'draw' | 'erase' | 'move' | 'resize'
  memo: TimelineInkMemo
  segment: TimelineMemoSegment
  startClient: { x: number; y: number }
  points: TimelineMemoPoint[]
  previewPlacement: TimelineMemoPlacement
}

export function TimelineMemoLayer({
  memos,
  template,
  page,
  paperTracks,
  layoutOverrides,
  pageSize,
  surface,
  selectedMemoId,
  editMode,
  penColor,
  penWidth,
  eraserWidth,
  onAppendStroke,
  onEraseStroke,
  onUpdatePlacement,
}: {
  memos: readonly TimelineInkMemo[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: { widthPx: number; heightPx: number }
  selectedMemoId: string | null
  editMode: EditMode
  penColor: string
  penWidth: number
  eraserWidth: number
  onAppendStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onEraseStroke: (memoId: string, points: TimelineMemoPoint[], widthUnits: number) => void
  onUpdatePlacement: (memoId: string, placement: TimelineMemoPlacement) => void
}) {
  const [interaction, setInteraction] = useState<MemoInteraction | null>(null)
  const interactionRef = useRef<MemoInteraction | null>(null)
  const renderedMemos = useMemo(() => memos
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(memo => interaction?.memo.memoId === memo.memoId ? { ...memo, placement: interaction.previewPlacement } : memo), [interaction, memos])
  const handleW = 16 / Math.max(1, pageSize.widthPx)
  const handleH = 16 / Math.max(1, pageSize.heightPx)
  const moveGripW = 10 / Math.max(1, pageSize.widthPx)
  const moveGripH = 8 / Math.max(1, pageSize.heightPx)
  const resizeMarkW = 9 / Math.max(1, pageSize.widthPx)
  const resizeMarkH = 9 / Math.max(1, pageSize.heightPx)
  const edgeW = 1.25 / Math.max(1, pageSize.widthPx)
  const edgeH = 1.25 / Math.max(1, pageSize.heightPx)
  const renderedMemoSegments = renderedMemos.map(memo => ({
    memo,
    segments: timelineMemoSegmentsForPage(template, page, memo, { paperTracks, layoutOverrides }),
  }))
  const anchorGroups = new Map<string, {
    anchorCell: NonNullable<ReturnType<typeof timelineMemoAnchorCellForPage>>
    anchorFrame: number
    memoIds: string[]
  }>()
  for (const memo of renderedMemos) {
    const anchorCell = timelineMemoAnchorCellForPage(template, page, memo, { paperTracks, layoutOverrides })
    if (!anchorCell) continue
    const key = [anchorCell.regionId, memo.anchor.role, memo.anchor.frame, memo.anchor.paperTrack ?? '', memo.anchor.laneId ?? ''].join(':')
    const existing = anchorGroups.get(key)
    if (existing) existing.memoIds.push(memo.memoId)
    else anchorGroups.set(key, { anchorCell, anchorFrame: memo.anchor.frame, memoIds: [memo.memoId] })
  }
  const selectedRender = renderedMemoSegments.find(item => item.memo.memoId === selectedMemoId)
  const selectedAnchorGroup = [...anchorGroups.values()].find(group => selectedMemoId && group.memoIds.includes(selectedMemoId))
  const selectedStartSegment = selectedRender?.segments.find(segment => segment.startsMemo)
  const selectedAnchorMarker = selectedAnchorGroup ? timelineMemoAnchorMarkerRect(selectedAnchorGroup.anchorCell.rect, surface) : null
  const selectedConnectorPoints = selectedAnchorMarker && selectedStartSegment
    ? timelineMemoAnchorConnectorPoints(selectedAnchorMarker, selectedStartSegment.rect, surface)
    : null

  function begin(event: PointerEvent<SVGElement>, memo: TimelineInkMemo, segment: TimelineMemoSegment, mode: MemoInteraction['mode']) {
    if (memo.memoId !== selectedMemoId) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = timelineMemoPointFromPagePoint(segment, pagePoint(event))
    const next: MemoInteraction = {
      pointerId: event.pointerId,
      mode,
      memo,
      segment,
      startClient: { x: event.clientX, y: event.clientY },
      points: mode === 'draw' ? [point] : [],
      previewPlacement: memo.placement,
    }
    interactionRef.current = next
    setInteraction(next)
  }

  function move(event: PointerEvent<SVGElement>) {
    const current = interactionRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (current.mode === 'draw' || current.mode === 'erase') {
      const points = [...current.points, timelineMemoPointFromPagePoint(current.segment, pagePoint(event))]
      const next = { ...current, points }
      interactionRef.current = next
      setInteraction(next)
      return
    }
    const svg = event.currentTarget.ownerSVGElement
    const rect = svg?.getBoundingClientRect()
    if (!rect) return
    const deltaUnits = (event.clientX - current.startClient.x) / Math.max(1, rect.width * current.segment.rowHeightX)
    const deltaFrames = (event.clientY - current.startClient.y) / Math.max(1, rect.height * current.segment.rowHeightY)
    const previewPlacement = current.mode === 'move'
      ? {
          ...current.memo.placement,
          crossOffsetUnits: current.memo.placement.crossOffsetUnits + deltaUnits,
          frameOffset: current.memo.placement.frameOffset + deltaFrames,
        }
      : {
          ...current.memo.placement,
          widthUnits: Math.max(1, current.memo.placement.widthUnits + deltaUnits),
          heightFrames: Math.max(1, current.memo.placement.heightFrames + deltaFrames),
        }
    const next = { ...current, previewPlacement }
    interactionRef.current = next
    setInteraction(next)
  }

  function finish(event: PointerEvent<SVGElement>, cancelled = false) {
    const current = interactionRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    interactionRef.current = null
    setInteraction(null)
    if (cancelled) return
    if (current.mode === 'draw') {
      if (current.points.length > 1) {
        onAppendStroke(current.memo.memoId, {
          color: penColor,
          widthUnits: Math.max(0.04, penWidth / Math.max(Number.EPSILON, current.segment.rowHeightY)),
          points: current.points,
        })
      }
      return
    }
    if (current.mode === 'erase') {
      onEraseStroke(
        current.memo.memoId,
        current.points,
        Math.max(0.04, eraserWidth / Math.max(Number.EPSILON, current.segment.rowHeightY)),
      )
      return
    }
    onUpdatePlacement(current.memo.memoId, current.previewPlacement)
  }

  return (
    <g className="timelineMemoLayer" aria-label="タイムライン手書きメモ">
      {renderedMemoSegments.flatMap(({ memo, segments }) => segments.map(segment => {
        const selected = memo.memoId === selectedMemoId
        const draftPoints = interaction?.memo.memoId === memo.memoId && interaction.mode === 'draw' ? interaction.points : null
        const eraserPoints = interaction?.memo.memoId === memo.memoId && interaction.mode === 'erase' ? interaction.points : null
        const drawingToolActive = editMode === 'pen' || editMode === 'eraser'
        const hitW = Math.min(segment.rect.w, handleW)
        const hitH = Math.min(segment.rect.h, handleH)
        const gripW = Math.min(segment.rect.w, moveGripW)
        const gripH = Math.min(segment.rect.h, moveGripH)
        const gripX = segment.rect.x + Math.max(0, (hitW - gripW) / 2)
        const gripY = segment.rect.y + Math.max(0, (hitH - gripH) / 2)
        const resizeW = Math.min(segment.rect.w, resizeMarkW)
        const resizeH = Math.min(segment.rect.h, resizeMarkH)
        const resizeRight = segment.rect.x + segment.rect.w - Math.min(2 / Math.max(1, pageSize.widthPx), resizeW * 0.2)
        const resizeBottom = segment.rect.y + segment.rect.h - Math.min(2 / Math.max(1, pageSize.heightPx), resizeH * 0.2)
        return (
          <g key={`${memo.memoId}:${segment.regionId}`} data-timeline-memo-id={memo.memoId} className={selected ? 'timelineMemoSegment selected' : 'timelineMemoSegment'}>
            {selected && <rect className="timelineMemoHitArea" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />}
            {memo.strokes.map(stroke => {
              const path = timelineMemoStrokePath(segment, stroke.points)
              return path ? <g key={stroke.strokeId}>
                {!selected && <path className="timelineMemoStrokeHit" d={path} />}
                <path className="timelineMemoStroke" d={path} stroke={stroke.color} strokeWidth={stroke.widthUnits * segment.rowHeightY} />
              </g> : null
            })}
            {draftPoints && (() => {
              const path = timelineMemoStrokePath(segment, draftPoints)
              return path ? <path className="timelineMemoStroke draft" d={path} stroke={penColor} strokeWidth={Math.max(penWidth, 0.001)} /> : null
            })()}
            {eraserPoints && (() => {
              const path = timelineMemoStrokePath(segment, eraserPoints)
              return path ? <path className="timelineMemoEraserPreview" d={path} strokeWidth={Math.max(eraserWidth, 0.001)} /> : null
            })()}
            {selected && <g className="timelineMemoBoundsEdges">
              <rect className="timelineMemoBounds" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={edgeH} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y + segment.rect.h - edgeH} width={segment.rect.w} height={edgeH} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y} width={edgeW} height={segment.rect.h} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x + segment.rect.w - edgeW} y={segment.rect.y} width={edgeW} height={segment.rect.h} />
            </g>}
            {selected && drawingToolActive && <rect
              className={editMode === 'eraser' ? 'timelineMemoDrawSurface eraser' : 'timelineMemoDrawSurface'}
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              onPointerDown={event => begin(event, memo, segment, editMode === 'eraser' ? 'erase' : 'draw')}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={event => finish(event, true)}
            />}
            {selected && segment.startsMemo && <g
              className="timelineMemoMoveHandle"
              aria-label="メモを移動"
              onPointerDown={event => begin(event, memo, segment, 'move')}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={event => finish(event, true)}
            >
              <title>メモを移動</title>
              <rect className="timelineMemoHandleHitArea" x={segment.rect.x} y={segment.rect.y} width={hitW} height={hitH} />
              <rect className="timelineMemoMoveHandleVisual" x={gripX} y={gripY} width={gripW} height={gripH} rx={Math.min(gripW, gripH) * 0.34} />
              {[0.3, 0.5, 0.7].map(ratio => <line
                key={ratio}
                className="timelineMemoMoveHandleGrip"
                x1={gripX + gripW * 0.25}
                y1={gripY + gripH * ratio}
                x2={gripX + gripW * 0.75}
                y2={gripY + gripH * ratio}
              />)}
            </g>}
            {selected && segment.endsMemo && <g
              className="timelineMemoResizeHandle"
              aria-label="メモの大きさを変更"
              onPointerDown={event => begin(event, memo, segment, 'resize')}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={event => finish(event, true)}
            >
              <title>メモの大きさを変更</title>
              <rect className="timelineMemoHandleHitArea" x={segment.rect.x + segment.rect.w - hitW} y={segment.rect.y + segment.rect.h - hitH} width={hitW} height={hitH} />
              <path className="timelineMemoResizeHandleVisual" d={`M ${resizeRight - resizeW} ${resizeBottom} H ${resizeRight} V ${resizeBottom - resizeH}`} />
            </g>}
          </g>
        )
      }))}
      {selectedConnectorPoints && <polygon className="timelineMemoAnchorConnector" points={selectedConnectorPoints} />}
      {[...anchorGroups.entries()].map(([key, group]) => {
        const hitRect = timelineMemoAnchorHitRect(group.anchorCell.rect, surface)
        const selected = Boolean(selectedMemoId && group.memoIds.includes(selectedMemoId))
        const memoCount = group.memoIds.length
        return (
          <g
            key={key}
            className={selected ? 'timelineMemoAnchorCue selected' : 'timelineMemoAnchorCue'}
            data-timeline-memo-id={selectedMemoId && group.memoIds.includes(selectedMemoId) ? selectedMemoId : undefined}
            data-timeline-memo-ids={group.memoIds.join(' ')}
            data-timeline-memo-anchor-frame={group.anchorFrame}
            data-timeline-memo-count={memoCount}
            aria-label={memoCount === 1 ? '手書きメモのアンカー' : `手書きメモのアンカー ${memoCount}件`}
          >
            <title>{memoCount === 1 ? '手書きメモ' : `手書きメモ ${memoCount}件`}</title>
            {!selected && <rect
              className="timelineMemoAnchorHitArea"
              x={hitRect.x}
              y={hitRect.y}
              width={hitRect.w}
              height={hitRect.h}
            />}
            <polygon className="timelineMemoAnchorMarker" points={sheetCellCornerTrianglePoints(group.anchorCell.rect, surface, 'top-left')} />
          </g>
        )
      })}
    </g>
  )
}

function pagePoint(event: PointerEvent<SVGElement>) {
  const svg = event.currentTarget.ownerSVGElement
  const rect = svg?.getBoundingClientRect()
  return {
    x: rect ? (event.clientX - rect.left) / Math.max(1, rect.width) : 0,
    y: rect ? (event.clientY - rect.top) / Math.max(1, rect.height) : 0,
  }
}
