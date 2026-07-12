import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchInternalDrag, startInternalPointerDrag, subscribeInternalDrag, type InternalDragDetail } from './internalDrag'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('internal drag', () => {
  it('publishes one normalized drag contract', () => {
    const received: InternalDragDetail[] = []
    const unsubscribe = subscribeInternalDrag(detail => received.push(detail))
    dispatchInternalDrag({
      sessionId: 'test',
      phase: 'drop',
      payload: { kind: 'asset', assetIds: ['asset-a'] },
      clientX: 20,
      clientY: 30,
    })
    unsubscribe()
    expect(received).toEqual([{
      sessionId: 'test',
      phase: 'drop',
      payload: { kind: 'asset', assetIds: ['asset-a'] },
      clientX: 20,
      clientY: 30,
    }])
  })

  it('starts after the pointer threshold and emits move then drop', () => {
    const source = document.createElement('article')
    document.body.append(source)
    const phases: string[] = []
    const unsubscribe = subscribeInternalDrag(detail => phases.push(detail.phase))
    const ghost = document.createElement('div')
    const started = vi.fn()
    const finished = vi.fn()

    startInternalPointerDrag({
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
      target: source,
      currentTarget: source,
    } as never, {
      begin: () => ({ kind: 'asset', assetIds: ['asset-a', 'asset-a'] }),
      createDragGhost: () => ghost,
      onStarted: started,
      onFinished: finished,
    })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 12, clientY: 12 }))
    expect(phases).toEqual([])
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 18, clientY: 12 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 22, clientY: 16 }))
    unsubscribe()

    expect(phases).toEqual(['start', 'move', 'drop'])
    expect(started).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(finished).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
  })
})
