import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchInternalDrag, startInternalPointerDrag, subscribeInternalDrag, type InternalDragDetail } from './internalDrag'

afterEach(() => {
  document.body.innerHTML = ''
  document.body.className = ''
  delete document.body.dataset.internalDragKind
  delete document.body.dataset.internalDragValidity
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
    expect(source.classList.contains('internalPointerDragSource')).toBe(true)
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(true)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 22, clientY: 16 }))
    unsubscribe()

    expect(phases).toEqual(['start', 'move', 'drop'])
    expect(started).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(finished).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
    expect(source.classList.contains('internalPointerDragSource')).toBe(false)
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(false)
  })

  it('allows an editable card label to be the drag origin and cancels cleanly on window blur', () => {
    const source = document.createElement('article')
    const label = document.createElement('span')
    label.setAttribute('role', 'button')
    source.append(label)
    document.body.append(source)
    const phases: string[] = []
    const unsubscribe = subscribeInternalDrag(detail => phases.push(detail.phase))
    const finished = vi.fn()

    expect(startInternalPointerDrag({
      button: 0,
      pointerId: 8,
      clientX: 20,
      clientY: 20,
      target: label,
      currentTarget: source,
    } as never, {
      begin: () => ({ kind: 'registered-cell', keyId: 'key-a' }),
      createDragGhost: () => document.createElement('div'),
      onFinished: finished,
      interactiveTargetSelector: 'button,input,select,textarea,a,[contenteditable="true"]',
    })).toBe(true)

    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 25, clientY: 20 }))
    window.dispatchEvent(new Event('blur'))
    unsubscribe()

    expect(phases).toEqual(['start', 'move', 'cancel'])
    expect(finished).toHaveBeenCalledWith({ kind: 'registered-cell', keyId: 'key-a' })
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(false)
  })
})
