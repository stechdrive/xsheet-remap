// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { ClipPixels } from './types'

/** Retain only meaningful pixels; most saved offscreens span the whole animation paper. */
export function cropPixels(pixels: ClipPixels, mask = false): ClipPixels {
  const { width, height, rgba } = pixels
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  const background = pixels.defaultColor ?? 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4
    if (mask ? rgba[at] !== background : rgba[at + 3] !== 0) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  }
  if (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1) return pixels
  if (x1 < 0) return { ...pixels, width: 1, height: 1, rgba: new Uint8ClampedArray(mask ? [background, background, background, 255] : [0, 0, 0, 0]) }
  const croppedWidth = x1 - x0 + 1, croppedHeight = y1 - y0 + 1, cropped = new Uint8ClampedArray(croppedWidth * croppedHeight * 4)
  for (let y = 0; y < croppedHeight; y++) {
    const at = ((y + y0) * width + x0) * 4
    cropped.set(rgba.subarray(at, at + croppedWidth * 4), y * croppedWidth * 4)
  }
  return { ...pixels, width: croppedWidth, height: croppedHeight, left: pixels.left + x0, top: pixels.top + y0, rgba: cropped }
}
