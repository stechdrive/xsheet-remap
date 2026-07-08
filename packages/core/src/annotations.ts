import type { Annotation, AnnotationPoint, AnnotationStroke, AnnotationText, CutProject } from './types'

export function addAnnotation(project: CutProject, annotation: Annotation): CutProject {
  return { ...project, annotations: [...project.annotations, annotation] }
}

export function clearAnnotations(project: CutProject): CutProject {
  return { ...project, annotations: [] }
}

export function clearAnnotationsForPage(project: CutProject, pageId: string): CutProject {
  const annotations = project.annotations.filter(stroke => stroke.pageId !== pageId)
  return annotations.length === project.annotations.length ? project : { ...project, annotations }
}

export function eraseAnnotations(project: CutProject, input: { pageId: string; points: AnnotationPoint[]; width: number }): CutProject {
  if (input.points.length === 0 || input.width <= 0) return project
  const existingIds = new Set(project.annotations.map(stroke => stroke.annotationId))
  let changed = false
  const annotations = project.annotations.flatMap(stroke => {
    if (!isAnnotationStroke(stroke) || stroke.pageId !== input.pageId || stroke.tool !== 'pen') return [stroke]
    const parts = splitAnnotationStroke(stroke, input.points, input.width)
    if (parts === null) return [stroke]
    changed = true
    if (parts.length === 0) return []
    return parts.map((part, index) => ({
      ...stroke,
      annotationId: index === 0 ? stroke.annotationId : nextAnnotationPartId(existingIds, stroke.annotationId, index),
      points: part,
    }))
  })
  return changed ? { ...project, annotations } : project
}

export function migrateAnnotation(annotation: Annotation, templateId: string): Annotation {
  if (isAnnotationText(annotation)) return migrateAnnotationText(annotation, templateId)
  return migrateAnnotationStroke(annotation, templateId)
}

export function migrateAnnotationStroke(stroke: AnnotationStroke, templateId: string): AnnotationStroke {
  const coordinateSpace = stroke.coordinateSpace ?? 'view-surface'
  const anchor = stroke.anchor?.kind === 'view-surface'
    ? {
        ...stroke.anchor,
        templateId: stroke.anchor.templateId ?? templateId,
        pageId: stroke.anchor.pageId ?? stroke.pageId,
      }
    : stroke.anchor ?? {
        kind: 'view-surface' as const,
        templateId,
        pageId: stroke.pageId,
  }
  return {
    ...stroke,
    kind: stroke.kind ?? 'stroke',
    coordinateSpace,
    anchor,
  }
}

function migrateAnnotationText(annotation: AnnotationText, templateId: string): AnnotationText {
  const coordinateSpace = annotation.coordinateSpace ?? 'view-surface'
  const anchor = annotation.anchor?.kind === 'view-surface'
    ? {
        ...annotation.anchor,
        templateId: annotation.anchor.templateId ?? templateId,
        pageId: annotation.anchor.pageId ?? annotation.pageId,
      }
    : annotation.anchor ?? {
        kind: 'view-surface' as const,
        templateId,
        pageId: annotation.pageId,
      }
  return {
    ...annotation,
    kind: 'text',
    text: annotation.text ?? '',
    fontSizePx: Number.isFinite(annotation.fontSizePx) ? annotation.fontSizePx : 16,
    coordinateSpace,
    anchor,
  }
}

function isAnnotationStroke(annotation: Annotation): annotation is AnnotationStroke {
  return annotation.kind !== 'text'
}

function isAnnotationText(annotation: Annotation): annotation is AnnotationText {
  return annotation.kind === 'text'
}

function splitAnnotationStroke(stroke: AnnotationStroke, eraserPoints: AnnotationPoint[], eraserWidth: number): AnnotationPoint[][] | null {
  if (stroke.points.length === 0) return []
  const threshold = Math.max(0, eraserWidth / 2 + stroke.width / 2)
  const thresholdSq = threshold * threshold
  if (stroke.points.length === 1) {
    return isPointNearEraser(stroke.points[0], eraserPoints, thresholdSq) ? [] : null
  }

  const pointErased = stroke.points.map(point => isPointNearEraser(point, eraserPoints, thresholdSq))
  const parts: AnnotationPoint[][] = []
  let current: AnnotationPoint[] = []
  let anyErased = pointErased.some(Boolean)

  for (let index = 0; index < stroke.points.length - 1; index += 1) {
    const a = stroke.points[index]
    const b = stroke.points[index + 1]
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

function isPointNearEraser(point: AnnotationPoint, eraserPoints: AnnotationPoint[], thresholdSq: number): boolean {
  if (eraserPoints.length === 1) return distanceSq(point, eraserPoints[0]) <= thresholdSq
  for (let index = 0; index < eraserPoints.length - 1; index += 1) {
    if (pointToSegmentDistanceSq(point, eraserPoints[index], eraserPoints[index + 1]) <= thresholdSq) return true
  }
  return false
}

function isSegmentNearEraser(a: AnnotationPoint, b: AnnotationPoint, eraserPoints: AnnotationPoint[], thresholdSq: number): boolean {
  if (eraserPoints.length === 1) return pointToSegmentDistanceSq(eraserPoints[0], a, b) <= thresholdSq
  for (let index = 0; index < eraserPoints.length - 1; index += 1) {
    if (segmentDistanceSq(a, b, eraserPoints[index], eraserPoints[index + 1]) <= thresholdSq) return true
  }
  return false
}

function nextAnnotationPartId(existingIds: Set<string>, baseId: string, partIndex: number): string {
  let serial = partIndex
  let candidate = `${baseId}_part_${serial}`
  while (existingIds.has(candidate)) {
    serial += 1
    candidate = `${baseId}_part_${serial}`
  }
  existingIds.add(candidate)
  return candidate
}

function distanceSq(a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function pointToSegmentDistanceSq(point: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distanceSq(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  return distanceSq(point, { x: a.x + t * dx, y: a.y + t * dy })
}

function segmentDistanceSq(a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint, d: AnnotationPoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistanceSq(a, c, d),
    pointToSegmentDistanceSq(b, c, d),
    pointToSegmentDistanceSq(c, a, b),
    pointToSegmentDistanceSq(d, a, b),
  )
}

function segmentsIntersect(a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint, d: AnnotationPoint): boolean {
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

function orientation(a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(value) < 1e-12 ? 0 : value
}

function onSegment(a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint): boolean {
  return b.x >= Math.min(a.x, c.x) - 1e-12
    && b.x <= Math.max(a.x, c.x) + 1e-12
    && b.y >= Math.min(a.y, c.y) - 1e-12
    && b.y <= Math.max(a.y, c.y) + 1e-12
}
