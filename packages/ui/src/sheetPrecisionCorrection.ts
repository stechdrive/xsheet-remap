import {
  resolveSheetTemplateGridLayout,
  type NormalizedRect,
  type SheetCalibrationPointPair,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SheetPrecisionWarp } from './appTypes'
import { calibrationTargetRectForTemplate, defaultSheetImageSettings, loadImage, warpSheetImageData } from './sheetImages'
import { precisionWarpDisplacementAt } from './sheetPrecisionWarp'

export type PrecisionGuideAnchor = {
  x: number
  y: number
  horizontalSpanPx: number
  verticalSpanPx: number
  searchRadiusPx: number
}

export type PrecisionControlMatch = {
  x: number
  y: number
  dxPx: number
  dyPx: number
  confidence: number
}

const PRECISION_ANALYSIS_MAX_WIDTH = 1800
const PRECISION_CONTROL_TARGET_X_PX = 180
const PRECISION_CONTROL_TARGET_Y_PX = 150

export async function detectSheetPrecisionWarp(
  imageUrl: string,
  points: SheetCalibrationPointPair[],
  template: SheetTemplate,
): Promise<SheetPrecisionWarp | null> {
  const bounds = calibrationTargetRectForTemplate(template)
  if (!bounds) return null
  await yieldToBrowser()
  const image = await loadImage(imageUrl)
  const analysisWidth = Math.max(1, Math.min(PRECISION_ANALYSIS_MAX_WIDTH, Math.round(template.page.widthPx)))
  const analysisHeight = Math.max(1, Math.round(analysisWidth * template.page.heightPx / template.page.widthPx))
  const rectified = warpSheetImageData(
    image,
    {
      ...defaultSheetImageSettings(),
      calibration: { enabled: true, points },
    },
    template,
    analysisWidth,
  )
  if (!rectified) return null
  await yieldToBrowser()
  const anchors = precisionGuideAnchors(template, analysisWidth, analysisHeight)
  const matches = detectPrecisionControlMatches(rectified, anchors)
  const inliers = filterPrecisionMatchOutliers(matches, analysisWidth, analysisHeight)
  return buildPrecisionWarpFromMatches(inliers, bounds, analysisWidth, analysisHeight, anchors.length, matches.length)
}

export function precisionGuideAnchors(
  template: SheetTemplate,
  imageWidth: number,
  imageHeight: number,
): PrecisionGuideAnchor[] {
  const anchors = new Map<string, PrecisionGuideAnchor>()
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    if (!['action', 'sound', 'cell', 'camera'].includes(region.grid.role)) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: template.defaults.paperTracks,
    })
    if (!layout || layout.columns.length === 0) continue
    const xPositions = [layout.columns[0]!.x, ...layout.columns.map(column => column.x + column.w)]
    const rowStep = Math.max(1, Math.round(region.grid.majorLineEvery ?? Math.max(1, layout.frames.rowCount / 12)))
    const rowPositions: number[] = []
    for (let row = 0; row <= layout.frames.rowCount; row += rowStep) {
      rowPositions.push(layout.rect.y + layout.frames.rowHeight * row)
    }
    const bottom = layout.rect.y + layout.frames.rowHeight * layout.frames.rowCount
    if (Math.abs((rowPositions.at(-1) ?? 0) - bottom) > 0.0001) rowPositions.push(bottom)
    const minColumnWidthPx = Math.min(...layout.columns.map(column => column.w * imageWidth))
    const rowHeightPx = layout.frames.rowHeight * imageHeight
    const horizontalSpanPx = clamp(minColumnWidthPx * 1.15, 20, 62)
    const verticalSpanPx = clamp(rowHeightPx * 2.25, 24, 62)
    const searchRadiusPx = Math.round(clamp(Math.min(minColumnWidthPx, rowHeightPx) * 0.34, 4, 12))
    for (const x of xPositions) {
      for (const y of rowPositions) {
        const key = `${Math.round(x * imageWidth * 2)}:${Math.round(y * imageHeight * 2)}`
        const existing = anchors.get(key)
        const anchor = { x, y, horizontalSpanPx, verticalSpanPx, searchRadiusPx }
        if (!existing) {
          anchors.set(key, anchor)
        } else {
          anchors.set(key, {
            ...existing,
            horizontalSpanPx: Math.max(existing.horizontalSpanPx, horizontalSpanPx),
            verticalSpanPx: Math.max(existing.verticalSpanPx, verticalSpanPx),
            searchRadiusPx: Math.max(existing.searchRadiusPx, searchRadiusPx),
          })
        }
      }
    }
  }
  return [...anchors.values()]
}

