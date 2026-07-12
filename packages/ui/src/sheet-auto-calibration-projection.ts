import { type NormalizedPoint } from '@xsheet-remap/core'
import { clampNumber } from './sheetInteraction'
import { MIN_HORIZONTAL_SPAN_RATIO, MIN_PROJECTED_LINE_RATIO, type DetectedLine, type ScoredLine } from './sheet-auto-calibration-types'

export function horizontalLineEndpoints(
  image: ImageData,
  y: number,
  searchLeft: number,
  searchRight: number,
  expectedLeft: number,
  expectedRight: number,
  maxGap: number,
): { start: number; end: number; ratio: number } | null {
  const yCenter = Math.round(clampNumber(y, 0, image.height - 1))
  const yRadius = 2
  const groups: Array<{ start: number; end: number; darkCount: number; sampleCount: number }> = []
  let current: { start: number; end: number; darkCount: number; sampleCount: number; lastHit: number } | null = null
  for (let x = searchLeft; x <= searchRight; x += 1) {
    const ratio = darkPixelsInVerticalBand(image, x, yCenter - yRadius, yCenter + yRadius) / (yRadius * 2 + 1)
    if (ratio >= MIN_HORIZONTAL_SPAN_RATIO) {
      if (!current || x - current.lastHit > maxGap) {
        if (current) groups.push(current)
        current = { start: x, end: x, darkCount: ratio, sampleCount: 1, lastHit: x }
      } else {
        current.end = x
        current.darkCount += ratio
        current.sampleCount += 1
        current.lastHit = x
      }
    }
  }
  if (current) groups.push(current)
  const expectedWidth = Math.max(1, expectedRight - expectedLeft)
  const endpointWindow = expectedWidth * 0.11
  const leftGroups = groups.filter(group => group.start <= expectedLeft + endpointWindow && group.end >= expectedLeft - endpointWindow)
  const rightGroups = groups.filter(group => group.start <= expectedRight + endpointWindow && group.end >= expectedRight - endpointWindow)
  if (leftGroups.length === 0 || rightGroups.length === 0) return null
  const left = Math.min(...leftGroups.map(group => group.start))
  const right = Math.max(...rightGroups.map(group => group.end))
  if (right <= left) return null
  const usedGroups = groups.filter(group => group.end >= left && group.start <= right)
  const darkCount = usedGroups.reduce((sum, group) => sum + group.darkCount, 0)
  const sampleCount = usedGroups.reduce((sum, group) => sum + group.sampleCount, 0)
  return {
    start: left,
    end: right,
    ratio: darkCount / Math.max(1, sampleCount),
  }
}

export function bestProjectedLine(
  expectedPosition: number,
  searchWindow: number,
  span: number,
  countDarkPixels: (position: number) => number,
): ProjectedLineResult | null {
  const start = Math.max(0, expectedPosition - searchWindow)
  const end = expectedPosition + searchWindow
  const groups: ProjectedLineGroup[] = []
  let current: ProjectedLineGroup | null = null
  for (let position = start; position <= end; position += 1) {
    const ratio = countDarkPixels(position) / Math.max(1, span)
    if (ratio >= MIN_PROJECTED_LINE_RATIO) {
      if (!current) {
        current = {
          start: position,
          end: position,
          bestPosition: position,
          bestRatio: ratio,
        }
      } else {
        current.end = position
        if (ratio > current.bestRatio) {
          current.bestPosition = position
          current.bestRatio = ratio
        }
      }
      continue
    }
    if (current) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)
  const closest = groups.reduce<ProjectedLineGroup | null>((best, group) => {
    if (!best) return group
    const distance = distanceToRange(expectedPosition, group.start, group.end)
    const bestDistance = distanceToRange(expectedPosition, best.start, best.end)
    if (distance !== bestDistance) return distance < bestDistance ? group : best
    return group.bestRatio > best.bestRatio ? group : best
  }, null)
  return closest
    ? {
        position: projectedLinePositionForExpected(closest, expectedPosition),
        ratio: closest.bestRatio,
        group: closest,
      }
    : null
}

export type ProjectedLineResult = {
  position: number
  ratio: number
  group: ProjectedLineGroup
}

type ProjectedLineGroup = {
  start: number
  end: number
  bestPosition: number
  bestRatio: number
}

function distanceToRange(value: number, start: number, end: number): number {
  if (value < start) return start - value
  if (value > end) return value - end
  return 0
}

