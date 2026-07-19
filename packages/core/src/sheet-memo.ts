import type {
  Annotation,
  AnnotationStroke,
  AnnotationText,
  CutProject,
  SheetMemo,
  SheetMemoAnchorPresentation,
  SheetPageMemo,
  SheetPageMemoTarget,
  TimelineInkMemo,
} from './types'
import { normalizeMemoAppearance } from './memo-appearance'

export function isSheetPageMemo(memo: SheetMemo): memo is SheetPageMemo {
  return memo.kind === 'page'
}

export function isTimelineMemo(memo: SheetMemo): memo is TimelineInkMemo {
  return memo.kind === 'timeline'
}

export function sheetPageMemos(project: Pick<CutProject, 'memos'>): SheetPageMemo[] {
  return project.memos.filter(isSheetPageMemo)
}

export function timelineMemos(project: Pick<CutProject, 'memos'>): TimelineInkMemo[] {
  return project.memos.filter(isTimelineMemo)
}

export function replaceTimelineMemos(project: CutProject, nextTimelineMemos: readonly TimelineInkMemo[]): CutProject {
  const replacements = new Map(nextTimelineMemos.map(memo => [memo.memoId, memo]))
  const memos: SheetMemo[] = []
  for (const memo of project.memos) {
    if (isSheetPageMemo(memo)) {
      memos.push(memo)
      continue
    }
    const replacement = replacements.get(memo.memoId)
    replacements.delete(memo.memoId)
    if (replacement) memos.push(replacement)
  }
  return {
    ...project,
    memos: [...memos, ...replacements.values()],
  }
}

export function sheetAnnotations(project: Pick<CutProject, 'memos'>): Annotation[] {
  return sheetPageMemos(project).flatMap(memo => [...memo.strokes, ...memo.texts])
}

export function sheetAnnotationStrokes(project: Pick<CutProject, 'memos'>): AnnotationStroke[] {
  return sheetPageMemos(project).flatMap(memo => memo.strokes)
}

export function sheetAnnotationTexts(project: Pick<CutProject, 'memos'>): AnnotationText[] {
  return sheetPageMemos(project).flatMap(memo => memo.texts)
}

export function memoAnchorPresentation(memo: SheetMemo): SheetMemoAnchorPresentation {
  if (memo.kind === 'page') return 'none'
  if (memo.anchor.role === 'camera') return 'camera-connector'
  return 'marker'
}

export function createPageMemosFromAnnotations(annotations: readonly Annotation[]): SheetPageMemo[] {
  const groups = new Map<string, { target: SheetPageMemoTarget; strokes: AnnotationStroke[]; texts: AnnotationText[] }>()
  for (const annotation of annotations) {
    const target = pageMemoTargetForAnnotation(annotation)
    const key = pageMemoTargetKey(target)
    const group = groups.get(key) ?? { target, strokes: [], texts: [] }
    if (annotation.kind === 'text') group.texts.push(annotation)
    else group.strokes.push(annotation)
    groups.set(key, group)
  }
  return [...groups.values()].map((group, index) => ({
    kind: 'page',
    memoId: pageMemoId(group.target, index + 1),
    target: group.target,
    strokes: group.strokes,
    texts: group.texts,
    order: index + 1,
  }))
}

export function normalizeSheetMemos(input: unknown): SheetMemo[] {
  if (!Array.isArray(input)) return []
  const result: SheetMemo[] = []
  input.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const memo = item as Partial<SheetMemo> & Record<string, unknown>
    if (memo.kind === 'page' && memo.target && typeof memo.target === 'object') {
      const target = memo.target as SheetPageMemoTarget
      if (typeof target.pageId !== 'string') return []
      result.push({
        kind: 'page',
        memoId: typeof memo.memoId === 'string' ? memo.memoId : `page_memo_${index + 1}`,
        target,
        strokes: Array.isArray(memo.strokes) ? memo.strokes as AnnotationStroke[] : [],
        texts: Array.isArray(memo.texts) ? memo.texts as AnnotationText[] : [],
        appearance: memo.appearance ? normalizeMemoAppearance(memo.appearance) : undefined,
        order: typeof memo.order === 'number' ? memo.order : index + 1,
      })
      return
    }
    if (memo.kind === 'timeline' && memo.anchor && memo.placement) {
      const rawTexts = Array.isArray(memo.texts) ? memo.texts as Array<NonNullable<TimelineInkMemo['texts']>[number] & { color?: string; fontSizeUnits?: number }> : []
      const legacyText = rawTexts[0]
      const appearance = memo.appearance
        ? normalizeMemoAppearance(memo.appearance)
        : legacyText
          ? normalizeMemoAppearance({
              text: {
                color: legacyText.color ?? '#d52b2b',
                fontSizeUnits: legacyText.fontSizeUnits ?? 1,
              },
            })
          : undefined
      result.push({
        ...(memo as unknown as TimelineInkMemo),
        kind: 'timeline',
        strokes: Array.isArray(memo.strokes) ? memo.strokes as TimelineInkMemo['strokes'] : [],
        texts: rawTexts.map(text => ({ textId: text.textId, text: text.text, x: text.x, y: text.y })),
        appearance,
        order: typeof memo.order === 'number' ? memo.order : index + 1,
      })
    }
  })
  return result
}

export function migrateLegacyMemos(
  memosInput: unknown,
  annotations: readonly Annotation[] = [],
  timelineMemoInput: readonly Omit<TimelineInkMemo, 'kind'>[] = [],
): SheetMemo[] {
  const normalized = normalizeSheetMemos(memosInput)
  if (Array.isArray(memosInput)) {
    if (normalized.length !== memosInput.length) throw new Error('メモデータが不正です。')
    return normalized
  }
  const pages = createPageMemosFromAnnotations(annotations)
  const timeline = timelineMemoInput.map(memo => ({ ...memo, kind: 'timeline' as const }))
  return [...pages, ...timeline].map((memo, index) => ({ ...memo, order: index + 1 }))
}

export function pageMemoTargetForAnnotation(annotation: Annotation): SheetPageMemoTarget {
  const anchor = annotation.anchor
  if (anchor?.kind === 'view-surface') {
    return {
      kind: anchor.regionId ? 'template-region' : 'page',
      pageId: anchor.pageId || annotation.pageId,
      templateId: anchor.templateId,
      regionId: anchor.regionId,
      surfaceSize: anchor.surfaceSize,
    }
  }
  if (anchor?.kind === 'template-region') {
    return {
      kind: 'template-region',
      pageId: annotation.pageId,
      templateId: anchor.templateId,
      regionId: anchor.regionId,
    }
  }
  return { kind: 'page', pageId: annotation.pageId }
}

export function pageMemoTargetKey(target: SheetPageMemoTarget): string {
  return [target.kind, target.pageId, target.templateId ?? '', target.regionId ?? ''].join(':')
}

function pageMemoId(target: SheetPageMemoTarget, serial: number): string {
  const safePage = target.pageId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeRegion = target.regionId?.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `memo_${safePage}${safeRegion ? `_${safeRegion}` : ''}_${serial}`
}
