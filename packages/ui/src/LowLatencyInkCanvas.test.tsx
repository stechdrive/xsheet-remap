import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LowLatencyInkCanvas,
  lowLatencyCanvasPixelRatio,
  useLowLatencyInkCanvas,
} from './LowLatencyInkCanvas'

const originalInkDescriptor = Object.getOwnPropertyDescriptor(navigator, 'ink')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalInkDescriptor) Object.defineProperty(navigator, 'ink', originalInkDescriptor)
  else Reflect.deleteProperty(navigator, 'ink')
})

function InkCanvasHarness() {
  const inkCanvas = useLowLatencyInkCanvas()
  return <LowLatencyInkCanvas
    canvasRef={inkCanvas.canvasRef}
    label="テスト描画"
  />
}

describe('LowLatencyInkCanvas', () => {
  it('caps backing-store resolution for high-DPI full-page canvases', () => {
    expect(lowLatencyCanvasPixelRatio(1000, 1000, 3)).toBe(2)
    expect(lowLatencyCanvasPixelRatio(4000, 4000, 3)).toBe(0.5)
  })

  it('requests delegated ink while retaining the incremental canvas fallback', () => {
    const requestPresenter = vi.fn().mockResolvedValue({
      updateInkTrailStartPoint: vi.fn(),
    })
    Object.defineProperty(navigator, 'ink', {
      configurable: true,
      value: { requestPresenter },
    })

    const { container } = render(<InkCanvasHarness />)
    const canvas = container.querySelector<HTMLCanvasElement>('canvas')!

    expect(requestPresenter).toHaveBeenCalledWith({ presentationArea: canvas })
    expect(canvas.dataset.inkRenderMode).toBe('incremental-canvas')
    expect(canvas.dataset.inkActive).toBe('false')
  })
})
