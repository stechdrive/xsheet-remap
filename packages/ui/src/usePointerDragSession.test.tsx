import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePointerDragSession } from './usePointerDragSession'

afterEach(cleanup)

type TestSession = {
  pointerId: number
  startX: number
  x: number
}

function PointerDragHarness({
  onCommit,
  onCancel,
  onPreview,
  replaceTarget = false,
  previewMode,
}: {
  onCommit: (x: number) => void
  onCancel: () => void
  onPreview?: (x: number) => void
  replaceTarget?: boolean
  previewMode?: 'immediate' | 'animation-frame'
}) {
  const [moved, setMoved] = useState(false)
  const drag = usePointerDragSession<TestSession>({
    onUpdate: (session, point) => {
      setMoved(true)
      onPreview?.(point.clientX)
      return { ...session, x: point.clientX }
    },
    onFinish: (session, finish) => {
      if (finish.cancelled) onCancel()
      else onCommit(session.x)
      setMoved(false)
    },
    previewMode,
  })
  const label = replaceTarget && moved ? '置換後の対象' : 'ドラッグ対象'
  return <button
    key={label}
    type="button"
    aria-label={label}
    onPointerDown={event => drag.begin({
      pointerId: event.pointerId,
      startX: event.clientX,
      x: event.clientX,
    }, event.currentTarget)}
  />
}

describe('usePointerDragSession', () => {
  it('commits the final pointerup coordinate once even after React replaces the capture target', () => {
    const onCommit = vi.fn()
    render(<PointerDragHarness onCommit={onCommit} onCancel={vi.fn()} replaceTarget />)
    const target = screen.getByRole('button', { name: 'ドラッグ対象' })

    fireEvent.pointerDown(target, { pointerId: 4, button: 0, buttons: 1, clientX: 10 })
    fireEvent.pointerMove(target, { pointerId: 4, buttons: 1, clientX: 20 })
    expect(screen.getByRole('button', { name: '置換後の対象' })).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 4, buttons: 0, clientX: 30 })
    fireEvent.pointerMove(window, { pointerId: 4, buttons: 0, clientX: 40 })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(30)
  })

  it('finishes when a move reports that the primary button is already released', () => {
    const onCommit = vi.fn()
    render(<PointerDragHarness onCommit={onCommit} onCancel={vi.fn()} />)
    const target = screen.getByRole('button', { name: 'ドラッグ対象' })

    fireEvent.pointerDown(target, { pointerId: 5, button: 0, buttons: 1, clientX: 10 })
    fireEvent.pointerMove(window, { pointerId: 5, buttons: 0, clientX: 25 })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(25)
  })

  it.each([
    ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 6, clientX: 20 })],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['blur', () => fireEvent.blur(window)],
  ])('cancels an active session on %s', (_label, cancel) => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(<PointerDragHarness onCommit={onCommit} onCancel={onCancel} />)
    const target = screen.getByRole('button', { name: 'ドラッグ対象' })

    fireEvent.pointerDown(target, { pointerId: 6, button: 0, buttons: 1, clientX: 10 })
    fireEvent.pointerMove(window, { pointerId: 6, buttons: 1, clientX: 20 })
    cancel()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('cancels a stale session before starting another pointer interaction', () => {
    const onCancel = vi.fn()
    render(<PointerDragHarness onCommit={vi.fn()} onCancel={onCancel} />)
    const target = screen.getByRole('button', { name: 'ドラッグ対象' })

    fireEvent.pointerDown(target, { pointerId: 7, button: 0, buttons: 1, clientX: 10 })
    fireEvent.pointerDown(document.body, { pointerId: 8, button: 0, buttons: 1, clientX: 40 })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('publishes at most one preview per animation frame while preserving the final coordinate', () => {
    const queuedFrames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      queuedFrames.push(callback)
      return queuedFrames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const onCommit = vi.fn()
    const onPreview = vi.fn()
    render(<PointerDragHarness
      onCommit={onCommit}
      onCancel={vi.fn()}
      onPreview={onPreview}
      previewMode="animation-frame"
    />)
    const target = screen.getByRole('button', { name: 'ドラッグ対象' })

    fireEvent.pointerDown(target, { pointerId: 9, button: 0, buttons: 1, clientX: 10 })
    for (let clientX = 11; clientX <= 1010; clientX += 1) {
      fireEvent.pointerMove(window, { pointerId: 9, buttons: 1, clientX })
    }

    expect(onPreview).toHaveBeenCalledTimes(1000)
    expect(queuedFrames).toHaveLength(1)
    queuedFrames[0]?.(16)
    fireEvent.pointerUp(window, { pointerId: 9, buttons: 0, clientX: 1200 })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(1200)
  })
})
