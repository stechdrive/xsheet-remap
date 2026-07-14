import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { standardA3SheetTemplate, type SheetCalibrationPointPair } from '@xsheet-remap/core'
import type { SheetPrecisionWarp } from './appTypes'
import { CalibrationLoupeDialog } from './sheetCalibrationLoupe'

afterEach(cleanup)

describe('CalibrationLoupeDialog precision correction', () => {
  it('shows automatic detection for review and waits for explicit apply', async () => {
    const onApply = vi.fn()
    const onApplyPrecision = vi.fn()
    const onAnalyze = vi.fn(async () => precisionWarp())
    const onClose = vi.fn()
    const detectedPoints = calibrationPoints().map(point => ({
      ...point,
      source: { x: point.source.x + 0.01, y: point.source.y + 0.01 },
    }))
    const onAutoDetect = vi.fn(async () => detectedPoints)
    render(
      <CalibrationLoupeDialog
        imageUrl="data:image/png;base64,unused"
        template={standardA3SheetTemplate}
        points={calibrationPoints()}
        autoCalibrationRunning={false}
        autoCalibrationMessage={null}
        onAutoDetect={onAutoDetect}
        onApply={onApply}
        onClose={onClose}
        autoDetectOnOpen
        precisionCorrection={{
          onAnalyze,
          onApply: onApplyPrecision,
          closeOnApply: false,
        }}
      />,
    )

    await waitFor(() => expect(onAutoDetect).toHaveBeenCalledTimes(1))
    expect(onApply).not.toHaveBeenCalled()
    expect(onAnalyze).not.toHaveBeenCalled()
    expect(onApplyPrecision).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '四隅合わせ' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '変形適用' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(detectedPoints))
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onApplyPrecision).toHaveBeenCalledWith(detectedPoints, expect.objectContaining({ version: 1 })))
    expect(screen.queryByRole('region', { name: 'テンプレート適応補正' })).toBeNull()
    expect(screen.getByRole('button', { name: '変形適用' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy()
  })

  it('uses normal correction and records evaluation when adaptive correction is unsafe', async () => {
    const onApply = vi.fn()
    const onEvaluated = vi.fn()
    const view = render(
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
          onAnalyze: async () => null,
          onApply: () => undefined,
          onEvaluated,
          closeOnApply: false,
        }}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '変形適用' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onEvaluated).toHaveBeenCalledWith(calibrationPoints()))
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
