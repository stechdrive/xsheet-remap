import { type SheetTemplate } from '@xsheet-remap/core'
import { calibrationTargetRectForTemplate } from './sheetImages'
import { clampNumber } from './sheetInteraction'
import { darkRatioInHorizontalBand, darkRatioInVerticalBand, localSupportGroups, projectedLinePositionForExpected } from './sheet-auto-calibration-projection'
import { averageNumber, boundaryOutsidePenalty, buildDarkDistanceMap, localCornerConfigs, matchLocalTemplateCorner, pixelRectFromCorners, pixelRectToCorners, scoreTemplateGridDistanceFitRect, segmentedHorizontalSupport, segmentedVerticalSupport, stabilizeLocalCornerMatches } from './sheet-auto-calibration-corners'
import type { AutoCalibrationLocalCornerDebug, DarkDistanceMap, GridFitGuide, GridFitGuides, PixelPoint, PixelRect } from './sheet-auto-calibration-types'

type TemplateGridFitCandidate = {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  score: number
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
}

export function fitTemplateGridCalibration(
  image: ImageData,
  rect: { left: number; top: number; right: number; bottom: number },
  template: SheetTemplate,
  seedCorners: PixelPoint[],
): {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  confidence: number
  localCornerMatches?: AutoCalibrationLocalCornerDebug[]
} | null {
  if (seedCorners.length !== 4) return null
  const targetRect = calibrationTargetRectForTemplate(template)
  if (!targetRect) return null
  const guides = templateGridFitGuides(template, targetRect)
  if (guides.vertical.length < 4 || guides.horizontal.length < 4) return null
  const distanceMap = buildDarkDistanceMap(image)

  const [seedTopLeft, seedTopRight, seedBottomRight, seedBottomLeft] = seedCorners
  const seedTop = (seedTopLeft.y + seedTopRight.y) / 2
  const seedBottom = (seedBottomLeft.y + seedBottomRight.y) / 2
  const seedLeft = (seedTopLeft.x + seedBottomLeft.x) / 2
  const seedRight = (seedTopRight.x + seedBottomRight.x) / 2
  const seedBounds = {
    left: seedLeft,
    top: seedTop,
    right: seedRight,
    bottom: seedBottom,
  }
  const expectedWidth = Math.max(1, rect.right - rect.left)
  const expectedHeight = Math.max(1, rect.bottom - rect.top)
  const seedBoundaryReliability = scoreGridFitSeedBoundaryReliability(seedCorners, expectedWidth, expectedHeight)
  const approximateLeft = Math.min(seedLeft, seedRight)
  const approximateRight = Math.max(seedLeft, seedRight)
  const approximateTop = Math.min(seedTop, seedBottom)
  const approximateBottom = Math.max(seedTop, seedBottom)

  const horizontalWindow = clampNumber(expectedHeight * 0.055, 48, 132)
  const verticalWindow = clampNumber(expectedWidth * 0.05, 44, 128)
  const topCandidates = candidateLinePositions(
    image,
    rect.top,
    seedTop,
    horizontalWindow,
    position => darkRatioInHorizontalBand(image, position, approximateLeft, approximateRight, 1),
    image.height - 1,
    5,
    'min',
  )
  const bottomCandidates = candidateLinePositions(
    image,
    rect.bottom,
    seedBottom,
    horizontalWindow,
    position => darkRatioInHorizontalBand(image, position, approximateLeft, approximateRight, 1),
    image.height - 1,
    5,
    'max',
  )
  const leftCandidates = candidateLinePositions(
    image,
    rect.left,
    seedLeft,
    verticalWindow,
    position => darkRatioInVerticalBand(image, position, approximateTop, approximateBottom, 1),
    image.width - 1,
    7,
    'min',
  )
  const rightCandidates = candidateLinePositions(
    image,
    rect.right,
    seedRight,
    verticalWindow,
    position => darkRatioInVerticalBand(image, position, approximateTop, approximateBottom, 1),
    image.width - 1,
    7,
    'max',
  )

  let best: TemplateGridFitCandidate | null = null
  for (const top of topCandidates) {
    for (const bottom of bottomCandidates) {
      const height = bottom - top
      if (height < expectedHeight * 0.82 || height > expectedHeight * 1.16) continue
      for (const left of leftCandidates) {
        for (const right of rightCandidates) {
          const width = right - left
          if (width < expectedWidth * 0.82 || width > expectedWidth * 1.16) continue
          const candidate = { left, top, right, bottom }
          const score = scoreTemplateGridFitRect(image, distanceMap, rect, guides, candidate) -
            gridFitSeedBoundaryPenalty(candidate, seedBounds, expectedWidth, expectedHeight, seedBoundaryReliability)
          if (!best || score > best.score) {
            best = {
              score,
              corners: [
                { x: left, y: top },
                { x: right, y: top },
                { x: right, y: bottom },
                { x: left, y: bottom },
              ],
            }
          }
        }
      }
    }
  }
  if (!best || best.score < 0.34) return null
  best = refineTemplateGridFitRect(
    image,
    distanceMap,
    rect,
    guides,
    best,
    expectedWidth,
    expectedHeight,
    seedBounds,
    seedBoundaryReliability,
  )
  best = refineTemplateGridFitCorners(distanceMap, guides, best, expectedWidth, expectedHeight)
  return {
    corners: best.corners,
    confidence: clampNumber(best.score, 0.05, 0.98),
    localCornerMatches: best.localCornerMatches,
  }
}

