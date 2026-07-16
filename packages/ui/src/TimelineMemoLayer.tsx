import { useMemo, useRef, useState, type PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimelineInkMemo, TimelineMemoPlacement, TimelineMemoPoint, TimelineMemoStroke } from '@xsheet-remap/core'
import {
  timelineMemoPointFromPagePoint,
  timelineMemoSegmentsForPage,
  timelineMemoStrokePath,
  type TimelineMemoSegment,
} from './timelineMemoGeometry'

type MemoInteraction = {
  pointerId: number
  mode: 'draw' | 'move' | 'resize'
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
  selectedMemoId,
  penColor,
  penWidth,
  onAppendStroke,
  onUpdatePlacement,
}: {
  memos: readonly TimelineInkMemo[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  selectedMemoId: string | null
  penColor: string
  penWidth: number
  onAppendStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onUpdatePlacement: (memoId: string, placement: TimelineMemoPlacement) => void
}) {
  const [interaction, setInteraction] = useState<MemoInteraction | null>(null)
  const interactionRef = useRef<MemoInteraction | null>(null)
  const renderedMemos = useMemo(() => memos
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(memo => interaction?.memo.memoId === memo.memoId ? { ...memo, placement: interaction.previewPlacement } : memo), [interaction, memos])
  const handleW = 18 / Math.max(1, pageSize.widthPx)
  const handleH = 18 / Math.max(1, pageSize.heightPx)
  const edgeW = 1.25 / Math.max(1, pageSize.widthPx)
  const edgeH = 1.25 / Math.max(1, pageSize.heightPx)

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
    if (current.mode === 'draw') {
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
    onUpdatePlacement(current.memo.memoId, current.previewPlacement)
  }

  return (
    <g className="timelineMemoLayer" aria-label="タイムライン手書きメモ">
      {renderedMemos.flatMap(memo => timelineMemoSegmentsForPage(template, page, memo, { paperTracks, layoutOverrides }).map(segment => {
        const selected = memo.memoId === selectedMemoId
        const draftPoints = interaction?.memo.memoId === memo.memoId && interaction.mode === 'draw' ? interaction.points : null
        return (
          <g key={`${memo.memoId}:${segment.regionId}`} data-timeline-memo-id={memo.memoId} className={selected ? 'timelineMemoSegment selected' : 'timelineMemoSegment'}>
            <rect className="timelineMemoHitArea" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />
            {memo.strokes.map(stroke => {
              const path = timelineMemoStrokePath(segment, stroke.points)
              return path ? <path key={stroke.strokeId} className="timelineMemoStroke" d={path} stroke={stroke.color} strokeWidth={stroke.widthUnits * segment.rowHeightY} /> : null
            })}
            {draftPoints && (() => {
              const path = timelineMemoStrokePath(segment, draftPoints)
              return path ? <path className="timelineMemoStroke draft" d={path} stroke={penColor} strokeWidth={Math.max(penWidth, 0.001)} /> : null
            })()}
            {selected && <g className="timelineMemoBoundsEdges">
              <rect className="timelineMemoBounds" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={edgeH} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y + segment.rect.h - edgeH} width={segment.rect.w} height={edgeH} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x} y={segment.rect.y} width={edgeW} height={segment.rect.h} />
              <rect className="timelineMemoBoundsEdge" x={segment.rect.x + segment.rect.w - edgeW} y={segment.rect.y} width={edgeW} height={segment.rect.h} />
            </g>}
            {selected && <rect
              className="timelineMemoDrawSurface"
              x={segment.rect.x + handleW}
              y={segment.rect.y}
              width={Math.max(0, segment.rect.w - handleW)}
              height={segment.rect.h}
              onPointerDown={event => begin(event, memo, segment, 'draw')}
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
              <rect x={segment.rect.x} y={segment.rect.y} width={handleW} height={handleH} />
              <rect className="timelineMemoMoveHandleGlyph" x={segment.rect.x + handleW * 0.2} y={segment.rect.y + handleH * 0.45} width={handleW * 0.6} height={handleH * 0.1} />
              <rect className="timelineMemoMoveHandleGlyph" x={segment.rect.x + handleW * 0.45} y={segment.rect.y + handleH * 0.2} width={handleW * 0.1} height={handleH * 0.6} />
            </g>}
            {selected && segment.endsMemo && <rect
              className="timelineMemoResizeHandle"
              aria-label="メモの大きさを変更"
              x={segment.rect.x + segment.rect.w - handleW}
              y={segment.rect.y + segment.rect.h - handleH}
              width={handleW}
              height={handleH}
              onPointerDown={event => begin(event, memo, segment, 'resize')}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={event => finish(event, true)}
            />}
          </g>
        )
      }))}
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
