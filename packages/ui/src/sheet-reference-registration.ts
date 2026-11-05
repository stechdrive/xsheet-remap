import type { Mat } from '@techstark/opencv-js'
import type { NormalizedPoint } from '@xsheet-remap/core'
import { withCvObjects, type OwnCvObject, type OpenCvRuntime } from './sheet-opencv'
import { matchSheetLandmarks, selectSheetLandmarks, type SheetLandmark } from './sheet-reference-landmarks'
import { paintSheetRaster, type SheetRaster } from './sheet-reference-raster'
import { isPlausibleRegisteredQuad } from './sheet-auto-calibration-projection'
import { applyHomography, type Homography } from './sheetImages'

type Point = { x: number; y: number }
type Feature = { pt: Point; response: number }
type Track = { reference: Point; input: Point }
type Features = { gray: Uint8Array; points: Point[]; width: number; height: number; landmarks?: SheetLandmark[] }
type Registration = { matrix: Homography; confidence: number; inliers: number }
const featuresByRaster = new WeakMap<SheetRaster, Features>()

function grayInk(cv: OpenCvRuntime, own: OwnCvObject, raster: SheetRaster, width: number, height: number): Mat {
  const rgba = own(cv.matFromImageData(paintSheetRaster(raster, width, height)))
  const gray = own(new cv.Mat()),
    background = own(new cv.Mat())
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  cv.GaussianBlur(gray, background, new cv.Size(25, 25), 0, 0, cv.BORDER_REPLICATE)
  const pixels = gray.data,
    light = background.data,
    histogram = new Uint32Array(256)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.max(0, light[i] - pixels[i])
    histogram[pixels[i]]++
  }
  let count = 0,
    level = 255
  for (; level > 0; level--) {
    count += histogram[level]
    if (count >= pixels.length * 0.05) break
  }
  const gain = 160 / Math.max(16, level)
  for (let i = 0; i < pixels.length; i++) pixels[i] = 255 - Math.min(255, Math.round(gain * pixels[i]))
  return gray
}

function referenceFeatures(cv: OpenCvRuntime, raster: SheetRaster, width: number, height: number): Features {
  const cached = featuresByRaster.get(raster)
  if (cached && cached.width === width && cached.height === height) return cached
  const features = withCvObjects(own => {
    const gray = grayInk(cv, own, raster, width, height)
    const orb = own(new cv.ORB()),
      keypoints = own(new cv.KeyPointVector())
    orb.setMaxFeatures(3000)
    orb.setNLevels(3)
    orb.setEdgeThreshold(12)
    orb.setFastThreshold(12)
    orb.detect(gray, keypoints, own(new cv.Mat()))
    const candidates = Array.from({ length: keypoints.size() }, (_, i) => keypoints.get(i) as Feature)
    candidates.sort((a, b) => b.response - a.response)
    const tiles = new Map<number, number>(),
      points: Point[] = []
    for (const { pt } of candidates) {
      const tile = Math.floor((pt.x / width) * 7) + 7 * Math.floor((pt.y / height) * 9)
      const used = tiles.get(tile) ?? 0
      if (used >= 3 || points.some(p => Math.hypot(pt.x - p.x, pt.y - p.y) < 15)) continue
      points.push({ x: pt.x, y: pt.y })
      tiles.set(tile, used + 1)
    }
    return { gray: Uint8Array.from(gray.data), points, width, height }
  })
  featuresByRaster.set(raster, features)
  return features
}

function pointMat(cv: OpenCvRuntime, points: Point[]): Mat {
  return cv.matFromArray(
    points.length,
    1,
    cv.CV_32FC2,
    points.flatMap(p => [p.x, p.y]),
  )
}

