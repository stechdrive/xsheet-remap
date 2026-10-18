// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import { check } from './binary'
import { num, type ClipRow } from './records'
import type { BrushPattern } from './vector'

export interface BrushTexture {
  /** Layer-local coordinates: moving a layer must move its paper grain too. */
  sample: (x: number, y: number) => number
  perDab: boolean
}

const wrap = (v: number, size: number) => (v % size + size) % size
// Keep only the last filter for each bitmap. Shared styles reuse it without
// mutating the decoded alpha or retaining an unbounded set of scale variants.
const filtered = new WeakMap<Uint8Array, { size: number; alpha: Float32Array }>()

/** Periodic, separable box prefilter: linear work, including very small scales. */
function minifiedAlpha(image: BrushPattern, size: number): Uint8Array | Float32Array {
  if (size <= 1) return image.alpha
  const cached = filtered.get(image.alpha)
  if (cached?.size === size) return cached.alpha
  const { width, height, alpha } = image, radius = Math.floor((size - 1) / 2)
  const horizontal = new Float32Array(alpha.length), result = new Float32Array(alpha.length)
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let k = 0; k < size; k++) sum += alpha[y * width + wrap(k - radius, width)]
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / size
      sum += alpha[y * width + wrap(x + size - radius, width)] - alpha[y * width + wrap(x - radius, width)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = 0; k < size; k++) sum += horizontal[wrap(k - radius, height) * width + x]
    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum / size
      sum += horizontal[wrap(y + size - radius, height) * width + x] - horizontal[wrap(y - radius, height) * width + x]
    }
  }
  filtered.set(alpha, { size, alpha: result })
  return result
}

/** Native normal/multiply grain; unknown CSP texture effects remain diagnostic. */
export function createBrushTexture(style: ClipRow, image: BrushPattern | undefined,
  report: (message: string) => void, pixelAligned = false): BrushTexture | undefined {
  if (!num(style, 'TexturePattern') || !(num(style, 'TextureFlag') & 1)) return
  if (!image) { report('紙質画像を復元できないため、紙質なしで描画しました'); return }
  if (![0, 1].includes(num(style, 'TextureComposite'))) { report('未対応の紙質合成方式を、紙質なしで描画しました'); return }
  try {
    const scale = num(style, 'TextureScale', 1), density = num(style, 'TextureDensityBase', 1)
    const rotation = num(style, 'TextureRotate') * Math.PI / 180
    const offsetX = num(style, 'TextureOffsetX'), offsetY = num(style, 'TextureOffsetY')
    check(Number.isFinite(scale) && scale > 0 && scale <= 65536 && Number.isFinite(density) && density >= 0 && density <= 1
      && [rotation, offsetX, offsetY].every(v => Number.isFinite(v) && Math.abs(v) <= 1000000), '紙質の倍率・濃度・座標が不正です')
    check(Number.isInteger(image.width) && Number.isInteger(image.height) && image.width > 0 && image.height > 0
      && image.width * image.height <= 4 * 1024 * 1024 && image.alpha.length === image.width * image.height, '紙質画像の寸法が不正です')
    // Native one-setting captures: bit 0 enables paper, bit 4 applies it per dab.
    const effector = style.TextureDensityEffector
    if (num(style, 'TextureFlag') & ~17 || num(style, 'TextureBrightness') || num(style, 'TextureContrast')
      || effector instanceof Uint8Array && (effector.length !== 4 || effector[0] || effector[1] || effector[2] || effector[3] > 1)) {
      report('紙質の明度・コントラスト・濃度変動など、一部の効果を近似しました')
    }
    const cos = Math.cos(rotation), sin = Math.sin(rotation)
    // Weak-AA image-tip captures sample grain once per output pixel. At 6.25%,
    // a 250px tile repeats after 31px, not 31.25px. Integer intermediate sizing
    // and this prefilter approximate that evidence; CSP's exact kernel is unknown.
    const periodX = Math.max(1, Math.floor(image.width * scale * 2)) / 2
    const periodY = Math.max(1, Math.floor(image.height * scale * 2)) / 2
    const pixels = pixelAligned ? minifiedAlpha(image, Math.max(1, Math.min(64, Math.floor(1 / (scale * 4))))) : image.alpha
    const alpha = (x: number, y: number) => pixels[wrap(y, image.height) * image.width + wrap(x, image.width)] / 255
    return { perDab: !!(num(style, 'TextureFlag') & 16), sample(x, y) {
      const dx = (pixelAligned ? Math.floor(x) : x) - offsetX, dy = (pixelAligned ? Math.floor(y) : y) - offsetY
      const u = pixelAligned ? wrap(dx * cos + dy * sin, periodX) * image.width / periodX : (dx * cos + dy * sin) / scale - .5
      const v = pixelAligned ? wrap(-dx * sin + dy * cos, periodY) * image.height / periodY : (-dx * sin + dy * cos) / scale - .5
      const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0
      const grain = (alpha(x0, y0) * (1 - tx) + alpha(x0 + 1, y0) * tx) * (1 - ty)
        + (alpha(x0, y0 + 1) * (1 - tx) + alpha(x0 + 1, y0 + 1) * tx) * ty
      // Zero strength removes the texture rather than making the stroke invisible.
      // Normal is centered at gray and may increase coverage; clamp AFTER multiplication.
      return 1 - density * ((num(style, 'TextureComposite') === 0 ? .5 : 1) - grain)
    } }
  } catch (e) { report(e instanceof Error ? e.message : String(e)); return }
}
