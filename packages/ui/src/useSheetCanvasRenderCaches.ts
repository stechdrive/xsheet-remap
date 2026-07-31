import { useMemo } from 'react'
import {
  logicalSheetDisplayDurationFrames,
  timelineMemos,
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
import {
  pageMemoRenderItemsForPage,
  templateMemoTargetGeometries,
} from './pageMemoProjection'

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
    () => eventRectsForPages(renderContext.project, template, visiblePages, { activeOverlayPaperTrack }),
    [activeOverlayPaperTrack, renderContext, template, visiblePages],
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
  const memoTargetGeometries = useMemo(
    () => templateMemoTargetGeometries(template, {
      paperTracks,
      timelineLanes: renderContext.timelineLanes,
      durationFrames: logicalSheetDisplayDurationFrames(renderContext.project.logicalSheet),
      layoutOverrides: project.sheetView.layoutOverrides,
    }),
    [paperTracks, project.sheetView.layoutOverrides, renderContext.project.logicalSheet, renderContext.timelineLanes, template],
  )
  const annotationRenderItemsByPage = useMemo(
    () => new Map(visiblePages.map(page => [
      page.pageId,
      pageMemoRenderItemsForPage({ memos: project.memos }, page, memoTargetGeometries),
    ])),
    [memoTargetGeometries, project.memos, visiblePages],
  )
  const annotationStrokeRenderItemsByPage = useMemo(
    () => new Map([...annotationRenderItemsByPage].map(([pageId, items]) => [pageId, items.strokes])),
    [annotationRenderItemsByPage],
  )
  const annotationTextRenderItemsByPage = useMemo(
    () => new Map([...annotationRenderItemsByPage].map(([pageId, items]) => [pageId, items.texts])),
    [annotationRenderItemsByPage],
  )
  const timelineMemoItems = useMemo(() => timelineMemos({ memos: project.memos }), [project.memos])
  const soundCues = useMemo(
    () => cuesWithPreview(project.timedRangeCues, 'sound', soundCuePreview),
    [project.timedRangeCues, soundCuePreview],
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
    () => cuesWithPreview(project.timedRangeCues, 'camera', cameraCuePreview),
    [cameraCuePreview, project.timedRangeCues],
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
    annotationStrokeRenderItemsByPage,
    annotationTextRenderItemsByPage,
    timelineMemoItems,
    soundCues,
    soundCueLayoutsByPage,
    cameraCues,
    calibrationMetrics,
  }
}

function cuesWithPreview(
  cues: readonly TimedRangeCue[],
  role: TimedRangeCue['role'],
  preview: TimedRangeCue | undefined,
): TimedRangeCue[] {
  return cues
    .filter(cue => cue.role === role)
    .map(cue => preview?.cueId === cue.cueId ? preview : cue)
}
