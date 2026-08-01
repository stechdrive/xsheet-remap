import { createSheetPages, standardA3SheetTemplate } from '@xsheet-remap/core'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageAnnotationInputSurface } from './PageAnnotationInputSurface'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageAnnotationInputSurface', () => {
  it('keeps every dense pointer sample while throttling diagnostics outside the incremental draw path', () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      clip: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      rect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const onAnnotation = vi.fn()
    const { container } = render(
      <PageAnnotationInputSurface
        page={page}
        editMode="pen"
        width={1000}
        height={1000}
        onPointerDown={event => ({
          pointerId: event.pointerId,
          svgRect: { left: 0, top: 0, width: 1000, height: 1000 },
          target: { kind: 'page', pageId: page.pageId },
          stroke: {
            annotationId: 'annotation_1',
            pageId: page.pageId,
            tool: 'pen',
            color: '#123456',
            width: 0.002,
            points: [{ x: 0.01, y: 0.01, pressure: 0.5 }],
          },
        })}
        onPointerMove={() => undefined}
        onPointerUp={() => undefined}
        onCancelOtherInteractions={() => undefined}
        onPointerLeave={() => undefined}
        onAnnotation={onAnnotation}
        onEraseAnnotation={vi.fn()}
      />,
    )
    const surface = container.querySelector<SVGSVGElement>('.pageAnnotationInputSurface')!
    const canvas = container.querySelector<HTMLCanvasElement>('.pageAnnotationInkCanvas')!
    Object.defineProperty(surface, 'setPointerCapture', { value: vi.fn() })

    fireEvent.pointerDown(surface, { pointerId: 12, button: 0, buttons: 1, clientX: 10, clientY: 10, pressure: 0.5 })
    for (let index = 0; index < 1000; index += 1) {
      fireEvent.pointerMove(window, {
        pointerId: 12,
        buttons: 1,
        clientX: 11 + index,
        clientY: 12 + index,
        pressure: 0.75,
      })
    }

    expect(requestFrame).not.toHaveBeenCalled()
    expect(canvas.dataset.inkActive).toBe('true')
    expect(Number(canvas.dataset.inkSampleCount)).toBeGreaterThanOrEqual(2)
    expect(Number(canvas.dataset.inkSampleCount)).toBeLessThan(1001)
    expect(context.lineTo).toHaveBeenCalledTimes(1001)
    expect(container.querySelector('.annotationDraftStroke')).toBeNull()
    fireEvent.pointerUp(window, { pointerId: 12, buttons: 0, clientX: 1200, clientY: 1250, pressure: 0.25 })

    expect(canvas.dataset.inkActive).toBe('false')
    expect(canvas.dataset.inkSampleCount).toBe('0')
    expect(onAnnotation).toHaveBeenCalledTimes(1)
    const committed = onAnnotation.mock.calls[0]?.[0]
    expect(committed.points).toHaveLength(1002)
    expect(committed.points.at(-1)).toEqual({ x: 1.2, y: 1.25, pressure: 0.25 })
  })

  it('keeps the target geometry captured at pointer down for the full stroke', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const firstTarget = {
      kind: 'template-region' as const,
      pageId: page.pageId,
      templateId: standardA3SheetTemplate.templateId,
      regionId: 'first_memo_area',
      logicalTargetId: 'memo:main',
      targetRect: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 },
    }
    const movedTarget = {
      ...firstTarget,
      regionId: 'moved_memo_area',
      targetRect: { x: 0.35, y: 0.45, w: 0.4, h: 0.3 },
    }
    const onEraseAnnotation = vi.fn()
    const view = (target: typeof firstTarget) => (
      <PageAnnotationInputSurface
        page={page}
        editMode="eraser"
        width={1000}
        height={1000}
        onPointerDown={event => ({
          pointerId: event.pointerId,
          svgRect: { left: 0, top: 0, width: 1000, height: 1000 },
          target,
          stroke: {
            annotationId: 'annotation_1',
            pageId: page.pageId,
            tool: 'eraser',
            color: '#2f7f6a',
            width: 0.01,
            coordinateSpace: 'memo-target',
            points: [{ x: 0.2, y: 0.2, pressure: 1 }],
          },
        })}
        onPointerMove={() => undefined}
        onPointerUp={() => undefined}
        onCancelOtherInteractions={() => undefined}
        onPointerLeave={() => undefined}
        onAnnotation={vi.fn()}
        onEraseAnnotation={onEraseAnnotation}
      />
    )
    const { container, rerender } = render(view(firstTarget))
    const surface = container.querySelector<SVGSVGElement>('.pageAnnotationInputSurface')!
    Object.defineProperty(surface, 'setPointerCapture', { value: vi.fn() })

    fireEvent.pointerDown(surface, {
      pointerId: 27,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 400,
    })
    rerender(view(movedTarget))
    fireEvent.pointerMove(window, {
      pointerId: 27,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 500,
      clientY: 600,
    })
    fireEvent.pointerUp(window, {
      pointerId: 27,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 600,
      clientY: 700,
    })

    expect(onEraseAnnotation).toHaveBeenCalledTimes(1)
    expect(onEraseAnnotation.mock.calls[0]?.[3]).toEqual(firstTarget)
    const projectedPoints = onEraseAnnotation.mock.calls[0]?.[1].slice(-2)
    expect(projectedPoints?.[0]).toMatchObject({ pressure: 1 })
    expect(projectedPoints?.[0]?.x).toBeCloseTo(0.4)
    expect(projectedPoints?.[0]?.y).toBeCloseTo(0.4)
    expect(projectedPoints?.[1]).toMatchObject({ pressure: 1 })
    expect(projectedPoints?.[1]?.x).toBeCloseTo(0.5)
    expect(projectedPoints?.[1]?.y).toBeCloseTo(0.5)
  })
})
