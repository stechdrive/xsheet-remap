import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  isSheetTouchNavigationTarget,
  sheetPinchPreview,
  sheetTouchPairMetrics,
  sheetTouchPanExceededThreshold,
  sheetTouchPanScrollPosition,
  type SheetTouchTap,
} from './sheetTouchNavigation'
import { useSheetTouchNavigation } from './useSheetTouchNavigation'

function TouchNavigationHarness({
  onTap,
  onBegin,
  onEnd,
  onSheetPointerDown,
  onControlPointerDown,
}: {
  onTap: (tap: SheetTouchTap) => void
  onBegin: () => void
  onEnd: () => void
  onSheetPointerDown?: () => void
  onControlPointerDown?: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pageStackRef = useRef<HTMLDivElement>(null)
  const touchNavigation = useSheetTouchNavigation({
    enabled: true,
    zoom,
    setZoom,
    viewportRef,
    pageStackRef,
    onTap,
    onBegin,
    onEnd,
  })
  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      onPointerDownCapture={touchNavigation.handlePointerDownCapture}
      onPointerMoveCapture={touchNavigation.handlePointerMoveCapture}
      onPointerUpCapture={touchNavigation.handlePointerUpCapture}
      onPointerCancelCapture={touchNavigation.handlePointerCancelCapture}
      onLostPointerCapture={touchNavigation.handleLostPointerCapture}
    >
      <div ref={pageStackRef} className="sheetPageStack" data-testid="stack">
        <div className="sheetPageSurface" data-page-id="page_1">
          <svg data-testid="sheet" onPointerDown={onSheetPointerDown}>
            <rect />
          </svg>
        </div>
      </div>
      <button type="button" onPointerDown={onControlPointerDown}>操作</button>
      <output data-testid="zoom">{zoom}</output>
    </div>
  )
}

