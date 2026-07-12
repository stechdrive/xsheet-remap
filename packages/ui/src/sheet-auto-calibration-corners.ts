import { clampNumber } from './sheetInteraction'
import { ProjectedLineResult, bestLocalSupportGroup, darkRatioInHorizontalBand, darkRatioInVerticalBand, distance, horizontalLineEndpoints, isDarkPixel, localSupportGroups } from './sheet-auto-calibration-projection'
import type { DarkDistanceMap, GridFitGuides, LocalCornerConfig, LocalCornerGuides, LocalCornerId, LocalCornerMatch, PixelPoint, PixelRect } from './sheet-auto-calibration-types'

export const localCornerConfigs: LocalCornerConfig[] = [
  { id: 'tl', index: 0, xSign: 1, ySign: 1 },
  { id: 'tr', index: 1, xSign: -1, ySign: 1 },
  { id: 'br', index: 2, xSign: -1, ySign: -1 },
  { id: 'bl', index: 3, xSign: 1, ySign: -1 },
]

export function matchLocalTemplateCorner(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  basePoint: PixelPoint,
  config: LocalCornerConfig,
  expectedWidth: number,
  expectedHeight: number,
): LocalCornerMatch & { id: LocalCornerId } {
  const localSpanX = clampNumber(expectedWidth * 0.16, 170, 340)
  const localSpanY = clampNumber(expectedHeight * 0.15, 210, 380)
  const localGuides = localCornerGuides(guides, config, expectedWidth, expectedHeight, localSpanX, localSpanY)
  const baseRawScore = scoreLocalTemplateCorner(distanceMap, basePoint, config, localGuides, localSpanX, localSpanY, 0)
  let best: LocalCornerMatch & { id: LocalCornerId } = {
    id: config.id,
    point: basePoint,
    score: baseRawScore,
    baseScore: baseRawScore,
    rawScore: baseRawScore,
    baseRawScore,
    dx: 0,
    dy: 0,
    angleDeg: 0,
  }
  const consider = (dx: number, dy: number, angleDeg: number) => {
    const point = { x: basePoint.x + dx, y: basePoint.y + dy }
    const rawScore = scoreLocalTemplateCorner(distanceMap, point, config, localGuides, localSpanX, localSpanY, angleDeg)
    const movementPenalty = Math.hypot(dx, dy) / 16 * 0.018
    const anglePenalty = Math.abs(angleDeg) / 1.2 * 0.012
    const score = rawScore - movementPenalty - anglePenalty
    if (score > best.score) {
      best = {
        id: config.id,
        point,
        score,
        baseScore: baseRawScore,
        rawScore,
        baseRawScore,
        dx,
        dy,
        angleDeg,
      }
    }
  }

  for (let angle = -0.9; angle <= 0.901; angle += 0.3) {
    for (let dy = -16; dy <= 16; dy += 2) {
      for (let dx = -16; dx <= 16; dx += 2) {
        consider(dx, dy, angle)
      }
    }
  }
  const coarse = best
  for (let angle = coarse.angleDeg - 0.25; angle <= coarse.angleDeg + 0.251; angle += 0.1) {
    for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy += 1) {
      for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx += 1) {
        consider(dx, dy, angle)
      }
    }
  }

  const rawGain = best.rawScore - baseRawScore
  if (rawGain < 0.018 || best.score < baseRawScore + 0.006) {
    return {
      id: config.id,
      point: basePoint,
      score: baseRawScore,
      baseScore: baseRawScore,
      rawScore: baseRawScore,
      baseRawScore,
      dx: 0,
      dy: 0,
      angleDeg: 0,
    }
  }
  return best
}

