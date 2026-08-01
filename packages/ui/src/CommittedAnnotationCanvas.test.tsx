import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommittedAnnotationCanvas } from './CommittedAnnotationCanvas'
import type { PageMemoCanvasStrokeRenderItem } from './pageMemoProjection'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CommittedAnnotationCanvas', () => {
  it('draws committed strokes into one canvas and appends across equivalent projection wrappers', () => {
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const first = strokeItem('first', 'top_memo_area', [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }])
    const second = strokeItem('second', undefined, [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.7 }])
    const { container, rerender } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[first]} />,
    )
    const canvas = container.querySelector('canvas')!

    expect(canvas.dataset.inkRenderMode).toBe('committed-canvas')
    expect(canvas.dataset.annotationStrokeCount).toBe('1')
    expect(canvas.dataset.annotationRegionIds).toBe('top_memo_area')
    expect(context.clearRect).toHaveBeenCalledTimes(1)
    expect(context.stroke).toHaveBeenCalledTimes(1)

    const equivalentFirst = {
      ...first,
      projectionOffset: { ...first.projectionOffset },
      target: first.target ? { ...first.target, rect: { ...first.target.rect } } : null,
    }
    rerender(<CommittedAnnotationCanvas width={1000} height={800} strokes={[equivalentFirst, second]} />)

    expect(canvas.dataset.annotationStrokeCount).toBe('2')
    expect(context.clearRect).toHaveBeenCalledTimes(1)
    expect(context.stroke).toHaveBeenCalledTimes(2)
  })

  it('replays the canvas when projected target geometry changes', () => {
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const initial = strokeItem('first', 'top_memo_area', [{ x: 0.1, y: 0.2 }])
    const moved = {
      ...initial,
      projectionOffset: { x: 0.2, y: 0.3 },
      target: initial.target ? {
        ...initial.target,
        regionId: 'digital_memo_area',
        rect: { ...initial.target.rect, x: 0.2, y: 0.3 },
      } : null,
    }
    const { rerender } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[initial]} />,
    )

    rerender(<CommittedAnnotationCanvas width={1000} height={800} strokes={[moved]} />)

    expect(context.clearRect).toHaveBeenCalledTimes(2)
    expect(context.stroke).toHaveBeenCalledTimes(2)
    const projectedMove = vi.mocked(context.moveTo).mock.calls.at(-1)
    expect(projectedMove?.[0]).toBeCloseTo(300)
    expect(projectedMove?.[1]).toBeCloseTo(400)
  })

  it('uses immutable stroke identity and redraws when a committed stroke is replaced', () => {
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const initial = strokeItem('first', undefined, [{ x: 0.1, y: 0.2 }])
    const replacement = strokeItem('first', undefined, [{ x: 0.1, y: 0.2 }])
    const { rerender } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[initial]} />,
    )

    rerender(<CommittedAnnotationCanvas width={1000} height={800} strokes={[replacement]} />)

    expect(context.clearRect).toHaveBeenCalledTimes(2)
    expect(context.stroke).toHaveBeenCalledTimes(2)
  })

  it('invalidates the backing store when the device pixel ratio changes', () => {
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const pixelRatio = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(1)
    const item = strokeItem('first', undefined, [{ x: 0.1, y: 0.2 }])
    const { container } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[item]} />,
    )
    const canvas = container.querySelector('canvas')!

    expect(canvas.width).toBe(1000)
    pixelRatio.mockReturnValue(2)
    act(() => window.dispatchEvent(new Event('resize')))

    expect(canvas.width).toBe(2000)
    expect(context.clearRect).toHaveBeenCalledTimes(2)
    expect(context.stroke).toHaveBeenCalledTimes(2)
  })

  it('releases an offscreen backing store and fully redraws current strokes on re-entry', () => {
    let callback: IntersectionObserverCallback | undefined
    let observer: IntersectionObserver | undefined
    let options: IntersectionObserverInit | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    class MockIntersectionObserver {
      root = null
      rootMargin = ''
      thresholds = [0]
      constructor(nextCallback: IntersectionObserverCallback, nextOptions?: IntersectionObserverInit) {
        callback = nextCallback
        options = nextOptions
        observer = this as unknown as IntersectionObserver
      }
      observe(target: Element) { observe(target) }
      unobserve() {}
      disconnect() { disconnect() }
      takeRecords() { return [] }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const first = strokeItem('first', undefined, [{ x: 0.1, y: 0.2 }])
    const second = strokeItem('second', undefined, [{ x: 0.3, y: 0.4 }])
    const { container, rerender, unmount } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[first]} />,
    )
    const canvas = container.querySelector('canvas')!

    expect(observe).toHaveBeenCalledWith(canvas)
    expect(options).toMatchObject({ root: null, rootMargin: '192px' })
    act(() => callback?.([intersectionEntry(canvas, false)], observer!))

    expect(canvas.dataset.annotationBackingState).toBe('released')
    expect(canvas.style.width).toBe('1000px')
    expect(canvas.style.height).toBe('800px')
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)

    rerender(<CommittedAnnotationCanvas width={1000} height={800} strokes={[first, second]} />)
    expect(context.stroke).toHaveBeenCalledTimes(1)
    act(() => callback?.([intersectionEntry(canvas, true)], observer!))

    expect(canvas.dataset.annotationBackingState).toBe('active')
    expect(canvas.width).toBe(1000)
    expect(canvas.height).toBe(800)
    expect(context.clearRect).toHaveBeenCalledTimes(2)
    expect(context.stroke).toHaveBeenCalledTimes(3)

    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('skips the initial backing allocation when geometry is already outside the viewport margin', () => {
    let callback: IntersectionObserverCallback | undefined
    let observer: IntersectionObserver | undefined
    class MockIntersectionObserver {
      root = null
      rootMargin = ''
      thresholds = [0]
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback
        observer = this as unknown as IntersectionObserver
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 2000,
      left: 0,
      right: 1000,
      top: 2000,
      bottom: 2800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect)
    const context = mockContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const item = strokeItem('first', undefined, [{ x: 0.1, y: 0.2 }])
    const { container } = render(
      <CommittedAnnotationCanvas width={1000} height={800} strokes={[item]} />,
    )
    const canvas = container.querySelector('canvas')!

    expect(canvas.dataset.annotationBackingState).toBe('released')
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)
    expect(context.stroke).not.toHaveBeenCalled()

    act(() => callback?.([intersectionEntry(canvas, true)], observer!))

    expect(canvas.dataset.annotationBackingState).toBe('active')
    expect(canvas.width).toBe(1000)
    expect(canvas.height).toBe(800)
    expect(context.stroke).toHaveBeenCalledTimes(1)
  })
})

function strokeItem(
  annotationId: string,
  regionId: string | undefined,
  points: Array<{ x: number; y: number }>,
): PageMemoCanvasStrokeRenderItem {
  const stroke = {
    annotationId,
    pageId: 'page_1',
    tool: 'pen' as const,
    color: '#123456',
    width: 0.004,
    coordinateSpace: regionId ? 'memo-target' as const : 'view-surface' as const,
    points,
  }
  return {
    memoId: `memo_${annotationId}`,
    stroke,
    points: stroke.points,
    projectionOffset: regionId ? { x: 0.1, y: 0.2 } : { x: 0, y: 0 },
    target: regionId ? {
      regionId,
      logicalTargetId: 'memo:main',
      label: 'MEMO',
      rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.2 },
    } : null,
  }
}

function mockContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D
}

function intersectionEntry(
  target: Element,
  isIntersecting: boolean,
): IntersectionObserverEntry {
  return { target, isIntersecting } as IntersectionObserverEntry
}
