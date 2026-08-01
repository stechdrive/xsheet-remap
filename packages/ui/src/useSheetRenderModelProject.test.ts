import { useMemo } from 'react'
import { renderHook } from '@testing-library/react'
import {
  addAnnotation,
  createDefaultProject,
  createOrSetEvent,
  logicalSheetDisplayDurationFrames,
  resolveSheetTemplatePageSize,
  standardA3SheetTemplate,
  timelineLanesForLayout,
  updateLogicalSheetSettings,
  upsertBinding,
  type CutProject,
} from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { templatePaperTracks } from './app-sheet-geometry'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { metadataTextRenderItemsForPage, type SheetRenderCutGroupContext } from './sheetRenderModel'
import {
  useSheetRenderCutGroupContext,
  useSheetRenderModelContext,
  useSheetRenderModelGeometryProject,
  useSheetRenderModelProject,
} from './useSheetRenderModelProject'

const initialCuts: SheetRenderCutGroupContext['cuts'] = [
  { cutId: 'cut_1', order: 0, metadata: { cut: '001' } },
  { cutId: 'cut_2', order: 1, metadata: { cut: '002' } },
]

describe('useSheetRenderModelProject', () => {
  it('keeps geometry and content stable for memo-only commits, then separates content and geometry changes', () => {
    const project = createDefaultProject()
    const { result, rerender } = renderHook(
      ({ currentProject, currentCuts }) => {
        const cutGroup = useSheetRenderCutGroupContext('cut_1', currentCuts)
        return useSheetRenderModelContext(currentProject, standardA3SheetTemplate, cutGroup)
      },
      { initialProps: { currentProject: project, currentCuts: initialCuts } },
    )
    const initialContext = result.current
    const initialGeometry = result.current.geometry
    const withInk = addAnnotation(project, {
      annotationId: 'annotation_1',
      pageId: 'page_1',
      tool: 'pen',
      color: '#123456',
      width: 0.002,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.2, y: 0.2, pressure: 0.5 },
      ],
    })
    const sameLabelsFromNewCutDocuments = initialCuts.map(cut => ({
      ...cut,
      metadata: { ...cut.metadata },
    }))

    rerender({ currentProject: withInk, currentCuts: sameLabelsFromNewCutDocuments })
    expect(result.current).toBe(initialContext)
    expect(result.current.geometry).toBe(initialGeometry)

    const withTiming = createOrSetEvent(withInk, 'A', 12).project
    rerender({ currentProject: withTiming, currentCuts: sameLabelsFromNewCutDocuments })
    expect(result.current).not.toBe(initialContext)
    expect(result.current.geometry).toBe(initialGeometry)
    expect(result.current.project).toBe(withTiming)

    const withDuration = updateLogicalSheetSettings(withTiming, {
      durationFrames: withTiming.logicalSheet.durationFrames + 24,
    })
    rerender({ currentProject: withDuration, currentCuts: sameLabelsFromNewCutDocuments })
    expect(result.current.geometry).not.toBe(initialGeometry)
  })

  it('refreshes asset-assignment markers without rebuilding geometry', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1)
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSheetRenderModelContext(currentProject, standardA3SheetTemplate),
      { initialProps: { currentProject: created.project } },
    )
    const initialGeometry = result.current.geometry
    const initialPage = result.current.pages[0]!
    expect(eventRectsForPages(result.current.project, standardA3SheetTemplate, [initialPage])
      .get(initialPage.pageId)?.[0]?.hasAssetBinding).toBe(false)

    const withAssetBinding = upsertBinding(created.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      assetId: 'asset_1',
      materialState: 'assigned',
    })
    rerender({ currentProject: withAssetBinding })

    expect(result.current.geometry).toBe(initialGeometry)
    expect(result.current.project).toBe(withAssetBinding)
    expect(eventRectsForPages(result.current.project, standardA3SheetTemplate, [result.current.pages[0]!])
      .get(result.current.pages[0]!.pageId)?.[0]?.hasAssetBinding).toBe(true)
  })

  it('refreshes shared-cut labels without rebuilding geometry', () => {
    const base = createDefaultProject()
    const project = {
      ...base,
      sheetView: {
        ...base.sheetView,
        metadataDisplay: { sharedCutNumbers: true },
      },
    }
    const { result, rerender } = renderHook(
      ({ currentCuts }) => {
        const cutGroup = useSheetRenderCutGroupContext('cut_1', currentCuts)
        return useSheetRenderModelContext(project, standardA3SheetTemplate, cutGroup)
      },
      { initialProps: { currentCuts: initialCuts } },
    )
    const initialGeometry = result.current.geometry
    expect(sharedCutText(result.current)).toBe('[002]')

    const renamedCuts: SheetRenderCutGroupContext['cuts'] = initialCuts.map(cut => cut.cutId === 'cut_2'
      ? { ...cut, metadata: { ...cut.metadata, cut: '003' } }
      : cut)
    rerender({ currentCuts: renamedCuts })

    expect(result.current.geometry).toBe(initialGeometry)
    expect(sharedCutText(result.current)).toBe('[003]')
  })

  it('keeps the app-shell page-size input stable for memo commits and refreshes it for geometry changes', () => {
    const project = createDefaultProject()
    const { result, rerender } = renderHook(
      ({ currentProject }) => useActiveSheetPageSize(currentProject),
      { initialProps: { currentProject: project } },
    )
    const initialPageSize = result.current
    const withInk = addAnnotation(project, {
      annotationId: 'annotation_1',
      pageId: 'page_1',
      tool: 'pen',
      color: '#123456',
      width: 0.002,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.2, y: 0.2, pressure: 0.5 },
      ],
    })

    rerender({ currentProject: withInk })
    expect(result.current).toBe(initialPageSize)

    const withDuration = updateLogicalSheetSettings(withInk, {
      durationFrames: withInk.logicalSheet.durationFrames + 24,
    })
    rerender({ currentProject: withDuration })
    expect(result.current).not.toBe(initialPageSize)
  })

  it('exposes stable geometry and refreshed content project slices', () => {
    const project = createDefaultProject()
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSheetRenderModelProject(currentProject),
      { initialProps: { currentProject: project } },
    )
    const initialGeometryProject = result.current.geometryProject
    const withTiming = createOrSetEvent(project, 'A', 12).project

    rerender({ currentProject: withTiming })

    expect(result.current.geometryProject).toBe(initialGeometryProject)
    expect(result.current.contentProject).toBe(withTiming)
  })
})

function sharedCutText(context: ReturnType<typeof useSheetRenderModelContext>): string | undefined {
  return metadataTextRenderItemsForPage(context, context.pages[0]!)
    .find(item => item.field === 'shared-cut-numbers')?.text
}

function useActiveSheetPageSize(project: CutProject) {
  const geometryProject = useSheetRenderModelGeometryProject(project)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(geometryProject.logicalSheet)
  return useMemo(
    () => resolveSheetTemplatePageSize(standardA3SheetTemplate, displayDurationFrames, {
      paperTracks: templatePaperTracks(geometryProject, standardA3SheetTemplate).map(track => track.paperTrack),
      timelineLanes: timelineLanesForLayout(geometryProject),
      layoutOverrides: geometryProject.sheetView.layoutOverrides,
    }),
    [displayDurationFrames, geometryProject],
  )
}
