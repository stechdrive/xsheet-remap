import { type DragEvent } from 'react'
import { type CutProject, type SheetHit, type SheetTemplate, getSheetViewLayout, resolveSheetTemplateGridFrames, resolveSheetTemplateRegionRect } from '@xsheet-remap/core'
import { clampNumber, clampSheetZoom, fitZoomForViewport } from './sheetInteraction'
import { CONTINUOUS_CANVAS_MIN_FRAME_ROW_PX, SHEET_AUTO_FIT_MIN_ZOOM } from './app-foundation'
import { rectForHit } from './app-sheet-layers'

export function clampAutoFitSheetZoom(value: number): number {
  return clampSheetZoom(Math.max(value, SHEET_AUTO_FIT_MIN_ZOOM))
}

export function fitSheetZoomForViewport(
  viewport: HTMLElement,
  template: SheetTemplate,
  pageSize: { widthPx: number; heightPx: number },
  durationFrames: number,
  inset: { horizontal: number; vertical: number },
): number | null {
  if (getSheetViewLayout(template).surface?.type !== 'continuous-canvas') {
    return fitZoomForViewport(viewport, pageSize, inset)
  }
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return null
  const availableWidth = Math.max(1, viewport.clientWidth - inset.horizontal)
  const widthZoom = availableWidth / pageSize.widthPx
  const rowHeight = minLogicalFrameRowHeightPx(template, pageSize, durationFrames)
  const rowZoom = rowHeight ? CONTINUOUS_CANVAS_MIN_FRAME_ROW_PX / rowHeight : 0
  return Math.max(widthZoom, rowZoom)
}

export function scrollSheetHitIntoView(
  viewport: HTMLElement,
  svg: SVGSVGElement,
  project: CutProject,
  template: SheetTemplate,
  hit: SheetHit,
) {
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return
  const rect = rectForHit(project, template, hit)
  if (!rect) return
  const viewportRect = viewport.getBoundingClientRect()
  const svgRect = svg.getBoundingClientRect()
  const targetCenterX = viewport.scrollLeft + (svgRect.left - viewportRect.left) + (rect.x + rect.w / 2) * svgRect.width
  const targetCenterY = viewport.scrollTop + (svgRect.top - viewportRect.top) + (rect.y + rect.h / 2) * svgRect.height
  viewport.scrollLeft = clampNumber(targetCenterX - viewport.clientWidth / 2, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth))
  viewport.scrollTop = clampNumber(targetCenterY - viewport.clientHeight / 2, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
}

export function autoScrollViewportForDrag(event: Pick<DragEvent<Element>, 'clientX' | 'clientY'>, viewport: HTMLElement | null) {
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  const edge = 64
  const maxStep = 28
  const dx = dragAutoScrollDelta(event.clientX - rect.left, viewport.clientWidth, edge, maxStep)
  const dy = dragAutoScrollDelta(event.clientY - rect.top, viewport.clientHeight, edge, maxStep)
  if (dx !== 0) viewport.scrollLeft += dx
  if (dy !== 0) viewport.scrollTop += dy
}

function dragAutoScrollDelta(position: number, size: number, edge: number, maxStep: number): number {
  if (size <= 0) return 0
  if (position < 0 || position > size) return 0
  if (position < edge) return -Math.ceil(((edge - position) / edge) * maxStep)
  if (position > size - edge) return Math.ceil(((position - (size - edge)) / edge) * maxStep)
  return 0
}

function minLogicalFrameRowHeightPx(
  template: SheetTemplate,
  pageSize: { widthPx: number; heightPx: number },
  durationFrames: number,
): number | null {
  const rowHeights = template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.frameProjection?.source !== 'logical-frames') return []
    const rect = resolveSheetTemplateRegionRect(template, region, durationFrames)
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, template.defaults.frameOrigin)
    return [(rect.h * pageSize.heightPx) / frames.rowCount]
  })
  return rowHeights.length > 0 ? Math.min(...rowHeights) : null
}
