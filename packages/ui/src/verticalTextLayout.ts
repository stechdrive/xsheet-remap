import { splitTextGraphemes, SHEET_TEXT_FONT_FAMILY, textFontDeclaration } from './textMetrics'
import { verticalGlyphData } from './verticalGlyphData'

export type VerticalTextGlyph = { value: string; xPx: number; yPx: number }

/** The same bundled vert outlines are used by SVG, Skia and Canvas 2D export. */
export function verticalGlyph(value: string, weight = 700) {
  return verticalGlyphData[weight >= 750 ? '800' : weight >= 550 ? '700' : '400'][value]
}

/** Top-left anchored Japanese columns: downwards, then right to left. */
export function layoutVerticalText(text: string, size: number, x: number, y: number, maxHeight: number, boxWidth?: number) {
  const capacity = Math.max(1, Math.floor(maxHeight / size))
  const columns: string[][] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const values = splitTextGraphemes(line)
    if (!values.length) columns.push([])
    for (let i = 0; i < values.length; i += capacity) columns.push(values.slice(i, i + capacity))
  }
  const widthPx = boxWidth ?? Math.max(size, (columns.length - 1) * size * 1.25 + size)
  const heightPx = columns.reduce((height, column) => Math.max(height, column.length * size), size)
  const glyphs = columns.flatMap((column, index) => column.map((value, row) => ({
    value, xPx: x + widthPx - size / 2 - index * size * 1.25, yPx: y + row * size + size * 0.88,
  })))
  return { glyphs, widthPx, heightPx }
}

export function drawVerticalGlyph(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, weight = 700, stroke = false) {
  const glyph = verticalGlyph(value, weight)
  ctx.save()
  try {
    if (glyph) {
      const path = new Path2D(glyph.path)
      const transformed = new Path2D()
      transformed.addPath(path, { a: size, d: size, e: x - glyph.advance * size / 2, f: y })
      if (stroke) ctx.stroke(transformed)
      ctx.fill(transformed)
    } else {
      ctx.font = textFontDeclaration({ family: SHEET_TEXT_FONT_FAMILY, sizePx: size, weight })
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      if (stroke) ctx.strokeText(value, x, y)
      ctx.fillText(value, x, y)
    }
  } finally { ctx.restore() }
}
