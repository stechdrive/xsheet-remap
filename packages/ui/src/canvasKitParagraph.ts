import type { Canvas, CanvasKit } from 'canvaskit-wasm'
import type { CanvasKitFonts } from './canvasKitRuntime'
import type { SceneNode, SceneText } from './canvasKitScene'
import { drawFallbackText } from './canvasKitTextFallback'

/** Shape text in the shared font and preserve the readable outline of cue/memo labels. */
export function drawCanvasKitText(kit: CanvasKit, canvas: Canvas, fonts: CanvasKitFonts, node: SceneNode, text: SceneText) {
  if (!fonts.supports(text)) { drawFallbackText(kit, canvas, node, text); return }
  const style = new kit.TextStyle({
    fontFamilies: fonts.families(text.weight), fontSize: text.size,
    fontStyle: { weight: { value: text.weight }, slant: text.italic ? kit.FontSlant.Italic : kit.FontSlant.Upright },
    letterSpacing: text.letterSpacing, locale: 'ja',
  })
  const foreground = new kit.Paint(), background = new kit.Paint()
  foreground.setAntiAlias(true); background.setColor(kit.TRANSPARENT)
  const order = node.paint.order?.startsWith('stroke') ? ['stroke', 'fill'] as const : ['fill', 'stroke'] as const
  try {
    for (const pass of order) {
      const color = node.paint[pass]
      if (color === 'none' || (pass === 'stroke' && node.paint.strokeWidth <= 0)) continue
      const rgba = kit.parseColorString(color)
      rgba[3] *= pass === 'fill' ? node.paint.fillOpacity : node.paint.strokeOpacity
      foreground.setColor(rgba)
      foreground.setStyle(pass === 'fill' ? kit.PaintStyle.Fill : kit.PaintStyle.Stroke)
      foreground.setStrokeWidth(node.paint.strokeWidth)
      foreground.setStrokeJoin(node.paint.join === 'round' ? kit.StrokeJoin.Round : node.paint.join === 'bevel' ? kit.StrokeJoin.Bevel : kit.StrokeJoin.Miter)
      const builder = kit.ParagraphBuilder.MakeFromFontProvider(new kit.ParagraphStyle({ textStyle: style }), fonts.provider)
      try {
        builder.pushPaintStyle(style, foreground, background)
        builder.addText(text.value)
        const paragraph = builder.build()
        try {
          paragraph.layout(1_000_000)
          const width = paragraph.getLongestLine()
          const x = text.x - (text.anchor === 'middle' ? width / 2 : text.anchor === 'end' ? width : 0)
          const baseline = paragraph.getAlphabeticBaseline()
          const y = text.y - (text.baseline === 'central' ? paragraph.getHeight() / 2
            : text.baseline === 'middle' ? baseline - text.size * 0.25
              : text.baseline === 'hanging' || text.baseline === 'text-before-edge' ? 0
                : text.baseline === 'text-after-edge' ? paragraph.getHeight() : baseline)
          canvas.drawParagraph(paragraph, x, y)
        } finally { paragraph.delete() }
      } finally { builder.delete() }
    }
  } finally { foreground.delete(); background.delete() }
}
