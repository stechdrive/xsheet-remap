import { check } from './binary'
import { renderClipMaterial } from './material-image'
import { applyLayerColor, applyMaterialEffects } from './material-effects'
import { withCanvasResources } from './render-resources'
import { cropPixels } from './pixels'
import type { ClipLayer, ClipPixels } from './types'
import { applyEdge } from './edge-effect'
import { applyWatercolor } from './watercolor-effect'

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
  const water = layer.effects?.watercolor
  const renderWater = water && !water.style && water.range > 0 && water.opacity > 0
  if (layer.pixels && !layer.placement && !layer.fragments?.length && !layer.text?.length
    && ((!layer.effects?.edge && !renderWater) || Number.isInteger(layer.pixels.left) && Number.isInteger(layer.pixels.top))) {
    let pixels = layer.pixels
    // Saved pixels and pixel effects need no canvas API. This also keeps the
    // worker path usable in WebKit where OffscreenCanvas is unavailable.
    if (layer.effects?.edge || renderWater) {
      const padding = (layer.effects?.edge ? Math.ceil(layer.effects.edge.radius + 1.5) : 0) + (renderWater ? Math.ceil(water.blur) : 0)
      const left = Math.max(0, pixels.left - padding), top = Math.max(0, pixels.top - padding)
      const right = Math.min(width, pixels.left + pixels.width + padding), bottom = Math.min(height, pixels.top + pixels.height + padding)
      const w = Math.max(1, right - left), h = Math.max(1, bottom - top)
      check(w * h * 20 <= 512 * 1024 * 1024, 'プレビューの画像展開量が上限を超えました。')
      const rgba = new Uint8ClampedArray(w * h * 4)
      const x0 = Math.max(left, pixels.left), x1 = Math.min(right, pixels.left + pixels.width)
      if (x1 > x0) for (let y = Math.max(top, pixels.top); y < Math.min(bottom, pixels.top + pixels.height); y++) {
        const start = ((y - pixels.top) * pixels.width + x0 - pixels.left) * 4
        rgba.set(pixels.rgba.subarray(start, start + (x1 - x0) * 4), ((y - top) * w + x0 - left) * 4)
      }
      pixels = { width: w, height: h, left, top, rgba }
    }
    if (layer.effects?.layerColor) applyLayerColor(pixels.rgba, layer.effects.layerColor)
    if (renderWater) applyWatercolor(pixels.rgba, pixels.width, pixels.height, water)
    if (layer.effects?.edge) applyEdge(pixels.rgba, pixels.width, pixels.height, layer.effects.edge)
    const masked = maskPreview(pixels, layer.mask)
    return pixels === layer.pixels ? masked : cropPixels(masked)
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
