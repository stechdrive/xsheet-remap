import type { NormalizedRect } from '@xsheet-remap/core'

export type SheetCellCorner = 'top-left' | 'top-right'

export type SheetCellMarkerSurface = {
  widthPx: number
  heightPx: number
}

export const SHEET_CELL_CORNER_MARKER_SIZE_PX = 9
export const SHEET_CELL_CORNER_MARKER_HIT_SIZE_PX = 14

function safeSurfaceSize(value: number): number {
  return Math.max(1, value)
}

export function sheetCellCornerMarkerSize(rect: NormalizedRect, surface: SheetCellMarkerSurface) {
  return {
    width: Math.min(rect.w * 0.46, SHEET_CELL_CORNER_MARKER_SIZE_PX / safeSurfaceSize(surface.widthPx)),
    height: Math.min(rect.h * 0.52, SHEET_CELL_CORNER_MARKER_SIZE_PX / safeSurfaceSize(surface.heightPx)),
  }
}

export function sheetCellCornerMarkerRect(
  rect: NormalizedRect,
  surface: SheetCellMarkerSurface,
  corner: SheetCellCorner,
): NormalizedRect {
  const size = sheetCellCornerMarkerSize(rect, surface)
  return {
    x: corner === 'top-left' ? rect.x : rect.x + rect.w - size.width,
    y: rect.y,
    w: size.width,
    h: size.height,
  }
}

export function sheetCellCornerMarkerHitRect(
  rect: NormalizedRect,
  surface: SheetCellMarkerSurface,
  corner: SheetCellCorner,
): NormalizedRect {
  const marker = sheetCellCornerMarkerRect(rect, surface, corner)
  const width = Math.max(marker.w, SHEET_CELL_CORNER_MARKER_HIT_SIZE_PX / safeSurfaceSize(surface.widthPx))
  const height = Math.max(marker.h, SHEET_CELL_CORNER_MARKER_HIT_SIZE_PX / safeSurfaceSize(surface.heightPx))
  return {
    x: corner === 'top-left' ? rect.x : rect.x + rect.w - width,
    y: rect.y,
    w: width,
    h: height,
  }
}

export function sheetCellCornerTrianglePoints(
  rect: NormalizedRect,
  surface: SheetCellMarkerSurface,
  corner: SheetCellCorner,
): string {
  const marker = sheetCellCornerMarkerRect(rect, surface, corner)
  const left = marker.x
  const right = marker.x + marker.w
  const top = marker.y
  const bottom = marker.y + marker.h
  return corner === 'top-left'
    ? `${left},${top} ${right},${top} ${left},${bottom}`
    : `${left},${top} ${right},${top} ${right},${bottom}`
}
