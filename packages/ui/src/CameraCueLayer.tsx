import type { PointerEvent } from 'react'
import type { SheetPage, SheetTemplate, SheetViewLayoutOverrides, TimedRangeCue } from '@xsheet-remap/core'
import { cameraCueLabelLayoutForPage, cameraCueSegmentsForPage, type CameraCueLabelLayout, type CameraCueSegment } from './cameraCueGeometry'
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
  const cueSegments = new Map(cues.map(cue => [cue.cueId, cameraCueSegmentsForPage(template, page, cue, { paperTracks, layoutOverrides })]))
  const labelLayouts = new Map<string, CameraCueLabelLayout>()
  const occupiedLabels: CameraCueLabelLayout[] = []
  for (const cue of cues) {
    const segments = cueSegments.get(cue.cueId) ?? []
    const obstacles = [
      ...cues.filter(other => other.cueId !== cue.cueId).flatMap(other => cueSegments.get(other.cueId)?.map(segment => segment.rect) ?? []),
      ...occupiedLabels.map(layout => layout.rect),
    ]
    const layout = cameraCueLabelLayoutForPage(template, page, cue, pageSize, segments, obstacles)
    if (layout) {
      labelLayouts.set(cue.cueId, layout)
      occupiedLabels.push(layout)
    }
  }
  const edgeHeight = 8 / Math.max(1, surface.heightPx)
  const markerWidth = 10 / Math.max(1, surface.widthPx)
  const markerHeight = 9 / Math.max(1, surface.heightPx)
  const pivotRadiusX = 5 / Math.max(1, surface.widthPx)
  const pivotRadiusY = 5 / Math.max(1, surface.heightPx)

  return (
    <g className="cameraCueLayer">
      {cues.flatMap(cue => (cueSegments.get(cue.cueId) ?? []).map(segment => {
        const selected = selectedCueId === cue.cueId
        const centerX = segment.rect.x + segment.rect.w / 2
        const camera = cue.camera ?? { shape: 'range' as const, startLabel: '', endLabel: '' }
        const overlapPaths = camera.shape === 'overlap' ? buildOverlapPaths(cue, segment) : null
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
            onDoubleClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onDoubleClick(cue.cueId)
            }}
          >
            <rect className="cameraCueHitBody" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} onPointerDown={event => onPointerDown(event, cue, 'move')} />
            {camera.shape === 'range' && <line className="cameraCueStroke" x1={centerX} y1={segment.rect.y} x2={centerX} y2={segment.rect.y + segment.rect.h} />}
            {(camera.shape === 'fade-in' || camera.shape === 'fade-out') && <path className="cameraCueFade" d={buildFadePath(cue, segment, camera.shape)} />}
            {overlapPaths?.map((points, index) => <polyline key={index} className="cameraCueStroke" points={points.map(point => `${point.x},${point.y}`).join(' ')} />)}
            {segment.startsCue && (
              <polygon className="cameraCueMarker start" points={`${centerX - markerWidth / 2},${segment.rect.y} ${centerX + markerWidth / 2},${segment.rect.y} ${centerX},${segment.rect.y + markerHeight}`} />
            )}
            {segment.endsCue && (
              <polygon className="cameraCueMarker end" points={`${centerX - markerWidth / 2},${segment.rect.y + segment.rect.h} ${centerX + markerWidth / 2},${segment.rect.y + segment.rect.h} ${centerX},${segment.rect.y + segment.rect.h - markerHeight}`} />
            )}
            {segment.startsCue && camera.startLabel && <EndpointLabel value={camera.startLabel} x={centerX + markerWidth * 0.75} y={segment.rect.y + markerHeight * 0.6} pageSize={pageSize} />}
            {segment.endsCue && camera.endLabel && <EndpointLabel value={camera.endLabel} x={centerX + markerWidth * 0.75} y={segment.rect.y + segment.rect.h - markerHeight * 0.25} pageSize={pageSize} />}
            {selected && camera.shape === 'overlap' && camera.pivotFrame !== undefined && camera.pivotFrame >= segment.frameStart && camera.pivotFrame <= segment.frameEnd && (
              <ellipse
                className="cameraCuePivotHandle"
                cx={centerX}
                cy={segment.rect.y + (camera.pivotFrame - segment.frameStart + 0.5) * segment.rowHeight}
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
      {[...labelLayouts].map(([cueId, layout]) => {
        const cue = cues.find(item => item.cueId === cueId)
        if (!cue) return null
        const selected = selectedCueId === cueId
        const resizeWidth = 9 / Math.max(1, surface.widthPx)
        const resizeHeight = 9 / Math.max(1, surface.heightPx)
        return (
          <g
            key={`label:${cueId}`}
            className={`cameraCueLabel${selected ? ' selected' : ''}${layout.manual ? ' manual' : ''}`}
            data-camera-cue-id={cueId}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerEnter={event => onPointerEnter(event, cueId)}
            onPointerLeave={onPointerLeave}
          >
            <rect className="cameraCueLabelBody" x={layout.rect.x} y={layout.rect.y} width={layout.rect.w} height={layout.rect.h} onPointerDown={event => onPointerDown(event, cue, 'move-label', { labelLayout: layout })} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onDoubleClick(cueId) }} />
            <g transform={`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`} className="cameraCueLabelText">
              {layout.glyphs.map((glyph, index) => <text key={index} x={glyph.xPx} y={glyph.yPx} fontSize={layout.fontSizePx} textAnchor="middle">{glyph.value}</text>)}
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

function buildFadePath(cue: TimedRangeCue, segment: CameraCueSegment, shape: 'fade-in' | 'fade-out'): string {
  const duration = Math.max(1, cue.frameEnd - cue.frameStart + 1)
  const topProgress = (segment.frameStart - cue.frameStart) / duration
  const bottomProgress = (segment.frameEnd + 1 - cue.frameStart) / duration
  const widthAt = (progress: number) => segment.rect.w * (shape === 'fade-in' ? progress : 1 - progress)
  const topWidth = widthAt(topProgress)
  const bottomWidth = widthAt(bottomProgress)
  const centerX = segment.rect.x + segment.rect.w / 2
  const top = segment.rect.y
  const bottom = segment.rect.y + segment.rect.h
  return `M ${centerX - topWidth / 2} ${top} L ${centerX + topWidth / 2} ${top} L ${centerX + bottomWidth / 2} ${bottom} L ${centerX - bottomWidth / 2} ${bottom} Z`
}

function buildOverlapPaths(cue: TimedRangeCue, segment: CameraCueSegment): Array<Array<{ x: number; y: number }>> {
  const startBoundary = cue.frameStart
  const endBoundary = cue.frameEnd + 1
  const pivotBoundary = Math.max(startBoundary, Math.min(endBoundary, (cue.camera?.pivotFrame ?? Math.round((cue.frameStart + cue.frameEnd) / 2)) + 0.5))
  const segmentStart = segment.frameStart
  const segmentEnd = segment.frameEnd + 1
  return [false, true].map(reverse => {
    const boundaries = [segmentStart, ...(pivotBoundary > segmentStart && pivotBoundary < segmentEnd ? [pivotBoundary] : []), segmentEnd]
    return boundaries.map(boundary => {
      const firstHalf = boundary <= pivotBoundary
      const denominator = Math.max(0.5, firstHalf ? pivotBoundary - startBoundary : endBoundary - pivotBoundary)
      const progress = Math.max(0, Math.min(1, firstHalf ? (boundary - startBoundary) / denominator : (boundary - pivotBoundary) / denominator))
      const base = firstHalf ? progress : 1 - progress
      const xRatio = reverse ? 1 - base : base
      const yRatio = (boundary - segmentStart) / Math.max(1, segmentEnd - segmentStart)
      return { x: segment.rect.x + segment.rect.w * xRatio, y: segment.rect.y + segment.rect.h * yRatio }
    })
  })
}