export function projectedLinePositionForExpected(group: ProjectedLineGroup, expectedPosition: number): number {
  void expectedPosition
  return Math.round(group.bestPosition)
}

export function localSupportGroups(
  startPosition: number,
  endPosition: number,
  supportRatioAt: (position: number) => number,
  minRatio: number,
): ProjectedLineGroup[] {
  const start = Math.round(startPosition)
  const end = Math.round(endPosition)
  const groups: ProjectedLineGroup[] = []
  let current: ProjectedLineGroup | null = null
  for (let position = start; position <= end; position += 1) {
    const ratio = supportRatioAt(position)
    if (ratio >= minRatio) {
      if (!current) {
        current = {
          start: position,
          end: position,
          bestPosition: position,
          bestRatio: ratio,
        }
      } else {
        current.end = position
        if (ratio > current.bestRatio) {
          current.bestPosition = position
          current.bestRatio = ratio
        }
      }
      continue
    }
    if (current) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)
  return groups
}

export function bestLocalSupportGroup(groups: ProjectedLineGroup[], anchorPosition: number): ProjectedLineGroup | null {
  return groups.reduce<ProjectedLineGroup | null>((best, group) => {
    if (!best) return group
    const distance = distanceToRange(anchorPosition, group.start, group.end)
    const bestDistance = distanceToRange(anchorPosition, best.start, best.end)
    if (distance !== bestDistance) return distance < bestDistance ? group : best
    return group.bestRatio > best.bestRatio ? group : best
  }, null)
}

export function darkPixelsInRow(image: ImageData, y: number, xStart: number, xEnd: number): number {
  if (y < 0 || y >= image.height) return 0
  let count = 0
  const start = Math.max(0, Math.min(image.width - 1, xStart))
  const end = Math.max(0, Math.min(image.width - 1, xEnd))
  for (let x = start; x <= end; x += 1) {
    if (isDarkPixel(image, x, y)) count += 1
  }
  return count
}

export function darkPixelsInColumn(image: ImageData, x: number, yStart: number, yEnd: number): number {
  if (x < 0 || x >= image.width) return 0
  let count = 0
  const start = Math.max(0, Math.min(image.height - 1, yStart))
  const end = Math.max(0, Math.min(image.height - 1, yEnd))
  for (let y = start; y <= end; y += 1) {
    if (isDarkPixel(image, x, y)) count += 1
  }
  return count
}

function darkPixelsInVerticalBand(image: ImageData, x: number, yStart: number, yEnd: number): number {
  return darkPixelsInColumn(image, x, yStart, yEnd)
}

export function darkRatioInHorizontalBand(image: ImageData, y: number, xStart: number, xEnd: number, radius: number): number {
  const center = Math.round(clampNumber(y, 0, image.height - 1))
  const top = Math.max(0, center - radius)
  const bottom = Math.min(image.height - 1, center + radius)
  const start = Math.max(0, Math.min(image.width - 1, Math.round(Math.min(xStart, xEnd))))
  const end = Math.max(0, Math.min(image.width - 1, Math.round(Math.max(xStart, xEnd))))
  let count = 0
  for (let currentY = top; currentY <= bottom; currentY += 1) {
    count += darkPixelsInRow(image, currentY, start, end)
  }
  return count / Math.max(1, (bottom - top + 1) * (end - start + 1))
}

export function darkRatioInVerticalBand(image: ImageData, x: number, yStart: number, yEnd: number, radius: number): number {
  const center = Math.round(clampNumber(x, 0, image.width - 1))
  const left = Math.max(0, center - radius)
  const right = Math.min(image.width - 1, center + radius)
  const start = Math.max(0, Math.min(image.height - 1, Math.round(Math.min(yStart, yEnd))))
  const end = Math.max(0, Math.min(image.height - 1, Math.round(Math.max(yStart, yEnd))))
  let count = 0
  for (let currentX = left; currentX <= right; currentX += 1) {
    count += darkPixelsInColumn(image, currentX, start, end)
  }
  return count / Math.max(1, (right - left + 1) * (end - start + 1))
}

export function isDarkPixel(image: ImageData, x: number, y: number): boolean {
  const offset = (y * image.width + x) * 4
  if (image.data[offset + 3] < 32) return false
  const luminance = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114
  return luminance < 140
}

