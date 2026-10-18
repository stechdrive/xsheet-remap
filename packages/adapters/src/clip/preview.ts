import type { SqlJsStatic } from 'sql.js'
import { ClipContainer } from './container'
import { mipmapChain, readLayerPixels } from './layers'
import { png } from './raster'
import { check } from './binary'
import { clipLayerKind, normalizedUuid, optionalRows } from './layer-metadata'

export interface ClipLayerPreview { bytes: Uint8Array; width: number; height: number; storedComposite: boolean }

export function readClipLayerPreview(SQL: SqlJsStatic, bytes: Uint8Array, layerId: number): ClipLayerPreview {
  const clip = new ClipContainer(SQL, bytes)
  try {
    const layer = clip.row('Layer', layerId)
    const surface = mipmapChain(clip, layer.LayerRenderMipmap)[0].off
    check(!layer.LayerFolder || clip.body(surface.BlockData), 'フォルダーの保存済み合成画像がありません。')
    const kind = clipLayerKind(layer, new Map(optionalRows(clip, 'CanvasItem').map(item => [normalizedUuid(item.ItemUuid), item])))
    check(kind !== 'video' || clip.body(surface.BlockData), 'この動画レイヤーには保存済み画像がありません。元のCLIPで動画を確認してください。')
    const pixels = readLayerPixels(clip, layer)
    check(pixels.channels === 4 && pixels.width * pixels.height <= 100_000_000, 'このレイヤーの保存済みプレビューは表示できません。')
    if ((Number(layer.LayerType) & 2) && (Number(layer.LayerVisibility) & 2) && layer.LayerLayerMaskMipmap) {
      const mask = readLayerPixels(clip, layer, true)
      check(mask.width === pixels.width && mask.height === pixels.height, '位置の異なるマスクのプレビューには対応していません。')
      check(['X', 'Y'].every(axis => Number(layer[`LayerMaskOffset${axis}`] ?? 0) + Number(layer[`LayerMaskOffscrOffset${axis}`] ?? 0) === Number(layer[`LayerRenderOffscrOffset${axis}`] ?? 0)), '位置の異なるマスクのプレビューには対応していません。')
      for (let i = 0; i < pixels.width * pixels.height; i++) pixels.data[i * 4 + 3] = Math.round(pixels.data[i * 4 + 3] * mask.data[i * mask.channels] / 255)
    }
    return { bytes: png(pixels), width: pixels.width, height: pixels.height, storedComposite: Boolean(layer.LayerFolder) || (Number(layer.LayerType) & ~2) !== 1 }
  } finally { clip.close() }
}
