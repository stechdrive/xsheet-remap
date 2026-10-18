// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
// Curve sampling and brush stamping adapted from animeops/clip-tools (MIT).
// 88/92-byte stroke layouts cross-checked with Aodaruma/clipfile-rs (MIT).
// This is an approximate material renderer, not CSP's brush engine.
import { check, Reader } from './binary'
import { num, type ClipRow } from './records'
import { VectorSurface } from './vector-surface'
import type { ClipPixels } from './types'
import { createBrushTexture, type BrushTexture } from './vector-texture'
import { brushRandom, readBrushDynamics } from './vector-dynamics'

export interface VectorPoint {
  x: number; y: number; flags: number
  pressure: number; velocity: number; smooth: number; direction: number; tilt: number; size: number; flow: number
  handles: number[]
}
export interface VectorStroke {
  flags: number; brush: number; diameter: number; opacity: number; randomSeed: number
  color: number[]; points: VectorPoint[]
}
export interface BrushPattern { width: number; height: number; alpha: Uint8Array; reverse?: number }
export interface VectorBrushes {
  styles: Map<number, ClipRow>
  graphs: Map<number, ClipRow>
  patterns: Map<number, BrushPattern>
  textures?: Map<number, BrushPattern>
}
const clamp = (v: number) => Math.max(0, Math.min(1, v))
// Empirical coverage correction for thin, hard, AA=1 / CompositeMode=31 pens.
// Validated on one production document; not a decoded CSP brush-engine rule.
const ROUND_WIDTH = .65
const ROUND_OPACITY = .9

/** Validate boundaries before allocation; unsupported records never become guessed strokes. */
export function readVectorStrokes(bytes: Uint8Array): VectorStroke[] {
  const r = new Reader(bytes), strokes: VectorStroke[] = []
  let totalPoints = 0
  while (r.position < bytes.length) {
    const start = r.position, header = r.u32(), section = r.u32(), stride = r.u32(), base = r.u32()
    check((header === 88 && section === 72 || header === 92 && section === 76) && base === 88 && [88, 104, 120].includes(stride), '未対応のベクターストローク形式です')
    const count = r.u32(), flags = r.u32()
    check((flags & 13) === 1 && [16, 32, 64, 128].includes(flags & 240), '未対応のベクター曲線形式です')
    check(totalPoints + count <= 1000000 && strokes.length < 50000 && count > 0, 'ベクターの制御点数が上限を超えるか不正です')
    totalPoints += count
    check(start + header + count * stride <= bytes.length, 'ベクターの制御点が途中で切れています')
    r.take(16)
    const color = [r.u32() >>> 24, r.u32() >>> 24, r.u32() >>> 24]
    r.take(12)
    const opacity = r.number('f64')
    let brush = r.u32()
    if (header === 92) brush = r.u32()
    const diameter = 2 * r.number('f64')
    const randomSeed = r.u32()
    check(opacity >= 0 && opacity <= 1 && diameter >= 0 && diameter <= 4096, 'ベクターの線幅・不透明度が範囲外です')
    const points: VectorPoint[] = []
    for (let i = 0; i < count; i++) {
      const p = new Reader(r.take(stride)), x = p.number('f64'), y = p.number('f64')
      check(Math.abs(x) <= 1000000 && Math.abs(y) <= 1000000, 'ベクター座標が範囲外です')
      p.take(16)
      const pointFlags = p.u32(), pressure = p.number('f32'), velocity = p.number('f32'), smooth = p.number('f32')
      const direction = p.number('f32')
      const tilt = p.number('f32'), size = p.number('f32'), flow = p.number('f32')
      check(size >= 0 && size <= 64 && flow >= 0 && flow <= 64, 'ベクターの制御点係数が範囲外です')
      p.take(24)
      const handles = Array.from({ length: (stride - 88) / 8 }, () => p.number('f64'))
      check(handles.every(v => Math.abs(v) <= 1000000), 'ベクターのハンドル座標が範囲外です')
      points.push({ x, y, flags: pointFlags, pressure, velocity, smooth, direction, tilt, size, flow, handles })
    }
    strokes.push({ flags, brush, diameter, opacity, randomSeed, color, points })
  }
  return strokes
}