export function detectPrecisionControlMatches(
  image: ImageData,
  anchors: PrecisionGuideAnchor[],
): PrecisionControlMatch[] {
  const darkness = buildDarknessMap(image)
  const matches: PrecisionControlMatch[] = []
  for (const anchor of anchors) {
    const expectedX = anchor.x * image.width
    const expectedY = anchor.y * image.height
    const vertical = findDirectionalLine(
      darkness,
      image.width,
      image.height,
      'vertical',
      expectedX,
      expectedY,
      anchor.verticalSpanPx,
      anchor.searchRadiusPx,
    )
    const horizontal = findDirectionalLine(
      darkness,
      image.width,
      image.height,
      'horizontal',
      expectedY,
      expectedX,
      anchor.horizontalSpanPx,
      anchor.searchRadiusPx,
    )
    if (!vertical || !horizontal) continue
    const confidence = Math.sqrt(vertical.confidence * horizontal.confidence)
    if (confidence < 0.24) continue
    matches.push({
      x: anchor.x,
      y: anchor.y,
      dxPx: vertical.position - expectedX,
      dyPx: horizontal.position - expectedY,
      confidence,
    })
  }
  return matches
}

export function buildPrecisionWarpFromMatches(
  matches: PrecisionControlMatch[],
  bounds: NormalizedRect,
  imageWidth: number,
  imageHeight: number,
  totalAnchorCount = matches.length,
  matchedAnchorCount = matches.length,
): SheetPrecisionWarp | null {
  const coverage = precisionMatchCoverage(matches, bounds)
  if (matches.length < 18 || coverage < 0.25) return null
  const columns = Math.round(clamp(bounds.w * imageWidth / PRECISION_CONTROL_TARGET_X_PX + 1, 6, 12))
  const rows = Math.round(clamp(bounds.h * imageHeight / PRECISION_CONTROL_TARGET_Y_PX + 1, 8, 16))
  const nodeCount = columns * rows
  const dataOffsets = new Float64Array(nodeCount * 2)
  const dataStrengths = new Float64Array(nodeCount)
  const stepX = bounds.w / Math.max(1, columns - 1)
  const stepY = bounds.h / Math.max(1, rows - 1)
  const scaleX = stepX * 1.55
  const scaleY = stepY * 1.55
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const nodeIndex = row * columns + column
      const nodeX = bounds.x + stepX * column
      const nodeY = bounds.y + stepY * row
      const estimate = robustNodeEstimate(matches, nodeX, nodeY, scaleX, scaleY, imageWidth, imageHeight)
      dataOffsets[nodeIndex * 2] = estimate.dxPx / imageWidth
      dataOffsets[nodeIndex * 2 + 1] = estimate.dyPx / imageHeight
      dataStrengths[nodeIndex] = estimate.strength
    }
  }

  let current = new Float64Array(dataOffsets)
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const next = new Float64Array(current.length)
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const nodeIndex = row * columns + column
        const neighbors = neighborNodeIndices(row, column, rows, columns)
        let neighborX = 0
        let neighborY = 0
        for (const neighbor of neighbors) {
          neighborX += current[neighbor * 2]
          neighborY += current[neighbor * 2 + 1]
        }
        neighborX /= Math.max(1, neighbors.length)
        neighborY /= Math.max(1, neighbors.length)
        const dataWeight = dataStrengths[nodeIndex] * 1.6
        const smoothWeight = 1.15
        const divisor = Math.max(0.0001, dataWeight + smoothWeight)
        next[nodeIndex * 2] = (dataOffsets[nodeIndex * 2] * dataWeight + neighborX * smoothWeight) / divisor
        next[nodeIndex * 2 + 1] = (dataOffsets[nodeIndex * 2 + 1] * dataWeight + neighborY * smoothWeight) / divisor
      }
    }
    current = next
  }

  const maxObservedPx = Math.max(2, ...matches.map(match => Math.hypot(match.dxPx, match.dyPx)))
  const offsets = [...current]
  for (let index = 0; index < offsets.length; index += 2) {
    const dxPx = offsets[index] * imageWidth
    const dyPx = offsets[index + 1] * imageHeight
    const magnitude = Math.hypot(dxPx, dyPx)
    const limit = Math.min(14, maxObservedPx * 1.12)
    if (magnitude > limit && magnitude > 0) {
      const scale = limit / magnitude
      offsets[index] *= scale
      offsets[index + 1] *= scale
    }
    if (Math.abs(offsets[index] * imageWidth) < 0.08) offsets[index] = 0
    if (Math.abs(offsets[index + 1] * imageHeight) < 0.08) offsets[index + 1] = 0
  }

  const placeholderDiagnostics = {
    totalAnchorCount,
    matchedAnchorCount,
    inlierCount: matches.length,
    coverage,
    confidence: 0,
    rmsBeforePx: 0,
    rmsAfterPx: 0,
    maxDisplacementPx: 0,
  }
  const warp: SheetPrecisionWarp = {
    version: 1,
    bounds,
    columns,
    rows,
    offsets,
    diagnostics: placeholderDiagnostics,
  }
  const rmsBeforePx = rootMeanSquare(matches.map(match => Math.hypot(match.dxPx, match.dyPx)))
  const rmsAfterPx = rootMeanSquare(matches.map(match => {
    const fitted = precisionWarpDisplacementAt(warp, match.x, match.y)
    return Math.hypot(match.dxPx - fitted.x * imageWidth, match.dyPx - fitted.y * imageHeight)
  }))
  const maxDisplacementPx = maximumNodeDisplacementPx(warp, imageWidth, imageHeight)
  const averageConfidence = average(matches.map(match => match.confidence))
  const confidence = clamp(
    averageConfidence * 0.58 + Math.min(1, matches.length / 80) * 0.22 + Math.min(1, coverage / 0.6) * 0.2,
    0,
    1,
  )
  warp.diagnostics = {
    totalAnchorCount,
    matchedAnchorCount,
    inlierCount: matches.length,
    coverage,
    confidence,
    rmsBeforePx,
    rmsAfterPx,
    maxDisplacementPx,
  }
  if (confidence < 0.3) return null
  if (rmsBeforePx >= 0.45 && rmsAfterPx > rmsBeforePx * 0.94) return null
  return warp
}

