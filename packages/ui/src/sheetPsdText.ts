import type { Layer, LayerTextData, PixelData } from 'ag-psd'
import { SHEET_TEXT_FONT_FAMILY, textFontDeclaration } from './textMetrics'
import type { VerticalTextGlyph } from './verticalTextLayout'
import { srgbProfile } from './srgbProfile'

type Rect = { x: number; y: number; w: number; h: number }
export type SheetExportText = {
  text: string
  x: number
  y: number
  size: number
  weight: number
  offsetY: number
  leading?: number
  vertical?: boolean
  glyphs?: VerticalTextGlyph[]
  name?: string
  groups?: string[]
  clips?: Rect[]
  stroke?: boolean
}

export type SheetTextOutput = SheetPsdTextCollector | 'omit'

// The callback is the image export's actual drawing operation, also used for
// each text layer's cached pixels. PSD text coordinates use the same layout.
export function drawSheetExportText(
  output: SheetTextOutput | undefined,
  ctx: CanvasRenderingContext2D,
  spec: SheetExportText,
  draw: (target: CanvasRenderingContext2D) => void,
) {
  if (output === 'omit') return
  if (output) output.add(ctx, spec, draw)
  draw(ctx)
}

export function verticalPsdLayout(glyphs: VerticalTextGlyph[], size: number, defaultLeading = size * 1.25) {
  const first = glyphs[0]
  if (!first) return { text: '', x: 0, y: 0, leading: defaultLeading, tracking: 0 }
  let text = first.value
  let leading = defaultLeading
  let step = size
  for (let i = 1; i < glyphs.length; i++) {
    const previous = glyphs[i - 1], glyph = glyphs[i]
    if (Math.abs(glyph.xPx - previous.xPx) > .01) {
      const columns = Math.max(1, Math.round((previous.xPx - glyph.xPx) / defaultLeading))
      text += '\n'.repeat(columns)
      leading = (previous.xPx - glyph.xPx) / columns
    } else if (glyph.yPx > previous.yPx) {
      step = glyph.yPx - previous.yPx
    }
    text += glyph.value
  }
  // Photoshop expects an integer Tracking value. A fractional EngineData
  // number is interpreted as fixed-point and can move the text off the page.
  return { text, x: first.xPx, y: first.yPx - size * .932, leading, tracking: Math.round((step / size - 1) * 1000) }
}

export function sheetPsdTextProperties(ctx: CanvasRenderingContext2D, spec: SheetExportText): LayerTextData {
  const vertical = spec.vertical && spec.glyphs ? verticalPsdLayout(spec.glyphs, spec.size, spec.leading) : undefined
  const baseline = ctx.textBaseline
  ctx.save()
  ctx.font = textFontDeclaration({ family: SHEET_TEXT_FONT_FAMILY, sizePx: spec.size, weight: spec.weight })
  ctx.textBaseline = 'alphabetic'
  const alphabetic = ctx.measureText('国').actualBoundingBoxAscent
  ctx.textBaseline = baseline
  const offset = alphabetic - ctx.measureText('国').actualBoundingBoxAscent
  ctx.restore()
  return {
    text: vertical?.text ?? spec.text,
    transform: [1, 0, 0, 1, vertical?.x ?? spec.x, (vertical?.y ?? spec.y + offset) - spec.offsetY],
    orientation: vertical ? 'vertical' : 'horizontal', shapeType: 'point', pointBase: [0, 0], antiAlias: 'smooth',
    style: {
      font: { name: spec.weight >= 750 ? 'LINESeedJP-ExtraBold' : spec.weight >= 550 ? 'LINESeedJP-Bold' : 'LINESeedJP-Regular', script: 1, type: 1, synthetic: 0 },
      fontSize: spec.size, leading: vertical?.leading ?? spec.leading ?? spec.size * 1.25,
      autoLeading: false, tracking: vertical?.tracking ?? 0, autoKerning: false, kerning: 0,
      horizontalScale: 1, verticalScale: 1, baselineDirection: 1, ligatures: false,
      fillColor: canvasColor(ctx.fillStyle), fillFlag: true,
      ...(spec.stroke ? { strokeFlag: true, strokeColor: canvasColor(ctx.strokeStyle), outlineWidth: ctx.lineWidth, fillFirst: false } : {}),
    },
    paragraphStyle: {
      justification: vertical ? 'left' : ctx.textAlign === 'center' ? 'center' : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? 'right' : 'left',
      // LINE Seed JP's space advances .345 em; app vertical layout uses 1 em.
      ...(vertical ? { wordSpacing: [1 / .345, 1 / .345, 1 / .345] } : {}),
      autoHyphenate: false, everyLineComposer: false, leadingType: 1,
    },
  }
}

function canvasColor(color: string | CanvasGradient | CanvasPattern) {
  // Canvas normalizes named/hex colors, including rgba, before we inspect them.
  const value = String(color)
  if (value.startsWith('#')) return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16), a: value.length === 9 ? parseInt(value.slice(7, 9), 16) : 255 }
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]
  return { r: channels[0], g: channels[1], b: channels[2], a: (channels[3] ?? 1) * 255 }
}

export class SheetPsdTextCollector {
  private readonly pages = new Map<number, Layer[]>()
  constructor(private readonly width: number, private readonly height: number) {}