/** Six-point interpolating spline, with duplicated endpoint and saved corner controls. */
function spline(points: VectorPoint[], i: number, t: number): [number, number] {
  // Bit 0 marks a corner. Controls across it must not pull this segment into a curve.
  // Only the six-point window matters; do not scan the full stroke for each sample.
  let first = Math.max(0, i - 2), last = Math.min(points.length - 1, i + 3)
  for (let k = i; k > first; k--) if (points[k].flags & 1) { first = k; break }
  for (let k = i + 1; k < last; k++) if (points[k].flags & 1) { last = k; break }
  const q = t * t
  const w = t >= .5
    ? [2*q-6*t+4, -16*q+44*t-28, 96*q-260*t+164, -164*q+328*t-65, 96*q-124*t+28, -14*q+18*t-4]
    : [-14*q+10*t, 96*q-68*t, -164*q+99, 96*q+68*t, -16*q-12*t, 2*q+2*t]
  let x = 0, y = 0
  for (let j = 0; j < 6; j++) { const p = points[Math.max(first, Math.min(last, i + j - 2))]; x += w[j] * p.x; y += w[j] * p.y }
  return [x / 99, y / 99]
}

export function sampleVectorStroke(stroke: VectorStroke): VectorPoint[] {
  const pts = stroke.points, out: VectorPoint[] = []
  // A click with one control is a brush stamp, not an empty path.
  if (pts.length === 1) return [{ ...pts[0] }]
  const kind = stroke.flags & 240
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y) + a.handles.reduce((sum, v, j) => j % 2 ? sum : sum + Math.hypot(v - a.x, a.handles[j + 1] - a.y), 0)
    const count = Math.max(2, Math.ceil(length * 2))
    check(out.length + count <= 1000000, 'ベクター曲線の展開量が上限を超えました')
    for (let j = i ? 1 : 0; j < count; j++) {
      const t = j / (count - 1), u = 1 - t
      const lerp = (x: number, y: number) => u * x + t * y
      let x = lerp(a.x, b.x), y = lerp(a.y, b.y)
      if (kind === 128) [x, y] = spline(pts, i, t)
      else if (kind === 32 && a.handles.length >= 2) {
        x = u*u*a.x + 2*u*t*a.handles[0] + t*t*b.x
        y = u*u*a.y + 2*u*t*a.handles[1] + t*t*b.y
      } else if (kind === 64) {
        check(a.handles.length === 4, '3次曲線のハンドルがありません')
        x = u*u*u*a.x + 3*u*u*t*a.handles[0] + 3*u*t*t*a.handles[2] + t*t*t*b.x
        y = u*u*u*a.y + 3*u*u*t*a.handles[1] + 3*u*t*t*a.handles[3] + t*t*t*b.y
      }
      out.push({ x, y, flags: t < .5 ? a.flags : b.flags, handles: [], pressure: lerp(a.pressure, b.pressure), velocity: lerp(a.velocity, b.velocity), smooth: lerp(a.smooth, b.smooth), direction: lerp(a.direction, b.direction), tilt: lerp(a.tilt, b.tilt), size: lerp(a.size, b.size), flow: lerp(a.flow, b.flow) })
    }
  }
  return out
}

interface Stamp { x: number; y: number; diameter: number; alpha: number; spacingDiameter: number; randomFlow: number }

/** Keep residual arc length across curve subdivisions instead of snapping to their vertices. */
function spaceStamps(samples: Stamp[], interval: number, thickness: number): Stamp[] {
  const out = [samples[0]]
  // The one-pixel floor precedes thickness, confirmed by saved residuals and RNG states.
  const gap = (p: Stamp) => Math.max(1, p.spacingDiameter * interval) * thickness
  let remaining = gap(samples[0])
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    let distance = remaining
    while (distance <= length) {
      const t = distance / length, lerp = (x: number, y: number) => x + (y - x) * t
      const p = { x: lerp(a.x, b.x), y: lerp(a.y, b.y), diameter: lerp(a.diameter, b.diameter), alpha: lerp(a.alpha, b.alpha), spacingDiameter: lerp(a.spacingDiameter, b.spacingDiameter), randomFlow: lerp(a.randomFlow, b.randomFlow) }
      check(out.length < 1000000, 'ベクターの押印数が上限を超えました')
      out.push(p); distance += gap(p)
    }
    remaining = distance - length
  }
  // A non-aligned endpoint is not an extra dab. A one-point stroke still stamps once.
  return out
}

