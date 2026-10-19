// Adapted from csp-paperback a454748 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { MaterialEffects } from './rendering'
import { createRenderCanvas, canvasBounds, setCanvasBounds } from './render-resources'
import { applyEdge } from './edge-effect'
import { applyWatercolor } from './watercolor-effect'

export function hasDrawableMaterialEffects(effects: MaterialEffects | undefined): boolean {
  const water = effects?.watercolor
  return !!(effects?.layerColor || (effects?.edge && effects.edge.radius > 0) || (water && !water.style && water.range > 0 && water.opacity > 0))
}

/** CSP's saved layer-color ramps; alpha is independent of the drawing color. */
export function applyLayerColor(data: Uint8ClampedArray, color: NonNullable<MaterialEffects['layerColor']>): void {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue
    // Coefficients recovered from native gray/R/G/B ramps and mixed-color pixels.
    const gray = Math.min(255, Math.floor((298912 * data[i] + 586611 * data[i + 1] + 114478 * data[i + 2]) / 1000000))
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((color.main[c] * (255 - gray) + color.sub[c] * gray) / 255)
  }
}

/** Apply effects to the selected material, never to a cached composite of other cels. */
export function applyMaterialEffects(canvas: OffscreenCanvas, left: number, top: number, effects: MaterialEffects | undefined, width: number, height: number): OffscreenCanvas {
  const water = effects?.watercolor
  const renderWater = water && !water.style && water.range > 0 && water.opacity > 0
  if (!effects?.edge && !effects?.layerColor && !renderWater) return canvas
  const result = createRenderCanvas(width, height)
  const ctx = result.getContext('2d')!
  ctx.drawImage(canvas, left, top)
  const padding = (effects?.edge ? Math.max(0, Math.ceil(effects.edge.radius + 1.5)) : 0) + (renderWater ? Math.ceil(water.blur) : 0)
  const area = canvasBounds(canvas, left, top, width, height, padding)
  setCanvasBounds(result, area)
  if (!area.width || !area.height) return result
  const image = ctx.getImageData(area.left, area.top, area.width, area.height)
  // Color the artwork before adding the border; the border keeps its own color.
  if (effects?.layerColor) applyLayerColor(image.data, effects.layerColor)
  if (renderWater) applyWatercolor(image.data, area.width, area.height, water)
  if (effects?.edge) applyEdge(image.data, area.width, area.height, effects.edge)
  ctx.putImageData(image, area.left, area.top)
  return result
}
