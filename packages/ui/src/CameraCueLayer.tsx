import type { PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimedRangeCue } from '@xsheet-remap/core'
import {
  buildCameraCuePageLayouts,
  cameraFadePolygonForSegment,
  cameraOverlapFillPolygonsForSegment,
  cameraOverlapPivotMarkForSegment,
  cameraOverlapPathsForSegment,
  cameraInstructionSpans,
  cameraCuePointLayoutsForPage,
  cameraRangeMarkerGeometryForSegment,
  cameraRangePathData,
  cameraRangePathsForSegment,
  type CameraCueLabelLayout,
} from './cameraCueGeometry'
import type { SheetSelectionSurface } from './sheet-selection-visuals'
import { SheetTransformHandle } from './SheetTransformHandle'

export type CameraCueDragMode = 'move' | 'resize-start' | 'resize-end' | 'pivot' | 'move-label' | 'resize-label' | 'point'

export interface CameraCueDragGeometry {
  labelLayout?: CameraCueLabelLayout
  pointId?: string
  segmentEndPointId?: string
}

export function CameraCueLayer({ cues, template, page, paperTracks, layoutOverrides, pageSize, surface, selectedCueId, draggingCueId, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onPointerEnter, onPointerLeave }: {
  cues: TimedRangeCue[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: SheetSelectionSurface
  selectedCueId: string | null
  draggingCueId?: string | null
  onPointerDown: (event: PointerEvent<SVGElement>, cue: TimedRangeCue, mode: CameraCueDragMode, geometry?: CameraCueDragGeometry) => void
  onPointerMove: (event: PointerEvent<SVGGElement>) => void
  onPointerUp: (event: PointerEvent<SVGGElement>) => void
  onPointerCancel: (event: PointerEvent<SVGGElement>) => void
  onDoubleClick: (cueId: string) => void
  onPointerEnter: (event: PointerEvent<SVGGElement>, cueId: string) => void
  onPointerLeave: () => void
}) {
  const pageLayouts = buildCameraCuePageLayouts(template, page, cues, pageSize, { paperTracks, layoutOverrides })
  const edgeHeight = 8 / Math.max(1, surface.heightPx)
  const pivotRadiusX = 5 / Math.max(1, surface.widthPx)
  const pivotRadiusY = 5 / Math.max(1, surface.heightPx)

  return (
    <g className="cameraCueLayer">
      {pageLayouts.flatMap(({ cue, segments }) => segments.map(segment => {
        const selected = selectedCueId === cue.cueId
        const camera = cue.camera ?? { shape: 'range' as const, points: [] }
        const instructionSpans = cameraInstructionSpans(cue)
        const intersectsSegment = (span: (typeof instructionSpans)[number]) => span.frameEndExclusive > segment.frameStart && span.frameStart < segment.frameEnd + 1
        const rangePaths = cameraRangePathsForSegment(cue, segment, pageSize)
        const fadeSpans = instructionSpans.filter(span => (span.kind === 'fade-in' || span.kind === 'fade-out') && intersectsSegment(span))
        const overlapSpans = instructionSpans.filter(span => span.kind === 'overlap' && intersectsSegment(span))
        const startKind = instructionSpans[0]?.kind
        const endKind = instructionSpans.at(-1)?.kind
        const marker = cameraRangeMarkerGeometryForSegment(segment, pageSize)
        return (
          <g
            key={`${cue.cueId}:${segment.regionId}:${segment.frameStart}`}
            className={`cameraCue ${camera.shape}${selected ? ' selected' : ''}${draggingCueId === cue.cueId ? ' transforming' : ''}`}
            data-camera-cue-id={cue.cueId}
            data-camera-lane-id={cue.laneId}
            data-frame-start={cue.frameStart}
            data-frame-end={cue.frameEnd}
            aria-label={`${cue.label || 'CAMERA'} ${cue.frameStart}-${cue.frameEnd}`}
            onPointerEnter={event => onPointerEnter(event, cue.cueId)}
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerCancel}
            onDoubleClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onDoubleClick(cue.cueId)
            }}
          >
            {rangePaths.map(path => <path key={`range-stroke-${path.endPointId}`} className={`cameraCueStroke cameraCueRangePath ${path.style}`} d={cameraRangePathData(path.commands)} />)}
            {rangePaths.map(path => <path key={`range-hit-${path.endPointId}`} className="cameraCueShapeHit" d={cameraRangePathData(path.commands)} onPointerDown={event => onPointerDown(event, cue, 'move')} />)}
            {fadeSpans.map(span => {
              const points = cameraFadePolygonForSegment(cue, segment, span.kind as 'fade-in' | 'fade-out', span)
              const d = `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`
              return <g key={`fade-${span.endPointId}`}><path className="cameraCueFade cameraCueFill" d={d} /><path className="cameraCueShapeHit" d={d} onPointerDown={event => onPointerDown(event, cue, 'move')} /></g>
            })}
            {overlapSpans.map(span => {
              const fillPolygons = cameraOverlapFillPolygonsForSegment(cue, segment, span)
              const paths = cameraOverlapPathsForSegment(cue, segment, span)
              const pivotMark = cameraOverlapPivotMarkForSegment(cue, segment, span)
              return <g key={`overlap-${span.endPointId}`}>
                {fillPolygons.map((points, index) => <polygon key={`fill-${index}`} className="cameraCueOverlapFill cameraCueFill" points={pointList(points)} />)}
                {paths.map((points, index) => <polyline key={`stroke-${index}`} className="cameraCueStroke" points={points.map(point => `${point.x},${point.y}`).join(' ')} />)}
                {paths.map((points, index) => <polyline key={`hit-${index}`} className="cameraCueShapeHit" points={points.map(point => `${point.x},${point.y}`).join(' ')} onPointerDown={event => onPointerDown(event, cue, 'move')} />)}
                {pivotMark && <line className="cameraCuePivotMarkHalo" x1={pivotMark.x1} y1={pivotMark.y} x2={pivotMark.x2} y2={pivotMark.y} />}
                {pivotMark && <line className="cameraCuePivotMark" x1={pivotMark.x1} y1={pivotMark.y} x2={pivotMark.x2} y2={pivotMark.y} />}
                {selected && pivotMark && <ellipse className="cameraCuePivotHandle" cx={(pivotMark.x1 + pivotMark.x2) / 2} cy={pivotMark.y} rx={pivotRadiusX} ry={pivotRadiusY} onPointerDown={event => onPointerDown(event, cue, 'pivot', { segmentEndPointId: span.endPointId })} />}
              </g>
            })}
            {(startKind === 'straight' || startKind === 'wave') && segment.startsCue && (
              <polygon className="cameraCueMarker start" points={pointList(marker.start)} />
            )}
            {(endKind === 'straight' || endKind === 'wave') && segment.endsCue && (
              <polygon className="cameraCueMarker end" points={pointList(marker.end)} />
            )}
            {selected && segment.startsCue && <rect className="cameraCueEdgeHandle start" x={segment.rect.x} y={segment.rect.y - edgeHeight / 2} width={segment.rect.w} height={edgeHeight} onPointerDown={event => onPointerDown(event, cue, 'resize-start')} />}
            {selected && segment.endsCue && <rect className="cameraCueEdgeHandle end" x={segment.rect.x} y={segment.rect.y + segment.rect.h - edgeHeight / 2} width={segment.rect.w} height={edgeHeight} onPointerDown={event => onPointerDown(event, cue, 'resize-end')} />}
          </g>
        )
      }))}
      {pageLayouts.flatMap(({ cue, segments }) => cameraCuePointLayoutsForPage(template, cue, segments, pageSize).map(layout => {
        const selected = selectedCueId === cue.cueId
        const movable = layout.point.role === 'intermediate'
        const clipId = `camera-point-clip-${safeSvgId(page.pageId)}-${safeSvgId(cue.cueId)}-${safeSvgId(layout.point.pointId)}`
        return (
          <g
            key={`point:${cue.cueId}:${layout.point.pointId}`}
            className={`cameraCuePoint ${layout.point.role}${selected ? ' selected' : ''}${movable ? ' movable' : ''}`}
            data-camera-cue-id={cue.cueId}
            data-camera-point-id={layout.point.pointId}
            data-camera-point-frame={layout.frame}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerCancel}
            onPointerEnter={event => onPointerEnter(event, cue.cueId)}
            onPointerLeave={onPointerLeave}
            onDoubleClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onDoubleClick(cue.cueId)
            }}
          >
            <defs><clipPath id={clipId}><rect x={layout.regionRect.x} y={layout.regionRect.y} width={layout.regionRect.w} height={layout.regionRect.h} /></clipPath></defs>
            {layout.mark && <line className="cameraCuePivotMarkHalo" x1={layout.mark.x1} y1={layout.mark.y} x2={layout.mark.x2} y2={layout.mark.y} />}
            {layout.mark && <line className="cameraCuePivotMark" x1={layout.mark.x1} y1={layout.mark.y} x2={layout.mark.x2} y2={layout.mark.y} />}
            {layout.connector && <line className="cameraCuePointConnector" x1={layout.connector.from.x} y1={layout.connector.from.y} x2={layout.connector.to.x} y2={layout.connector.to.y} />}
            {selected && movable && <rect className="cameraCuePointBody" x={layout.rect.x} y={layout.rect.y} width={layout.rect.w} height={layout.rect.h} />}
            <rect
              className="cameraCuePointHit"
              x={layout.rect.x}
              y={layout.rect.y}
              width={layout.rect.w}
              height={layout.rect.h}
              onPointerDown={movable ? event => onPointerDown(event, cue, 'point', { pointId: layout.point.pointId }) : undefined}
            />
            {layout.point.label && <g clipPath={`url(#${clipId})`} className="cameraCueEndpointLabel">
              <g transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`}>
                <text x={layout.textXpx} y={layout.textYpx} fontSize={layout.fontSizePx} textAnchor="middle">{layout.point.label}</text>
              </g>
            </g>}
          </g>
        )
      }))}
      {pageLayouts.map(({ cue, label: layout }) => {
        if (!layout) return null
        const cueId = cue.cueId
        const selected = selectedCueId === cueId
        const clipId = `camera-cue-label-clip-${safeSvgId(page.pageId)}-${safeSvgId(cueId)}`
        return (
          <g
            key={`label:${cueId}`}
            className={`cameraCueLabel${selected ? ' selected' : ''}${layout.manual ? ' manual' : ''}${layout.overflow ? ' overflow' : ''}`}
            data-camera-cue-id={cueId}
            data-camera-label-overflow={layout.overflow ? 'true' : 'false'}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onPointerCancel}
            onPointerEnter={event => onPointerEnter(event, cueId)}
            onPointerLeave={onPointerLeave}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={layout.regionRect.x} y={layout.regionRect.y} width={layout.regionRect.w} height={layout.regionRect.h} />
              </clipPath>
            </defs>
            {layout.overflow && <title>CAMERA欄に指示全文を表示できません。指示を短くするか、アンカー付きメモで補足してください。</title>}
            {layout.connector && <line className="cameraCueLabelConnector" x1={layout.connector.from.x} y1={layout.connector.from.y} x2={layout.connector.to.x} y2={layout.connector.to.y} />}
            {selected && <rect className="cameraCueLabelBody" x={layout.rect.x} y={layout.rect.y} width={layout.rect.w} height={layout.rect.h} />}
            <rect className="cameraCueLabelHit" x={layout.rect.x} y={layout.rect.y} width={layout.rect.w} height={layout.rect.h} onPointerDown={event => onPointerDown(event, cue, 'move-label', { labelLayout: layout })} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onDoubleClick(cueId) }} />
            <g clipPath={`url(#${clipId})`}>
              <g transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} className="cameraCueLabelText">
                {layout.glyphs.map((glyph, index) => <text key={index} x={glyph.xPx} y={glyph.yPx} fontSize={layout.fontSizePx} textAnchor="middle">{glyph.value}</text>)}
              </g>
            </g>
            {selected && <SheetTransformHandle
              rect={layout.rect}
              surface={surface}
              kind="resize"
              className="cameraCueLabelResizeHandle"
              label="CAMERAラベルの大きさを変更"
              onPointerDown={event => onPointerDown(event, cue, 'resize-label', { labelLayout: layout })}
            />}
          </g>
        )
      })}
    </g>
  )
}

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function pointList(points: Array<{ x: number; y: number }>): string {
  return points.map(point => `${point.x},${point.y}`).join(' ')
}