/** Worker-safe software renderer. Per-stroke bounds avoid full-canvas supersampling. */
export function renderVectors(strokes: VectorStroke[], brushes: VectorBrushes, width: number, height: number,
  offsetX = 0, offsetY = 0, report: (message: string) => void = () => {}): ClipPixels {
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 16 * 1024 * 1024, 'ベクター描画のキャンバスが16 Mpxを超えるか不正です')
  check(Number.isFinite(offsetX) && Number.isFinite(offsetY) && Math.abs(offsetX) <= 1000000 && Math.abs(offsetY) <= 1000000, 'ベクターレイヤーの位置が不正です')
  const output = new VectorSurface(width, height)
  let work = 0, sampleCount = 0
  const issues = new Set<string>()
  const textures = new Map<number, BrushTexture | undefined>()
  for (const st of strokes) {
    try {
      const b = brushes.styles.get(st.brush) ?? {}
      check(['AntiAlias', 'Hardness', 'ThicknessBase', 'FlowBase', 'IntervalBase', 'RotationBase'].every(k => Number.isFinite(num(b, k))), 'ブラシの数値が不正です')
      if (!brushes.styles.has(st.brush)) issues.add('ブラシ設定がない線を丸いペンで代替しました')
      const pattern = brushes.patterns.get(num(b, 'PatternStyle'))
      if (num(b, 'PatternStyle') && !pattern) issues.add('ブラシ先端画像がない線を丸いペンで代替しました')
      const imageAA = !!pattern && num(b, 'AntiAlias', 1) === 1
      // Sub-2px nominal image tips regressed in the independent PSD comparison.
      // Retain their previous footprint/AA until native captures resolve minification.
      const tinyImage = !!pattern && st.diameter < 2
      const weakImage = imageAA && !tinyImage
      if (!textures.has(st.brush)) textures.set(st.brush, createBrushTexture(b, brushes.textures?.get(num(b, 'TexturePattern')), message => issues.add(message), imageAA))
      const texture = textures.get(st.brush)
      if (num(b, 'SprayFlag') || num(b, 'UseWaterColor') || num(b, 'WaterEdgeFlag') || ![0, 27, 31].includes(num(b, 'CompositeMode'))) issues.add('散布・混色・特殊ブラシ合成の一部を通常の線で代替しました')
      // Native AA=weak, hard round tip uses a 1.5px inward ramp at pixel centers.
      // Keep the previous small-tip / special-composite approximation outside captured cases.
      const nativeRound = !pattern && num(b, 'AntiAlias', 1) === 1 && num(b, 'Hardness', 1) === 1
        && num(b, 'CompositeMode') === 0 && st.diameter >= 4
      // Image-tip AA=weak captures fit a 2x grid at integer sample positions.
      // This is a sampling approximation, not a translation of the saved path.
      const samples = sampleVectorStroke(st), ss = nativeRound ? 1 : weakImage ? 2 : num(b, 'AntiAlias', 1) ? 4 : 1
      sampleCount += samples.length
      check(sampleCount <= 1000000, 'ベクターの合計展開量が上限を超えました')
      const thickness = Math.max(.01, Math.min(1, num(b, 'ThicknessBase', 1)))
      const thinPen = !num(b, 'PatternStyle') && !num(b, 'SprayFlag') && !num(b, 'TexturePattern')
        && num(b, 'CompositeMode') === 31 && num(b, 'AntiAlias') === 1 && num(b, 'Hardness') === 1
        && thickness === 1 && st.diameter <= 4
      let patternScale = 1
      let aspectX = 1, aspectY = 1, flipX = 1, flipY = 1
      if (pattern) {
        const reverse = pattern.reverse ?? 0
        if (!Number.isInteger(reverse) || reverse < 0 || reverse > 255 || (reverse & 15) > 1 || (reverse >>> 4) > 1) {
          issues.add('ブラシ先端のランダム反転・折り返し反転など、一部の反転方式を省略しました')
        }
        if (Number.isInteger(reverse) && reverse >= 0 && reverse <= 255) {
          flipX = (reverse & 15) === 1 ? -1 : 1
          flipY = (reverse >>> 4) === 1 ? -1 : 1
        }
        if (!tinyImage) {
          aspectX = pattern.width / Math.max(pattern.width, pattern.height)
          aspectY = pattern.height / Math.max(pattern.width, pattern.height)
        }
        let painted = 0
        const tall = pattern.height >= pattern.width, narrow = tall ? pattern.width : pattern.height, long = tall ? pattern.height : pattern.width
        for (let i = 0; i < narrow; i++) {
          for (let j = 0; j < long; j++) if (pattern.alpha[tall ? j * pattern.width + i : i * pattern.width + j]) { painted++; break }
        }
        patternScale = narrow / Math.max(1, painted)
      }
      const sizeDynamics = readBrushDynamics(b.SizeEffector, brushes.graphs)
      const flowDynamics = readBrushDynamics(b.FlowEffector, brushes.graphs)
      const opacityDynamics = readBrushDynamics(b.OpacityEffector, brushes.graphs)
      if (sizeDynamics.randomMinimum !== undefined || opacityDynamics.randomMinimum !== undefined) issues.add('線幅・不透明度の乱数変動は近似しています')
      let stamps: Stamp[] = samples.map(p => {
        // A locked control already stores its final factor: do not square it.
        const size = p.size * (p.flags & 4096 ? 1 : sizeDynamics.value(p))
        const flow = p.flow * (p.flags & 8192 ? 1 : flowDynamics.value(p))
        return { ...p, x: p.x + offsetX - (nativeRound ? 0 : ss > 1 ? .001 : -.499), y: p.y + offsetY - (nativeRound ? 0 : ss > 1 ? .001 : .501),
          diameter: st.diameter * size * (!pattern && ss > 1 ? Math.cbrt(thickness) : 1) * patternScale * (thinPen ? ROUND_WIDTH : 1),
          spacingDiameter: st.diameter * size,
          randomFlow: p.flags & 8192 ? 0 : 1,
          alpha: clamp(flow * num(b, 'FlowBase', 1) * opacityDynamics.value(p) * (thinPen ? ROUND_OPACITY : 1)) }
      })
      const autoInterval = num(b, 'AutoIntervalType', 2)
      check([0, 1, 2, 3].includes(autoInterval), '未対応の自動押印間隔です')
      stamps = spaceStamps(stamps, autoInterval === 0 ? Math.max(0, num(b, 'IntervalBase', 1)) : [0, .12, .08, .04][autoInterval], thickness)
      sampleCount += Math.max(0, stamps.length - samples.length)
      check(sampleCount <= 1000000, 'ベクターの合計展開量が上限を超えました')
      let x0 = width, y0 = height, x1 = 0, y1 = 0
      for (const p of stamps) {
        const radius = p.diameter * .72 + 1
        x0 = Math.min(x0, Math.floor(p.x - radius)); y0 = Math.min(y0, Math.floor(p.y - radius))
        x1 = Math.max(x1, Math.ceil(p.x + radius)); y1 = Math.max(y1, Math.ceil(p.y + radius))
      }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1)
      if (x1 <= x0 || y1 <= y0) continue
      const w = (x1 - x0) * ss, h = (y1 - y0) * ss
      check(w * h <= 16 * 1024 * 1024, 'ベクター1ストロークの展開量が上限を超えました')
      work += w * h
      check(work <= 250000000, 'ベクター描画量が上限を超えました')
      const alpha = new Float32Array(w * h)
      const random = brushRandom(st.randomSeed), rotationMode = num(b, 'RotationEffector', 3)
      if ((rotationMode & ~128) !== 3) issues.add('ペン方向・線方向による先端角度の一部を近似しています')
      for (let i = 0; i < stamps.length; i++) {
        const p = stamps[i], previous = stamps[Math.max(0, i - 1)]
        // Native fixtures consume angle before density, including invisible dabs.
        const randomAngle = rotationMode & 128 ? (random() - (pattern && !tinyImage ? .5 : 0)) * 2 * Math.PI * num(b, 'RotationRandom', 1) : 0
        if (flowDynamics.randomMinimum !== undefined) p.alpha *= 1 - p.randomFlow * (1 - flowDynamics.randomMinimum) * (1 - random())
        if (p.diameter <= 0 || p.alpha <= 0) continue
        const radius = p.diameter * ss / 2, cx = (p.x - x0) * ss, cy = (p.y - y0) * ss
        const tangent = i ? Math.atan2(p.y - previous.y, p.x - previous.x) : stamps.length > 1 ? Math.atan2(stamps[1].y - p.y, stamps[1].x - p.x) : 0
        const rotation = randomAngle + num(b, 'RotationBase') * Math.PI / 180 + ((rotationMode & ~128) === 3 ? 0 : tangent + Math.PI / 2)
        const cos = Math.cos(rotation), sin = Math.sin(rotation), reach = radius * 1.42 + 1
        const left = Math.max(0, Math.floor(cx - reach)), right = Math.min(w, Math.ceil(cx + reach))
        const top = Math.max(0, Math.floor(cy - reach)), bottom = Math.min(h, Math.ceil(cy + reach))
        work += (right - left) * (bottom - top)
        check(work <= 250000000, 'ベクター描画量が上限を超えました')
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const phase = weakImage ? 0 : .5
          const dx = x + phase - cx, dy = y + phase - cy, lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos
          let coverage: number
          if (pattern) {
            // Reverse in tip-local axes before lookup; preserve the bitmap's aspect ratio.
            const u = Math.floor((lx * flipX / (2 * radius * thickness * aspectX) + .5) * pattern.width)
            const v = Math.floor((ly * flipY / (2 * radius * aspectY) + .5) * pattern.height)
            coverage = u >= 0 && u < pattern.width && v >= 0 && v < pattern.height ? pattern.alpha[v * pattern.width + u] / 255 : 0
          } else {
            const dist = nativeRound ? Math.hypot(lx / thickness, ly) : Math.hypot(lx, ly / (ss === 1 ? thickness : 1)), hardness = clamp(num(b, 'Hardness', 1))
            coverage = nativeRound ? clamp((radius - dist) * thickness / 1.5) : ss === 1 ? +(dist <= radius) : hardness >= 1 ? clamp(radius + .5 - dist) : clamp((radius - dist) / Math.max(.001, radius * (1 - hardness)))
          }
          const at = y * w + x, a = clamp(coverage * p.alpha * (texture?.perDab ? texture.sample(x0 + (x + .5) / ss - offsetX, y0 + (y + .5) / ss - offsetY) : 1))
          alpha[at] = pattern || num(b, 'CompositeMode') === 0 || num(b, 'Hardness', 1) < .9 ? alpha[at] + a * (1 - alpha[at]) : Math.max(alpha[at], a)
        }
      }
      for (let y = 0; y < h; y += ss) for (let x = 0; x < w; x += ss) {
        let a = 0
        for (let v = 0; v < ss; v++) for (let u = 0; u < ss; u++) {
          const coverage = alpha[(y + v) * w + x + u]
          if (coverage) a += clamp(coverage * (texture && !texture.perDab ? texture.sample(x0 + (x + u + .5) / ss - offsetX, y0 + (y + v + .5) / ss - offsetY) : 1))
        }
        // Stroke opacity limits the completed stroke, not every overlapping tip.
        a = a / (ss * ss) * st.opacity
        if (!a) continue
        output.blend(x0 + x / ss, y0 + y / ss, a, st.color, num(b, 'CompositeMode') === 27)
      }
    } catch (e) {
      issues.add(e instanceof Error ? e.message : String(e))
      if (work > 250000000 || sampleCount > 1000000) { issues.add('残りのストロークを描画できませんでした'); break }
    }
  }
  issues.forEach(report)
  return output.finish()
}
