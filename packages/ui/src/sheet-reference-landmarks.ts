import type { Mat } from '@techstark/opencv-js'
import { withCvObjects, type OpenCvRuntime } from './sheet-opencv'
import type { PixelPoint } from './sheet-auto-calibration-types'

// All distances here are in the bounded analysis image, not original scan pixels.
const radius = 24
const patchSize = 2 * radius + 1
const searchRadius = 44
const voteSize = 2 * searchRadius + 1

type Point = PixelPoint
export type SheetLandmark = { center: Point; patch: Uint8Array }
type Scores = { data: Float32Array; width: number; height: number; x: number; y: number }
type PatchScores = Scores & { center: Point }
type Peak = Point & { score: number; gap: number }
type Match = { center: Point; dx: number; dy: number }
type Shift = { dx: number; dy: number } & (
  | { kind: 'initial-flow' }
  | { kind: 'translation'; inliers: number; confidence: number }
)

function withScores<T>(cv: OpenCvRuntime, image: Mat, patch: Mat, center: Point, read: (map: Scores) => T): T {
  return withCvObjects(own => {
    const left = Math.max(0, center.x - radius - searchRadius)
    const top = Math.max(0, center.y - radius - searchRadius)
    const right = Math.min(image.cols, center.x + radius + searchRadius + 1)
    const bottom = Math.min(image.rows, center.y + radius + searchRadius + 1)
    const region = own(image.roi(new cv.Rect(left, top, right - left, bottom - top)))
    const scores = own(new cv.Mat())
    cv.matchTemplate(region, patch, scores, cv.TM_CCOEFF_NORMED)
    return read({ data: scores.data32F, width: scores.cols, height: scores.rows, x: left + radius - center.x, y: top + radius - center.y })
  })
}

function strongestPeak(map: Scores): Peak {
  const { data, width } = map
  let index = 0
  for (let i = 1; i < data.length; i++) if (data[i] > data[index]) index = i
  const px = index % width, py = Math.floor(index / width)
  let rival = -1
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.max(Math.abs(x - px), Math.abs(y - py)) >= 5) rival = Math.max(rival, data[y * width + x])
    }
  }
  return { x: px + map.x, y: py + map.y, score: data[index], gap: data[index] - rival }
}

function smooth(cv: OpenCvRuntime, image: Mat, output: Mat) {
  // Suppress the half-pixel alias between thin rules before comparing neighborhoods.
  cv.GaussianBlur(image, output, new cv.Size(3, 3), 0.85, 0.85, cv.BORDER_REPLICATE)
}

export function selectSheetLandmarks(cv: OpenCvRuntime, model: Mat, points: Point[]): SheetLandmark[] {
  return withCvObjects(own => {
    const image = own(new cv.Mat())
    smooth(cv, model, image)
    const candidates: { center: Point; gap: number }[] = []
    for (const point of points) {
      const x = Math.round(point.x), y = Math.round(point.y)
      if (x < radius || y < radius || x + radius >= model.cols || y + radius >= model.rows) continue
      const peak = withCvObjects(local => {
        const patch = local(image.roi(new cv.Rect(x - radius, y - radius, patchSize, patchSize)))
        return withScores(cv, image, patch, { x, y }, strongestPeak)
      })
      if (peak.x === 0 && peak.y === 0 && peak.gap >= 0.12) candidates.push({ center: { x, y }, gap: peak.gap })
    }
    candidates.sort((a, b) => b.gap - a.gap)
    const tiles = new Map<number, number>()
    const selected: SheetLandmark[] = []
    const pixels = image.data
    for (const { center } of candidates) {
      const tile = Math.floor(center.x / model.cols * 5) + 5 * Math.floor(center.y / model.rows * 6)
      const used = tiles.get(tile) ?? 0
      if (used >= 2 || selected.some(({ center: p }) => Math.hypot(p.x - center.x, p.y - center.y) < 32)) continue
      // A subimage still has the full sheet's row stride in the JS binding.
      const patch = new Uint8Array(patchSize * patchSize)
      for (let row = 0; row < patchSize; row++) {
        const start = (center.y - radius + row) * image.cols + center.x - radius
        patch.set(pixels.subarray(start, start + patchSize), row * patchSize)
      }
      selected.push({ center, patch })
      tiles.set(tile, used + 1)
      if (selected.length === 32) break
    }
    return selected
  })
}

