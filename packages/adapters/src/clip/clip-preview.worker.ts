import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { readClipLayerPreview } from './preview'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ bytes: Uint8Array; layerId: number }>) => void
  postMessage: (value: unknown, transfer?: Transferable[]) => void
}
scope.onmessage = async event => {
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const result = await readClipLayerPreview(SQL, event.data.bytes, event.data.layerId)
    scope.postMessage({ type: 'done', result }, [result.bytes.buffer as ArrayBuffer])
  } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
