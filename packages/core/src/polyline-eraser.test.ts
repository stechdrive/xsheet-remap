import { describe, expect, it } from 'vitest'
import { splitPolylineByEraser, type PolylinePoint } from './polyline-eraser'

describe('splitPolylineByEraser bounds fast path', () => {
  it('returns the untouched sentinel for a distant eraser path', () => {
    expect(splitPolylineByEraser(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 100, y: 100 }, { x: 101, y: 101 }],
      2,
    )).toBeNull()
  })

  it('matches the unoptimized geometry across deterministic randomized inputs', () => {
    let state = 0x5eed1234
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
    for (let caseIndex = 0; caseIndex < 250; caseIndex += 1) {
      const points = Array.from({ length: 1 + Math.floor(random() * 12) }, () => ({
        x: random() * 20 - 10,
        y: random() * 20 - 10,
      }))
      const eraserPoints = Array.from({ length: Math.floor(random() * 8) }, () => ({
        x: random() * 30 - 15,
        y: random() * 30 - 15,
      }))
      const threshold = random() * 3
      expect(splitPolylineByEraser(points, eraserPoints, threshold)).toEqual(
        splitPolylineByEraserReference(points, eraserPoints, threshold),
      )
    }
  })
})

function splitPolylineByEraserReference<T extends PolylinePoint>(
  points: readonly T[],
  eraserPoints: readonly PolylinePoint[],
  threshold: number,
): T[][] | null {
  if (points.length === 0) return []
  const thresholdSq = Math.max(0, threshold) ** 2
  if (points.length === 1) {
    return isPointNearEraser(points[0]!, eraserPoints, thresholdSq) ? [] : null
  }
  const pointErased = points.map(point => isPointNearEraser(point, eraserPoints, thresholdSq))
  const parts: T[][] = []
  let current: T[] = []
  let anyErased = pointErased.some(Boolean)
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const segmentErased = pointErased[index]
      || pointErased[index + 1]
      || isSegmentNearEraser(a, b, eraserPoints, thresholdSq)
    if (segmentErased) {
      anyErased = true
      if (current.length >= 2) parts.push(current)
      current = []
      continue
    }
    if (current.length === 0) current.push(a)
    current.push(b)
  }
  if (current.length >= 2) parts.push(current)
  return anyErased ? parts : null
}

function isPointNearEraser(point: PolylinePoint, eraserPoints: readonly PolylinePoint[], thresholdSq: number): boolean {
  if (eraserPoints.length === 0) return false
  if (eraserPoints.length === 1) return pointToSegmentDistanceSq(point, eraserPoints[0]!, eraserPoints[0]!) <= thresholdSq
  for (let index = 0; index < eraserPoints.length - 1; index += 1) {
    if (pointToSegmentDistanceSq(point, eraserPoints[index]!, eraserPoints[index + 1]!) <= thresholdSq) return true
  }
  return false
}

function isSegmentNearEraser(a: PolylinePoint, b: PolylinePoint, eraserPoints: readonly PolylinePoint[], thresholdSq: number): boolean {
  if (eraserPoints.length === 0) return false
  if (eraserPoints.length === 1) return pointToSegmentDistanceSq(eraserPoints[0]!, a, b) <= thresholdSq
  for (let index = 0; index < eraserPoints.length - 1; index += 1) {
    if (segmentDistanceSq(a, b, eraserPoints[index]!, eraserPoints[index + 1]!) <= thresholdSq) return true
  }
  return false
}

function pointToSegmentDistanceSq(point: PolylinePoint, a: PolylinePoint, b: PolylinePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  return (point.x - (a.x + t * dx)) ** 2 + (point.y - (a.y + t * dy)) ** 2
}

function segmentDistanceSq(a: PolylinePoint, b: PolylinePoint, c: PolylinePoint, d: PolylinePoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistanceSq(a, c, d),
    pointToSegmentDistanceSq(b, c, d),
    pointToSegmentDistanceSq(c, a, b),
    pointToSegmentDistanceSq(d, a, b),
  )
}

function segmentsIntersect(a: PolylinePoint, b: PolylinePoint, c: PolylinePoint, d: PolylinePoint): boolean {
  const orientation = (p: PolylinePoint, q: PolylinePoint, r: PolylinePoint) => {
    const value = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
    return Math.abs(value) < 1e-12 ? 0 : value
  }
  const onSegment = (p: PolylinePoint, q: PolylinePoint, r: PolylinePoint) =>
    q.x >= Math.min(p.x, r.x) - 1e-12
    && q.x <= Math.max(p.x, r.x) + 1e-12
    && q.y >= Math.min(p.y, r.y) - 1e-12
    && q.y <= Math.max(p.y, r.y) + 1e-12
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (abC === 0 && onSegment(a, c, b)) return true
  if (abD === 0 && onSegment(a, d, b)) return true
  if (cdA === 0 && onSegment(c, a, d)) return true
  if (cdB === 0 && onSegment(c, b, d)) return true
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)
}