export function stabilizeLocalCornerMatches(matches: Array<LocalCornerMatch & { id: LocalCornerId }>): Array<LocalCornerMatch & { id: LocalCornerId }> {
  const byId = new Map(matches.map(match => [match.id, match]))
  const keep = new Set<LocalCornerId>(matches.map(match => match.id))
  const rejectIsolatedSideMove = (
    firstId: LocalCornerId,
    secondId: LocalCornerId,
    axis: 'x' | 'y',
  ) => {
    const first = byId.get(firstId)
    const second = byId.get(secondId)
    if (!first || !second) return
    const firstDelta = axis === 'x' ? first.dx : first.dy
    const secondDelta = axis === 'x' ? second.dx : second.dy
    if (Math.abs(firstDelta) <= 7 || Math.abs(secondDelta) > 4 || Math.sign(firstDelta) === Math.sign(secondDelta)) return
    if (first.rawScore - first.baseRawScore < 0.04) keep.delete(firstId)
  }
  rejectIsolatedSideMove('tl', 'bl', 'x')
  rejectIsolatedSideMove('bl', 'tl', 'x')
  rejectIsolatedSideMove('tr', 'br', 'x')
  rejectIsolatedSideMove('br', 'tr', 'x')
  rejectIsolatedSideMove('tl', 'tr', 'y')
  rejectIsolatedSideMove('tr', 'tl', 'y')
  rejectIsolatedSideMove('bl', 'br', 'y')
  rejectIsolatedSideMove('br', 'bl', 'y')
  return matches.filter(match => keep.has(match.id) && (match.dx !== 0 || match.dy !== 0 || Math.abs(match.angleDeg) > 0.01))
}

function localCornerGuides(
  guides: GridFitGuides,
  config: LocalCornerConfig,
  expectedWidth: number,
  expectedHeight: number,
  localSpanX: number,
  localSpanY: number,
): LocalCornerGuides {
  const vertical = guides.vertical
    .map(guide => ({
      offset: config.xSign > 0 ? guide.ratio * expectedWidth : (1 - guide.ratio) * expectedWidth,
      weight: guide.weight,
    }))
    .filter(guide => guide.offset >= -0.5 && guide.offset <= localSpanX)
    .sort((a, b) => a.offset - b.offset)
  const horizontal = guides.horizontal
    .map(guide => ({
      offset: config.ySign > 0 ? guide.ratio * expectedHeight : (1 - guide.ratio) * expectedHeight,
      weight: guide.weight,
    }))
    .filter(guide => guide.offset >= -0.5 && guide.offset <= localSpanY)
    .sort((a, b) => a.offset - b.offset)
  return {
    vertical: vertical.slice(0, 14),
    horizontal: horizontal.slice(0, 16),
  }
}

function scoreLocalTemplateCorner(
  distanceMap: DarkDistanceMap,
  origin: PixelPoint,
  config: LocalCornerConfig,
  guides: LocalCornerGuides,
  localSpanX: number,
  localSpanY: number,
  angleDeg: number,
): number {
  const angle = angleDeg * Math.PI / 180
  const right = { x: Math.cos(angle), y: Math.sin(angle) }
  const down = { x: -Math.sin(angle), y: Math.cos(angle) }
  const u = { x: right.x * config.xSign, y: right.y * config.xSign }
  const v = { x: down.x * config.ySign, y: down.y * config.ySign }
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const start = addLocalVector(origin, u, guide.offset, v, 0)
    const end = addLocalVector(origin, u, guide.offset, v, localSpanY)
    const score = scoreDistanceSegment(distanceMap, start, end)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const start = addLocalVector(origin, u, 0, v, guide.offset)
    const end = addLocalVector(origin, u, localSpanX, v, guide.offset)
    const score = scoreDistanceSegment(distanceMap, start, end)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  return weightedScore / Math.max(1, totalWeight)
}

function addLocalVector(origin: PixelPoint, u: PixelPoint, uDistance: number, v: PixelPoint, vDistance: number): PixelPoint {
  return {
    x: origin.x + u.x * uDistance + v.x * vDistance,
    y: origin.y + u.y * uDistance + v.y * vDistance,
  }
}

function scoreDistanceSegment(distanceMap: DarkDistanceMap, start: PixelPoint, end: PixelPoint): number {
  const length = Math.max(1, distance(start, end))
  const sampleCount = Math.round(clampNumber(length / 18, 14, 40))
  const maxDistance = 5
  let total = 0
  let coverage = 0
  let used = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount === 1 ? 0.5 : index / (sampleCount - 1)
    const x = start.x + (end.x - start.x) * t
    const y = start.y + (end.y - start.y) * t
    if (x < 0 || y < 0 || x >= distanceMap.width || y >= distanceMap.height) continue
    const currentDistance = darkDistanceAt(distanceMap, x, y)
    const normalized = clampNumber(1 - currentDistance / maxDistance, 0, 1)
    total += normalized
    if (currentDistance <= 2.1) coverage += 1
    used += 1
  }
  if (used === 0) return 0
  return (total / used) * 0.72 + (coverage / used) * 0.28
}