describe('sheet touch navigation', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses stable pan and pinch geometry', () => {
    expect(sheetTouchPanExceededThreshold(10, 10, 17, 10)).toBe(false)
    expect(sheetTouchPanExceededThreshold(10, 10, 18, 10)).toBe(true)
    expect(sheetTouchPanScrollPosition(100, 200, 50, 60, 20, 100)).toEqual({
      scrollLeft: 130,
      scrollTop: 160,
    })
    expect(sheetTouchPairMetrics(
      { clientX: 50, clientY: 100 },
      { clientX: 250, clientY: 100 },
    )).toEqual({
      clientX: 150,
      clientY: 100,
      distance: 200,
    })
    expect(sheetPinchPreview({
      baseZoom: 1,
      startDistance: 100,
      anchorContentX: 200,
      anchorContentY: 300,
      viewportLeft: 0,
      viewportTop: 0,
      first: { clientX: 50, clientY: 100 },
      second: { clientX: 250, clientY: 100 },
    })).toEqual({
      zoom: 2,
      scale: 2,
      scrollLeft: 250,
      scrollTop: 500,
      centroidClientX: 150,
      centroidClientY: 100,
    })
  })

  it('reserves sheet surfaces for touch gestures without swallowing controls', () => {
    const root = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const button = document.createElement('button')
    const buttonLabel = document.createElement('span')
    button.append(buttonLabel)
    root.append(svg, button)

    expect(isSheetTouchNavigationTarget(svg)).toBe(true)
    expect(isSheetTouchNavigationTarget(buttonLabel)).toBe(false)
  })

  it('delays a touch tap until release and never forwards it to the sheet handler', () => {
    const onTap = vi.fn()
    const onBegin = vi.fn()
    const onEnd = vi.fn()
    const onSheetPointerDown = vi.fn()
    render(<TouchNavigationHarness {...{ onTap, onBegin, onEnd, onSheetPointerDown }} />)
    const sheet = screen.getByTestId('sheet')

    fireEvent.pointerDown(sheet, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 120,
      clientY: 180,
    })
    expect(onSheetPointerDown).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()

    fireEvent.pointerUp(screen.getByTestId('viewport'), {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 123,
      clientY: 183,
    })
    expect(onTap).toHaveBeenCalledWith(expect.objectContaining({
      target: sheet,
      clientX: 123,
      clientY: 183,
    }))
    expect(onBegin).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('moves the scroll viewport directly after the threshold and suppresses the tap', () => {
    const onTap = vi.fn()
    const onBegin = vi.fn()
    const onEnd = vi.fn()
    render(<TouchNavigationHarness {...{ onTap, onBegin, onEnd }} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')
    viewport.scrollLeft = 100
    viewport.scrollTop = 200

    fireEvent.pointerDown(sheet, {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 200,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      pointerType: 'touch',
      buttons: 1,
      clientX: 170,
      clientY: 140,
    })

    expect(onBegin).toHaveBeenCalledTimes(1)
    expect(viewport.scrollLeft).toBe(130)
    expect(viewport.scrollTop).toBe(260)

    fireEvent.pointerUp(viewport, {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 160,
      clientY: 130,
    })
    expect(viewport.scrollLeft).toBe(140)
    expect(viewport.scrollTop).toBe(270)
    expect(onTap).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('previews a pinch without React zoom updates and commits once on release', () => {
    const onTap = vi.fn()
    const onBegin = vi.fn()
    const onEnd = vi.fn()
    render(<TouchNavigationHarness {...{ onTap, onBegin, onEnd }} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')
    const stack = screen.getByTestId('stack')

    fireEvent.pointerDown(sheet, {
      pointerId: 10,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerDown(sheet, {
      pointerId: 11,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 100,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 11,
      pointerType: 'touch',
      buttons: 1,
      clientX: 300,
      clientY: 100,
    })

    expect(stack.style.transform).toBe('scale(2)')
    expect(stack.dataset.touchPinchPreview).toBe('true')
    expect(screen.getByTestId('zoom').textContent).toBe('1')

    fireEvent.pointerUp(viewport, {
      pointerId: 11,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 300,
      clientY: 100,
    })

    expect(screen.getByTestId('zoom').textContent).toBe('2')
    expect(stack.style.transform).toBe('')
    expect(stack.dataset.touchPinchPreview).toBeUndefined()
    expect(onTap).not.toHaveBeenCalled()
    expect(onBegin).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)

    fireEvent.pointerUp(viewport, {
      pointerId: 10,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 100,
      clientY: 100,
    })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('reverts an uncommitted pinch when a pen takes ownership', () => {
    const onTap = vi.fn()
    const onBegin = vi.fn()
    const onEnd = vi.fn()
    render(<TouchNavigationHarness {...{ onTap, onBegin, onEnd }} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')
    const stack = screen.getByTestId('stack')
    viewport.scrollLeft = 40
    viewport.scrollTop = 60

    fireEvent.pointerDown(sheet, {
      pointerId: 12,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerDown(sheet, {
      pointerId: 13,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 100,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 13,
      pointerType: 'touch',
      buttons: 1,
      clientX: 300,
      clientY: 100,
    })
    expect(stack.style.transform).toBe('scale(2)')

    fireEvent.pointerDown(sheet, {
      pointerId: 14,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: 150,
      clientY: 150,
    })

    expect(stack.style.transform).toBe('')
    expect(viewport.scrollLeft).toBe(40)
    expect(viewport.scrollTop).toBe(60)
    expect(screen.getByTestId('zoom').textContent).toBe('1')
    expect(onTap).not.toHaveBeenCalled()
    expect(onBegin).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('owns an added touch even when the second finger lands on a control', () => {
    const onControlPointerDown = vi.fn()
    render(<TouchNavigationHarness
      onTap={vi.fn()}
      onBegin={vi.fn()}
      onEnd={vi.fn()}
      onControlPointerDown={onControlPointerDown}
    />)
    const sheet = screen.getByTestId('sheet')
    const control = screen.getByRole('button', { name: '操作' })

    fireEvent.pointerDown(sheet, {
      pointerId: 20,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 60,
    })
    fireEvent.pointerDown(control, {
      pointerId: 21,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 80,
      clientY: 90,
    })

    expect(onControlPointerDown).not.toHaveBeenCalled()
  })

  it('lets an active pen own input and accepts a new touch gesture after pen release', () => {
    const onTap = vi.fn()
    const onSheetPointerDown = vi.fn()
    render(<TouchNavigationHarness
      onTap={onTap}
      onBegin={vi.fn()}
      onEnd={vi.fn()}
      onSheetPointerDown={onSheetPointerDown}
    />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')

    fireEvent.pointerDown(sheet, {
      pointerId: 30,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerDown(sheet, {
      pointerId: 31,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 120,
      clientY: 120,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 31,
      pointerType: 'touch',
      buttons: 1,
      clientX: 80,
      clientY: 80,
    })
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)

    fireEvent.pointerUp(viewport, {
      pointerId: 31,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 80,
      clientY: 80,
    })
    fireEvent.pointerUp(sheet, {
      pointerId: 30,
      pointerType: 'pen',
      button: 0,
      buttons: 0,
      clientX: 100,
      clientY: 100,
    })

    fireEvent.pointerDown(sheet, {
      pointerId: 32,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 32,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 101,
      clientY: 101,
    })

    expect(onSheetPointerDown).toHaveBeenCalledTimes(1)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('ends a cancelled drag once and accepts the next gesture', () => {
    const onTap = vi.fn()
    const onEnd = vi.fn()
    render(<TouchNavigationHarness onTap={onTap} onBegin={vi.fn()} onEnd={onEnd} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')

    fireEvent.pointerDown(sheet, {
      pointerId: 40,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 40,
      pointerType: 'touch',
      buttons: 1,
      clientX: 80,
      clientY: 70,
    })
    fireEvent.pointerCancel(viewport, {
      pointerId: 40,
      pointerType: 'touch',
    })
    fireEvent.lostPointerCapture(viewport, {
      pointerId: 40,
      pointerType: 'touch',
    })
    expect(onEnd).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(sheet, {
      pointerId: 41,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 40,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 41,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 42,
      clientY: 42,
    })
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('leaves mouse input on the existing sheet path', () => {
    const onSheetPointerDown = vi.fn()
    render(<TouchNavigationHarness
      onTap={vi.fn()}
      onBegin={vi.fn()}
      onEnd={vi.fn()}
      onSheetPointerDown={onSheetPointerDown}
    />)

    fireEvent.pointerDown(screen.getByTestId('sheet'), {
      pointerId: 50,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 60,
    })
    expect(onSheetPointerDown).toHaveBeenCalledTimes(1)
  })
})
