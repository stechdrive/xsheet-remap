// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
// GradationFillInfo layout: dobrokot/clip_to_psd (MIT).
import { check, Reader } from './binary'
import type { ClipPixels } from './types'

type Stop = { position: number; rgba: number[] }

/** Generate the known gradient forms when no saved layer image is available. */
export function readGradient(bytes: Uint8Array, width: number, height: number, offsetX: number, offsetY: number, report: (message: string) => void): ClipPixels {
  const r = new Reader(bytes)
  r.take(8)
  let stops: Stop[] | undefined, geometry: number[] | undefined, flat: number[] | undefined
  let approximate = false
  while (r.position < bytes.length) {
    const name = r.wideName()
    if (name === 'GradationSetting') {
      geometry = [r.u32(), r.u32(), r.u32(), ...Array.from({ length: 7 }, () => r.number('f64'))]
    } else {
      const part = new Reader(r.take(r.u32()))
      if (name === 'GradationData') {
        part.take(8)
        const count = part.u32(); part.u32()
        check(count > 0 && count <= 1024, 'グラデーションの色数が範囲外です')
        stops = Array.from({ length: count }, () => {
          const rgba = Array.from({ length: 4 }, () => part.u32() >>> 24)
          const currentColor = part.u32(), position = part.u32() / 32768, curves = part.u32()
          check(curves <= 1024, 'グラデーションの曲線が多すぎます')
          part.take(curves * 16)
          approximate ||= curves > 0 || currentColor !== 0
          return { position, rgba }
        }).sort((a, b) => a.position - b.position)
      } else if (name === 'GradationSettingAdd0001' && part.u32()) {
        flat = [...Array.from({ length: 3 }, () => part.u32() >>> 24), 255]
      }
    }
  }
  check(flat || (stops?.length && geometry), 'グラデーションの色・配置情報がありません')
  check(width * height <= 64 * 1024 * 1024, '画像1枚のサイズが上限を超えました')
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (flat) {
    for (let i = 0; i < rgba.length; i += 4) rgba.set(flat, i)
  } else {
    const [repeat, shape, , , secondDiameter, , sx, sy, ex, ey] = geometry!
    check(repeat <= 3 && shape <= 2, '未対応のグラデーション形式です')
    const dx = ex - sx, dy = ey - sy, radius = Math.hypot(dx, dy)
    check(radius > 0 && (shape !== 2 || secondDiameter > 0), 'グラデーションの大きさが不正です')
    const colors = stops!
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = x + 0.5 - offsetX - sx, py = y + 0.5 - offsetY - sy
      const along = (px * dx + py * dy) / (radius * radius)
      const across = (py * dx - px * dy) / (radius * (shape === 2 ? secondDiameter / 2 : radius))
      let t = shape === 0 ? along : Math.hypot(along, across)
      if (repeat === 3 && (t < 0 || t > 1)) continue
      if (repeat === 1) t = ((t % 1) + 1) % 1
      else if (repeat === 2) { t = ((t % 2) + 2) % 2; if (t > 1) t = 2 - t }
      else t = Math.max(0, Math.min(1, t))
      const last = colors.findIndex(s => s.position >= t)
      const b = colors[last < 0 ? colors.length - 1 : last], a = colors[Math.max(0, last - 1)]
      const amount = last <= 0 || b.position === a.position ? 1 : Math.max(0, Math.min(1, (t - a.position) / (b.position - a.position)))
      const at = (y * width + x) * 4
      for (let c = 0; c < 4; c++) rgba[at + c] = a.rgba[c] * (1 - amount) + b.rgba[c] * amount
    }
  }
  if (approximate) report('グラデーションの曲線・描画色連動は保存色による直線補間で描画します')
  return { width, height, left: 0, top: 0, rgba }
}