export function averageNumber(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function pixelRectFromCorners(corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]): PixelRect {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  return {
    left: (topLeft.x + bottomLeft.x) / 2,
    top: (topLeft.y + topRight.y) / 2,
    right: (topRight.x + bottomRight.x) / 2,
    bottom: (bottomLeft.y + bottomRight.y) / 2,
  }
}

export function pixelRectToCorners(rect: PixelRect): [PixelPoint, PixelPoint, PixelPoint, PixelPoint] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]
}

export function scoreTemplateGridDistanceFitRect(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  candidate: PixelRect,
): number {
  const width = Math.max(1, candidate.right - candidate.left)
  const height = Math.max(1, candidate.bottom - candidate.top)
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const x = candidate.left + width * guide.ratio
    const score = scoreDistanceLine(distanceMap, 'vertical', x, candidate.top, candidate.bottom)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const y = candidate.top + height * guide.ratio
    const score = scoreDistanceLine(distanceMap, 'horizontal', y, candidate.left, candidate.right)
    weightedScore += score * guide.weight
    totalWeight += guide.weight
  }
  return weightedScore / Math.max(1, totalWeight)
}

function scoreDistanceLine(
  distanceMap: DarkDistanceMap,
  orientation: 'horizontal' | 'vertical',
  fixedPosition: number,
  startPosition: number,
  endPosition: number,
): number {
  const start = Math.min(startPosition, endPosition)
  const end = Math.max(startPosition, endPosition)
  const length = Math.max(1, end - start)
  const sampleCount = Math.round(clampNumber(length / 85, 12, 32))
  const maxDistance = 5.5
  let total = 0
  let coverage = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount === 1 ? 0.5 : index / (sampleCount - 1)
    const moving = start + length * t
    const x = orientation === 'vertical' ? fixedPosition : moving
    const y = orientation === 'vertical' ? moving : fixedPosition
    const distance = darkDistanceAt(distanceMap, x, y)
    const normalized = clampNumber(1 - distance / maxDistance, 0, 1)
    total += normalized
    if (distance <= 2.25) coverage += 1
  }
  const average = total / sampleCount
  return average * 0.68 + (coverage / sampleCount) * 0.32
}

function darkDistanceAt(distanceMap: DarkDistanceMap, x: number, y: number): number {
  const clampedX = Math.round(clampNumber(x, 0, distanceMap.width - 1))
  const clampedY = Math.round(clampNumber(y, 0, distanceMap.height - 1))
  return distanceMap.distances[clampedY * distanceMap.width + clampedX] / distanceMap.unit
}

export function buildDarkDistanceMap(image: ImageData): DarkDistanceMap {
  const width = image.width
  const height = image.height
  const distances = new Uint16Array(width * height)
  const maxDistance = 32000
  const unit = 3
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      distances[rowOffset + x] = isDarkPixel(image, x, y) ? 0 : maxDistance
    }
  }
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x
      let value = distances[index]
      if (x > 0) value = Math.min(value, distances[index - 1] + 3)
      if (y > 0) {
        const up = index - width
        value = Math.min(value, distances[up] + 3)
        if (x > 0) value = Math.min(value, distances[up - 1] + 4)
        if (x < width - 1) value = Math.min(value, distances[up + 1] + 4)
      }
      distances[index] = value
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowOffset = y * width
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = rowOffset + x
      let value = distances[index]
      if (x < width - 1) value = Math.min(value, distances[index + 1] + 3)
      if (y < height - 1) {
        const down = index + width
        value = Math.min(value, distances[down] + 3)
        if (x > 0) value = Math.min(value, distances[down - 1] + 4)
        if (x < width - 1) value = Math.min(value, distances[down + 1] + 4)
      }
      distances[index] = value
    }
  }
  return { width, height, distances, unit }
}

