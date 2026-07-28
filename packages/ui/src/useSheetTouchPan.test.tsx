import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  isSheetTouchPanTarget,
  sheetTouchPanExceededThreshold,
  sheetTouchPanScrollPosition,
  useSheetTouchPan,
  type SheetTouchTap,
} from './useSheetTouchPan'

function TouchPanHarness({
  onTap,
  onBegin,
  onEnd,
  onSheetPointerDown,
}: {
  onTap: (tap: SheetTouchTap) => void
  onBegin: () => void
  onEnd: () => void
  onSheetPointerDown?: () => void
}) {
  const touchPan = useSheetTouchPan({
    enabled: true,
    onTap,
    onBegin,
    onEnd,
  })
  return (
    <div
      data-testid="viewport"
      onPointerDownCapture={touchPan.handlePointerDownCapture}
      onPointerMoveCapture={touchPan.handlePointerMoveCapture}
      onPointerUpCapture={touchPan.handlePointerUpCapture}
      onPointerCancelCapture={touchPan.handlePointerCancelCapture}
      onLostPointerCapture={touchPan.handleLostPointerCapture}
    >
      <svg data-testid="sheet" onPointerDown={onSheetPointerDown}>
        <rect />
      </svg>
      <button type="button">操作</button>
    </div>
  )
}

describe('sheet touch pan', () => {
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

  it('uses a stable movement threshold and preserves the gesture origin', () => {
    expect(sheetTouchPanExceededThreshold(10, 10, 17, 10)).toBe(false)
    expect(sheetTouchPanExceededThreshold(10, 10, 18, 10)).toBe(true)
    expect(sheetTouchPanScrollPosition(100, 200, 50, 60, 20, 100)).toEqual({
      scrollLeft: 130,
      scrollTop: 160,
    })
  })

  it('reserves sheet surfaces for touch gestures without swallowing controls', () => {
    const root = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const button = document.createElement('button')
    const buttonLabel = document.createElement('span')
    button.append(buttonLabel)
    root.append(svg, button)

    expect(isSheetTouchPanTarget(svg)).toBe(true)
    expect(isSheetTouchPanTarget(buttonLabel)).toBe(false)
  })

  it('delays a touch tap until release and never forwards it to the sheet handler', () => {
    const onTap = vi.fn()
    const onBegin = vi.fn()
    const onEnd = vi.fn()
    const onSheetPointerDown = vi.fn()
    render(<TouchPanHarness {...{ onTap, onBegin, onEnd, onSheetPointerDown }} />)
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
    render(<TouchPanHarness {...{ onTap, onBegin, onEnd }} />)
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

  it('suppresses a tap when a second finger joins the gesture', () => {
    const onTap = vi.fn()
    render(<TouchPanHarness onTap={onTap} onBegin={vi.fn()} onEnd={vi.fn()} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')

    fireEvent.pointerDown(sheet, {
      pointerId: 4,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 60,
    })
    fireEvent.pointerDown(sheet, {
      pointerId: 5,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 5,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 80,
      clientY: 90,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 4,
      pointerType: 'touch',
      button: 0,
      buttons: 0,
      clientX: 50,
      clientY: 60,
    })

    expect(onTap).not.toHaveBeenCalled()
  })

  it('ends a cancelled drag once and accepts the next gesture', () => {
    const onTap = vi.fn()
    const onEnd = vi.fn()
    render(<TouchPanHarness onTap={onTap} onBegin={vi.fn()} onEnd={onEnd} />)
    const viewport = screen.getByTestId('viewport')
    const sheet = screen.getByTestId('sheet')

    fireEvent.pointerDown(sheet, {
      pointerId: 6,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(viewport, {
      pointerId: 6,
      pointerType: 'touch',
      buttons: 1,
      clientX: 80,
      clientY: 70,
    })
    fireEvent.pointerCancel(viewport, {
      pointerId: 6,
      pointerType: 'touch',
    })
    fireEvent.lostPointerCapture(viewport, {
      pointerId: 6,
      pointerType: 'touch',
    })
    expect(onEnd).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(sheet, {
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 40,
    })
    fireEvent.pointerUp(viewport, {
      pointerId: 7,
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
    render(<TouchPanHarness
      onTap={vi.fn()}
      onBegin={vi.fn()}
      onEnd={vi.fn()}
      onSheetPointerDown={onSheetPointerDown}
    />)

    fireEvent.pointerDown(screen.getByTestId('sheet'), {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 60,
    })
    expect(onSheetPointerDown).toHaveBeenCalledTimes(1)
  })
})
