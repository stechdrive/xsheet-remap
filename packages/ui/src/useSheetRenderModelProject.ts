import { useMemo } from 'react'
import type { CutProject, CutSheetDocument, SheetTemplate, SheetGeometryInput, SheetContentInput } from '@xsheet-remap/core'
import {
  createSheetRenderModelContext,
  createSheetRenderModelGeometry,
  type SheetRenderCutGroupContext,
  type SheetRenderModelContext,
} from './sheetRenderModel'

export type SheetRenderModelProjectSlices = {
  /** Only fields that can change page, track, lane, or overlay geometry. */
  geometryProject: SheetGeometryInput
  /** Fields read while rendering sheet content; annotation memos are intentionally excluded. */
  contentProject: SheetContentInput
}

export function useSheetRenderModelGeometryProject(project: CutProject): SheetGeometryInput {
  return useMemo(
    () => ({ logicalSheet: {
      frameOrigin: project.logicalSheet.frameOrigin, durationFrames: project.logicalSheet.durationFrames,
      workRange: project.logicalSheet.workRange, paperTracks: project.logicalSheet.paperTracks,
      timelineSections: project.logicalSheet.timelineSections,
    }, sheetView: { layoutOverrides: project.sheetView.layoutOverrides } }),
    // Keep this list narrower than logicalSheet: timing events and keys change
    // rendered content but not the expensive page/track geometry.
    [
      project.logicalSheet.frameOrigin,
      project.logicalSheet.durationFrames,
      project.logicalSheet.workRange,
      project.logicalSheet.paperTracks,
      project.logicalSheet.timelineSections,
      project.sheetView.layoutOverrides,
    ],
  )
}

export function useSheetRenderModelProject(project: CutProject): SheetRenderModelProjectSlices {
  const geometryProject = useSheetRenderModelGeometryProject(project)
  const contentProject = useMemo<SheetContentInput>(
    () => ({ ...geometryProject,
      logicalSheet: { ...geometryProject.logicalSheet, fps: project.logicalSheet.fps, keys: project.logicalSheet.keys, events: project.logicalSheet.events },
      sheetView: { ...geometryProject.sheetView, metadataDisplay: project.sheetView.metadataDisplay, continuationDisplay: project.sheetView.continuationDisplay },
      cut: project.cut, sheetFormData: project.sheetFormData, stackGuideLabels: project.stackGuideLabels, bindings: project.bindings,
    }),
    // Memos are projected by the dedicated annotation caches. All data read
    // through SheetRenderModelContext must be represented here.
    [
      geometryProject,
      project.cut,
      project.logicalSheet.fps,
      project.logicalSheet.keys,
      project.logicalSheet.events,
      project.sheetFormData,
      project.sheetView.metadataDisplay,
      project.sheetView.continuationDisplay,
      project.stackGuideLabels,
      project.bindings,
    ],
  )

  return useMemo(() => ({ geometryProject, contentProject }), [contentProject, geometryProject])
}

export function useSheetRenderCutGroupContext(
  activeCutId: string,
  cuts: ReadonlyArray<Pick<CutSheetDocument, 'cutId' | 'order' | 'metadata'>>,
): SheetRenderCutGroupContext {
  const sharedCutLabelRevision = JSON.stringify(cuts.map(cut => [
    cut.cutId,
    cut.order,
    cut.metadata.cut?.trim() || null,
  ]))

  return useMemo(
    () => ({
      activeCutId,
      cuts: cuts.map(cut => ({
        cutId: cut.cutId,
        order: cut.order,
        metadata: { cut: cut.metadata.cut?.trim() || undefined },
      })),
    }),
    // Cut revisions and memo payloads do not affect the shared-cut label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCutId, sharedCutLabelRevision],
  )
}

export function useSheetRenderModelContext(
  project: CutProject,
  template: SheetTemplate,
  cutGroup?: SheetRenderCutGroupContext,
): SheetRenderModelContext {
  const { geometryProject, contentProject } = useSheetRenderModelProject(project)
  const geometry = useMemo(
    () => createSheetRenderModelGeometry(geometryProject, template),
    [geometryProject, template],
  )

  return useMemo(
    () => createSheetRenderModelContext(contentProject, template, { geometry, cutGroup }),
    [contentProject, cutGroup, geometry, template],
  )
}
