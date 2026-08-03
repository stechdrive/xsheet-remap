import {
  updateSheetPageViewState,
  type CutProject,
  type SheetCalibrationPointPair,
  type SheetSource,
} from '@xsheet-remap/core'

export function paperSheetCalibrationSourceIdentity(source: Pick<SheetSource, 'assetId' | 'imageRef'>): string {
  const ref = source.imageRef
  return JSON.stringify([
    source.assetId ?? null,
    ref.name,
    ref.size ?? null,
    ref.lastModified ?? null,
    ref.path ?? null,
    ref.assetPath ?? null,
    ref.contentHash ?? null,
    ref.pixelWidth ?? null,
    ref.pixelHeight ?? null,
    ref.ppiX ?? null,
    ref.ppiY ?? null,
  ])
}

export function applyDetectedPaperSheetCalibration(input: {
  project: CutProject
  pageId: string
  sourceId?: string
  sourceIdentity?: string
  points: SheetCalibrationPointPair[]
  enabled?: boolean
}): { project: CutProject; pageId: string } | null {
  const matchedSource = input.sourceId
    ? input.project.sheetView.sources.find(item => item.sourceId === input.sourceId)
    : undefined
  if (input.sourceId && (!matchedSource || paperSheetCalibrationSourceIdentity(matchedSource) !== input.sourceIdentity)) return null
  const page = matchedSource
    ? input.project.sheetView.pages.find(item => item.sourceId === matchedSource.sourceId)
    : input.project.sheetView.pages.find(item => item.pageId === input.pageId && !item.sourceId)
  if (!page) return null
  const source = matchedSource ?? (page.sourceId ? input.project.sheetView.sources.find(item => item.sourceId === page.sourceId) : undefined)
  const alignment = source?.alignment ?? page.alignment
  const corners = input.points.length >= 4
    ? {
        tl: { ...input.points[0]!.source },
        tr: { ...input.points[1]!.source },
        br: { ...input.points[2]!.source },
        bl: { ...input.points[3]!.source },
      }
    : alignment.corners
  return {
    project: updateSheetPageViewState(input.project, page.pageId, {
      alignment: {
        corners,
        calibration: { enabled: input.enabled ?? false, points: input.points },
      },
    }),
    pageId: page.pageId,
  }
}