export function segmentedVerticalSupport(image: ImageData, x: number, yStart: number, yEnd: number, radius: number): number {
  const start = Math.max(0, Math.round(Math.min(yStart, yEnd)))
  const end = Math.min(image.height - 1, Math.round(Math.max(yStart, yEnd)))
  const length = Math.max(1, end - start + 1)
  const segments = Math.max(6, Math.min(24, Math.round(length / 90)))
  let coverage = 0
  let average = 0
  for (let index = 0; index < segments; index += 1) {
    const segmentStart = start + Math.round(length * (index / segments))
    const segmentEnd = start + Math.round(length * ((index + 1) / segments)) - 1
    const ratio = darkRatioInVerticalBand(image, x, segmentStart, segmentEnd, radius)
    const normalized = clampNumber(ratio / 0.1, 0, 1)
    average += normalized
    if (ratio >= 0.018) coverage += 1
  }
  return (average / segments) * 0.42 + (coverage / segments) * 0.58
}

export function segmentedHorizontalSupport(image: ImageData, y: number, xStart: number, xEnd: number, radius: number): number {
  const start = Math.max(0, Math.round(Math.min(xStart, xEnd)))
  const end = Math.min(image.width - 1, Math.round(Math.max(xStart, xEnd)))
  const length = Math.max(1, end - start + 1)
  const segments = Math.max(6, Math.min(24, Math.round(length / 90)))
  let coverage = 0
  let average = 0
  for (let index = 0; index < segments; index += 1) {
    const segmentStart = start + Math.round(length * (index / segments))
    const segmentEnd = start + Math.round(length * ((index + 1) / segments)) - 1
    const ratio = darkRatioInHorizontalBand(image, y, segmentStart, segmentEnd, radius)
    const normalized = clampNumber(ratio / 0.1, 0, 1)
    average += normalized
    if (ratio >= 0.018) coverage += 1
  }
  return (average / segments) * 0.42 + (coverage / segments) * 0.58
}

export function boundaryOutsidePenalty(
  image: ImageData,
  candidate: { left: number; top: number; right: number; bottom: number },
): number {
  const height = Math.max(1, candidate.bottom - candidate.top)
  const width = Math.max(1, candidate.right - candidate.left)
  const verticalProbe = clampNumber(height * 0.08, 70, 170)
  const horizontalProbe = clampNumber(width * 0.06, 80, 180)
  const topOutsideStart = candidate.top - verticalProbe
  const topOutsideEnd = candidate.top - 8
  const bottomOutsideStart = candidate.bottom + 8
  const bottomOutsideEnd = candidate.bottom + verticalProbe
  const leftOutsideStart = candidate.left - horizontalProbe
  const leftOutsideEnd = candidate.left - 8
  const rightOutsideStart = candidate.right + 8
  const rightOutsideEnd = candidate.right + horizontalProbe
  const verticalOvershoot = Math.max(
    darkRatioInVerticalBand(image, candidate.left, topOutsideStart, topOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.right, topOutsideStart, topOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.left, bottomOutsideStart, bottomOutsideEnd, 1),
    darkRatioInVerticalBand(image, candidate.right, bottomOutsideStart, bottomOutsideEnd, 1),
  )
  const horizontalOvershoot = Math.max(
    darkRatioInHorizontalBand(image, candidate.top, leftOutsideStart, leftOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.bottom, leftOutsideStart, leftOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.top, rightOutsideStart, rightOutsideEnd, 1),
    darkRatioInHorizontalBand(image, candidate.bottom, rightOutsideStart, rightOutsideEnd, 1),
  )
  return Math.max(0, verticalOvershoot - 0.035) * 0.25 + Math.max(0, horizontalOvershoot - 0.035) * 0.2
}

