import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchInternalDrag,
  INTERNAL_TOUCH_DRAG_LONG_PRESS_MS,
  setInternalDragDropValidity,
  startInternalPointerDrag,
  subscribeInternalDrag,
  type InternalDragDetail,
} from './internalDrag'

afterEach(() => {
  vi.useRealTimers()
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
      createPreview: payload => ({ primaryText: 'A1.png', secondaryText: '画像素材', itemCount: payload.kind === 'asset' ? payload.assetIds.length : 1 }),
      onStarted: started,
      onFinished: finished,
    })
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 12, clientY: 12 }))
    expect(phases).toEqual([])
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 18, clientY: 12 }))
    expect(source.classList.contains('internalPointerDragSource')).toBe(true)
    expect(source.dataset.internalDragSource).toBe('true')
    expect(source.style.cursor).toBe('grabbing')
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')?.textContent).toContain('A1.png')
    setInternalDragDropValidity('valid')
    expect(source.style.cursor).toBe('crosshair')
    source.className = 'assetCard dragging'
    expect(source.dataset.internalDragSource).toBe('true')
    expect(source.style.cursor).toBe('crosshair')
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(true)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 22, clientY: 16 }))
    unsubscribe()

    expect(phases).toEqual(['start', 'move', 'drop'])
    expect(started).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(finished).toHaveBeenCalledWith({ kind: 'asset', assetIds: ['asset-a'] })
    expect(document.querySelector('.pointerDragGhost')).toBeNull()
    expect(source.classList.contains('internalPointerDragSource')).toBe(false)
    expect(source.dataset.internalDragSource).toBeUndefined()
    expect(source.style.cursor).toBe('')
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
      createPreview: () => ({ primaryText: 'A1', secondaryText: '作画' }),
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

  it('leaves an ordinary touch swipe to native scrolling instead of starting a drag', () => {
    vi.useFakeTimers()
    const source = document.createElement('article')
    const scroller = document.createElement('section')
    scroller.append(source)
    document.body.append(scroller)
    scroller.scrollLeft = 25
    scroller.scrollTop = 40
    const phases: string[] = []
    const unsubscribe = subscribeInternalDrag(detail => phases.push(detail.phase))
    const begin = vi.fn(() => ({ kind: 'asset' as const, assetIds: ['asset-a'] }))

    startInternalPointerDrag({
      button: 0,
      pointerId: 9,
      pointerType: 'touch',
      clientX: 20,
      clientY: 20,
      target: source,
      currentTarget: source,
    } as never, {
      begin,
      createPreview: () => ({ primaryText: 'A1.png' }),
      sourceScrollElement: scroller,
    })
    const move = new PointerEvent('pointermove', {
      pointerId: 9,
      pointerType: 'touch',
      buttons: 1,
      clientX: 40,
      clientY: 20,
      cancelable: true,
    })
    window.dispatchEvent(move)
    scroller.scrollLeft = 45
    vi.advanceTimersByTime(INTERNAL_TOUCH_DRAG_LONG_PRESS_MS)
    unsubscribe()

    expect(move.defaultPrevented).toBe(false)
    expect(begin).not.toHaveBeenCalled()
    expect(phases).toEqual([])
    expect(scroller.scrollLeft).toBe(45)
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(false)
  })

  it('starts a touch drag only after long press and then emits move and drop', () => {
    vi.useFakeTimers()
    const source = document.createElement('article')
    document.body.append(source)
    const phases: string[] = []
    const unsubscribe = subscribeInternalDrag(detail => phases.push(detail.phase))

    startInternalPointerDrag({
      button: 0,
      pointerId: 10,
      pointerType: 'touch',
      clientX: 20,
      clientY: 20,
      target: source,
      currentTarget: source,
    } as never, {
      begin: () => ({ kind: 'asset', assetIds: ['asset-a'] }),
      createPreview: () => ({ primaryText: 'A1.png' }),
    })
    vi.advanceTimersByTime(INTERNAL_TOUCH_DRAG_LONG_PRESS_MS)
    expect(phases).toEqual(['start'])

    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 10,
      pointerType: 'touch',
      buttons: 1,
      clientX: 30,
      clientY: 30,
    }))
    window.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 10,
      pointerType: 'touch',
      button: 0,
      clientX: 30,
      clientY: 30,
    }))
    unsubscribe()

    expect(phases).toEqual(['start', 'move', 'drop'])
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(false)
  })
})
