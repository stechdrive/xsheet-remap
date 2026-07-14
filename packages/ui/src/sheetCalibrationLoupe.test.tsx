import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { standardA3SheetTemplate, type SheetCalibrationPointPair } from '@xsheet-remap/core'
import type { SheetPrecisionWarp } from './appTypes'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'

describe('CalibrationLoupeDialog precision correction', () => {
  it('silently applies safe template-adaptive correction after normal correction', async () => {
    const onApply = vi.fn()
    const onApplyPrecision = vi.fn()
    const onAnalyze = vi.fn(async () => precisionWarp())
    render(
      <CalibrationLoupeDialog
        imageUrl="data:image/png;base64,unused"
        template={standardA3SheetTemplate}
        points={calibrationPoints()}
        autoCalibrationRunning={false}
        autoCalibrationMessage={null}
        onAutoDetect={() => undefined}
        onApply={onApply}
        onClose={() => undefined}
        precisionCorrection={{
          basicApplied: false,
          onAnalyze,
          onApply: onApplyPrecision,
          closeOnApply: false,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '補正を適用' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onApplyPrecision).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ version: 1 })))
  })
})

function calibrationPoints(): SheetCalibrationPointPair[] {
  return [
    { pointId: 'tl', label: '1', source: { x: 0.1, y: 0.1 }, target: { x: 0.1, y: 0.1 } },
    { pointId: 'tr', label: '2', source: { x: 0.9, y: 0.1 }, target: { x: 0.9, y: 0.1 } },
    { pointId: 'br', label: '3', source: { x: 0.9, y: 0.9 }, target: { x: 0.9, y: 0.9 } },
    { pointId: 'bl', label: '4', source: { x: 0.1, y: 0.9 }, target: { x: 0.1, y: 0.9 } },
  ]
}

function precisionWarp(): SheetPrecisionWarp {
  return {
    version: 1,
    bounds: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    columns: 2,
    rows: 2,
    offsets: [0, 0, 0, 0, 0, 0, 0, 0],
    diagnostics: {
      totalAnchorCount: 32,
      matchedAnchorCount: 28,
      inlierCount: 24,
      coverage: 0.75,
      confidence: 0.9,
      rmsBeforePx: 1.2,
      rmsAfterPx: 0.4,
      maxDisplacementPx: 2.3,
    },
  }
}
