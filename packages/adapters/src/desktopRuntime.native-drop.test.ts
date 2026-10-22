import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { subscribeNativeDragDrop } from './desktopRuntime'

const { webview, windowDrop, event } = vi.hoisted(() => ({ webview: vi.fn(), windowDrop: vi.fn(), event: vi.fn() }))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: webview }) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: windowDrop }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: event }))
beforeEach(() => {
  vi.resetAllMocks()
  ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
})
afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ })

it('routes and normalizes each native source, retaining pathless over/leave and releasing every listener', async () => {
  const stops = [vi.fn(), vi.fn(), vi.fn()]
  webview.mockResolvedValue(stops[0]); windowDrop.mockResolvedValue(stops[1]); event.mockResolvedValue(stops[2])
  const receive = vi.fn(), stop = await subscribeNativeDragDrop(receive, ['webview', 'window', 'event'])
  webview.mock.calls[0][0]({ payload: { type: 'enter', paths: ['a.png', 9], position: { x: 240, y: 120 } } })
  windowDrop.mock.calls[0][0]({ payload: { type: 'over', position: { x: 260, y: 120 } } })
  event.mock.calls[0][1]({ payload: { type: 'leave' } })
  expect(receive.mock.calls).toEqual([
    [{ type: 'enter', paths: ['a.png'], position: { x: 240, y: 120 } }, 'webview'],
    [{ type: 'over', paths: undefined, position: { x: 260, y: 120 } }, 'window'],
    [{ type: 'leave', paths: undefined, position: undefined }, 'event'],
  ])
  stop(); for (const unlisten of stops) expect(unlisten).toHaveBeenCalledTimes(1)
})

it('unwinds subscriptions if a later route fails and never registers outside Tauri', async () => {
  const stop = vi.fn(), failure = new Error('second route unavailable')
  webview.mockResolvedValue(stop); windowDrop.mockRejectedValue(failure)
  await expect(subscribeNativeDragDrop(vi.fn(), ['webview', 'window', 'event'])).rejects.toBe(failure)
  expect(stop).toHaveBeenCalledOnce(); expect(event).not.toHaveBeenCalled()
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  webview.mockClear()
  const noop = await subscribeNativeDragDrop(vi.fn()); noop()
  expect(webview).not.toHaveBeenCalled()
})
