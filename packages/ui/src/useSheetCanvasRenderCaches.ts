import { useMemo } from 'react'
import {
  sheetAnnotations,
  timelineMemos,
  type AnnotationStroke,
  type AnnotationText,
  type CutProject,
  type SheetPage,
  type SheetTemplate,
  type SheetViewMode,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import { calibrationGuideMetrics } from './sheet-layers-calibration-render'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { buildSoundCuePageTextLayouts } from './soundCueGeometry'
import { continuationRenderItemsForPages, type SheetRenderModelContext } from './sheetRenderModel'

export function useSheetCanvasRenderCaches({
  project,
  template,
  sheetPages,
  activePageIndex,
  viewMode,
  activeOverlayPaperTrack,
  renderContext,
  pageSize,
  paperTracks,
  soundCuePreview,
  cameraCuePreview,
  referenceProject,
  referenceRenderContext,
}: {
  project: CutProject
  template: SheetTemplate
  sheetPages: SheetPage[]
  activePageIndex: number
  viewMode: SheetViewMode
  activeOverlayPaperTrack: string | null
  renderContext: SheetRenderModelContext
  pageSize: SheetRenderModelContext['pageSize']
  paperTracks: string[]
  soundCuePreview?: TimedRangeCue
  cameraCuePreview?: TimedRangeCue
  referenceProject?: CutProject | null
  referenceRenderContext?: SheetRenderModelContext | null
}) {
  const visiblePages = useMemo(
    () => viewMode === 'single-page'
      ? sheetPages.filter(page => page.pageIndex === activePageIndex)
      : sheetPages,
    [activePageIndex, sheetPages, viewMode],
  )
  const eventRectsByPage = useMemo(
    () => eventRectsForPages(project, template, visiblePages, { activeOverlayPaperTrack }),
    [activeOverlayPaperTrack, project, template, visiblePages],
  )
  const continuationItemsByPage = useMemo(
    () => continuationRenderItemsForPages(renderContext, visiblePages),
    [renderContext, visiblePages],
  )
  const referenceEventRectsByPage = useMemo(
    () => referenceProject
      ? eventRectsForPages(referenceProject, template, visiblePages)
      : new Map(visiblePages.map(page => [page.pageId, []])),
    [referenceProject, template, visiblePages],
  )
  const referenceContinuationItemsByPage = useMemo(
    () => referenceRenderContext
      ? continuationRenderItemsForPages(referenceRenderContext, visiblePages)
      : new Map(visiblePages.map(page => [page.pageId, []])),
    [referenceRenderContext, visiblePages],
  )
  const annotationStrokesByPage = useMemo(() => {
    const grouped = new Map<string, AnnotationStroke[]>()
    for (const annotation of sheetAnnotations(project)) {
      if (annotation.kind === 'text' || annotation.tool !== 'pen') continue
      const items = grouped.get(annotation.pageId) ?? []
      items.push(annotation)
      grouped.set(annotation.pageId, items)
    }
    return grouped
  }, [project])
  const annotationTextsByPage = useMemo(() => {
    const grouped = new Map<string, AnnotationText[]>()
    for (const annotation of sheetAnnotations(project)) {
      if (annotation.kind !== 'text') continue
      const items = grouped.get(annotation.pageId) ?? []
      items.push(annotation)
      grouped.set(annotation.pageId, items)
    }
    return grouped
  }, [project])
  const timelineMemoItems = useMemo(() => timelineMemos(project), [project])
  const soundCues = useMemo(
    () => cuesWithPreview(project, 'sound', soundCuePreview),
    [project, soundCuePreview],
  )
  const soundCueLayoutsByPage = useMemo(() => {
    const grouped = new Map<string, ReturnType<typeof buildSoundCuePageTextLayouts>>()
    for (const layout of buildSoundCuePageTextLayouts(
      template,
      renderContext.pages,
      soundCues,
      pageSize,
      {
        paperTracks,
        timelineLanes: renderContext.timelineLanes,
        layoutOverrides: project.sheetView.layoutOverrides,
      },
    )) {
      const items = grouped.get(layout.pageId) ?? []
      items.push(layout)
      grouped.set(layout.pageId, items)
    }
    return grouped
  }, [pageSize, paperTracks, project.sheetView.layoutOverrides, renderContext.pages, renderContext.timelineLanes, soundCues, template])
  const cameraCues = useMemo(
    () => cuesWithPreview(project, 'camera', cameraCuePreview),
    [cameraCuePreview, project],
  )
  const calibrationMetrics = useMemo(
    () => calibrationGuideMetrics(template, pageSize),
    [pageSize, template],
  )

  return {
    visiblePages,
    eventRectsByPage,
    continuationItemsByPage,
    referenceEventRectsByPage,
    referenceContinuationItemsByPage,
    annotationStrokesByPage,
    annotationTextsByPage,
    timelineMemoItems,
    soundCues,
    soundCueLayoutsByPage,
    cameraCues,
    calibrationMetrics,
  }
}

function cuesWithPreview(
  project: CutProject,
  role: TimedRangeCue['role'],
  preview: TimedRangeCue | undefined,
): TimedRangeCue[] {
  return project.timedRangeCues
    .filter(cue => cue.role === role)
    .map(cue => preview?.cueId === cue.cueId ? preview : cue)
}
