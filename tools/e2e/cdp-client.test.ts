// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { CdpClient } from './cdp-client'

afterEach(() => vi.unstubAllGlobals())

it('delivers protocol events separately from pending responses and removes event subscriptions', async () => {
  class TestSocket extends EventTarget {
    static instance: TestSocket
    sent: Array<{ id: number; method: string }> = []
    constructor() { super(); TestSocket.instance = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
    send(bytes: string) { this.sent.push(JSON.parse(bytes)) }
    emit(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
    close() {}
  }
  vi.stubGlobal('WebSocket', TestSocket)
  const client = await CdpClient.connect('ws://fixture')
  const socket = TestSocket.instance
  const listener = vi.fn(), unsubscribe = client.on('Page.javascriptDialogOpening', listener)
  const pending = client.send('Page.navigate', { url: 'http://tauri.localhost/index.html?app=editor' })
  socket!.emit({ method: 'Page.javascriptDialogOpening', params: { type: 'beforeunload' } })
  expect(listener).toHaveBeenCalledWith({ type: 'beforeunload' })
  const confirm = client.send('Page.handleJavaScriptDialog', { accept: true })
  socket!.emit({ id: socket!.sent[1].id, result: {} })
  await confirm
  socket!.emit({ id: socket!.sent[0].id, result: { frameId: 'fixture' } })
  await expect(pending).resolves.toEqual({ frameId: 'fixture' })
  unsubscribe()
  socket!.emit({ method: 'Page.javascriptDialogOpening', params: { type: 'alert' } })
  expect(listener).toHaveBeenCalledTimes(1)
  client.close()
})
