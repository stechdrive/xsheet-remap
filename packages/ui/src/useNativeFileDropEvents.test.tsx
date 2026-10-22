import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NativeDragDropPayload, NativeDragDropSource } from '@xsheet-remap/adapters'
import { useNativeFileDropEvents } from './useNativeFileDropEvents'
import { subscribeNativeFileDragPreview, updateNativeFileDragPreview } from './nativeFileDragPreview'

const { subscribe, native } = vi.hoisted(() => ({ subscribe: vi.fn(), native: vi.fn(() => true) }))
vi.mock('@xsheet-remap/adapters', () => ({ subscribeNativeDragDrop: subscribe, isTauriHost: native }))
let receive: (payload: NativeDragDropPayload, source: NativeDragDropSource) => void
beforeEach(() => { subscribe.mockReset(); native.mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('delivers to the latest committed mode without resubscribing, including delayed subscription', async () => {
  let complete!: (unsubscribe: () => void) => void
  const stop = vi.fn(), delivered = vi.fn()
  subscribe.mockImplementation(handler => { receive = handler; return new Promise(resolve => { complete = resolve }) })
  const hook = renderHook(({ mode }) => useNativeFileDropEvents(payload => delivered(mode, payload)), { initialProps: { mode: 'sheet' } })
  hook.rerender({ mode: 'clip' })
  await act(async () => complete(stop))
  act(() => receive({ type: 'enter', paths: ['001.png'] }, 'webview'))
  expect(delivered).toHaveBeenLastCalledWith('clip', { type: 'enter', paths: ['001.png'] })
  expect(subscribe).toHaveBeenCalledTimes(1)
  hook.unmount(); expect(stop).toHaveBeenCalledTimes(1)
})

it('unsubscribes a late registration and ignores events after unmount', async () => {
  let complete!: (unsubscribe: () => void) => void
  const stop = vi.fn(), delivered = vi.fn()
  subscribe.mockImplementation(handler => { receive = handler; return new Promise(resolve => { complete = resolve }) })
  const hook = renderHook(() => useNativeFileDropEvents(delivered))
  hook.unmount()
  await act(async () => complete(stop))
  receive({ type: 'drop', paths: ['001.png'] }, 'event')
  expect(stop).toHaveBeenCalledTimes(1); expect(delivered).not.toHaveBeenCalled()
})

it('imports one drop from three native routes, permits the next action, and preserves pathless feedback', async () => {
  let time = 100
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const delivered = vi.fn()
  subscribe.mockImplementation(handler => { receive = handler; return Promise.resolve(vi.fn()) })
  renderHook(() => useNativeFileDropEvents(delivered))
  const drop = { type: 'drop' as const, paths: ['001.png', '002.png'], position: { x: 120, y: 240 } }
  for (const source of ['webview', 'window', 'event'] as const) act(() => receive(drop, source))
  expect(delivered).toHaveBeenCalledTimes(1)
  time += 501; act(() => receive(drop, 'webview'))
  act(() => receive({ ...drop, paths: ['003.png'] }, 'webview'))
  act(() => receive({ type: 'over', position: drop.position }, 'webview'))
  act(() => receive({ type: 'leave' }, 'window'))
  expect(delivered.mock.calls.map(([payload]) => payload.type)).toEqual(['drop', 'drop', 'drop', 'over', 'leave'])
  expect(delivered).toHaveBeenLastCalledWith({ type: 'leave' }, 'native:window')
})

it('clears feedback on disposal, reports subscription failure, and does nothing outside the desktop host', async () => {
  const failure = new Error('native subscription failed'), error = vi.spyOn(console, 'error').mockImplementation(() => {})
  subscribe.mockRejectedValue(failure)
  const feedback = vi.fn(), stop = subscribeNativeFileDragPreview(feedback)
  const hook = renderHook(() => useNativeFileDropEvents(vi.fn()))
  updateNativeFileDragPreview({ type: 'enter', paths: ['one.png'] }, { x: 10, y: 10 }, null, false)
  await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to subscribe native file drop event', failure))
  hook.unmount(); expect(document.querySelector('.nativeFileDragPreview')).toBeNull()
  expect(feedback).toHaveBeenLastCalledWith(null); stop()
  native.mockReturnValue(false); subscribe.mockClear()
  renderHook(() => useNativeFileDropEvents(vi.fn()))
  expect(subscribe).not.toHaveBeenCalled()
})
