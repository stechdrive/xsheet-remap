// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import { createRenderCanvas as createCanvas } from './render-resources'
import { check } from './binary'
import type { ClipLayer, ClipPixels } from './types'
import type { MaterialQuad, TextObject } from './rendering'

export function pixelCanvas(pixels: ClipPixels): OffscreenCanvas {
  const canvas = createCanvas(pixels.width, pixels.height), ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(pixels.width, pixels.height)
  data.data.set(pixels.rgba); ctx.putImageData(data, 0, 0)
  return canvas
}

/** Inverse homography: document coordinates -> unit source square. */
function inverseQuad(q: MaterialQuad): number[] {
  const matrix: number[][] = []
  for (let i = 0; i < 4; i++) {
    const x = q[i * 2], y = q[i * 2 + 1], u = i === 1 || i === 2 ? 1 : 0, v = i >= 2 ? 1 : 0
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(matrix[r][c]) > Math.abs(matrix[pivot][c])) pivot = r
    ;[matrix[c], matrix[pivot]] = [matrix[pivot], matrix[c]]
    const divisor = matrix[c][c]
    check(Math.abs(divisor) > 1e-10, '画像素材の配置が退化しています')
    for (let j = c; j <= 8; j++) matrix[c][j] /= divisor
    for (let r = 0; r < 8; r++) if (r !== c) {
      const scale = matrix[r][c]
      for (let j = c; j <= 8; j++) matrix[r][j] -= matrix[c][j] * scale
    }
  }
  return matrix.map(row => row[8])
}

export function placeMaterial(pixels: ClipPixels, quad: MaterialQuad): { canvas: OffscreenCanvas; left: number; top: number } {
  const xs = quad.filter((_, i) => i % 2 === 0), ys = quad.filter((_, i) => i % 2 !== 0)
  const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys))
  const width = Math.ceil(Math.max(...xs)) - left, height = Math.ceil(Math.max(...ys)) - top
  check(width > 0 && height > 0 && width * height <= 64 * 1024 * 1024, '配置後の画像サイズが範囲外です')
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')!
  if (Math.abs(quad[0] + quad[4] - quad[2] - quad[6]) < 1e-7 && Math.abs(quad[1] + quad[5] - quad[3] - quad[7]) < 1e-7) {
    ctx.setTransform((quad[2] - quad[0]) / pixels.width, (quad[3] - quad[1]) / pixels.width,
      (quad[6] - quad[0]) / pixels.height, (quad[7] - quad[1]) / pixels.height, quad[0] - left, quad[1] - top)
    ctx.drawImage(pixelCanvas(pixels), 0, 0)
    ctx.resetTransform()
  } else {
    const m = inverseQuad(quad), data = ctx.createImageData(width, height), src = pixels.rgba
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = x + left + 0.5, dy = y + top + 0.5, d = m[6] * dx + m[7] * dy + 1
      const u = (m[0] * dx + m[1] * dy + m[2]) / d, v = (m[3] * dx + m[4] * dy + m[5]) / d
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue
      const sx = u * pixels.width - 0.5, sy = v * pixels.height - 0.5, ix = Math.floor(sx), iy = Math.floor(sy)
      const fx = sx - ix, fy = sy - iy, at = (y * width + x) * 4, sum = [0, 0, 0, 0]
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const px = Math.max(0, Math.min(pixels.width - 1, ix + i)), py = Math.max(0, Math.min(pixels.height - 1, iy + j))
        const pos = (py * pixels.width + px) * 4, weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), alpha = src[pos + 3] / 255
        for (let c = 0; c < 3; c++) sum[c] += src[pos + c] * alpha * weight
        sum[3] += alpha * weight
      }
      for (let c = 0; c < 3; c++) data.data[at + c] = sum[3] > 0 ? sum[c] / sum[3] : 0
      data.data[at + 3] = sum[3] * 255
    }
    ctx.putImageData(data, 0, 0)
  }
  return { canvas, left, top }
}

/** Basic browser text rendering. Cached CSP pixels always take precedence. */
export function drawTextObject(ctx: OffscreenCanvasRenderingContext2D, text: TextObject): void {
  ctx.save(); ctx.textBaseline = 'top'
  let offset = 0, y = text.top
  let line: { char: string; font: string; size: number; color: number[]; width: number }[] = []
  let lineWidth = 0, lineHeight = text.size * 1.2
  let afterCarriageReturn = false
  const flush = () => {
    let x = text.left + (text.align === 'center' ? (text.width - lineWidth) / 2 : text.align === 'right' ? text.width - lineWidth : 0)
    for (const glyph of line) {
      ctx.font = `${glyph.size}px ${JSON.stringify(glyph.font)}, sans-serif`
      ctx.fillStyle = `rgb(${glyph.color.join(',')})`; ctx.fillText(glyph.char, x, y)
      x += glyph.width
    }
    y += lineHeight; line = []; lineWidth = 0; lineHeight = text.size * 1.2
  }
  for (const char of text.text) {
    const style = text.runs.find(r => offset >= r.start && offset < r.start + r.length) ?? text
    offset += char.length
    // Run offsets use the original UTF-16 string, including both characters of CRLF.
    if (char === '\r') { flush(); afterCarriageReturn = true; continue }
    if (char === '\n') { if (!afterCarriageReturn) flush(); afterCarriageReturn = false; continue }
    afterCarriageReturn = false
    ctx.font = `${style.size}px ${JSON.stringify(style.font)}, sans-serif`
    const width = ctx.measureText(char).width
    if (text.width > 0 && line.length && lineWidth + width > text.width) flush()
    line.push({ char, font: style.font, size: style.size, color: style.color, width })
    lineWidth += width; lineHeight = Math.max(lineHeight, style.size * 1.2)
  }
  flush(); ctx.restore()
}

export function renderClipMaterial(layer: ClipLayer, width: number, height: number): { canvas: OffscreenCanvas; left: number; top: number } | undefined {
  if (layer.adjustment) {
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height)
    return { canvas, left: 0, top: 0 }
  }
  if (layer.pixels && !layer.text?.length && !layer.fragments?.length) {
    return layer.placement ? placeMaterial(layer.pixels, layer.placement)
      : { canvas: pixelCanvas(layer.pixels), left: layer.pixels.left, top: layer.pixels.top }
  }
  if (!layer.pixels && !layer.fragments?.length && !layer.text?.length) return
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d')!
  for (const pixels of [...(layer.pixels ? [layer.pixels] : []), ...(layer.fragments ?? [])]) ctx.drawImage(pixelCanvas(pixels), pixels.left, pixels.top)
  for (const text of layer.text ?? []) drawTextObject(ctx, text)
  return { canvas, left: 0, top: 0 }
}
