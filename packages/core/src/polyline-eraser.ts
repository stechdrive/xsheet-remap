export interface PolylinePoint {
  x: number
  y: number
}

export function splitPolylineByEraser<T extends PolylinePoint>(
  points: readonly T[],
  eraserPoints: readonly PolylinePoint[],
  threshold: number,
): T[][] | null {
  if (points.length === 0) return []
  const thresholdSq = Math.max(0, threshold) ** 2
  if (points.length === 1) {
    return isPointNearEraser(points[0], eraserPoints, thresholdSq) ? [] : null
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
  if (eraserPoints.length === 1) return distanceSq(point, eraserPoints[0]!) <= thresholdSq
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

function distanceSq(a: PolylinePoint, b: PolylinePoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function pointToSegmentDistanceSq(point: PolylinePoint, a: PolylinePoint, b: PolylinePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distanceSq(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  return distanceSq(point, { x: a.x + t * dx, y: a.y + t * dy })
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

function orientation(a: PolylinePoint, b: PolylinePoint, c: PolylinePoint): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(value) < 1e-12 ? 0 : value
}

function onSegment(a: PolylinePoint, b: PolylinePoint, c: PolylinePoint): boolean {
  return b.x >= Math.min(a.x, c.x) - 1e-12
    && b.x <= Math.max(a.x, c.x) + 1e-12
    && b.y >= Math.min(a.y, c.y) - 1e-12
    && b.y <= Math.max(a.y, c.y) + 1e-12
}
