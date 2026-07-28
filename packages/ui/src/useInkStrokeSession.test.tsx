import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  actualInkPointsFromEvent,
  predictedInkPointsFromEvent,
  resolveInkPointerInputMode,
  useInkStrokeSession,
  type InkPointerPoint,
} from './useInkStrokeSession'

const originalPointerRawUpdateDescriptor = Object.getOwnPropertyDescriptor(window, 'onpointerrawupdate')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalPointerRawUpdateDescriptor) {
    Object.defineProperty(window, 'onpointerrawupdate', originalPointerRawUpdateDescriptor)
  } else {
    Reflect.deleteProperty(window, 'onpointerrawupdate')
  }
})

type TestSession = {
  pointerId: number
  points: InkPointerPoint[]
}

function pointerEvent(
  type: string,
  init: Partial<globalThis.PointerEvent> & {
    pointerId: number
    clientX: number
    clientY: number
  },
  extras: {
    coalesced?: globalThis.PointerEvent[]
    predicted?: globalThis.PointerEvent[]
  } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as globalThis.PointerEvent
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  if (extras.coalesced) {
    Object.defineProperty(event, 'getCoalescedEvents', {
      configurable: true,
      value: () => extras.coalesced,
    })
  }
  if (extras.predicted) {
    Object.defineProperty(event, 'getPredictedEvents', {
      configurable: true,
      value: () => extras.predicted,
    })
  }
  return event
}

function InkHarness({
  onCommit,
  onPredicted,
}: {
  onCommit: (points: InkPointerPoint[]) => void
  onPredicted: (points: readonly InkPointerPoint[]) => void
}) {
  const stroke = useInkStrokeSession<TestSession>({
    onActualPoints: (session, points) => ({
      ...session,
      points: [...session.points, ...points],
    }),
    onPredictedPoints: (_session, points) => onPredicted(points),
    onFinish: (session, finish) => {
      if (!finish.cancelled) onCommit(session.points)
    },
  })
  return <button
    type="button"
    aria-label="描画対象"
    data-input-mode={stroke.inputModeRef.current}
    onPointerDown={event => stroke.begin({
      pointerId: event.pointerId,
      points: [{
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        pressure: event.pressure,
        timeStamp: event.timeStamp,
      }],
    }, event.currentTarget, event.nativeEvent)}
  />
}

describe('ink pointer sampling', () => {
  it('uses coalesced actual points without appending the aggregate parent event', () => {
    const coalesced = [
      { clientX: 10, clientY: 20, pressure: 0.25, timeStamp: 100 },
      { clientX: 12, clientY: 23, pressure: 0.5, timeStamp: 101 },
    ] as globalThis.PointerEvent[]
    const event = {
      pointerId: 14,
      clientX: 15,
      clientY: 27,
      pressure: 0.75,
      timeStamp: 102,
      getCoalescedEvents: () => coalesced,
    } as globalThis.PointerEvent

    expect(actualInkPointsFromEvent(event)).toEqual([
      { pointerId: 14, clientX: 10, clientY: 20, pressure: 0.25, timeStamp: 100 },
      { pointerId: 14, clientX: 12, clientY: 23, pressure: 0.5, timeStamp: 101 },
    ])
  })

  it('keeps predicted points separate from actual points', () => {
    const predicted = [
      { clientX: 18, clientY: 29, pressure: 0.7, timeStamp: 103 },
      { clientX: 22, clientY: 34, pressure: 0.65, timeStamp: 104 },
    ] as globalThis.PointerEvent[]
    const event = {
      type: 'pointermove',
      pointerId: 14,
      pointerType: 'pen',
      getPredictedEvents: () => predicted,
    } as globalThis.PointerEvent

    expect(predictedInkPointsFromEvent(event)).toEqual([
      { pointerId: 14, clientX: 18, clientY: 29, pressure: 0.7, timeStamp: 103 },
      { pointerId: 14, clientX: 22, clientY: 34, pressure: 0.65, timeStamp: 104 },
    ])
    expect(predictedInkPointsFromEvent({
      type: 'pointermove',
      pointerId: 14,
      pointerType: 'mouse',
      getPredictedEvents: () => predicted,
    } as globalThis.PointerEvent)).toEqual([])
  })

  it('selects one input stream per stroke while preserving pointermove for mouse', () => {
    expect(resolveInkPointerInputMode({
      pointerType: 'pen',
      getPredictedEvents: () => [],
    } as unknown as globalThis.PointerEvent, {
      supportsRawUpdates: true,
    })).toBe('pointermove')
    expect(resolveInkPointerInputMode({
      pointerType: 'pen',
      getPredictedEvents: undefined,
    } as unknown as globalThis.PointerEvent, {
      supportsRawUpdates: true,
    })).toBe('pointerrawupdate')
    expect(resolveInkPointerInputMode({
      pointerType: 'mouse',
      getPredictedEvents: undefined,
    } as unknown as globalThis.PointerEvent, {
      supportsRawUpdates: true,
    })).toBe('pointermove')
  })
})