function filterPrecisionMatchOutliers(
  matches: PrecisionControlMatch[],
  imageWidth: number,
  imageHeight: number,
): PrecisionControlMatch[] {
  if (matches.length < 8) return matches
  return matches.filter(match => {
    const neighbors = matches.filter(candidate => (
      candidate !== match &&
      Math.abs(candidate.x - match.x) * imageWidth <= imageWidth * 0.13 &&
      Math.abs(candidate.y - match.y) * imageHeight <= imageHeight * 0.13
    ))
    if (neighbors.length < 3) return match.confidence >= 0.42
    const medianDx = median(neighbors.map(candidate => candidate.dxPx))
    const medianDy = median(neighbors.map(candidate => candidate.dyPx))
    const residual = Math.hypot(match.dxPx - medianDx, match.dyPx - medianDy)
    const threshold = match.confidence >= 0.72 ? 4.2 : 2.8
    return residual <= threshold
  })
}

function findDirectionalLine(
  darkness: Uint8Array,
  width: number,
  height: number,
  orientation: 'horizontal' | 'vertical',
  expectedFixed: number,
  movingCenter: number,
  movingHalfSpan: number,
  searchRadius: number,
): { position: number; confidence: number } | null {
  const radius = Math.max(2, Math.round(searchRadius))
  const scores: number[] = []
  for (let delta = -radius; delta <= radius; delta += 1) {
    scores.push(directionalLineScore(
      darkness,
      width,
      height,
      orientation,
      expectedFixed + delta,
      movingCenter,
      movingHalfSpan,
    ))
  }
  let bestIndex = 0
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] > scores[bestIndex]) bestIndex = index
  }
  if (bestIndex === 0 || bestIndex === scores.length - 1) return null
  const bestScore = scores[bestIndex]
  const competitors = scores.filter((_, index) => Math.abs(index - bestIndex) >= 3)
  const secondScore = competitors.length > 0 ? Math.max(...competitors) : 0
  const prominence = bestScore - secondScore
  const supportConfidence = clamp((bestScore - 0.09) / 0.36, 0, 1)
  const prominenceConfidence = clamp(prominence / 0.16, 0, 1)
  const confidence = supportConfidence * 0.68 + prominenceConfidence * 0.32
  if (bestScore < 0.13 || confidence < 0.2) return null
  const left = scores[bestIndex - 1]
  const center = scores[bestIndex]
  const right = scores[bestIndex + 1]
  const denominator = left - 2 * center + right
  const subpixel = Math.abs(denominator) > 1e-6
    ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5)
    : 0
  return {
    position: expectedFixed + (bestIndex - radius) + subpixel,
    confidence,
  }
}