function trackSheet(cv: OpenCvRuntime, model: Mat, input: Mat, features: Features, shift?: { dx: number; dy: number }): Registration | null {
  const { width, height } = features
  return withCvObjects(own => {
    const points = own(pointMat(cv, features.points))
    const forward = own(shift ? pointMat(cv, features.points.map(p => ({ x: p.x + shift.dx, y: p.y + shift.dy }))) : new cv.Mat())
    const backward = own(shift ? pointMat(cv, features.points) : new cv.Mat())
    const fs = own(new cv.Mat()),
      bs = own(new cv.Mat()),
      fe = own(new cv.Mat()),
      be = own(new cv.Mat())
    const window = new cv.Size(21, 21)
    if (shift) {
      const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01)
      cv.calcOpticalFlowPyrLK(model, input, points, forward, fs, fe, window, 3, criteria, cv.OPTFLOW_USE_INITIAL_FLOW)
      cv.calcOpticalFlowPyrLK(input, model, forward, backward, bs, be, window, 3, criteria, cv.OPTFLOW_USE_INITIAL_FLOW)
    } else {
      cv.calcOpticalFlowPyrLK(model, input, points, forward, fs, fe, window, 3)
      cv.calcOpticalFlowPyrLK(input, model, forward, backward, bs, be, window, 3)
    }
    const fit: Track[] = [],
      validation: Track[] = []
    for (const [i, reference] of features.points.entries()) {
      if (!fs.data[i] || !bs.data[i] || fe.data32F[i] > 60) continue
      if (Math.hypot(reference.x - backward.data32F[2 * i], reference.y - backward.data32F[2 * i + 1]) > 1.2) continue
      const track = { reference, input: { x: forward.data32F[2 * i], y: forward.data32F[2 * i + 1] } }
      if (i % 4 === 0) validation.push(track)
      else fit.push(track)
    }
    if (fit.length < 16 || validation.length < 8) return null
    const mask = own(new cv.Mat())
    const from = own(pointMat(cv, fit.map(t => t.reference)))
    const to = own(pointMat(cv, fit.map(t => t.input)))
    const matrix = own(cv.findHomography(from, to, cv.RANSAC, 1.5, mask))
    if (matrix.empty()) return null
    const inliers = fit.filter((_, i) => mask.data[i])
    const occupied = new Set(
      inliers.map(({ reference: p }) => Math.floor((p.x / width) * 4) + 4 * Math.floor((p.y / height) * 4)),
    )
    if (inliers.length < Math.max(16, fit.length / 2) || occupied.size < 8) return null
    const h = Array.from(matrix.data64F) as Homography
    const errors = validation
      .map(({ reference, input }) => {
        const p = applyHomography(h, reference.x, reference.y)
        return p ? Math.hypot(p.x - input.x, p.y - input.y) : Infinity
      })
      .sort((a, b) => a - b)
    const residual = (errors[(errors.length - 1) >> 1] + errors[errors.length >> 1]) / 2
    if (!(residual <= 1)) return null
    return { matrix: h, inliers: inliers.length, confidence: Math.min(0.99, 0.6 + (0.3 * inliers.length) / fit.length + 0.1 * (1 - residual)) }
  })
}

export function registerSheetImage(
  cv: OpenCvRuntime,
  reference: SheetRaster,
  scan: SheetRaster,
  targets: NormalizedPoint[],
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): { corners: NormalizedPoint[]; confidence: number; inliers: number } | null {
  const features = referenceFeatures(cv, reference, width, height)
  if (features.points.length < 24) return null
  function project(fit: Registration | null) {
    if (!fit) return null
    const corners: NormalizedPoint[] = []
    for (const t of targets) {
      // Templates locate features at pixel indices; resizing maps pixel centers.
      const p = applyHomography(fit.matrix, (t.x + 0.5 / pageWidth) * width - 0.5, (t.y + 0.5 / pageHeight) * height - 0.5)
      if (!p) return null
      corners.push({
        x: (p.x + 0.5) / width - 0.5 / (scan.image.naturalWidth || scan.image.width),
        y: (p.y + 0.5) / height - 0.5 / (scan.image.naturalHeight || scan.image.height),
      })
    }
    if (!isPlausibleRegisteredQuad(corners, targets)) return null
    return { corners, inliers: fit.inliers, confidence: fit.confidence }
  }
  return withCvObjects(own => {
    const model = own(cv.matFromArray(height, width, cv.CV_8UC1, features.gray))
    const input = grayInk(cv, own, scan, width, height)
    const ordinary = project(trackSheet(cv, model, input, features))
    if (ordinary) return ordinary

    try {
      features.landmarks ??= selectSheetLandmarks(cv, model, features.points)
      const shift = matchSheetLandmarks(cv, input, features.landmarks)
      if (!shift) return null
      if (shift.kind === 'initial-flow') return project(trackSheet(cv, model, input, features, shift))
      return project({ matrix: [1, 0, shift.dx, 0, 1, shift.dy, 0, 0, 1], inliers: shift.inliers, confidence: shift.confidence })
    } catch {
      // A failed optional WASM operation must still allow reference-validated geometry.
      return null
    }
  })
}
