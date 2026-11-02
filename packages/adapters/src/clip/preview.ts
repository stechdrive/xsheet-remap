import type { SqlJsStatic } from 'sql.js'
import { png } from './raster'
import { check } from './binary'
import { previewMaterialImage } from './material/preview-image'
import { layerRenderingDiagnostics } from './material/rendering-status'
import { codecCall, codecMessage } from './material/celcodec'
import { flattenLayers, openClipSession } from './session'
import type { ClipLayer } from './material/types'

export interface ClipLayerPreview {
  bytes: Uint8Array; width: number; height: number; storedComposite: boolean
  reconstructed?: boolean
  source?: ClipLayer['materialSource']
  warnings?: string[]
}
export async function readClipLayerPreview(SQL: SqlJsStatic, bytes: Uint8Array, layerId: number): Promise<ClipLayerPreview> {
  const reader = createClipLayerPreviewReader(SQL, bytes)
  try { return await reader.read(layerId) } finally { reader.close() }
}
export function createClipLayerPreviewReader(SQL: SqlJsStatic, bytes: Uint8Array, ownership: 'copy' | 'borrow' = 'copy') {
  return codecCall(() => {
    const session = openClipSession(SQL, bytes, ownership)
    try {
      const { width, height } = session.document.canvas
      check(width * height <= 64 * 1024 * 1024, 'キャンバス寸法が範囲外です。')
      const layers = new Map(flattenLayers(session.document.layers).map(layer => [layer.nativeId, layer]))
      return { close: () => session.dispose(), read: (layerId: number): Promise<ClipLayerPreview> => codecCall(async () => {
        const view = layers.get(layerId)
        check(view, 'レイヤーが見つかりません。')
        const storedComposite = view.folder || view.kind === 'video'
        const decoded = await session.decodeLayer(view.id, {
          source: storedComposite ? 'saved' : 'prefer-original', budget: 'extent', vectorReservation: true,
        })
        const layer: ClipLayer = { isAnimationFolder: view.animation, expanded: view.expanded ?? true, hidden: false,
          opacity: 1, clipping: false, children: [], ...decoded.layer,
          kind: storedComposite ? 'folder' : decoded.layer.kind === 'audio' || decoded.layer.kind === 'video' ? 'other' : decoded.layer.kind }
        const renderingCodes = new Set(['APPROXIMATE_VECTOR', 'APPROXIMATE_TEXT', 'UNSUPPORTED_3D', 'APPROXIMATE_WATERCOLOR', 'UNSUPPORTED_WATERCOLOR_STYLE', 'UNSUPPORTED_TONE'])
        const warnings = decoded.diagnostics.filter(issue => !renderingCodes.has(issue.code)
          && !(issue.code === 'MISSING_VECTOR_DATA' && layer.vectorRendering === 'unavailable'))
          .map(issue => '「' + layer.name + '」: ' + codecMessage(issue.code, issue.data))
        warnings.push(...layerRenderingDiagnostics(layer, session.document.compatibility).map(issue => issue.message))
        check(layer.pixels || layer.fragments?.length || layer.text?.length, storedComposite
          ? view.kind === 'video' ? 'この動画レイヤーには保存済み画像がありません。元のCLIPで動画を確認してください。' : 'フォルダーの保存済み合成画像がありません。'
          : warnings.join('\n') || 'このレイヤーの画像を復元できません。')
        const pixels = previewMaterialImage(layer, width, height)
        return { bytes: png({ width: pixels.width, height: pixels.height, channels: 4,
          data: new Uint8Array(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength) }),
          width: pixels.width, height: pixels.height, storedComposite, source: layer.materialSource,
          reconstructed: ['vector', 'text', 'gradient', 'fill'].includes(layer.materialSource ?? ''), warnings: [...new Set(warnings)] }
      }) }
    } catch (error) { session.dispose(); throw error }
  })
}
