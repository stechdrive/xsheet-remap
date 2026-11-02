import { createClipPreviewSession } from './runtime'

/** One immutable source revision, no retained PNGs. Idle sources over 64 MiB are released immediately. */
export function createClipPreviewCache() {
  type Reader = ReturnType<typeof createClipPreviewSession>
  type Entry = { source: string; reader: Reader; leases: number; pending: number; timer?: ReturnType<typeof setTimeout> }
  let current: Entry | undefined
  const close = (entry: Entry) => {
    clearTimeout(entry.timer)
    entry.reader.dispose()
    if (current === entry) current = undefined
  }
  const idle = (entry: Entry) => {
    if (current !== entry || entry.leases || entry.pending) return
    clearTimeout(entry.timer)
    if (entry.source.length * 3 / 4 > 64 * 1024 * 1024) close(entry)
    else entry.timer = setTimeout(() => close(entry), 30_000)
  }
  return {
    dispose() { if (current) close(current) },
    acquire(source: string, signal: AbortSignal): Reader {
      if (signal.aborted) throw new DOMException('キャンセルしました。', 'AbortError')
      if (current?.source !== source) {
        if (current) close(current)
        current = { source, reader: createClipPreviewSession(source), leases: 0, pending: 0 }
      }
      const entry = current
      clearTimeout(entry.timer); entry.leases++
      let released = false
      const abortError = () => new DOMException('キャンセルしました。', 'AbortError')
      const waiting = new Set<(reason: Error) => void>()
      const dispose = () => {
        if (released) return
        released = true; entry.leases--
        signal.removeEventListener('abort', dispose)
        for (const reject of waiting) reject(abortError())
        waiting.clear()
        // Stop obsolete synchronous SQL/raster work instead of queuing more work behind it.
        if (!entry.leases && entry.pending) close(entry)
        else idle(entry)
      }
      signal.addEventListener('abort', dispose, { once: true })
      return {
        dispose,
        get closed() { return released || current !== entry || entry.reader.closed },
        read(layerId) {
          if (released || current !== entry) return Promise.reject(abortError())
          entry.pending++
          return new Promise((resolve, reject) => {
            waiting.add(reject)
            const finish = () => { waiting.delete(reject); entry.pending--; idle(entry) }
            void entry.reader.read(layerId).then(value => { finish(); resolve(value) }, error => {
              finish()
              if (entry.reader.closed) close(entry)
              reject(error)
            })
          })
        },
      }
    },
  }
}