function directionalLineScore(
  darkness: Uint8Array,
  width: number,
  height: number,
  orientation: 'horizontal' | 'vertical',
  fixedPosition: number,
  movingCenter: number,
  movingHalfSpan: number,
): number {
  const fixed = Math.round(fixedPosition)
  const movingStart = Math.round(movingCenter - movingHalfSpan)
  const movingEnd = Math.round(movingCenter + movingHalfSpan)
  let responseTotal = 0
  let coverage = 0
  let used = 0
  for (let moving = movingStart; moving <= movingEnd; moving += 2) {
    if (Math.abs(moving - movingCenter) <= 4) continue
    const x = orientation === 'vertical' ? fixed : moving
    const y = orientation === 'vertical' ? moving : fixed
    if (x < 6 || y < 6 || x >= width - 6 || y >= height - 6) continue
    const primary = darkness[y * width + x]
    const neighborA = orientation === 'vertical' ? darkness[y * width + x - 1] : darkness[(y - 1) * width + x]
    const neighborB = orientation === 'vertical' ? darkness[y * width + x + 1] : darkness[(y + 1) * width + x]
    const center = (primary + (neighborA + neighborB) * 0.35) / 1.7
    const flankA = orientation === 'vertical' ? darkness[y * width + x - 5] : darkness[(y - 5) * width + x]
    const flankB = orientation === 'vertical' ? darkness[y * width + x + 5] : darkness[(y + 5) * width + x]
    const response = Math.max(0, center - (flankA + flankB) * 0.28)
    responseTotal += response
    if (response >= 42) coverage += 1
    used += 1
  }
  if (used === 0) return 0
  return (responseTotal / (used * 255)) * 0.72 + (coverage / used) * 0.28
}

function buildDarknessMap(image: ImageData): Uint8Array {
  const darkness = new Uint8Array(image.width * image.height)
  for (let pixel = 0, offset = 0; pixel < darkness.length; pixel += 1, offset += 4) {
    if (image.data[offset + 3] < 24) continue
    const luminance = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114
    darkness[pixel] = Math.round(clamp((205 - luminance) * 1.55, 0, 255))
  }
  return darkness
}

function robustNodeEstimate(
  matches: PrecisionControlMatch[],
  nodeX: number,
  nodeY: number,
  scaleX: number,
  scaleY: number,
  imageWidth: number,
  imageHeight: number,
): { dxPx: number; dyPx: number; strength: number } {
  const candidates = matches.flatMap(match => {
    const distanceSquared = ((match.x - nodeX) / scaleX) ** 2 + ((match.y - nodeY) / scaleY) ** 2
    if (distanceSquared > 8) return []
    return [{ match, weight: match.confidence ** 2 * Math.exp(-distanceSquared * 0.5) }]
  })
  if (candidates.length === 0) return { dxPx: 0, dyPx: 0, strength: 0 }
  let dxPx = weightedAverage(candidates, candidate => candidate.match.dxPx)
  let dyPx = weightedAverage(candidates, candidate => candidate.match.dyPx)
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const robust = candidates.map(candidate => {
      const residual = Math.hypot(candidate.match.dxPx - dxPx, candidate.match.dyPx - dyPx)
      return { ...candidate, weight: candidate.weight / (1 + (residual / 2.4) ** 2) }
    })
    dxPx = weightedAverage(robust, candidate => candidate.match.dxPx)
    dyPx = weightedAverage(robust, candidate => candidate.match.dyPx)
  }
  const spatialWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
  const resolutionScale = Math.sqrt((imageWidth * imageHeight) / (1754 * 2481))
  return {
    dxPx,
    dyPx,
    strength: clamp(spatialWeight / Math.max(1.5, 3 * resolutionScale), 0.08, 3.5),
  }
}

function weightedAverage<T extends { weight: number }>(items: T[], value: (item: T) => number): number {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 1e-9) return 0
  return items.reduce((sum, item) => sum + value(item) * item.weight, 0) / totalWeight
}

function neighborNodeIndices(row: number, column: number, rows: number, columns: number): number[] {
  const result: number[] = []
  if (row > 0) result.push((row - 1) * columns + column)
  if (row < rows - 1) result.push((row + 1) * columns + column)
  if (column > 0) result.push(row * columns + column - 1)
  if (column < columns - 1) result.push(row * columns + column + 1)
  return result
}

function precisionMatchCoverage(matches: PrecisionControlMatch[], bounds: NormalizedRect): number {
  const columns = 4
  const rows = 4
  const occupied = new Set<number>()
  for (const match of matches) {
    const column = Math.floor(clamp((match.x - bounds.x) / bounds.w, 0, 0.9999) * columns)
    const row = Math.floor(clamp((match.y - bounds.y) / bounds.h, 0, 0.9999) * rows)
    occupied.add(row * columns + column)
  }
  return occupied.size / (columns * rows)
}

function maximumNodeDisplacementPx(warp: SheetPrecisionWarp, imageWidth: number, imageHeight: number): number {
  let maximum = 0
  for (let index = 0; index < warp.offsets.length; index += 2) {
    maximum = Math.max(maximum, Math.hypot(warp.offsets[index] * imageWidth, warp.offsets[index + 1] * imageHeight))
  }
  return maximum
}

function rootMeanSquare(values: number[]): number {
  return values.length > 0 ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) : 0
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    window.requestAnimationFrame(() => resolve())
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
