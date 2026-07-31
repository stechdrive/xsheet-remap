import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommittedAnnotationCanvas } from './CommittedAnnotationCanvas'
import type { PageMemoStrokeRenderItem } from './pageMemoProjection'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CommittedAnnotationCanvas', () => {
  it('draws committed strokes into one canvas and appends without replaying stable ink', () => {
    const context = {
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

    rerender(<CommittedAnnotationCanvas width={1000} height={800} strokes={[first, second]} />)

    expect(canvas.dataset.annotationStrokeCount).toBe('2')
    expect(context.clearRect).toHaveBeenCalledTimes(1)
    expect(context.stroke).toHaveBeenCalledTimes(2)
  })

  it('replays the canvas when projected target geometry changes', () => {
    const context = {
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const initial = strokeItem('first', 'top_memo_area', [{ x: 0.1, y: 0.2 }])
    const moved = {
      ...initial,
      points: [{ x: 0.3, y: 0.4 }],
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
  })
})

function strokeItem(
  annotationId: string,
  regionId: string | undefined,
  points: Array<{ x: number; y: number }>,
): PageMemoStrokeRenderItem {
  return {
    memoId: `memo_${annotationId}`,
    stroke: {
      annotationId,
      pageId: 'page_1',
      tool: 'pen',
      color: '#123456',
      width: 0.004,
      points,
    },
    points,
    path: '',
    target: regionId ? {
      regionId,
      logicalTargetId: 'memo:main',
      label: 'MEMO',
      rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.2 },
    } : null,
  }
}
