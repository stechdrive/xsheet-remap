import { memo, useId, useMemo, type PointerEvent } from 'react'
import { type CutProject, type NormalizedPoint, type SheetCalibrationPointPair, type SheetPage, type SheetTemplate, resolveSheetTemplateGridLayout } from '@xsheet-remap/core'
import { type SheetImageSettings } from './appTypes'
import { buildTemplateChromeRenderModel, buildTemplateGridOverlayRenderModel } from './templateEditorGeometry'
import { metadataTextRenderItemsForPage, type SheetRenderModelContext } from './sheetRenderModel'
import { rawImageToViewportPoint } from './sheetImages'
import { clampNumber } from './sheetInteraction'
import { SheetSvgText } from './SheetSvgText'
import { sheetSvgTextX } from './sheetSvgTextGeometry'
import { GridOverlayLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { AutoCalibrationOverlayState, CalibrationGuideMetrics, CalibrationPointKind } from './app-foundation'
import { frameOriginForPageHit } from './sheet-layers-hit-geometry'

export function AutoCalibrationGuideOverlay({
  overlay,
  imageSettings,
}: {
  overlay: AutoCalibrationOverlayState
  imageSettings: SheetImageSettings
}) {
  const detectedPoints = overlay.detectedQuad.map(point => rawImageToViewportPoint(point, imageSettings))
  return (
    <g className="autoCalibrationGuideOverlay" data-method={overlay.method} aria-hidden="true">
      <polygon className="autoCalibrationExpectedQuad" points={normalizedPolygonPoints(overlay.targetQuad)} />
      <polygon className="autoCalibrationDetectedQuad" points={normalizedPolygonPoints(detectedPoints)} />
    </g>
  )
}

function normalizedPolygonPoints(points: NormalizedPoint[]): string {
  return points.map(point => `${point.x},${point.y}`).join(' ')
}

export function CalibrationQuadEditor({
  points,
  imageSettings,
  metrics,
  onHandlePointerDown,
}: {
  points: SheetCalibrationPointPair[]
  imageSettings: SheetImageSettings
  metrics: CalibrationGuideMetrics
  onHandlePointerDown: (event: PointerEvent<SVGElement>, index: number, kind: CalibrationPointKind) => void
}) {
  const sourcePoints = points.map(point => rawImageToViewportPoint(point.source, imageSettings))
  const pointKind: CalibrationPointKind = 'source'

  return (
    <g>
      {sourcePoints.map((point, index) => (
        <g key={points[index].pointId}>
          <path className="calibrationTrimMark source" d={calibrationTrimMarkPath(point, index, metrics)} style={{ strokeWidth: `${metrics.trimStrokePx}px` }} />
          <path className="calibrationHandleMark source" d={calibrationHandlePath(point, metrics)} style={{ strokeWidth: `${metrics.handleStrokePx}px` }} />
          <ellipse
            className="calibrationHandle source"
            cx={point.x}
            cy={point.y}
            rx={metrics.hitRadiusX}
            ry={metrics.hitRadiusY}
            onPointerDown={event => onHandlePointerDown(event, index, pointKind)}
          />
        </g>
      ))}
    </g>
  )
}

export function calibrationGuideMetrics(template: SheetTemplate, pageSize: { widthPx: number; heightPx: number }): CalibrationGuideMetrics {
  const dpi = template.page.dpi ?? 150
  const pxPerMm = dpi / 25.4
  const handleStrokePx = clampNumber(pxPerMm * 0.18, 0.85, 1.35)
  const handleOuterPx = clampNumber(pxPerMm * 1.6, 8, 16)
  const handleInnerPx = clampNumber(pxPerMm * 0.55, 3, 6)
  const trimOuterPx = clampNumber(pxPerMm * 5.5, 24, 48)
  const trimStrokePx = clampNumber(pxPerMm * 0.24, 1.1, 1.8)
  const hitRadiusPx = clampNumber(pxPerMm * 2.2, 12, 24)

  return {
    handleStrokePx,
    handleOuterX: handleOuterPx / pageSize.widthPx,
    handleOuterY: handleOuterPx / pageSize.heightPx,
    handleInnerX: handleInnerPx / pageSize.widthPx,
    handleInnerY: handleInnerPx / pageSize.heightPx,
    trimOuterX: trimOuterPx / pageSize.widthPx,
    trimOuterY: trimOuterPx / pageSize.heightPx,
    trimStrokePx,
    hitRadiusX: hitRadiusPx / pageSize.widthPx,
    hitRadiusY: hitRadiusPx / pageSize.heightPx,
  }
}

function calibrationTrimMarkPath(point: NormalizedPoint, index: number, metrics: CalibrationGuideMetrics): string {
  const horizontalDirection = index === 1 || index === 2 ? -1 : 1
  const verticalDirection = index >= 2 ? -1 : 1
  const xEnd = point.x + metrics.trimOuterX * horizontalDirection
  const yEnd = point.y + metrics.trimOuterY * verticalDirection
  return [
    `M ${point.x} ${point.y} L ${xEnd} ${point.y}`,
    `M ${point.x} ${point.y} L ${point.x} ${yEnd}`,
  ].join(' ')
}

function calibrationHandlePath(point: NormalizedPoint, metrics: CalibrationGuideMetrics): string {
  return [
    `M ${point.x - metrics.handleOuterX} ${point.y} L ${point.x - metrics.handleInnerX} ${point.y}`,
    `M ${point.x + metrics.handleInnerX} ${point.y} L ${point.x + metrics.handleOuterX} ${point.y}`,
    `M ${point.x} ${point.y - metrics.handleOuterY} L ${point.x} ${point.y - metrics.handleInnerY}`,
    `M ${point.x} ${point.y + metrics.handleInnerY} L ${point.x} ${point.y + metrics.handleOuterY}`,
  ].join(' ')
}

export const TemplateChrome = memo(function TemplateChrome({
  template,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
  layoutOverrides,
  showLines = true,
  showLabels = true,
}: {
  template: SheetTemplate
  paperTracks?: string[]
  durationFrames?: number
  layoutOverrides?: CutProject['sheetView']['layoutOverrides']
  showLines?: boolean
  showLabels?: boolean
}) {
  const model = useMemo(
    () => buildTemplateChromeRenderModel(template, paperTracks, durationFrames, { layoutOverrides }),
    [durationFrames, layoutOverrides, paperTracks, template],
  )
  return <TemplateChromeLayer model={model} showLines={showLines} showLabels={showLabels} />
})

export const GridOverlay = memo(function GridOverlay({
  template,
  region,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  pageFrameStart,
  layoutOverrides,
  showLines = true,
  showLabels = true,
}: {
  template: SheetTemplate
  region: SheetTemplate['regions'][number]
  paperTracks?: string[]
  durationFrames?: number
  frameOrigin?: number
  pageFrameStart?: number
  layoutOverrides?: CutProject['sheetView']['layoutOverrides']
  showLines?: boolean
  showLabels?: boolean
}) {
  const model = useMemo(
    () => buildTemplateGridOverlayRenderModel(template, region, { paperTracks, durationFrames, frameOrigin, pageFrameStart, layoutOverrides }),
    [durationFrames, frameOrigin, layoutOverrides, pageFrameStart, paperTracks, region, template],
  )
  return model ? <GridOverlayLayer model={model} showLines={showLines} showLabels={showLabels} /> : null
})

export function MetadataTextLayer({ context, page }: { context: SheetRenderModelContext; page: SheetPage }) {
  const items = metadataTextRenderItemsForPage(context, page)
  const clipPrefix = useId().replace(/:/g, '')
  if (items.length === 0) return null
  return (
    <g className="metadataTextLayer" aria-hidden="true">
      <defs>
        {items.map((item, index) => (
          <clipPath key={`${item.regionId}:clip`} id={`${clipPrefix}-${index}`}>
            <rect x={item.rect.x} y={item.rect.y} width={item.rect.w} height={item.rect.h} />
          </clipPath>
        ))}
      </defs>
      {items.map((item, itemIndex) => (
        <g
          key={item.regionId}
          className={`metadataFieldItem${item.overflow ? ' overflow' : ''}`}
          data-region-id={item.regionId}
          data-text-overflow={item.overflow ? 'true' : 'false'}
          clipPath={`url(#${clipPrefix}-${itemIndex})`}
        >
          {item.overflow && <title>文字が欄内に収まりません。</title>}
          <SheetSvgText
            className="metadataFieldText"
            data-region-id={item.regionId}
            x={item.x}
            y={item.y}
            textAnchor={item.textAnchor}
            dominantBaseline={item.dominantBaseline}
            fontSizePx={item.fontSizePx}
            pageSize={context.pageSize}
            fontWeight={item.fontWeight}
          >
            {item.lines.map((line, index) => (
              <tspan
                key={`${item.regionId}_${index}`}
                x={sheetSvgTextX(item.x, context.pageSize)}
                dy={index === 0 ? 0 : item.lineHeightPx}
              >
                {line}
              </tspan>
            ))}
          </SheetSvgText>
        </g>
      ))}
    </g>
  )
}

export function WorkRangeOverlay({
  template,
  page,
  displayDurationFrames = template.defaults.durationFrames,
  officialFrameStart,
  officialFrameEnd,
}: {
  template: SheetTemplate
  page: SheetPage
  displayDurationFrames?: number
  officialFrameStart: number
  officialFrameEnd: number
}) {
  const frameOrigin = frameOriginForPageHit(template, page)
  const isContinuousFrameAxis = frameOrigin === page.frameStart
  const localFrameToGlobalFrame = (frame: number) => isContinuousFrameAxis
    ? frame
    : page.frameStart + (frame - template.defaults.frameOrigin)
  const globalFrameToLocalFrame = (frame: number) => isContinuousFrameAxis
    ? frame
    : frame - page.frameStart + template.defaults.frameOrigin
  const rects = template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || !region.grid) return []
    const layout = resolveSheetTemplateGridLayout(template, region, { durationFrames: displayDurationFrames, frameOrigin })
    if (!layout) return []
    const frames = layout.frames
    const visibleFrameStart = localFrameToGlobalFrame(frames.frameStart)
    const visibleFrameEnd = localFrameToGlobalFrame(frames.frameEnd)
    const dimRanges = [
      { frameStart: visibleFrameStart, frameEnd: Math.min(visibleFrameEnd, officialFrameStart - 1) },
      { frameStart: Math.max(visibleFrameStart, officialFrameEnd + 1), frameEnd: visibleFrameEnd },
    ].filter(range => range.frameEnd >= range.frameStart)
    return dimRanges.flatMap(range => {
      const localStart = globalFrameToLocalFrame(range.frameStart)
      const localEnd = globalFrameToLocalFrame(range.frameEnd)
      const start = Math.max(frames.frameStart, localStart)
      const end = Math.min(frames.frameEnd, localEnd)
      if (end < start) return []
      const rowIndex = start - frames.frameStart
      const rowCount = end - start + 1
      return [{
        x: layout.rect.x,
        y: layout.rect.y + frames.rowHeight * rowIndex,
        w: layout.rect.w,
        h: frames.rowHeight * rowCount,
      }]
    })
  })
  return (
    <g>
      {rects.map((rect, index) => (
        <rect key={index} className="inactiveFrameRect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </g>
  )
}