describe('useInkStrokeSession', () => {
  it('commits actual samples only and replaces predicted samples on every move', () => {
    const onCommit = vi.fn()
    const onPredicted = vi.fn()
    render(<InkHarness onCommit={onCommit} onPredicted={onPredicted} />)
    const target = screen.getByRole('button', { name: '描画対象' })

    fireEvent(target, pointerEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
      pressure: 0.5,
      timeStamp: 100,
    }, { predicted: [] }))
    const actual = [
      { clientX: 11, clientY: 12, pressure: 0.55, timeStamp: 101 },
      { clientX: 13, clientY: 15, pressure: 0.6, timeStamp: 102 },
    ] as globalThis.PointerEvent[]
    const predicted = [
      { clientX: 16, clientY: 19, pressure: 0.6, timeStamp: 103 },
    ] as globalThis.PointerEvent[]
    fireEvent(window, pointerEvent('pointermove', {
      pointerId: 7,
      pointerType: 'pen',
      buttons: 1,
      clientX: 13,
      clientY: 15,
      pressure: 0.6,
      timeStamp: 102,
    }, { coalesced: actual, predicted }))
    fireEvent(window, pointerEvent('pointerup', {
      pointerId: 7,
      pointerType: 'pen',
      buttons: 0,
      clientX: 14,
      clientY: 16,
      pressure: 0,
      timeStamp: 105,
    }))

    expect(onPredicted).toHaveBeenCalledWith([
      expect.objectContaining({ clientX: 16, clientY: 19 }),
    ])
    expect(onPredicted).toHaveBeenLastCalledWith([])
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0]?.[0].map((point: InkPointerPoint) => [point.clientX, point.clientY]))
      .toEqual([[10, 10], [11, 12], [13, 15], [14, 16]])
  })

  it('processes raw updates exclusively when pen prediction is unavailable', () => {
    Object.defineProperty(window, 'onpointerrawupdate', {
      configurable: true,
      value: null,
    })
    const onCommit = vi.fn()
    render(<InkHarness onCommit={onCommit} onPredicted={vi.fn()} />)
    const target = screen.getByRole('button', { name: '描画対象' })

    fireEvent(target, pointerEvent('pointerdown', {
      pointerId: 8,
      pointerType: 'pen',
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
      pressure: 0.5,
      timeStamp: 200,
    }))
    fireEvent(window, pointerEvent('pointermove', {
      pointerId: 8,
      pointerType: 'pen',
      buttons: 1,
      clientX: 20,
      clientY: 20,
      pressure: 0.55,
      timeStamp: 201,
    }))
    fireEvent(window, pointerEvent('pointerrawupdate', {
      pointerId: 8,
      pointerType: 'pen',
      buttons: 1,
      clientX: 30,
      clientY: 30,
      pressure: 0.6,
      timeStamp: 202,
    }))
    fireEvent(window, pointerEvent('pointerup', {
      pointerId: 8,
      pointerType: 'pen',
      buttons: 0,
      clientX: 40,
      clientY: 40,
      pressure: 0,
      timeStamp: 203,
    }))

    expect(onCommit.mock.calls[0]?.[0].map((point: InkPointerPoint) => [point.clientX, point.clientY]))
      .toEqual([[10, 10], [30, 30], [40, 40]])
  })
})
