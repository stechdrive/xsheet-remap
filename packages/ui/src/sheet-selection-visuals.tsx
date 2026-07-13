import type { NormalizedRect } from '@xsheet-remap/core'

export type SheetSelectionSurface = {
  widthPx: number
  heightPx: number
}

const ASSET_MARKER_SIZE_PX = 9
const SELECTED_CORNER_SIZE_PX = 8
const RANGE_BOUNDARY_INSET_PX = 1
const RANGE_MERGE_EPSILON = 0.00001

function safeSurfaceSize(value: number): number {
  return Math.max(1, value)
}

export function assetAssignedMarkerSize(rect: NormalizedRect, surface: SheetSelectionSurface) {
  return {
    width: Math.min(rect.w * 0.46, ASSET_MARKER_SIZE_PX / safeSurfaceSize(surface.widthPx)),
    height: Math.min(rect.h * 0.52, ASSET_MARKER_SIZE_PX / safeSurfaceSize(surface.heightPx)),
  }
}

export function assetAssignedMarkerPoints(rect: NormalizedRect, surface: SheetSelectionSurface): string {
  const { width, height } = assetAssignedMarkerSize(rect, surface)
  const right = rect.x + rect.w
  const bottom = rect.y + height
  return [
    `${right - width},${rect.y}`,
    `${right},${rect.y}`,
    `${right},${bottom}`,
    `${right - width * 0.34},${rect.y + height * 0.62}`,
  ].join(' ')
}

export function selectedCellCornerSize(rect: NormalizedRect, surface: SheetSelectionSurface) {
  return {
    width: Math.min(rect.w * 0.32, SELECTED_CORNER_SIZE_PX / safeSurfaceSize(surface.widthPx)),
    height: Math.min(rect.h * 0.32, SELECTED_CORNER_SIZE_PX / safeSurfaceSize(surface.heightPx)),
  }
}

export function selectedCellCornerPath(rect: NormalizedRect, surface: SheetSelectionSurface): string {
  const { width, height } = selectedCellCornerSize(rect, surface)
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  return [
    `M ${left + width} ${top} H ${left} V ${top + height}`,
    `M ${right - width} ${top} H ${right} V ${top + height}`,
    `M ${left + width} ${bottom} H ${left} V ${bottom - height}`,
    `M ${right - width} ${bottom} H ${right} V ${bottom - height}`,
  ].join(' ')
}

export function mergeAdjacentRangeRects(rects: NormalizedRect[]): NormalizedRect[] {
  const sorted = rects
    .filter(rect => rect.w > 0 && rect.h > 0)
    .map(rect => ({ ...rect }))
    .sort((left, right) => left.y - right.y || left.h - right.h || left.x - right.x)
  const merged: NormalizedRect[] = []

  for (const rect of sorted) {
    const previous = merged.at(-1)
    const sameVerticalSpan = previous
      && Math.abs(previous.y - rect.y) <= RANGE_MERGE_EPSILON
      && Math.abs(previous.h - rect.h) <= RANGE_MERGE_EPSILON
    const touchesPrevious = previous
      && rect.x <= previous.x + previous.w + RANGE_MERGE_EPSILON
      && rect.x + rect.w >= previous.x - RANGE_MERGE_EPSILON
    if (previous && sameVerticalSpan && touchesPrevious) {
      const right = Math.max(previous.x + previous.w, rect.x + rect.w)
      previous.x = Math.min(previous.x, rect.x)
      previous.w = right - previous.x
      continue
    }
    merged.push(rect)
  }

  return merged
}

export function rangeBoundaryRect(
  rect: NormalizedRect,
  surface: SheetSelectionSurface,
): NormalizedRect {
  const insetX = Math.min(RANGE_BOUNDARY_INSET_PX / safeSurfaceSize(surface.widthPx), rect.w * 0.24)
  const insetY = Math.min(RANGE_BOUNDARY_INSET_PX / safeSurfaceSize(surface.heightPx), rect.h * 0.24)
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    w: Math.max(0, rect.w - insetX * 2),
    h: Math.max(0, rect.h - insetY * 2),
  }
}

export function SheetRangeFillCue({
  rect,
  draft,
}: {
  rect: NormalizedRect
  draft: boolean
}) {
  return (
    <rect
      className={draft ? 'draftRangeRect' : 'selectedRangeRect'}
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
    />
  )
}

export function SheetRangeBoundaryCue({
  rect,
  draft,
  surface,
}: {
  rect: NormalizedRect
  draft: boolean
  surface: SheetSelectionSurface
}) {
  const boundary = rangeBoundaryRect(rect, surface)
  return (
    <g className={draft ? 'draftRangeBoundary' : 'selectedRangeBoundary'}>
      <rect
        className={draft ? 'draftRangeOutline' : 'selectedRangeOutline'}
        x={boundary.x}
        y={boundary.y}
        width={boundary.w}
        height={boundary.h}
      />
      {!draft && <path className="selectedRangeCorners" d={selectedCellCornerPath(boundary, surface)} />}
    </g>
  )
}

export function AssetAssignedFrameCue({
  rect,
  surface,
}: {
  rect: NormalizedRect
  surface: SheetSelectionSurface
}) {
  return <polygon className="assetAssignedEventMarker" points={assetAssignedMarkerPoints(rect, surface)} />
}

export function SelectedCellCue({
  rect,
  surface,
}: {
  rect: NormalizedRect
  surface: SheetSelectionSurface
}) {
  return (
    <g className="selectedCellOverlay">
      <rect className="selectedCellRect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      <path className="selectedCellCorners" d={selectedCellCornerPath(rect, surface)} />
    </g>
  )
}

export function SheetDropTargetCue({
  rect,
  surface,
  validity,
}: {
  rect: NormalizedRect
  surface: SheetSelectionSurface
  validity: 'valid' | 'invalid'
}) {
  const boundary = rangeBoundaryRect(rect, surface)
  return (
    <g className="sheetDropTargetCue" data-drop-validity={validity}>
      <rect className="sheetDropTargetFill" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      <rect className="sheetDropTargetOutline" x={boundary.x} y={boundary.y} width={boundary.w} height={boundary.h} />
      <path className="sheetDropTargetCorners" d={selectedCellCornerPath(boundary, surface)} />
    </g>
  )
}
