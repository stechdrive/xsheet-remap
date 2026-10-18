import { check } from './binary'
import { renderClipMaterial } from './material-image'
import { applyLayerColor, applyMaterialEffects } from './material-effects'
import { withCanvasResources } from './render-resources'
import { cropPixels } from './pixels'
import type { ClipLayer, ClipPixels } from './types'

/** Masks are in document coordinates and may have a different extent or origin. */
export function maskPreview(pixels: ClipPixels, mask?: ClipPixels): ClipPixels {
  if (!mask || mask.disabled) return pixels
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    const mx = x + pixels.left - mask.left, my = y + pixels.top - mask.top
    const value = mx >= 0 && my >= 0 && mx < mask.width && my < mask.height
      ? mask.rgba[(my * mask.width + mx) * 4] : mask.defaultColor ?? 255
    const at = (y * pixels.width + x) * 4 + 3
    pixels.rgba[at] = Math.round(pixels.rgba[at] * value / 255)
  }
  return pixels
}

/** Render one material, retaining its own effects and mask without export opacity rules. */
export function previewMaterialImage(layer: ClipLayer, width: number, height: number): ClipPixels {
  check(!layer.adjustment, '色調補正レイヤーは単独でプレビューできません。親フォルダーで確認してください。')
  if (layer.pixels && !layer.placement && !layer.fragments?.length && !layer.text?.length && !layer.effects?.edge) {
    if (layer.effects?.layerColor) applyLayerColor(layer.pixels.rgba, layer.effects.layerColor)
    return maskPreview(layer.pixels, layer.mask)
  }
  check(layer.pixels || layer.fragments?.length || layer.text?.length, 'このレイヤーの画像を復元できません。')
  check(width * height * 20 <= 512 * 1024 * 1024, 'プレビューの画像展開量が上限を超えました。')
  return withCanvasResources(() => {
    const material = renderClipMaterial(layer, width, height)
    check(material, 'このレイヤーの画像を復元できません。')
    const canvas = applyMaterialEffects(material.canvas, material.left, material.top, layer.effects, width, height)
    const hasEffects = canvas !== material.canvas
    const pixels = { width: canvas.width, height: canvas.height, left: hasEffects ? 0 : material.left, top: hasEffects ? 0 : material.top,
      rgba: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data }
    return cropPixels(maskPreview(pixels, layer.mask))
  }, () => [])
}