  add(ctx: CanvasRenderingContext2D, spec: SheetExportText, draw: (target: CanvasRenderingContext2D) => void) {
    if (!spec.text.trim() && !spec.glyphs?.length) return
    const text = sheetPsdTextProperties(ctx, spec)
    const bounds = textBounds(ctx, spec)
    let left = Math.max(0, Math.floor(bounds.x)), top = Math.max(spec.offsetY, Math.floor(bounds.y))
    let right = Math.min(this.width, Math.ceil(bounds.x + bounds.w)), bottom = Math.min(spec.offsetY + this.height, Math.ceil(bounds.y + bounds.h))
    for (const clip of spec.clips ?? []) {
      left = Math.max(left, Math.floor(clip.x)); top = Math.max(top, Math.floor(clip.y))
      right = Math.min(right, Math.ceil(clip.x + clip.w)); bottom = Math.min(bottom, Math.ceil(clip.y + clip.h))
    }
    if (right <= left || bottom <= top) return
    const canvas = document.createElement('canvas')
    canvas.width = right - left; canvas.height = bottom - top
    const target = canvas.getContext('2d', { willReadFrequently: true })!
    target.font = ctx.font; target.fillStyle = ctx.fillStyle; target.strokeStyle = ctx.strokeStyle
    target.textAlign = ctx.textAlign; target.textBaseline = ctx.textBaseline
    target.lineWidth = ctx.lineWidth; target.lineJoin = ctx.lineJoin
    target.translate(-left, -top)
    for (const clip of spec.clips ?? []) { target.beginPath(); target.rect(clip.x, clip.y, clip.w, clip.h); target.clip() }
    draw(target)
    const layer: Layer = {
      name: spec.name ?? text.text.replace(/\n/g, ' ').slice(0, 80),
      left, top: top - spec.offsetY, imageData: target.getImageData(0, 0, canvas.width, canvas.height), text,
      opacity: ctx.globalAlpha,
    }
    // A mask preserves the app's cell/memo clipping when Photoshop redraws text.
    if (spec.clips?.length) {
      const clip = spec.clips.reduce((a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
        w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
        h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) }))
      const x = Math.max(0, Math.floor(clip.x)), y = Math.max(spec.offsetY, Math.floor(clip.y))
      const w = Math.max(1, Math.min(this.width, Math.ceil(clip.x + clip.w)) - x)
      const h = Math.max(1, Math.min(spec.offsetY + this.height, Math.ceil(clip.y + clip.h)) - y)
      const data = new Uint8ClampedArray(w * h * 4).fill(255)
      layer.mask = { left: x, top: y - spec.offsetY, defaultColor: 0, imageData: { width: w, height: h, data } }
    }
    const page = Math.round(spec.offsetY / this.height)
    let children: Layer[] = this.pages.get(page) ?? []
    this.pages.set(page, children)
    for (const name of spec.groups ?? []) {
      let group: Layer | undefined = children.find(child => child.name === name && child.children)
      if (!group) { group = { name, opened: false, children: [] }; children.push(group) }
      children = group.children!
    }
    children.push(layer)
    canvas.width = canvas.height = 0
  }

  forPage(index: number): Layer[] { return this.pages.get(index) ?? [] }
}

function textBounds(ctx: CanvasRenderingContext2D, spec: SheetExportText): Rect {
  if (spec.glyphs?.length) {
    const xs = spec.glyphs.map(g => g.xPx), ys = spec.glyphs.map(g => g.yPx)
    return { x: Math.min(...xs) - spec.size * 1.5, y: Math.min(...ys) - spec.size * 1.5,
      w: Math.max(...xs) - Math.min(...xs) + spec.size * 3, h: Math.max(...ys) - Math.min(...ys) + spec.size * 3 }
  }
  ctx.save()
  ctx.font = textFontDeclaration({ family: SHEET_TEXT_FONT_FAMILY, sizePx: spec.size, weight: spec.weight })
  const lines = spec.text.split('\n'), metrics = lines.map(line => ctx.measureText(line))
  const left = Math.max(...metrics.map(m => m.actualBoundingBoxLeft)), right = Math.max(...metrics.map(m => m.actualBoundingBoxRight))
  const ascent = Math.max(...metrics.map(m => m.actualBoundingBoxAscent)), descent = Math.max(...metrics.map(m => m.actualBoundingBoxDescent))
  ctx.restore()
  const pad = (spec.stroke ? ctx.lineWidth : 0) + 2
  return { x: spec.x - left - pad, y: spec.y - ascent - pad, w: left + right + pad * 2,
    h: ascent + descent + (lines.length - 1) * (spec.leading ?? spec.size * 1.25) + pad * 2 }
}

export async function writeSheetTextPsd(width: number, height: number, dpi: number, children: Layer[], imageData: PixelData) {
  const { writePsdUint8Array } = await import('ag-psd')
  const bytes = writePsdUint8Array({ width, height, children, imageData, imageResources: { resolutionInfo: {
    horizontalResolution: dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches',
    verticalResolution: dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches',
  } } }, { invalidateTextLayers: true })
  return tagSrgb(bytes)
}

// ag-psd does not currently serialize ICC resource 1039. Keep browser sRGB
// explicit so Photoshop's working profile cannot change colors on re-save.
function tagSrgb(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const resourceOffset = 30 + view.getUint32(26)
  const resourceLength = view.getUint32(resourceOffset)
  const end = resourceOffset + 4 + resourceLength
  const block = new Uint8Array(12 + srgbProfile.length)
  block.set([56, 66, 73, 77, 4, 15, 0, 0]) // 8BIM, ICC Profile, empty Pascal name
  new DataView(block.buffer).setUint32(8, srgbProfile.length)
  block.set(srgbProfile, 12)
  const result = new Uint8Array(bytes.length + block.length)
  result.set(bytes.subarray(0, end)); result.set(block, end); result.set(bytes.subarray(end), end + block.length)
  new DataView(result.buffer).setUint32(resourceOffset, resourceLength + block.length)
  return result
}
