// Fixed 0.2.0 oracle: keep the pre-migration application translation independent of the new writer.
import { writeClip, type ClipWriteOptions as LegacyOptions } from 'celcodec-legacy/write'
import { readEditableDocument } from 'celcodec-legacy/read'
import { normalizeClipName } from '@xsheet-remap/core'
import type { SqlJsStatic } from 'sql.js'
import type { ClipWriteOptions } from '../writer'
import { clipSourceBytes } from '../document-data'

export { readEditableDocument as readLegacyClip }
export function writeLegacyClip(SQL: SqlJsStatic, seed: Uint8Array, options: ClipWriteOptions) {
  const { plan, ...settings } = options, state = plan.document
  const legacy: LegacyOptions = { ...settings, pathIdentity: normalizeClipName, plan: {
    namespace: 'xsheet-remap:clip:1:' + plan.projectId, rootName: 'xsheet-remap', folders: plan.folders,
    timelines: plan.timelines.map(time => ({ ...time, audio: time.audio && { ...time.audio,
      assets: time.audio.assets.map(({ dataUrl, ...asset }) => ({ ...asset, bytes: clipSourceBytes(dataUrl) })) } })),
    document: state ? { nodes: state.nodes, canvas: state.canvas, source: state.source && clipSourceBytes(state.source.dataUrl) } : undefined,
  } }
  return writeClip(SQL, seed, legacy)
}
