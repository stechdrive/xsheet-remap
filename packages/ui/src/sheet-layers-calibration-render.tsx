import { memo, useId, useMemo, type PointerEvent } from 'react'
import { type CutProject, type NormalizedPoint, type SheetCalibrationPointPair, type SheetPage, type SheetTemplate, type SheetTemplateLayoutResolveOptions } from '@xsheet-remap/core'
import { type SheetImageSettings } from './appTypes'
import { buildTemplateChromeRenderModel, buildTemplateGridOverlayRenderModel } from './templateEditorGeometry'
import { metadataTextRenderItemsForPage, workRangeShadeRenderItemsForPage, type SheetRenderModelContext } from './sheetRenderModel'
import { rawImageToViewportPoint } from './sheetImages'
import { clampNumber } from './sheetInteraction'
import { SheetSvgText } from './SheetSvgText'
import { sheetSvgTextX } from './sheetSvgTextGeometry'
import { GridOverlayLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { AutoCalibrationOverlayState, CalibrationGuideMetrics, CalibrationPointKind } from './app-foundation'

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
  timelineLanes,
  durationFrames = template.defaults.durationFrames,
  layoutOverrides,
  showLines = true,
  showLabels = true,
}: {
  template: SheetTemplate
  paperTracks?: string[]
  timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']
  durationFrames?: number
  layoutOverrides?: CutProject['sheetView']['layoutOverrides']
  showLines?: boolean
  showLabels?: boolean
}) {
  const model = useMemo(
    () => buildTemplateChromeRenderModel(template, paperTracks, durationFrames, { timelineLanes, layoutOverrides }),
    [durationFrames, layoutOverrides, paperTracks, template, timelineLanes],
  )
  return <TemplateChromeLayer model={model} showLines={showLines} showLabels={showLabels} />
})

export const GridOverlay = memo(function GridOverlay({
  template,
  region,
  paperTracks = template.defaults.paperTracks,
  timelineLanes,
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
  timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']
  durationFrames?: number
  frameOrigin?: number
  pageFrameStart?: number
  layoutOverrides?: CutProject['sheetView']['layoutOverrides']
  showLines?: boolean
  showLabels?: boolean
}) {
  const model = useMemo(
    () => buildTemplateGridOverlayRenderModel(template, region, { paperTracks, timelineLanes, durationFrames, frameOrigin, pageFrameStart, layoutOverrides }),
    [durationFrames, frameOrigin, layoutOverrides, pageFrameStart, paperTracks, region, template, timelineLanes],
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
            <rect x={item.clipRect.x} y={item.clipRect.y} width={item.clipRect.w} height={item.clipRect.h} />
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
  context,
  page,
}: {
  context: SheetRenderModelContext
  page: SheetPage
}) {
  const items = workRangeShadeRenderItemsForPage(context, page)
  return (
    <g>
      {items.map(item => (
        <rect key={`${item.regionId}:${item.rect.y}`} className="inactiveFrameRect" x={item.rect.x} y={item.rect.y} width={item.rect.w} height={item.rect.h} />
      ))}
    </g>
  )
}
