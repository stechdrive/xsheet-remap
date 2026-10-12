import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import seedUrl from './blank.clip?url'
import { inspectClip, writeClip, type ClipWriteOptions } from './writer'
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ type: 'inspect'; bytes: Uint8Array } | { type: 'write'; options: ClipWriteOptions }>) => void
  postMessage: (value: unknown, transfer?: Transferable[]) => void
}
scope.onmessage = async event => {
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    if (event.data.type === 'inspect') scope.postMessage({ type: 'done', result: inspectClip(SQL, event.data.bytes) })
    else {
      const response = await fetch(seedUrl)
      if (!response.ok) throw new Error('新規CLIPの雛形を読み込めませんでした。')
      const result = await writeClip(SQL, new Uint8Array(await response.arrayBuffer()), event.data.options, message => scope.postMessage({ type: 'progress', message }))
      scope.postMessage({ type: 'done', result }, [result.bytes.buffer as ArrayBuffer])
    }
  } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
