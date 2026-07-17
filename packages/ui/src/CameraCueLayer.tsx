import type { PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimedRangeCue } from '@xsheet-remap/core'
import {
  buildCameraCuePageLayouts,
  cameraFadePolygonForSegment,
  cameraOverlapPivotMarkForSegment,
  cameraOverlapPathsForSegment,
  type CameraCueLabelLayout,
} from './cameraCueGeometry'
import type { SheetSelectionSurface } from './sheet-selection-visuals'

export type CameraCueDragMode = 'move' | 'resize-start' | 'resize-end' | 'pivot' | 'move-label' | 'resize-label'

export interface CameraCueDragGeometry {
  labelLayout?: CameraCueLabelLayout
}

export function CameraCueLayer({ cues, template, page, paperTracks, layoutOverrides, pageSize, surface, selectedCueId, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onPointerEnter, onPointerLeave }: {
  cues: TimedRangeCue[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: SheetSelectionSurface
  selectedCueId: string | null
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
  const markerWidth = 10 / Math.max(1, surface.widthPx)
  const markerHeight = 9 / Math.max(1, surface.heightPx)
  const pivotRadiusX = 5 / Math.max(1, surface.widthPx)
  const pivotRadiusY = 5 / Math.max(1, surface.heightPx)

  return (
    <g className="cameraCueLayer">
      {pageLayouts.flatMap(({ cue, segments }) => segments.map(segment => {
        const selected = selectedCueId === cue.cueId
        const centerX = segment.rect.x + segment.rect.w / 2
        const camera = cue.camera ?? { shape: 'range' as const, startLabel: '', endLabel: '' }
        const fadePoints = camera.shape === 'fade-in' || camera.shape === 'fade-out'
          ? cameraFadePolygonForSegment(cue, segment, camera.shape)
          : null
        const fadePath = fadePoints ? `${fadePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z` : null
        const overlapPaths = camera.shape === 'overlap' ? cameraOverlapPathsForSegment(cue, segment) : null
        const overlapPivotMark = camera.shape === 'overlap' ? cameraOverlapPivotMarkForSegment(cue, segment) : null
        return (
          <g
            key={`${cue.cueId}:${segment.regionId}:${segment.frameStart}`}
            className={`cameraCue ${camera.shape}${selected ? ' selected' : ''}`}
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
            {camera.shape === 'range' && <line className="cameraCueStroke" x1={centerX} y1={segment.rect.y} x2={centerX} y2={segment.rect.y + segment.rect.h} />}
            {camera.shape === 'range' && <line className="cameraCueShapeHit" x1={centerX} y1={segment.rect.y} x2={centerX} y2={segment.rect.y + segment.rect.h} onPointerDown={event => onPointerDown(event, cue, 'move')} />}
            {fadePath && <path className="cameraCueFade" d={fadePath} />}
            {fadePath && <path className="cameraCueShapeHit" d={fadePath} onPointerDown={event => onPointerDown(event, cue, 'move')} />}
            {overlapPaths?.map((points, index) => <polyline key={`stroke-${index}`} className="cameraCueStroke" points={points.map(point => `${point.x},${point.y}`).join(' ')} />)}
            {overlapPaths?.map((points, index) => <polyline key={`hit-${index}`} className="cameraCueShapeHit" points={points.map(point => `${point.x},${point.y}`).join(' ')} onPointerDown={event => onPointerDown(event, cue, 'move')} />)}
            {overlapPivotMark && <line className="cameraCuePivotMarkHalo" x1={overlapPivotMark.x1} y1={overlapPivotMark.y} x2={overlapPivotMark.x2} y2={overlapPivotMark.y} />}
            {overlapPivotMark && <line className="cameraCuePivotMark" x1={overlapPivotMark.x1} y1={overlapPivotMark.y} x2={overlapPivotMark.x2} y2={overlapPivotMark.y} />}
            {camera.shape === 'range' && segment.startsCue && (
              <polygon className="cameraCueMarker start" points={`${centerX - markerWidth / 2},${segment.rect.y} ${centerX + markerWidth / 2},${segment.rect.y} ${centerX},${segment.rect.y + markerHeight}`} />
            )}
            {camera.shape === 'range' && segment.endsCue && (
              <polygon className="cameraCueMarker end" points={`${centerX - markerWidth / 2},${segment.rect.y + segment.rect.h} ${centerX + markerWidth / 2},${segment.rect.y + segment.rect.h} ${centerX},${segment.rect.y + segment.rect.h - markerHeight}`} />
            )}
            {segment.startsCue && camera.startLabel && <EndpointLabel value={camera.startLabel} x={centerX + markerWidth * 0.75} y={segment.rect.y + markerHeight * 0.6} pageSize={pageSize} />}
            {segment.endsCue && camera.endLabel && <EndpointLabel value={camera.endLabel} x={centerX + markerWidth * 0.75} y={segment.rect.y + segment.rect.h - markerHeight * 0.25} pageSize={pageSize} />}
            {selected && overlapPivotMark && (
              <ellipse
                className="cameraCuePivotHandle"
                cx={(overlapPivotMark.x1 + overlapPivotMark.x2) / 2}
                cy={overlapPivotMark.y}
                rx={pivotRadiusX}
                ry={pivotRadiusY}
                onPointerDown={event => onPointerDown(event, cue, 'pivot')}
              />
            )}
            {selected && segment.startsCue && <rect className="cameraCueEdgeHandle start" x={segment.rect.x} y={segment.rect.y - edgeHeight / 2} width={segment.rect.w} height={edgeHeight} onPointerDown={event => onPointerDown(event, cue, 'resize-start')} />}
            {selected && segment.endsCue && <rect className="cameraCueEdgeHandle end" x={segment.rect.x} y={segment.rect.y + segment.rect.h - edgeHeight / 2} width={segment.rect.w} height={edgeHeight} onPointerDown={event => onPointerDown(event, cue, 'resize-end')} />}
          </g>
        )
      }))}
      {pageLayouts.map(({ cue, label: layout }) => {
        if (!layout) return null
        const cueId = cue.cueId
        const selected = selectedCueId === cueId
        const resizeWidth = 9 / Math.max(1, surface.widthPx)
        const resizeHeight = 9 / Math.max(1, surface.heightPx)
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
            {selected && (
              <rect className="cameraCueLabelResizeHandle" x={layout.rect.x + layout.rect.w - resizeWidth} y={layout.rect.y + layout.rect.h - resizeHeight} width={resizeWidth} height={resizeHeight} onPointerDown={event => onPointerDown(event, cue, 'resize-label', { labelLayout: layout })} />
            )}
          </g>
        )
      })}
    </g>
  )
}

function EndpointLabel({ value, x, y, pageSize }: { value: string; x: number; y: number; pageSize: { widthPx: number; heightPx: number } }) {
  return <g transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} className="cameraCueEndpointLabel"><text x={x * pageSize.widthPx} y={y * pageSize.heightPx} fontSize={11}>{value}</text></g>
}

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}