function scoreGridFitSeedBoundaryReliability(seedCorners: PixelPoint[], expectedWidth: number, expectedHeight: number): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = seedCorners
  const topWidth = Math.max(0, topRight.x - topLeft.x)
  const bottomWidth = Math.max(0, bottomRight.x - bottomLeft.x)
  const leftHeight = Math.max(0, bottomLeft.y - topLeft.y)
  const rightHeight = Math.max(0, bottomRight.y - topRight.y)
  const averageWidth = (topWidth + bottomWidth) / 2
  const averageHeight = (leftHeight + rightHeight) / 2
  const widthAgreement = 1 - Math.abs(topWidth - bottomWidth) / Math.max(1, expectedWidth * 0.055)
  const heightAgreement = 1 - Math.abs(leftHeight - rightHeight) / Math.max(1, expectedHeight * 0.055)
  const widthScale = 1 - Math.abs(averageWidth - expectedWidth) / Math.max(1, expectedWidth * 0.09)
  const heightScale = 1 - Math.abs(averageHeight - expectedHeight) / Math.max(1, expectedHeight * 0.09)
  return clampNumber(Math.min(widthAgreement, heightAgreement, widthScale, heightScale), 0, 1)
}

function gridFitSeedBoundaryPenalty(
  candidate: PixelRect,
  seed: PixelRect,
  expectedWidth: number,
  expectedHeight: number,
  reliability: number,
): number {
  if (reliability <= 0) return 0
  const xWindow = clampNumber(expectedWidth * 0.018, 18, 42)
  const yWindow = clampNumber(expectedHeight * 0.018, 20, 48)
  const horizontal = (
    seedEdgePenalty(candidate.left, seed.left, xWindow) +
    seedEdgePenalty(candidate.right, seed.right, xWindow)
  ) / 2
  const vertical = (
    seedEdgePenalty(candidate.top, seed.top, yWindow) +
    seedEdgePenalty(candidate.bottom, seed.bottom, yWindow)
  ) / 2
  return reliability * (horizontal * 0.34 + vertical * 0.28)
}

function seedEdgePenalty(candidate: number, seed: number, window: number): number {
  const normalizedDistance = Math.abs(candidate - seed) / Math.max(1, window)
  return Math.max(0, normalizedDistance - 0.22)
}

function templateGridFitGuides(template: SheetTemplate, targetRect: { x: number; y: number; w: number; h: number }): GridFitGuides {
  const vertical: GridFitGuide[] = [
    { ratio: 0, weight: 1.8 },
    { ratio: 1, weight: 1.8 },
  ]
  const horizontal: GridFitGuide[] = [
    { ratio: 0, weight: 1.8 },
    { ratio: 1, weight: 1.8 },
  ]
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    if (!['action', 'sound', 'cell', 'camera'].includes(region.grid.role)) continue
    addGuide(vertical, (region.rect.x - targetRect.x) / targetRect.w, 1.2)
    addGuide(vertical, (region.rect.x + region.rect.w - targetRect.x) / targetRect.w, 1.2)
    const columnCount = Math.max(1, region.grid.columns.length)
    for (let index = 1; index < columnCount; index += 1) {
      addGuide(vertical, (region.rect.x + region.rect.w * (index / columnCount) - targetRect.x) / targetRect.w, 0.7)
    }

    addGuide(horizontal, (region.rect.y - targetRect.y) / targetRect.h, 1.25)
    addGuide(horizontal, (region.rect.y + region.rect.h - targetRect.y) / targetRect.h, 1.15)
    const rowCount = Math.max(1, region.grid.rowCount)
    const minorStep = Math.max(1, Math.floor(rowCount / 18))
    for (let row = minorStep; row < rowCount; row += minorStep) {
      const weight = region.grid.majorLineEvery && row % region.grid.majorLineEvery === 0 ? 0.85 : 0.42
      addGuide(horizontal, (region.rect.y + region.rect.h * (row / rowCount) - targetRect.y) / targetRect.h, weight)
    }
  }
  return {
    vertical: dedupeGuides(vertical).sort((a, b) => a.ratio - b.ratio),
    horizontal: dedupeGuides(horizontal).sort((a, b) => a.ratio - b.ratio),
  }
}

