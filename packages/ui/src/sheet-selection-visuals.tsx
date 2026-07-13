import type { NormalizedRect } from '@xsheet-remap/core'

export type SheetSelectionSurface = {
  widthPx: number
  heightPx: number
}

const ASSET_MARKER_SIZE_PX = 9
const SELECTED_CORNER_SIZE_PX = 8
const RANGE_PATTERN_TILE_PX = 8

function safeSurfaceSize(value: number): number {
  return Math.max(1, value)
}

export function sheetRangePatternId(pageId: string): string {
  const encoded = Array.from(pageId, character => /[A-Za-z0-9_-]/.test(character)
    ? character
    : `_${character.codePointAt(0)?.toString(16) ?? '0'}_`).join('')
  return `sheet-range-pattern-${encoded}`
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

export function SheetRangePatternDefs({
  patternId,
  surface,
}: {
  patternId: string
  surface: SheetSelectionSurface
}) {
  const width = safeSurfaceSize(surface.widthPx)
  const height = safeSurfaceSize(surface.heightPx)
  const tileWidth = RANGE_PATTERN_TILE_PX / width
  const tileHeight = RANGE_PATTERN_TILE_PX / height
  const slashPath = [
    `M ${1.5 / width} ${6.5 / height}`,
    `L ${4 / width} ${4 / height}`,
  ].join(' ')
  return (
    <defs>
      <pattern id={patternId} patternUnits="userSpaceOnUse" width={tileWidth} height={tileHeight}>
        <path className="selectedRangePatternMark" d={slashPath} />
      </pattern>
    </defs>
  )
}

export function SheetRangeCue({
  rect,
  draft,
  patternId,
}: {
  rect: NormalizedRect
  draft: boolean
  patternId: string
}) {
  return (
    <rect
      className={draft ? 'draftRangeRect' : 'selectedRangeRect'}
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      fill={draft ? undefined : `url(#${patternId})`}
    />
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
