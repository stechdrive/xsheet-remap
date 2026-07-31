import {
  resolveSheetTemplateRegionRect,
  sheetPageMemos,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationText,
  type CutProject,
  type NormalizedRect,
  type SheetPage,
  type SheetPageMemoTarget,
  type SheetTemplate,
  type SheetTemplateLayoutResolveOptions,
} from '@xsheet-remap/core'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'
import {
  resolveTemplateRegionMemoTarget,
  type TemplateMemoTargetRef,
} from './templateMemoTargets'

export interface TemplateMemoTargetGeometry extends TemplateMemoTargetRef {
  rect: NormalizedRect
}

export interface PageMemoStrokeRenderItem {
  memoId: string
  stroke: AnnotationStroke
  points: AnnotationPoint[]
  path: string
  target: TemplateMemoTargetGeometry | null
}

export interface PageMemoTextRenderItem {
  memoId: string
  annotation: AnnotationText
  x: number
  y: number
  target: TemplateMemoTargetGeometry | null
}

export interface PageMemoRenderItems {
  strokes: PageMemoStrokeRenderItem[]
  texts: PageMemoTextRenderItem[]
}

export type TemplateMemoGeometryOptions =
  Omit<SheetTemplateLayoutResolveOptions, 'paperTracks'>
  & {
    paperTracks: string[]
    durationFrames: number
  }

export function templateMemoTargetGeometries(
  template: SheetTemplate,
  options: TemplateMemoGeometryOptions,
): TemplateMemoTargetGeometry[] {
  const chrome = buildTemplateChromeRenderModel(
    template,
    options.paperTracks,
    options.durationFrames,
    {
      timelineLanes: options.timelineLanes,
      layoutOverrides: options.layoutOverrides,
    },
  )
  const candidates: TemplateMemoTargetGeometry[] = []
  for (const region of template.regions) {
    if (
      region.type !== 'metadata-field'
      || region.usage !== 'input'
      || region.binding?.target !== 'cut-metadata'
      || region.binding.field === 'page'
    ) continue
    candidates.push({
      ...resolveTemplateRegionMemoTarget(region),
      rect: resolveSheetTemplateRegionRect(
        template,
        region,
        options.durationFrames,
        {
          paperTracks: options.paperTracks,
          timelineLanes: options.timelineLanes,
          layoutOverrides: options.layoutOverrides,
        },
      ),
    })
  }
  for (const field of chrome.formFields) {
    if (!field.memoTarget) continue
    candidates.push({ ...field.memoTarget, rect: field.rect })
  }
  for (const target of chrome.formAnnotationTargets) {
    candidates.push({ ...target.memoTarget, rect: target.rect })
  }
  return mergeSharedTargetRects(candidates)
}

export function resolveTemplateMemoTargetGeometry(
  target: Pick<SheetPageMemoTarget, 'kind' | 'templateId' | 'regionId' | 'targetId' | 'logicalTargetId'>,
  geometries: readonly TemplateMemoTargetGeometry[],
): TemplateMemoTargetGeometry | null {
  if (target.kind !== 'template-region') return null
  if (target.logicalTargetId) {
    const logical = geometries.find(candidate => candidate.logicalTargetId === target.logicalTargetId)
    if (logical) return logical
  }
  return geometries.find(candidate =>
    candidate.regionId === target.regionId
    && candidate.targetId === target.targetId,
  ) ?? null
}

export function pageMemoRenderItemsForPage(
  project: Pick<CutProject, 'memos'>,
  page: SheetPage,
  geometries: readonly TemplateMemoTargetGeometry[],
): PageMemoRenderItems {
  const strokes: PageMemoStrokeRenderItem[] = []
  const texts: PageMemoTextRenderItem[] = []
  for (const memo of sheetPageMemos(project)) {
    if (memo.target.pageId !== page.pageId) continue
    const target = resolveTemplateMemoTargetGeometry(memo.target, geometries)
    if (memo.target.kind === 'template-region' && !target) continue
    const offset = target?.rect ?? { x: 0, y: 0 }
    for (const stroke of memo.strokes) {
      if (stroke.tool !== 'pen') continue
      const points = stroke.coordinateSpace === 'memo-target'
        ? stroke.points.map(point => ({ ...point, x: point.x + offset.x, y: point.y + offset.y }))
        : stroke.points
      strokes.push({
        memoId: memo.memoId,
        stroke,
        points,
        path: strokePathForPoints(points),
        target,
      })
    }
    for (const annotation of memo.texts) {
      texts.push({
        memoId: memo.memoId,
        annotation,
        x: annotation.coordinateSpace === 'memo-target' ? annotation.x + offset.x : annotation.x,
        y: annotation.coordinateSpace === 'memo-target' ? annotation.y + offset.y : annotation.y,
        target,
      })
    }
  }
  return { strokes, texts }
}

export function strokePathForPoints(points: readonly AnnotationPoint[]): string {
  const [first, ...rest] = points
  if (!first) return ''
  return [`M ${first.x} ${first.y}`, ...rest.map(point => `L ${point.x} ${point.y}`)].join(' ')
}

function mergeSharedTargetRects(
  candidates: readonly TemplateMemoTargetGeometry[],
): TemplateMemoTargetGeometry[] {
  const merged = new Map<string, TemplateMemoTargetGeometry>()
  for (const candidate of candidates) {
    const key = `${candidate.regionId}:${candidate.targetId ?? ''}:${candidate.logicalTargetId}`
    const current = merged.get(key)
    if (!current) {
      merged.set(key, candidate)
      continue
    }
    merged.set(key, {
      ...current,
      rect: unionRect(current.rect, candidate.rect),
    })
  }
  return [...merged.values()]
}

function unionRect(left: NormalizedRect, right: NormalizedRect): NormalizedRect {
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const rightEdge = Math.max(left.x + left.w, right.x + right.w)
  const bottomEdge = Math.max(left.y + left.h, right.y + right.h)
  return { x, y, w: rightEdge - x, h: bottomEdge - y }
}