export function stabilizeCornerSideExtents(
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  topLeft: PixelPoint,
  topRight: PixelPoint,
  bottomRight: PixelPoint,
  bottomLeft: PixelPoint,
  expectedWidth: number,
): [PixelPoint, PixelPoint, PixelPoint, PixelPoint] {
  let nextTopLeft = topLeft
  let nextTopRight = topRight
  let nextBottomRight = bottomRight
  let nextBottomLeft = bottomLeft
  const sideDeltaLimit = clampNumber(expectedWidth * 0.018, 18, 42)
  const leftDelta = topLeft.x - bottomLeft.x
  const rightDelta = topRight.x - bottomRight.x
  if (Math.abs(leftDelta) > sideDeltaLimit && Math.abs(rightDelta) < sideDeltaLimit * 0.75) {
    const topProjectedLeft = topRight.x - expectedWidth
    const bottomProjectedLeft = bottomRight.x - expectedWidth
    const topDeviation = Math.abs(topLeft.x - topProjectedLeft)
    const bottomDeviation = Math.abs(bottomLeft.x - bottomProjectedLeft)
    const suspect = moreSuspiciousCorner(
      topLeft,
      bottomLeft,
      topDeviation,
      bottomDeviation,
      image,
      rect,
      'left',
    )
    if (suspect === 'top') {
      nextTopLeft = { ...topLeft, x: topProjectedLeft }
    } else if (suspect === 'bottom') {
      nextBottomLeft = { ...bottomLeft, x: bottomProjectedLeft }
    }
  }
  if (Math.abs(rightDelta) > sideDeltaLimit && Math.abs(leftDelta) < sideDeltaLimit * 0.75) {
    const topProjectedRight = topLeft.x + expectedWidth
    const bottomProjectedRight = bottomLeft.x + expectedWidth
    const topDeviation = Math.abs(topRight.x - topProjectedRight)
    const bottomDeviation = Math.abs(bottomRight.x - bottomProjectedRight)
    const suspect = moreSuspiciousCorner(
      topRight,
      bottomRight,
      topDeviation,
      bottomDeviation,
      image,
      rect,
      'right',
    )
    if (suspect === 'top') {
      nextTopRight = { ...topRight, x: topProjectedRight }
    } else if (suspect === 'bottom') {
      nextBottomRight = { ...bottomRight, x: bottomProjectedRight }
    }
  }
  return [nextTopLeft, nextTopRight, nextBottomRight, nextBottomLeft]
}

function moreSuspiciousCorner(
  top: PixelPoint,
  bottom: PixelPoint,
  topDeviation: number,
  bottomDeviation: number,
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
): 'top' | 'bottom' | null {
  const deviationGap = Math.abs(topDeviation - bottomDeviation)
  const minimumGap = clampNumber((rect.right - rect.left) * 0.01, 10, 24)
  if (deviationGap < minimumGap) return null

  const topScore = cornerGuideSupportScore(image, top, rect, horizontalSide, 'top')
  const bottomScore = cornerGuideSupportScore(image, bottom, rect, horizontalSide, 'bottom')
  if (topDeviation > bottomDeviation && topScore <= bottomScore + 0.02) return 'top'
  if (bottomDeviation > topDeviation && bottomScore <= topScore + 0.02) return 'bottom'
  return null
}

export function refineHorizontalSpanCorner(
  image: ImageData,
  point: PixelPoint,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
  verticalSide: 'top' | 'bottom',
  horizontalLine: ProjectedLineResult,
): PixelPoint {
  const rectWidth = Math.max(1, rect.right - rect.left)
  const rectHeight = Math.max(1, rect.bottom - rect.top)
  const horizontalArm = Math.round(clampNumber(rectWidth * 0.08, 70, 180))
  const verticalArm = Math.round(clampNumber(rectHeight * 0.08, 90, 200))
  const horizontalRange = horizontalSide === 'left'
    ? { start: point.x - 4, end: point.x + horizontalArm }
    : { start: point.x - horizontalArm, end: point.x + 4 }
  const yGroups = localSupportGroups(
    horizontalLine.group.start - 3,
    horizontalLine.group.end + 3,
    y => darkRatioInHorizontalBand(image, y, horizontalRange.start, horizontalRange.end, 2),
    0.1,
  )
  const yGroup = bestLocalSupportGroup(yGroups, point.y)
  const refinedY = yGroup ? Math.round((yGroup.start + yGroup.end) / 2) : point.y
  const verticalRange = verticalSide === 'top'
    ? { start: refinedY - 4, end: refinedY + verticalArm }
    : { start: refinedY - verticalArm, end: refinedY + 4 }
  const xSearchRadius = Math.round(clampNumber(rectWidth * 0.006, 8, 16))
  const xGroups = localSupportGroups(
    point.x - xSearchRadius,
    point.x + xSearchRadius,
    x => darkRatioInVerticalBand(image, x, verticalRange.start, verticalRange.end, 1),
    0.08,
  )
  const xGroup = bestLocalSupportGroup(xGroups, point.x)
  const refinedX = xGroup ? Math.round((xGroup.start + xGroup.end) / 2) : point.x
  const candidate = { x: refinedX, y: refinedY }
  if (candidate.x === point.x && candidate.y === point.y) return point
  const baseScore = cornerGuideSupportScore(image, point, rect, horizontalSide, verticalSide)
  const candidateScore = cornerGuideSupportScore(image, candidate, rect, horizontalSide, verticalSide)
  const scoreImprovement = candidateScore - baseScore
  if (scoreImprovement >= 0.012) return candidate
  const minorAdjustment = Math.abs(candidate.x - point.x) <= 4 && Math.abs(candidate.y - point.y) <= 2
  if (minorAdjustment && scoreImprovement >= -0.004) return candidate
  return point
}

