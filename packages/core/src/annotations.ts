import type { Annotation, AnnotationPoint, AnnotationStroke, AnnotationText, CutProject } from './types'
import { splitPolylineByEraser } from './polyline-eraser'

export function addAnnotation(project: CutProject, annotation: Annotation): CutProject {
  return { ...project, annotations: [...project.annotations, annotation] }
}

export function clearAnnotations(project: CutProject): CutProject {
  return project.annotations.length ? { ...project, annotations: [] } : project
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
  const threshold = Math.max(0, eraserWidth / 2 + stroke.width / 2)
  return splitPolylineByEraser(stroke.points, eraserPoints, threshold)
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
