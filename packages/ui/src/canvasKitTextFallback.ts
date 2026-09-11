import type { Canvas, CanvasKit } from 'canvaskit-wasm'
import type { SceneNode, SceneText } from './canvasKitScene'
import { SHEET_TEXT_FONT_FAMILY } from './textMetrics'

/** Preserve OS-fallback glyphs (emoji or scripts outside the bundled font).
 * Ordinary Japanese text is shaped by Skia. Only uncovered text uses this path.
 */
export function drawFallbackText(kit: CanvasKit, target: Canvas, node: SceneNode, text: SceneText) {
  const bitmap = document.createElement('canvas')
  const context = bitmap.getContext('2d')
  if (!context) throw new Error('Fallback glyph context is unavailable')
  const font = `${text.italic ? 'italic' : 'normal'} ${text.weight} ${text.size}px ${text.family || SHEET_TEXT_FONT_FAMILY}`
  context.font = font
  context.letterSpacing = `${text.letterSpacing}px`
  const metrics = context.measureText(text.value)
  const padding = text.size
  const width = Math.ceil(metrics.width + padding * 2)
  const height = Math.ceil(text.size * 4)
  const ratio = Math.min(4, Math.sqrt(2_000_000 / Math.max(1, width * height)))
  bitmap.width = Math.max(1, Math.ceil(width * ratio)); bitmap.height = Math.max(1, Math.ceil(height * ratio))
  context.scale(ratio, ratio)
  context.font = font; context.letterSpacing = `${text.letterSpacing}px`
  context.textBaseline = 'alphabetic'
  const order = node.paint.order?.startsWith('stroke') ? ['stroke', 'fill'] as const : ['fill', 'stroke'] as const
  for (const pass of order) {
    if (node.paint[pass] === 'none') continue
    if (pass === 'fill') {
      context.fillStyle = node.paint.fill; context.globalAlpha = node.paint.fillOpacity
      context.fillText(text.value, padding, padding + text.size)
    } else if (node.paint.strokeWidth > 0) {
      context.strokeStyle = node.paint.stroke; context.globalAlpha = node.paint.strokeOpacity
      context.lineWidth = node.paint.strokeWidth; context.lineJoin = node.paint.join as CanvasLineJoin
      context.strokeText(text.value, padding, padding + text.size)
    }
  }
  const image = kit.MakeImageFromCanvasImageSource(bitmap)
  const paint = new kit.Paint()
  const x = text.x - padding - (text.anchor === 'middle' ? metrics.width / 2 : text.anchor === 'end' ? metrics.width : 0)
  const baselineOffset = text.baseline === 'central' ? (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
    : text.baseline === 'middle' ? text.size * 0.25
      : text.baseline === 'hanging' || text.baseline === 'text-before-edge' ? metrics.actualBoundingBoxAscent
        : text.baseline === 'text-after-edge' ? -metrics.actualBoundingBoxDescent : 0
  try {
    target.drawImageRectOptions(image, kit.XYWHRect(0, 0, bitmap.width, bitmap.height),
      kit.XYWHRect(x, text.y + baselineOffset - padding - text.size, width, height), kit.FilterMode.Linear, kit.MipmapMode.None, paint)
  } finally { paint.delete(); image.delete(); bitmap.width = bitmap.height = 1 }
}
