import { type Annotation, type CutProject, type AnnotationStroke, type AnnotationText } from '@xsheet-remap/core'
import { clampTextFontSizePx } from './sheetTextLayout'
import { resolveAnnotationTextFontSizePx } from './annotationTextLayout'
import { clampNumber } from './sheetInteraction'
import { TextAnnotationUpdate } from './app-foundation'

export function updateTimelineEventFontSize(project: CutProject, eventId: string, fontSizePx: number): CutProject {
  let changed = false
  const events = project.logicalSheet.events.map(event => {
    if (event.eventId !== eventId) return event
    const nextFontSizePx = clampTextFontSizePx(fontSizePx)
    if (event.fontSizePx === nextFontSizePx) return event
    changed = true
    return { ...event, fontSizePx: nextFontSizePx }
  })
  return changed ? { ...project, logicalSheet: { ...project.logicalSheet, events } } : project
}

export function updateTextAnnotation(
  project: CutProject,
  annotationId: string,
  updates: TextAnnotationUpdate,
): CutProject {
  let changed = false
  const annotations = project.annotations.map(annotation => {
    if (annotation.kind !== 'text' || annotation.annotationId !== annotationId) return annotation
    const nextAnnotation = {
      ...annotation,
      ...updates,
      ...(updates.fontSizePx === undefined ? {} : { fontSizePx: clampTextFontSizePx(updates.fontSizePx) }),
      ...(updates.x === undefined ? {} : { x: clampNumber(updates.x, 0, 1) }),
      ...(updates.y === undefined ? {} : { y: clampNumber(updates.y, 0, 1) }),
    }
    if (
      nextAnnotation.text === annotation.text
      && nextAnnotation.fontSizePx === annotation.fontSizePx
      && nextAnnotation.x === annotation.x
      && nextAnnotation.y === annotation.y
      && nextAnnotation.color === annotation.color
      && nextAnnotation.coordinateSpace === annotation.coordinateSpace
      && annotationAnchorSignature(nextAnnotation.anchor) === annotationAnchorSignature(annotation.anchor)
    ) {
      return annotation
    }
    changed = true
    return nextAnnotation
  })
  return changed ? { ...project, annotations } : project
}

function annotationAnchorSignature(anchor: AnnotationText['anchor']): string {
  if (!anchor) return ''
  if (anchor.kind === 'view-surface') {
    return [
      anchor.kind,
      anchor.templateId ?? '',
      anchor.pageId,
      anchor.regionId ?? '',
      anchor.surfaceSize?.widthPx ?? '',
      anchor.surfaceSize?.heightPx ?? '',
    ].join(':')
  }
  return JSON.stringify(anchor)
}

export function deleteTextAnnotation(project: CutProject, annotationId: string): CutProject {
  const annotations = project.annotations.filter(annotation => annotation.annotationId !== annotationId)
  return annotations.length === project.annotations.length ? project : { ...project, annotations }
}

export function cloneTextAnnotationForPaste(
  annotation: AnnotationText,
  input: {
    annotationId: string
    pageId: string
    templateId: string
    surfaceSize: { widthPx: number; heightPx: number }
  },
): AnnotationText {
  return {
    ...annotation,
    annotationId: input.annotationId,
    pageId: input.pageId,
    fontSizePx: resolveAnnotationTextFontSizePx(annotation, input.surfaceSize),
    x: clampNumber(annotation.x + 0.012, 0, 0.98),
    y: clampNumber(annotation.y + 0.012, 0, 0.98),
    coordinateSpace: 'view-surface',
    anchor: {
      kind: 'view-surface',
      templateId: input.templateId,
      pageId: input.pageId,
      surfaceSize: input.surfaceSize,
    },
  }
}

export function strokePath(stroke: AnnotationStroke): string {
  const [first, ...rest] = stroke.points
  if (!first) return ''
  return [`M ${first.x} ${first.y}`, ...rest.map(point => `L ${point.x} ${point.y}`)].join(' ')
}

export function isAnnotationStroke(annotation: Annotation): annotation is AnnotationStroke {
  return annotation.kind !== 'text'
}

export function nextAnnotationId(annotations: Annotation[]): string {
  const used = new Set(annotations.map(annotation => annotation.annotationId))
  let index = annotations.length + 1
  let candidate = `anno_${String(index).padStart(4, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `anno_${String(index).padStart(4, '0')}`
  }
  return candidate
}
