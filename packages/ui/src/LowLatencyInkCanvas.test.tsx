import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LowLatencyInkCanvas,
  lowLatencyCanvasPixelRatio,
  shouldUseDelegatedInk,
  useLowLatencyInkCanvas,
} from './LowLatencyInkCanvas'

const originalInkDescriptor = Object.getOwnPropertyDescriptor(navigator, 'ink')
const originalUserAgentDataDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgentData')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalInkDescriptor) Object.defineProperty(navigator, 'ink', originalInkDescriptor)
  else Reflect.deleteProperty(navigator, 'ink')
  if (originalUserAgentDataDescriptor) {
    Object.defineProperty(navigator, 'userAgentData', originalUserAgentDataDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'userAgentData')
  }
})

type InkCanvasController = ReturnType<typeof useLowLatencyInkCanvas>

function InkCanvasHarness({
  onReady,
}: {
  onReady?: (controller: InkCanvasController) => void
}) {
  const inkCanvas = useLowLatencyInkCanvas()
  onReady?.(inkCanvas)
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

  it('disables delegated ink on Android and other mobile browsers', () => {
    expect(shouldUseDelegatedInk({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-X620)',
    })).toBe(false)
    expect(shouldUseDelegatedInk({
      userAgent: 'Mozilla/5.0',
      userAgentData: { mobile: true },
    })).toBe(false)
    expect(shouldUseDelegatedInk({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      userAgentData: { mobile: false },
    })).toBe(true)
  })

  it('keeps the transparent overlay hidden until drawing is initialized', () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const requestPresenter = vi.fn().mockReturnValue(new Promise(() => undefined))
    Object.defineProperty(navigator, 'ink', {
      configurable: true,
      value: { requestPresenter },
    })

    let controller: InkCanvasController | null = null
    const { container } = render(<InkCanvasHarness onReady={value => { controller = value }} />)
    const canvas = container.querySelector<HTMLCanvasElement>('canvas')!

    expect(canvas.dataset.inkRenderMode).toBe('incremental-canvas')
    expect(canvas.dataset.inkActive).toBe('false')
    expect(canvas.hidden).toBe(true)
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)
    expect(requestPresenter).not.toHaveBeenCalled()

    act(() => {
      controller!.begin({
        width: 1000,
        height: 1600,
        color: '#123456',
        lineWidth: 2,
        point: { x: 10, y: 12 },
        pointerEvent: { pointerType: 'pen' } as globalThis.PointerEvent,
      })
    })

    expect(getContext).toHaveBeenCalledWith('2d', { alpha: true })
    expect(requestPresenter).toHaveBeenCalledWith({ presentationArea: canvas })
    expect(canvas.dataset.inkActive).toBe('true')
    expect(canvas.hidden).toBe(false)

    act(() => controller!.clear())

    expect(canvas.dataset.inkActive).toBe('false')
    expect(canvas.hidden).toBe(true)
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)

    act(() => {
      controller!.begin({
        width: 1000,
        height: 1600,
        color: '#123456',
        lineWidth: 2,
        point: { x: 20, y: 24 },
        pointerEvent: { pointerType: 'pen' } as globalThis.PointerEvent,
      })
    })

    expect(requestPresenter).toHaveBeenCalledTimes(1)
  })

  it('does not request delegated ink when drawing starts on a mobile browser', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const requestPresenter = vi.fn()
    Object.defineProperty(navigator, 'ink', {
      configurable: true,
      value: { requestPresenter },
    })
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { mobile: true },
    })

    let controller: InkCanvasController | null = null
    render(<InkCanvasHarness onReady={value => { controller = value }} />)

    act(() => {
      controller!.begin({
        width: 1000,
        height: 1600,
        color: '#123456',
        lineWidth: 2,
        point: { x: 10, y: 12 },
        pointerEvent: { pointerType: 'pen' } as globalThis.PointerEvent,
      })
    })

    expect(requestPresenter).not.toHaveBeenCalled()
  })
})
