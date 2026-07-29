import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  useTouchLongPress,
  TOUCH_EDIT_LONG_PRESS_MS,
  type TouchLongPressActivation,
} from './useTouchLongPress'

function LongPressHarness({
  onActivate,
}: {
  onActivate: (activation: TouchLongPressActivation) => void
}) {
  const longPress = useTouchLongPress()
  return (
    <button
      type="button"
      onPointerDown={event => {
        longPress.begin(event, onActivate)
      }}
    >
      item
    </button>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useTouchLongPress', () => {
  it('activates an unmoved primary touch after the hold delay', () => {
    vi.useFakeTimers()
    const onActivate = vi.fn()
    render(<LongPressHarness onActivate={onActivate} />)
    const button = screen.getByRole('button', { name: 'item' })

    fireEvent.pointerDown(button, {
      pointerId: 81,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 50,
    })
    vi.advanceTimersByTime(TOUCH_EDIT_LONG_PRESS_MS)

    expect(onActivate).toHaveBeenCalledWith({
      pointerId: 81,
      clientX: 40,
      clientY: 50,
      target: button,
    })
  })

  it('cancels on an ordinary touch swipe without preventing native movement', () => {
    vi.useFakeTimers()
    const onActivate = vi.fn()
    render(<LongPressHarness onActivate={onActivate} />)
    const button = screen.getByRole('button', { name: 'item' })

    fireEvent.pointerDown(button, {
      pointerId: 82,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 50,
    })
    const move = new PointerEvent('pointermove', {
      pointerId: 82,
      pointerType: 'touch',
      buttons: 1,
      clientX: 60,
      clientY: 50,
      cancelable: true,
    })
    window.dispatchEvent(move)
    vi.advanceTimersByTime(TOUCH_EDIT_LONG_PRESS_MS)

    expect(move.defaultPrevented).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('ignores mouse input so the existing desktop interaction remains immediate', () => {
    vi.useFakeTimers()
    const onActivate = vi.fn()
    render(<LongPressHarness onActivate={onActivate} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'item' }), {
      pointerId: 83,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: 50,
    })
    vi.advanceTimersByTime(TOUCH_EDIT_LONG_PRESS_MS)

    expect(onActivate).not.toHaveBeenCalled()
  })
})
