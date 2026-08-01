import { renderHook } from '@testing-library/react'
import {
  addAnnotation,
  createDefaultProject,
  createOrSetEvent,
  createSheetPages,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  standardA3SheetTemplate,
} from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { createSheetRenderModelContext } from './sheetRenderModel'
import { useSheetCanvasRenderCaches } from './useSheetCanvasRenderCaches'

describe('useSheetCanvasRenderCaches', () => {
  it('reuses sheet geometry while rebuilding only annotation caches for an ink commit', () => {
    const project = createDefaultProject()
    const pages = createSheetPages(
      standardA3SheetTemplate,
      logicalSheetDisplayDurationFrames(project.logicalSheet),
      logicalSheetDisplayFrameStart(project.logicalSheet),
    )
    const renderContext = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const common = {
      template: standardA3SheetTemplate,
      sheetPages: pages,
      activePageIndex: 0,
      viewMode: project.sheetView.viewMode,
      activeOverlayPaperTrack: null,
      pageSize: renderContext.pageSize,
      paperTracks: renderContext.paperTracks,
    } as const
    const { result, rerender } = renderHook(
      ({ currentProject, currentRenderContext }) => useSheetCanvasRenderCaches({
        ...common,
        project: currentProject,
        renderContext: currentRenderContext,
      }),
      { initialProps: { currentProject: project, currentRenderContext: renderContext } },
    )
    const firstEventRects = result.current.eventRectsByPage
    const firstContinuationItems = result.current.continuationItemsByPage
    const firstAnnotationItems = result.current.annotationStrokeRenderItemsByPage
    const page = pages[0]!
    const withInk = addAnnotation(project, {
      annotationId: 'annotation_1',
      pageId: page.pageId,
      tool: 'pen',
      color: '#123456',
      width: 0.002,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.2, y: 0.2, pressure: 0.5 },
      ],
    })

    rerender({ currentProject: withInk, currentRenderContext: renderContext })

    expect(result.current.eventRectsByPage).toBe(firstEventRects)
    expect(result.current.continuationItemsByPage).toBe(firstContinuationItems)
    expect(result.current.annotationStrokeRenderItemsByPage).not.toBe(firstAnnotationItems)
    expect(result.current.annotationStrokeRenderItemsByPage.get(page.pageId)).toHaveLength(1)
    const sourceStroke = withInk.memos.find(memo => memo.kind === 'page')?.strokes[0]
    const canvasItem = result.current.annotationStrokeRenderItemsByPage.get(page.pageId)?.[0]
    expect(canvasItem?.points).toBe(sourceStroke?.points)
    expect(canvasItem?.projectionOffset).toEqual({ x: 0, y: 0 })
    expect('path' in canvasItem!).toBe(false)

    const withTiming = createOrSetEvent(withInk, 'A', 12).project
    const withTimingRenderContext = { ...renderContext, project: withTiming }
    const annotationItemsAfterInk = result.current.annotationStrokeRenderItemsByPage
    rerender({ currentProject: withTiming, currentRenderContext: withTimingRenderContext })

    expect(withTimingRenderContext.project.logicalSheet).not.toBe(renderContext.project.logicalSheet)
    expect(result.current.annotationStrokeRenderItemsByPage).toBe(annotationItemsAfterInk)
  })

  it('precomputes indexed SVG projection for the revision reference layer', () => {
    const project = createDefaultProject()
    const pages = createSheetPages(
      standardA3SheetTemplate,
      logicalSheetDisplayDurationFrames(project.logicalSheet),
      logicalSheetDisplayFrameStart(project.logicalSheet),
    )
    const page = pages[0]!
    const referenceProject = addAnnotation(project, {
      annotationId: 'reference_ink',
      pageId: page.pageId,
      tool: 'pen',
      color: '#123456',
      width: 0.002,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    })
    const renderContext = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const referenceRenderContext = createSheetRenderModelContext(referenceProject, standardA3SheetTemplate)

    const { result } = renderHook(() => useSheetCanvasRenderCaches({
      project,
      template: standardA3SheetTemplate,
      sheetPages: pages,
      activePageIndex: 0,
      viewMode: project.sheetView.viewMode,
      activeOverlayPaperTrack: null,
      renderContext,
      pageSize: renderContext.pageSize,
      paperTracks: renderContext.paperTracks,
      referenceProject,
      referenceRenderContext,
    }))

    const projected = result.current.referenceAnnotationRenderItemsByPage.get(page.pageId)
    expect(projected?.strokes).toHaveLength(1)
    expect(projected?.strokes[0]?.path).toContain('M ')
  })
})
