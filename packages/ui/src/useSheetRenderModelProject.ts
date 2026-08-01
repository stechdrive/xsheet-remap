import { useMemo } from 'react'
import type { CutProject, CutSheetDocument, SheetTemplate } from '@xsheet-remap/core'
import {
  createSheetRenderModelContext,
  createSheetRenderModelGeometry,
  type SheetRenderCutGroupContext,
  type SheetRenderModelContext,
} from './sheetRenderModel'

export type SheetRenderModelProjectSlices = {
  /** Only fields that can change page, track, lane, or overlay geometry. */
  geometryProject: CutProject
  /** Fields read while rendering sheet content; annotation memos are intentionally excluded. */
  contentProject: CutProject
}

export function useSheetRenderModelGeometryProject(project: CutProject): CutProject {
  return useMemo(
    () => project,
    // Keep this list narrower than logicalSheet: timing events and keys change
    // rendered content but not the expensive page/track geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const contentProject = useMemo(
    () => project,
    // Memos are projected by the dedicated annotation caches. All data read
    // through SheetRenderModelContext must be represented here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