export function bestHorizontalLine(lines: DetectedLine[], expectedY: number, expectedLeft: number, expectedRight: number, imageHeight: number): ScoredLine | null {
  const tolerance = Math.max(imageHeight * 0.035, Math.abs(expectedRight - expectedLeft) * 0.035, 24)
  return bestLine(lines, line => {
    const y = lineYAt(line, (expectedLeft + expectedRight) / 2) ?? line.centerY
    const distanceScore = Math.abs(y - expectedY) / tolerance
    const overlap = rangeOverlap(Math.min(line.x1, line.x2), Math.max(line.x1, line.x2), expectedLeft, expectedRight)
    const expectedWidth = Math.max(1, expectedRight - expectedLeft)
    const overlapRatio = overlap / expectedWidth
    const coverageScore = overlapRatio >= 0.25 ? 0 : (0.25 - overlapRatio) * 5
    return distanceScore + coverageScore + line.angleDeg / 35
  })
}

export function bestVerticalLine(lines: DetectedLine[], expectedX: number, expectedTop: number, expectedBottom: number, imageWidth: number): ScoredLine | null {
  const tolerance = Math.max(imageWidth * 0.035, Math.abs(expectedBottom - expectedTop) * 0.035, 24)
  return bestLine(lines, line => {
    const x = lineXAt(line, (expectedTop + expectedBottom) / 2) ?? line.centerX
    const distanceScore = Math.abs(x - expectedX) / tolerance
    const overlap = rangeOverlap(Math.min(line.y1, line.y2), Math.max(line.y1, line.y2), expectedTop, expectedBottom)
    const expectedHeight = Math.max(1, expectedBottom - expectedTop)
    const overlapRatio = overlap / expectedHeight
    const coverageScore = overlapRatio >= 0.25 ? 0 : (0.25 - overlapRatio) * 5
    return distanceScore + coverageScore + Math.abs(90 - line.angleDeg) / 35
  })
}

function bestLine(lines: DetectedLine[], score: (line: DetectedLine) => number): ScoredLine | null {
  let best: ScoredLine | null = null
  for (const line of lines) {
    const current = { line, score: score(line) }
    if (!best || current.score < best.score) best = current
  }
  return best
}

export function normalizedAxisAngleDeg(angleDeg: number): number {
  let angle = Math.abs(angleDeg)
  while (angle > 180) angle -= 180
  if (angle > 90) angle = 180 - angle
  return angle
}

function lineYAt(line: DetectedLine, x: number): number | null {
  const dx = line.x2 - line.x1
  if (Math.abs(dx) < 1e-6) return null
  return line.y1 + (line.y2 - line.y1) * ((x - line.x1) / dx)
}

function lineXAt(line: DetectedLine, y: number): number | null {
  const dy = line.y2 - line.y1
  if (Math.abs(dy) < 1e-6) return null
  return line.x1 + (line.x2 - line.x1) * ((y - line.y1) / dy)
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export function intersectLines(a: DetectedLine, b: DetectedLine): { x: number; y: number } | null {
  const x1 = a.x1
  const y1 = a.y1
  const x2 = a.x2
  const y2 = a.y2
  const x3 = b.x1
  const y3 = b.y1
  const x4 = b.x2
  const y4 = b.y2
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-6) return null
  return {
    x: ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
    y: ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator,
  }
}

export function normalizePixelPoint(point: { x: number; y: number }, width: number, height: number): NormalizedPoint {
  return {
    x: clampNumber(point.x / Math.max(1, width), 0, 1),
    y: clampNumber(point.y / Math.max(1, height), 0, 1),
  }
}

export function isPlausibleCalibrationQuad(points: NormalizedPoint[]): boolean {
  if (points.length !== 4) return false
  const [tl, tr, br, bl] = points
  const topWidth = distance(tl, tr)
  const bottomWidth = distance(bl, br)
  const leftHeight = distance(tl, bl)
  const rightHeight = distance(tr, br)
  const area = polygonArea(points)
  return area > 0.05 &&
    topWidth > 0.15 &&
    bottomWidth > 0.15 &&
    leftHeight > 0.15 &&
    rightHeight > 0.15 &&
    tl.x < tr.x &&
    bl.x < br.x &&
    tl.y < bl.y &&
    tr.y < br.y
}

export function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function polygonArea(points: NormalizedPoint[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area) / 2
}
