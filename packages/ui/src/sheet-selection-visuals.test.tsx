import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SelectedCellCue,
  SheetRangeBoundaryCue,
  SheetRangeFillCue,
  assetAssignedMarkerSize,
  mergeAdjacentRangeRects,
  rangeBoundaryRect,
  selectedCellCornerSize,
} from './sheet-selection-visuals'

afterEach(() => cleanup())

describe('sheet selection visuals', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.2, h: 0.1 }

  it('keeps persistent asset and current-cell cues at screen-pixel sizes', () => {
    const surface = { widthPx: 1000, heightPx: 1500 }
    const assetMarker = assetAssignedMarkerSize(rect, surface)
    const selectedCorner = selectedCellCornerSize(rect, surface)

    expect(assetMarker.width * surface.widthPx).toBeCloseTo(9)
    expect(assetMarker.height * surface.heightPx).toBeCloseTo(9)
    expect(selectedCorner.width * surface.widthPx).toBeCloseTo(8)
    expect(selectedCorner.height * surface.heightPx).toBeCloseTo(8)
  })

  it('clamps cues inside very small frame cells', () => {
    const tinyRect = { x: 0.1, y: 0.2, w: 0.01, h: 0.004 }
    const assetMarker = assetAssignedMarkerSize(tinyRect, { widthPx: 1000, heightPx: 1000 })
    const selectedCorner = selectedCellCornerSize(tinyRect, { widthPx: 1000, heightPx: 1000 })

    expect(assetMarker.width).toBeLessThan(tinyRect.w / 2)
    expect(assetMarker.height).toBeLessThan(tinyRect.h)
    expect(selectedCorner.width).toBeLessThan(tinyRect.w / 2)
    expect(selectedCorner.height).toBeLessThan(tinyRect.h / 2)
  })

  it('merges only touching range columns with the same vertical span', () => {
    const merged = mergeAdjacentRangeRects([
      { x: 0.2, y: 0.3, w: 0.1, h: 0.2 },
      { x: 0.1, y: 0.3, w: 0.1, h: 0.2 },
      { x: 0.35, y: 0.3, w: 0.1, h: 0.2 },
      { x: 0.1, y: 0.6, w: 0.1, h: 0.1 },
    ])

    expect(merged).toHaveLength(3)
    expect(merged[0]).toMatchObject({ x: 0.1, y: 0.3, h: 0.2 })
    expect(merged[0]?.w).toBeCloseTo(0.2)
    expect(merged.slice(1)).toEqual([
      { x: 0.35, y: 0.3, w: 0.1, h: 0.2 },
      { x: 0.1, y: 0.6, w: 0.1, h: 0.1 },
    ])
  })

  it('insets the visible range boundary by one screen pixel', () => {
    const boundary = rangeBoundaryRect(rect, { widthPx: 1000, heightPx: 500 })

    expect((boundary.x - rect.x) * 1000).toBeCloseTo(1)
    expect((boundary.y - rect.y) * 500).toBeCloseTo(1)
    expect((rect.w - boundary.w) * 1000).toBeCloseTo(2)
    expect((rect.h - boundary.h) * 500).toBeCloseTo(2)
  })

  it('renders separate range fill, boundary, corners, and current-cell shapes', () => {
    const surface = { widthPx: 1000, heightPx: 1500 }
    const { container } = render(
      <svg>
        <SheetRangeFillCue rect={rect} draft={false} />
        <SheetRangeBoundaryCue rect={rect} draft={false} surface={surface} />
        <SelectedCellCue rect={rect} surface={surface} />
      </svg>,
    )

    expect(container.querySelector('.selectedRangeRect')).toBeTruthy()
    expect(container.querySelector('.selectedRangeOutline')).toBeTruthy()
    expect(container.querySelector('.selectedRangeCorners')).toBeTruthy()
    expect(Number(container.querySelector('.selectedRangeOutline')?.getAttribute('x'))).toBeGreaterThan(rect.x)
    expect(container.querySelector('.selectedCellCorners')).toBeTruthy()
    expect(container.querySelector('.selectedCellRect')?.getAttribute('stroke')).toBeNull()
  })

  it('keeps the draft fill and outline separate without confirmed-range corners', () => {
    const { container } = render(
      <svg>
        <SheetRangeFillCue rect={rect} draft />
        <SheetRangeBoundaryCue rect={rect} draft surface={{ widthPx: 1000, heightPx: 1500 }} />
      </svg>,
    )

    expect(container.querySelector('.draftRangeRect')).toBeTruthy()
    expect(container.querySelector('.draftRangeOutline')).toBeTruthy()
    expect(container.querySelector('.selectedRangeCorners')).toBeNull()
  })
})
