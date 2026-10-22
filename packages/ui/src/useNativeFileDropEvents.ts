import { useEffect, useEffectEvent } from 'react'
import { isTauriHost, subscribeNativeDragDrop, type NativeDragDropPayload } from '@xsheet-remap/adapters'
import { clearNativeFileDragPreview } from './nativeFileDragPreview'

/** One subscription lifetime, with the latest committed UI state at delivery time. */
export function useNativeFileDropEvents(handler: (payload: NativeDragDropPayload, source: string) => void): void {
  const receive = useEffectEvent(handler)
  useEffect(() => {
    if (!isTauriHost()) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let previous: { signature: string; timestamp: number } | undefined
    void subscribeNativeDragDrop((payload, source) => {
      if (disposed) return
      if (payload.type === 'drop' && payload.paths?.length) {
        const position = payload.position ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const signature = `${payload.paths.join('\u001f')}@${Math.round(position.x)},${Math.round(position.y)}`
        const timestamp = performance.now()
        if (previous?.signature === signature && timestamp - previous.timestamp < 500) return
        previous = { signature, timestamp }
      }
      receive(payload, `native:${source}`)
    }, ['webview', 'window', 'event']).then(next => {
      if (disposed) next()
      else unsubscribe = next
    }).catch(error => console.error('Failed to subscribe native file drop event', error))
    return () => {
      disposed = true
      unsubscribe?.()
      clearNativeFileDragPreview()
    }
  }, [])
}
