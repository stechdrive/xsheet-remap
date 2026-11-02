import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { createClipLayerPreviewReader } from './preview'
import { clipSourceBytes } from './document-data'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; source?: Uint8Array | string; layerId: number }>) => void
  postMessage: (value: unknown, transfer?: Transferable[]) => void
}
let reader: ReturnType<typeof createClipLayerPreviewReader> | undefined
let queue = Promise.resolve()
scope.onmessage = event => {
  const { id, source, layerId } = event.data
  queue = queue.then(async () => {
    try {
      if (!reader) {
        if (source === undefined) throw new Error('CLIPの元データがありません。')
        const SQL = await initSqlJs({ locateFile: () => wasmUrl })
        // The structured clone / decoded data URL is private to this Worker.
        reader = createClipLayerPreviewReader(SQL, typeof source === 'string' ? clipSourceBytes(source) : source, 'borrow')
      }
      const result = await reader.read(layerId)
      scope.postMessage({ type: 'done', id, result }, [result.bytes.buffer as ArrayBuffer])
    } catch (error) { scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) }) }
  })
}
