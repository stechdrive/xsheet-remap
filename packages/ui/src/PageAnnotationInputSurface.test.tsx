import { createSheetPages, standardA3SheetTemplate } from '@xsheet-remap/core'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageAnnotationInputSurface } from './PageAnnotationInputSurface'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageAnnotationInputSurface', () => {
  it('keeps every dense pointer sample while publishing one preview per frame', () => {
    const queuedFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      queuedFrames.push(callback)
      return queuedFrames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
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

    expect(queuedFrames).toHaveLength(1)
    act(() => queuedFrames[0]?.(16))
    expect(container.querySelector('.annotationDraftStroke')?.getAttribute('d')).toContain('L ')
    fireEvent.pointerUp(window, { pointerId: 12, buttons: 0, clientX: 1200, clientY: 1250, pressure: 0.25 })

    expect(onAnnotation).toHaveBeenCalledTimes(1)
    const committed = onAnnotation.mock.calls[0]?.[0]
    expect(committed.points).toHaveLength(1002)
    expect(committed.points.at(-1)).toEqual({ x: 1.2, y: 1.25, pressure: 0.25 })
  })
})
