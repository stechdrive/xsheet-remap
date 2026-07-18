import type { Annotation, AnnotationPoint, AnnotationStroke, AnnotationText, CutProject, SheetPageMemoTarget } from './types'
import { splitPolylineByEraser } from './polyline-eraser'
import { isSheetPageMemo, pageMemoTargetForAnnotation, pageMemoTargetKey, sheetAnnotations } from './sheet-memo'

export function addAnnotation(project: CutProject, annotation: Annotation): CutProject {
  const target = pageMemoTargetForAnnotation(annotation)
  const targetKey = pageMemoTargetKey(target)
  let added = false
  const memos = project.memos.map(memo => {
    if (!isSheetPageMemo(memo) || pageMemoTargetKey(memo.target) !== targetKey) return memo
    added = true
    return annotation.kind === 'text'
      ? { ...memo, texts: [...memo.texts, annotation] }
      : { ...memo, strokes: [...memo.strokes, annotation] }
  })
  if (added) return { ...project, memos }
  const order = project.memos.reduce((maximum, memo) => Math.max(maximum, memo.order), 0) + 1
  return {
    ...project,
    memos: [...memos, {
      kind: 'page',
      memoId: nextPageMemoId(project, annotation.pageId),
      target,
      strokes: annotation.kind === 'text' ? [] : [annotation],
      texts: annotation.kind === 'text' ? [annotation] : [],
      order,
    }],
  }
}

export function clearAnnotations(project: CutProject): CutProject {
  const memos = project.memos.filter(memo => !isSheetPageMemo(memo))
  return memos.length === project.memos.length ? project : { ...project, memos }
}

export function clearAnnotationsForPage(project: CutProject, pageId: string): CutProject {
  const memos = project.memos.filter(memo => !isSheetPageMemo(memo) || memo.target.pageId !== pageId)
  return memos.length === project.memos.length ? project : { ...project, memos }
}

export function eraseAnnotations(project: CutProject, input: { pageId: string; points: AnnotationPoint[]; width: number; target?: SheetPageMemoTarget }): CutProject {
  if (input.points.length === 0 || input.width <= 0) return project
  const existingIds = new Set(sheetAnnotations(project).map(stroke => stroke.annotationId))
  let changed = false
  const memos = project.memos.map(memo => {
    if (!isSheetPageMemo(memo) || memo.target.pageId !== input.pageId
      || (input.target && pageMemoTargetKey(memo.target) !== pageMemoTargetKey(input.target))) return memo
    const strokes = memo.strokes.flatMap(stroke => {
      if (stroke.tool !== 'pen') return [stroke]
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
    return strokes === memo.strokes ? memo : { ...memo, strokes }
  })
  return changed ? { ...project, memos } : project
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

function nextPageMemoId(project: CutProject, pageId: string): string {
  const used = new Set(project.memos.map(memo => memo.memoId))
  const safePage = pageId.replace(/[^a-zA-Z0-9_-]/g, '_')
  let index = 1
  while (used.has(`memo_${safePage}_${index}`)) index += 1
  return `memo_${safePage}_${index}`
}