function pooledPeak(maps: PatchScores[]): Peak {
  const votes = new Float32Array(voteSize * voteSize)
  const counts = new Uint8Array(votes.length)
  for (const map of maps) {
    for (let y = 0; y < map.height; y++) {
      const start = (map.y + y + searchRadius) * voteSize + map.x + searchRadius
      for (let x = 0; x < map.width; x++) {
        votes[start + x] += Math.max(0, map.data[y * map.width + x])
        counts[start + x]++
      }
    }
  }
  for (let i = 0; i < votes.length; i++) votes[i] = counts[i] >= maps.length * 0.76 ? votes[i] / counts[i] : -1
  return strongestPeak({ data: votes, width: voteSize, height: voteSize, x: -searchRadius, y: -searchRadius })
}

function localMatch(map: PatchScores, peak: Point): Match | null {
  const { data, width } = map
  let index = -1, best = 0.5
  for (let y = Math.max(1, peak.y - map.y - 2); y <= Math.min(map.height - 2, peak.y - map.y + 2); y++) {
    for (let x = Math.max(1, peak.x - map.x - 2); x <= Math.min(width - 2, peak.x - map.x + 2); x++) {
      const i = y * width + x
      if (data[i] > best) { best = data[i]; index = i }
    }
  }
  if (index < 0) return null
  function subpixel(step: number) {
    const left = data[index - step], right = data[index + step], curvature = left - 2 * best + right
    return curvature < -1e-5 ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0
  }
  return { center: map.center, dx: index % width + map.x + subpixel(1), dy: Math.floor(index / width) + map.y + subpixel(width) }
}

function median(values: number[]) {
  values.sort((a, b) => a - b)
  return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2
}

function distributed(matches: Match[], width: number, height: number) {
  const x = matches.map(m => m.center.x), y = matches.map(m => m.center.y)
  return Math.max(...x) - Math.min(...x) > width * 0.35 && Math.max(...y) - Math.min(...y) > height * 0.35
}

export function matchSheetLandmarks(cv: OpenCvRuntime, input: Mat, landmarks: SheetLandmark[]): Shift | null {
  if (landmarks.length < 14) return null // At least ten fit patches and four independent checks.
  return withCvObjects(own => {
    const image = own(new cv.Mat())
    smooth(cv, input, image)
    const fit: PatchScores[] = [], held: PatchScores[] = []
    const patch = own(new cv.Mat(patchSize, patchSize, cv.CV_8UC1))
    for (const [i, landmark] of landmarks.entries()) {
      patch.data.set(landmark.patch)
      const map = withScores(cv, image, patch, landmark.center, m => ({ ...m, data: m.data.slice(), center: landmark.center }))
      const group = i % 4 === 0 ? held : fit
      group.push(map)
    }
    const a = pooledPeak(fit), b = pooledPeak(held)
    if (a.score < 0.42 || a.gap < 0.045 || b.score < 0.39 || b.gap < 0.026 || Math.hypot(a.x - b.x, a.y - b.y) > 2) return null
    // Agreement about the row/column is enough to seed flow. A direct translation needs
    // subpixel consensus over both independently distributed sets.
    const guess: Shift = { kind: 'initial-flow', dx: a.x, dy: a.y }
    const matches = fit.map(map => localMatch(map, a)).filter(m => m !== null)
    const checks = held.map(map => localMatch(map, a)).filter(m => m !== null)
    if (matches.length < 10 || checks.length < 4) return guess
    const dx = median(matches.map(m => m.dx)), dy = median(matches.map(m => m.dy))
    const agrees = (m: Match) => Math.hypot(m.dx - dx, m.dy - dy) <= 0.85
    const inliers = matches.filter(agrees), verified = checks.filter(agrees)
    if (inliers.length < Math.max(10, 0.73 * matches.length) || verified.length < Math.max(4, 0.72 * checks.length)
      || !distributed(inliers, input.cols, input.rows) || !distributed(verified, input.cols, input.rows)) return guess
    return { kind: 'translation', dx, dy, inliers: inliers.length, confidence: Math.min(0.985, 0.8 + 0.185 * Math.min(a.score, b.score)) }
  })
}