function cornerGuideSupportScore(
  image: ImageData,
  point: PixelPoint,
  rect: { left: number; top: number; right: number; bottom: number },
  horizontalSide: 'left' | 'right',
  verticalSide: 'top' | 'bottom',
): number {
  const rectWidth = Math.max(1, rect.right - rect.left)
  const rectHeight = Math.max(1, rect.bottom - rect.top)
  const horizontalArm = Math.round(clampNumber(rectWidth * 0.08, 70, 180))
  const verticalArm = Math.round(clampNumber(rectHeight * 0.08, 90, 200))
  const horizontalRange = horizontalSide === 'left'
    ? { start: point.x - 4, end: point.x + horizontalArm }
    : { start: point.x - horizontalArm, end: point.x + 4 }
  const verticalRange = verticalSide === 'top'
    ? { start: point.y - 4, end: point.y + verticalArm }
    : { start: point.y - verticalArm, end: point.y + 4 }
  const horizontalSupport = darkRatioInHorizontalBand(image, point.y, horizontalRange.start, horizontalRange.end, 2)
  const verticalSupport = darkRatioInVerticalBand(image, point.x, verticalRange.start, verticalRange.end, 2)
  return horizontalSupport * 0.62 + verticalSupport * 0.38
}

export function bestHorizontalSideSpan(
  image: ImageData,
  line: ProjectedLineResult,
  anchorPosition: number,
  searchLeft: number,
  searchRight: number,
  expectedLeft: number,
  expectedRight: number,
  maxGap: number,
  referenceSpan?: { start: number; end: number } | null,
): ({ y: number } & NonNullable<ReturnType<typeof horizontalLineEndpoints>>) | null {
  const expectedWidth = Math.max(1, expectedRight - expectedLeft)
  let best: ({ y: number; score: number } & NonNullable<ReturnType<typeof horizontalLineEndpoints>>) | null = null
  for (let y = line.group.start; y <= line.group.end; y += 1) {
    const span = horizontalLineEndpoints(image, y, searchLeft, searchRight, expectedLeft, expectedRight, maxGap)
    if (!span) continue
    const width = span.end - span.start
    if (width < expectedWidth * 0.35) continue
    const widthRatio = clampNumber(width / expectedWidth, 0, 1.2)
    const endpointDistance = (Math.abs(span.start - expectedLeft) + Math.abs(span.end - expectedRight)) / expectedWidth
    const referenceDistance = referenceSpan
      ? (Math.abs(span.start - referenceSpan.start) + Math.abs(span.end - referenceSpan.end)) / expectedWidth
      : 0
    const anchorDistance = Math.abs(y - anchorPosition) / Math.max(1, line.group.end - line.group.start + 1)
    const outerBias = ((expectedLeft - span.start) + (span.end - expectedRight)) / expectedWidth
    const score = widthRatio * 1.35 + span.ratio * 0.25 + outerBias * 1.1 - endpointDistance * 0.55 - anchorDistance * 0.25 - referenceDistance * 1.2
    if (!best || score > best.score) best = { ...span, y, score }
  }
  return best
}
