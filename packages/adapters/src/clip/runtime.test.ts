import { afterEach, expect, it, vi } from 'vitest'
import { createClipPreviewSession, previewClipLayer } from './runtime'

class PreviewWorker {
  static instances: PreviewWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { message: string }) => void
  messages: Array<{ id: number; source?: string | Uint8Array; layerId: number }> = []
  terminate = vi.fn()
  constructor() { PreviewWorker.instances.push(this) }
  postMessage(message: typeof this.messages[number]) { this.messages.push(structuredClone(message)) }
  complete(index: number) { this.onmessage?.({ data: { id: this.messages[index].id, type: 'done', result: { bytes: new Uint8Array([1, 2]), width: 1, height: 1 } } }) }
}
afterEach(() => { vi.unstubAllGlobals(); PreviewWorker.instances = [] })

it('sends encoded source once, shares a worker across gallery reads and releases it explicitly', async () => {
  vi.stubGlobal('Worker', PreviewWorker)
  const source = 'data:application/x-clip-studio;base64,AQID', session = createClipPreviewSession(source)
  expect(PreviewWorker.instances).toHaveLength(0)
  const first = session.read(10), worker = PreviewWorker.instances[0]
  expect(worker.messages).toEqual([{ id: 0, source, layerId: 10 }])
  worker.onmessage?.({ data: { id: 0, type: 'error', message: 'no saved composite' } })
  await expect(first).rejects.toThrow('no saved composite')
  const second = session.read(11)
  expect(PreviewWorker.instances).toHaveLength(1)
  expect(worker.messages[1]).toEqual({ id: 1, layerId: 11 })
  worker.complete(1)
  expect((await second).bytes).toEqual(new Uint8Array([1, 2]))
  session.dispose(); session.dispose()
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  await expect(session.read(12)).rejects.toHaveProperty('name', 'AbortError')
})

it('preserves borrowed source bytes for save/export and terminates a one-shot preview', async () => {
  vi.stubGlobal('Worker', PreviewWorker)
  const source = new Uint8Array([0, 255, 4]), request = previewClipLayer(source, 1)
  PreviewWorker.instances[0].complete(0)
  await request
  expect(source).toEqual(new Uint8Array([0, 255, 4]))
  expect(PreviewWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
})

it('aborts every pending read and handles worker startup failures without leaving a worker', async () => {
  vi.stubGlobal('Worker', PreviewWorker)
  const controller = new AbortController(), session = createClipPreviewSession('source', controller.signal)
  const first = session.read(1), second = session.read(2)
  controller.abort()
  await expect(first).rejects.toHaveProperty('name', 'AbortError')
  await expect(second).rejects.toHaveProperty('name', 'AbortError')
  expect(PreviewWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  const failed = previewClipLayer('source', 1)
  PreviewWorker.instances[1].onerror?.({ message: 'startup failed' })
  await expect(failed).rejects.toThrow('startup failed')
  expect(PreviewWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
})