function addGuide(guides: GridFitGuide[], ratio: number, weight: number) {
  if (!Number.isFinite(ratio) || ratio < -0.01 || ratio > 1.01) return
  guides.push({ ratio: clampNumber(ratio, 0, 1), weight })
}

function dedupeGuides(guides: GridFitGuide[]): GridFitGuide[] {
  const sorted = [...guides].sort((a, b) => a.ratio - b.ratio)
  const result: GridFitGuide[] = []
  for (const guide of sorted) {
    const previous = result[result.length - 1]
    if (previous && Math.abs(previous.ratio - guide.ratio) < 0.0016) {
      previous.weight = Math.max(previous.weight, guide.weight)
    } else {
      result.push({ ...guide })
    }
  }
  return result
}

type CandidateEdgePreference = 'min' | 'max'

function candidateLinePositions(
  image: ImageData,
  expected: number,
  seed: number,
  window: number,
  supportAt: (position: number) => number,
  maxPosition: number,
  limit: number,
  edgePreference: CandidateEdgePreference,
): number[] {
  const start = Math.round(Math.max(0, Math.min(expected, seed) - window))
  const end = Math.round(Math.min(maxPosition, Math.max(expected, seed) + window))
  const groups = localSupportGroups(start, end, supportAt, 0.018)
  const scored = new Map<number, number>()
  const addPosition = (position: number, bonus = 0) => {
    const rounded = Math.round(position)
    const support = supportAt(rounded)
    const distance = Math.abs(rounded - expected) / Math.max(1, window)
    const seedDistance = Math.abs(rounded - seed) / Math.max(1, window)
    const score = support * 2.2 - distance * 0.28 - seedDistance * 0.1 + bonus
    const previous = scored.get(rounded)
    if (previous === undefined || score > previous) scored.set(rounded, score)
  }
  addPosition(expected, 0.18)
  addPosition(seed, 0.12)
  for (const group of groups) {
    addPosition(group.bestPosition, group.bestRatio)
    const edgePosition = edgePreference === 'min' ? group.start : group.end
    if (Math.abs(edgePosition - group.bestPosition) >= 10) {
      addPosition(edgePosition, group.bestRatio * 0.45)
    }
    addPosition(projectedLinePositionForExpected(group, expected), group.bestRatio * 0.8)
    addPosition((group.start + group.end) / 2, group.bestRatio * 0.55)
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([position]) => position)
    .sort((a, b) => a - b)
}

function scoreTemplateGridFitRect(
  image: ImageData,
  distanceMap: DarkDistanceMap,
  expectedRect: { left: number; top: number; right: number; bottom: number },
  guides: GridFitGuides,
  candidate: { left: number; top: number; right: number; bottom: number },
): number {
  const width = Math.max(1, candidate.right - candidate.left)
  const height = Math.max(1, candidate.bottom - candidate.top)
  let weightedScore = 0
  let totalWeight = 0
  for (const guide of guides.vertical) {
    const x = candidate.left + width * guide.ratio
    const support = segmentedVerticalSupport(image, x, candidate.top, candidate.bottom, 1)
    weightedScore += support * guide.weight
    totalWeight += guide.weight
  }
  for (const guide of guides.horizontal) {
    const y = candidate.top + height * guide.ratio
    const support = segmentedHorizontalSupport(image, y, candidate.left, candidate.right, 1)
    weightedScore += support * guide.weight
    totalWeight += guide.weight
  }
  const supportScore = weightedScore / Math.max(1, totalWeight)
  const distanceScore = scoreTemplateGridDistanceFitRect(distanceMap, guides, candidate)
  const gridScore = supportScore * 0.86 + distanceScore * 0.14
  const expectedWidth = Math.max(1, expectedRect.right - expectedRect.left)
  const expectedHeight = Math.max(1, expectedRect.bottom - expectedRect.top)
  const xWindow = clampNumber(expectedWidth * 0.05, 44, 128)
  const yWindow = clampNumber(expectedHeight * 0.055, 48, 132)
  const localDistancePenalty = (
    Math.abs(candidate.left - expectedRect.left) / xWindow +
    Math.abs(candidate.right - expectedRect.right) / xWindow +
    Math.abs(candidate.top - expectedRect.top) / yWindow +
    Math.abs(candidate.bottom - expectedRect.bottom) / yWindow
  ) * 0.08
  const globalDistancePenalty = (
    Math.abs(candidate.left - expectedRect.left) / expectedWidth +
    Math.abs(candidate.right - expectedRect.right) / expectedWidth +
    Math.abs(candidate.top - expectedRect.top) / expectedHeight +
    Math.abs(candidate.bottom - expectedRect.bottom) / expectedHeight
  ) * 0.1
  const outsidePenalty = boundaryOutsidePenalty(image, candidate)
  return gridScore - localDistancePenalty - globalDistancePenalty - outsidePenalty
}

