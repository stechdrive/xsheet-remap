import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnimationFramePointerUpdate } from './useAnimationFramePointerUpdate'

const originalRequestAnimationFrame = window.requestAnimationFrame
const originalCancelAnimationFrame = window.cancelAnimationFrame

describe('useAnimationFramePointerUpdate', () => {
  let callbacks: FrameRequestCallback[]

  beforeEach(() => {
    callbacks = []
    window.requestAnimationFrame = vi.fn(callback => {
      callbacks.push(callback)
      return callbacks.length
    })
    window.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('coalesces pointer movement to the newest update in one animation frame', () => {
    const apply = vi.fn()
    const { result } = renderHook(() => useAnimationFramePointerUpdate(apply))

    act(() => {
      result.current.schedule(4, 10, 20)
      result.current.schedule(4, 30, 40)
      result.current.schedule(4, 50, 60)
    })

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(apply).not.toHaveBeenCalled()
    act(() => callbacks[0]?.(16))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(4, 50, 60)
  })

  it('flushes the final pointer position before a drag is committed', () => {
    const apply = vi.fn()
    const { result } = renderHook(() => useAnimationFramePointerUpdate(apply))

    act(() => {
      result.current.schedule(7, 11, 12)
      result.current.flush({ pointerId: 7, clientX: 21, clientY: 22 })
    })

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(7, 21, 22)
  })

  it('cancels a pending update without applying it', () => {
    const apply = vi.fn()
    const { result } = renderHook(() => useAnimationFramePointerUpdate(apply))

    act(() => {
      result.current.schedule(9, 1, 2)
      result.current.cancel()
    })

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    act(() => callbacks[0]?.(16))
    expect(apply).not.toHaveBeenCalled()
  })
})
