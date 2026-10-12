import { validateClipCanvas, type ClipCanvasSettings } from '@xsheet-remap/core'
import { check, view } from './binary'
import { blob, ClipContainer } from './container'
import { mipmapChain, readLayerPixels, refreshCaches, writeMipmap } from './layers'
import { placePixels } from './raster'
export function inspectCanvas(clip: ClipContainer): ClipCanvasSettings {
  const row = clip.rows('Canvas')[0]
  return { width: Number(row.CanvasWidth), height: Number(row.CanvasHeight), dpi: Number(row.CanvasResolution), basisWidth: Number(row.CropFrameInnerWidth) || Number(row.CanvasWidth), basisHeight: Number(row.CropFrameInnerHeight) || Number(row.CanvasHeight), offsetX: Number(row.CropFrameInnerOffsetX) || 0, offsetY: Number(row.CropFrameInnerOffsetY) || 0 }
}
export function resizeCanvas(clip: ClipContainer, settings: ClipCanvasSettings, fresh: boolean): void {
  validateClipCanvas(settings)
  const canvas = clip.rows('Canvas')[0], old = inspectCanvas(clip)
  const dx = Math.ceil((settings.width - old.width) / 2), dy = Math.ceil((settings.height - old.height) / 2)
  if (settings.width !== old.width || settings.height !== old.height) {
    const layers = clip.rows('Layer')
    if (!fresh) {
      check(layers.every(layer => [0, 1, 2, 256, 800, 1584].includes(Number(layer.LayerType)) && (layer.LayerType !== 0 || layer.LayerFolder || layer.TextLayerString)), 'このテンプレートにはサイズ変更未対応のレイヤーがあります。「キャンバスサイズを固定」を選択してください。')
      check(clip.rows('Track').every(track => [1000, 2000, 2001, 2003].includes(Number(track.TrackKind))), 'カメラ・変形を含むテンプレートの拡張には未対応です。「キャンバスサイズを固定」を選択してください。')
    }
    for (const layer of layers) {
      for (const mask of [false, true]) {
        const field = mask ? 'LayerLayerMaskMipmap' : 'LayerRenderMipmap'
        if (!layer[field]) continue
        const off = mipmapChain(clip, layer[field])[0].off, stored = clip.body(off.BlockData)
        const aw = view(blob(off.Attribute)).getUint32(38), ah = view(blob(off.Attribute)).getUint32(42)
        const width = !layer.LayerFolder && !fresh ? Math.ceil(Math.max(settings.width, aw + dx) / 256) * 256 : settings.width
        const height = !layer.LayerFolder && !fresh ? Math.ceil(Math.max(settings.height, ah + dy) / 256) * 256 : settings.height
        const pixels = stored ? placePixels(readLayerPixels(clip, layer, mask), width, height, dx, dy) : undefined
        // Clone before replacing the reference; template attributes remain intact.
        const mip = writeMipmap(clip, layer, pixels ?? { width, height }, clip, layer, mask)
        clip.update('Layer', layer.MainId, { [field]: mip })
      }
      if (!layer.LayerFolder && !fresh) {
        const changes = { LayerOffsetX: Number(layer.LayerOffsetX) + dx, LayerOffsetY: Number(layer.LayerOffsetY) + dy,
          LayerRenderOffscrOffsetX: Number(layer.LayerRenderOffscrOffsetX) - dx, LayerRenderOffscrOffsetY: Number(layer.LayerRenderOffscrOffsetY) - dy,
          ...(layer.LayerLayerMaskMipmap ? { LayerMaskOffscrOffsetX: Number(layer.LayerMaskOffscrOffsetX) - dx, LayerMaskOffscrOffsetY: Number(layer.LayerMaskOffscrOffsetY) - dy } : {}) }
        clip.update('Layer', layer.MainId, changes)
        if (layer.LayerEffectInfo) {
          const effect = blob(layer.LayerEffectInfo).slice()
          check(effect.length === 610 && view(effect).getUint32(120) === 45 && view(effect).getUint32(124) === 30, 'このレイヤー効果のサイズ変更には対応していません。')
          view(effect).setInt32(132, view(effect).getInt32(132) + dx); view(effect).setInt32(136, view(effect).getInt32(136) + dy)
          clip.update('Layer', layer.MainId, { LayerEffectInfo: effect })
        }
      }
    }
  }
  clip.update('Canvas', canvas.MainId, { CanvasWidth: settings.width, CanvasHeight: settings.height, CanvasResolution: settings.dpi,
    CropFrameWidth: settings.width, CropFrameHeight: settings.height, CropFrameCropOffsetX: 0, CropFrameCropOffsetY: 0,
    CropFrameInnerWidth: settings.basisWidth, CropFrameInnerHeight: settings.basisHeight, CropFrameInnerOffsetX: settings.offsetX, CropFrameInnerOffsetY: settings.offsetY,
    CropFrameInnerOffsetBasePosition: 4, CropFrameDesignationType: 0, CropFrameOptionFlag: Number(canvas.CropFrameOptionFlag) | 8194 })
  refreshCaches(clip, settings.width, settings.height)
}