function refineTemplateGridFitRect(
  image: ImageData,
  distanceMap: DarkDistanceMap,
  expectedRect: { left: number; top: number; right: number; bottom: number },
  guides: GridFitGuides,
  initial: { corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]; score: number },
  expectedWidth: number,
  expectedHeight: number,
  seedBounds: PixelRect,
  seedBoundaryReliability: number,
): TemplateGridFitCandidate {
  let rect = pixelRectFromCorners(initial.corners)
  let score = initial.score
  const scoreRect = (candidate: PixelRect) => scoreTemplateGridFitRect(image, distanceMap, expectedRect, guides, candidate) -
    gridFitSeedBoundaryPenalty(candidate, seedBounds, expectedWidth, expectedHeight, seedBoundaryReliability)
  const minWidth = expectedWidth * 0.82
  const maxWidth = expectedWidth * 1.16
  const minHeight = expectedHeight * 0.82
  const maxHeight = expectedHeight * 1.16
  const isPlausible = (candidate: PixelRect) => {
    const width = candidate.right - candidate.left
    const height = candidate.bottom - candidate.top
    return width >= minWidth && width <= maxWidth && height >= minHeight && height <= maxHeight
  }

  for (const step of [4, 2, 1]) {
    let improved = true
    let guard = 0
    while (improved && guard < 24) {
      improved = false
      guard += 1
      const variants: PixelRect[] = [
        { ...rect, left: rect.left - step },
        { ...rect, left: rect.left + step },
        { ...rect, right: rect.right - step },
        { ...rect, right: rect.right + step },
        { ...rect, top: rect.top - step },
        { ...rect, top: rect.top + step },
        { ...rect, bottom: rect.bottom - step },
        { ...rect, bottom: rect.bottom + step },
      ]
      for (const candidate of variants) {
        if (!isPlausible(candidate)) continue
        const candidateScore = scoreRect(candidate)
        if (candidateScore > score + 0.006) {
          rect = candidate
          score = candidateScore
          improved = true
        }
      }
    }
  }

  return {
    corners: pixelRectToCorners(rect),
    score,
  }
}

function refineTemplateGridFitCorners(
  distanceMap: DarkDistanceMap,
  guides: GridFitGuides,
  initial: { corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]; score: number },
  expectedWidth: number,
  expectedHeight: number,
): {
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  score: number
  localCornerMatches: AutoCalibrationLocalCornerDebug[]
} {
  const corners = [...initial.corners] as [PixelPoint, PixelPoint, PixelPoint, PixelPoint]
  const matches = localCornerConfigs.map(config => matchLocalTemplateCorner(
    distanceMap,
    guides,
    corners[config.index],
    config,
    expectedWidth,
    expectedHeight,
  ))
  const accepted = stabilizeLocalCornerMatches(matches)
  for (const match of accepted) {
    const config = localCornerConfigs.find(item => item.id === match.id)
    if (config) corners[config.index] = match.point
  }
  const averageGain = averageNumber(accepted.map(match => Math.max(0, match.rawScore - match.baseRawScore)))
  return {
    corners,
    score: clampNumber(initial.score + averageGain * 0.08, 0.05, 0.98),
    localCornerMatches: matches.map(match => ({
      corner: match.id,
      dx: match.dx,
      dy: match.dy,
      angleDeg: match.angleDeg,
      rawGain: match.rawScore - match.baseRawScore,
      accepted: accepted.some(acceptedMatch => acceptedMatch.id === match.id),
    })),
  }
}
