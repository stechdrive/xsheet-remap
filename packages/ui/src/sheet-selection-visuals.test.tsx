import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SelectedCellCue,
  SheetRangeCue,
  SheetRangePatternDefs,
  assetAssignedMarkerSize,
  selectedCellCornerSize,
  sheetRangePatternId,
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

  it('renders distinct pattern, range, and current-cell shapes', () => {
    const patternId = sheetRangePatternId('page:1')
    const { container } = render(
      <svg>
        <SheetRangePatternDefs patternId={patternId} surface={{ widthPx: 1000, heightPx: 1500 }} />
        <SheetRangeCue rect={rect} draft={false} patternId={patternId} />
        <SelectedCellCue rect={rect} surface={{ widthPx: 1000, heightPx: 1500 }} />
      </svg>,
    )

    expect(patternId).toBe('sheet-range-pattern-page_3a_1')
    expect(container.querySelector('pattern')?.id).toBe(patternId)
    expect(container.querySelector('.selectedRangeRect')?.getAttribute('fill')).toBe(`url(#${patternId})`)
    expect(container.querySelector('.selectedCellCorners')).toBeTruthy()
    expect(container.querySelector('.selectedCellRect')?.getAttribute('stroke')).toBeNull()
  })
})
