import type { SqlJsStatic } from 'sql.js'
import type { ClipImportData, ClipImportNode, ClipLayerNode } from '@xsheet-remap/core'
import { ClipError } from 'celcodec'
import type { LayerView } from 'celcodec/document'
import { codecCall, codecMessage } from './material/celcodec'
import { canvasSettings, openClipSession } from './session'

export function readClip(SQL: SqlJsStatic, bytes: Uint8Array, fileName: string): Promise<ClipImportData> {
  return codecCall(async () => {
    const session = openClipSession(SQL, bytes)
    try {
      const layers: ClipLayerNode[] = []
      function tree(nodes: readonly LayerView[], path: string[], parentVisible: boolean): ClipImportNode[] {
        return nodes.map(node => {
          const visible = node.visible ?? true, fullPath = [...path, node.name]
          const disclosure = node.folder ? { expanded: node.expanded ?? true } : {}
          const kind = node.animation ? 'animation' : node.folder ? 'folder'
            : node.kind === 'audio' || node.kind === 'video' ? node.kind
              : ((node.stored.type ?? 0) & ~2) === 1 ? 'raster' : 'other'
          layers.push({ id: node.id, parentId: node.parentId, name: node.name, kind, sourceLayerId: node.nativeId,
            visible, opacity: node.opacity ?? 1, blendMode: node.blendMode ?? 0, locked: node.locked ?? false,
            ...(node.labelColor ? { labelColor: node.labelColor } : {}), ...disclosure })
          return { id: node.id, name: node.name, path: fullPath, animation: node.animation, visible: parentVisible && visible,
            children: tree(node.children, fullPath, parentVisible && visible), ...disclosure }
        })
      }
      const nodes = tree(session.document.layers, [], true)
      const timelines = session.document.timelines.map(time => {
        if (!(Number.isFinite(time.fps) && time.fps >= 1 && time.fps <= 120 && Number.isInteger(time.startFrame)
          && Number.isInteger(time.endFrame) && time.endFrame > time.startFrame && time.endFrame - time.startFrame <= 1_000_000)) throw new ClipError('INVALID_TIMELINE_RANGE')
        return { id: time.id, name: time.name, fps: time.fps,
        startFrame: time.startFrame, endFrame: time.endFrame, tracks: time.tracks.filter(track => track.kind === 2000).map(track => {
          try {
            const frames = session.readCelTrack(track.id).map(key => {
              const frame = Math.round(key.frame)
              if (!Number.isSafeInteger(frame) || Math.abs(key.frame - frame) >= .001) throw new ClipError('UNSUPPORTED_FRACTIONAL_FRAME')
              return { ...key, frame }
            })
            return { layerId: track.layerId, frames }
          }
          catch (error) {
            if (!(error instanceof ClipError) || ['resource-limit', 'cancelled'].includes(error.diagnostic.kind)) throw error
            return { layerId: track.layerId, frames: [], error: 'CLIP: ' + codecMessage(error.diagnostic.code, error.diagnostic.data) }
          }
        }) }
      })
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
      return { fileName, fileHash: Array.from(digest, value => value.toString(16).padStart(2, '0')).join(''),
        nodes, layers, canvas: canvasSettings(session), timelines, currentTimelineId: session.document.defaultTimelineId ?? timelines[0]?.id ?? '' }
    } finally { session.dispose() }
  })
}
