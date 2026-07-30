import { renderHook } from '@testing-library/react'
import {
  addAnnotation,
  createDefaultProject,
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
      renderContext,
      pageSize: renderContext.pageSize,
      paperTracks: renderContext.paperTracks,
    } as const
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSheetCanvasRenderCaches({
        ...common,
        project: currentProject,
      }),
      { initialProps: { currentProject: project } },
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

    rerender({ currentProject: withInk })

    expect(result.current.eventRectsByPage).toBe(firstEventRects)
    expect(result.current.continuationItemsByPage).toBe(firstContinuationItems)
    expect(result.current.annotationStrokeRenderItemsByPage).not.toBe(firstAnnotationItems)
    expect(result.current.annotationStrokeRenderItemsByPage.get(page.pageId)).toHaveLength(1)
  })
})
