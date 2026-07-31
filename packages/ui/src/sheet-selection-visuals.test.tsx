import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SelectedCellCue,
  SheetDropTargetCue,
  SheetRangeBoundaryCue,
  SheetRangeFillCue,
  SheetSelectionOutline,
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

  it('renders a reusable selection outline with a fixed screen-space stroke', () => {
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <SheetSelectionOutline rect={rect} className="customSelection" />
      </svg>,
    )

    const outline = container.querySelector('.sheetSelectionOutline')
    const halo = container.querySelector('.sheetSelectionOutlineHalo')
    expect(outline?.classList.contains('customSelection')).toBe(true)
    expect(outline?.getAttribute('x')).toBe(String(rect.x))
    expect(outline?.getAttribute('width')).toBe(String(rect.w))
    expect(outline?.getAttribute('stroke')).toBe('currentColor')
    expect(outline?.getAttribute('stroke-width')).toBe('2px')
    expect(outline?.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    expect(halo?.getAttribute('stroke')).toBe('#fffdf8')
    expect(halo?.getAttribute('stroke-width')).toBe('4px')
    expect(halo?.getAttribute('vector-effect')).toBe('non-scaling-stroke')
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
    expect(container.querySelector('.selectedCellOutline')).toBeTruthy()
    expect(Number(container.querySelector('.selectedCellOutline')?.getAttribute('x'))).toBeGreaterThan(rect.x)
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

  it('renders valid and invalid drop targets as separate fill and one-pixel inset boundary cues', () => {
    const surface = { widthPx: 1000, heightPx: 500 }
    const { container, rerender } = render(
      <svg>
        <SheetDropTargetCue rect={rect} surface={surface} validity="valid" />
      </svg>,
    )

    const validCue = container.querySelector('.sheetDropTargetCue')
    const outline = container.querySelector('.sheetDropTargetOutline')
    expect(validCue?.getAttribute('data-drop-validity')).toBe('valid')
    expect(container.querySelector('.sheetDropTargetFill')).toBeTruthy()
    expect(container.querySelector('.sheetDropTargetCorners')).toBeTruthy()
    expect((Number(outline?.getAttribute('x')) - rect.x) * surface.widthPx).toBeCloseTo(1)
    expect((Number(outline?.getAttribute('y')) - rect.y) * surface.heightPx).toBeCloseTo(1)

    rerender(
      <svg>
        <SheetDropTargetCue rect={rect} surface={surface} validity="invalid" />
      </svg>,
    )
    expect(container.querySelector('.sheetDropTargetCue')?.getAttribute('data-drop-validity')).toBe('invalid')
  })
})
