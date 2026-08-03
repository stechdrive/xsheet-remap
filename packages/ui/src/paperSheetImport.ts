import {
  assignSheetSourceToPage,
  createSheetPages,
  getSheetViewLayout,
  getTemplateFramesPerPage,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  registerAsset,
  registerSheetSource,
  updateLogicalSheetSettings,
  type CutProject,
  type FileRef,
  type SheetCalibrationPointPair,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { compareFileNameLikeText } from './naturalSort'
import { paperSheetCalibrationSourceIdentity } from './paperSheetAutoCalibration'
import { serializableImageRef } from './sheetImages'

export const IMPORTED_SHEET_IMAGE_INITIAL_OPACITY = 0.5

export type ImportedSheetSourceCalibrationTarget = {
  pageId: string
  sourceId: string
  sourceIdentity: string
  imageUrl: string
}

export type ImportedSheetSourceCalibrationResult = {
  target: ImportedSheetSourceCalibrationTarget
  points: SheetCalibrationPointPair[]
}

export function paperSheetImportDurationFrames(input: {
  currentDurationFrames: number
  startPageIndex: number
  imageCount: number
  template: SheetTemplate
}): number {
  const currentDurationFrames = Math.max(1, Math.round(input.currentDurationFrames))
  const imageCount = Math.max(0, Math.floor(input.imageCount))
  if (imageCount === 0) return currentDurationFrames

  const frameAxisType = getSheetViewLayout(input.template).frameAxis?.type
  if (frameAxisType === 'continuous' || frameAxisType === 'infinite') return currentDurationFrames

  const startPageIndex = Math.max(0, Math.floor(input.startPageIndex))
  const requiredDurationFrames = (startPageIndex + imageCount) * getTemplateFramesPerPage(input.template)
  return Math.max(currentDurationFrames, requiredDurationFrames)
}

export function paperSheetImportPlan(input: {
  project: CutProject
  startPageId?: string
  imageCount: number
  template: SheetTemplate
}) {
  const currentDisplayFrames = logicalSheetDisplayDurationFrames(input.project.logicalSheet)
  const displayFrameStart = logicalSheetDisplayFrameStart(input.project.logicalSheet)
  const currentPages = createSheetPages(input.template, currentDisplayFrames, displayFrameStart)
  const startPageIndex = Math.max(0, currentPages.findIndex(page => page.pageId === input.startPageId))
  const displayDurationFrames = paperSheetImportDurationFrames({ currentDurationFrames: currentDisplayFrames, startPageIndex, imageCount: input.imageCount, template: input.template })
  return {
    startPageIndex,
    displayDurationFrames,
    durationFrames: input.project.logicalSheet.durationFrames + Math.max(0, displayDurationFrames - currentDisplayFrames),
    pages: createSheetPages(input.template, displayDurationFrames, displayFrameStart),
  }
}

export function importPaperSheetSourceRefs(input: {
  project: CutProject
  refs: FileRef[]
  startPageId?: string
  template: SheetTemplate
}): {
  project: CutProject
  runtimeUpdates: Record<string, string>
  calibrationTargets: ImportedSheetSourceCalibrationTarget[]
} | null {
  const imageRefs = input.refs
    .filter(ref => /\.(?:png|jpe?g|gif|webp|bmp|tiff?|tga)$/i.test(ref.name))
    .sort((a, b) => compareFileNameLikeText(a.name, b.name))
  if (imageRefs.length === 0) return null

  const plan = paperSheetImportPlan({ project: input.project, startPageId: input.startPageId, imageCount: imageRefs.length, template: input.template })
  const runtimeUpdates: Record<string, string> = {}
  const calibrationTargets: ImportedSheetSourceCalibrationTarget[] = []
  const batchAssetIds = new Set<string>()
  let project = updateLogicalSheetSettings(input.project, { durationFrames: plan.durationFrames })

  for (const [index, ref] of imageRefs.entries()) {
    const assetRegistered = registerAsset(project, ref, { role: 'timesheet-scan', excludeAssetIds: batchAssetIds })
    batchAssetIds.add(assetRegistered.asset.assetId)
    const registered = registerSheetSource(assetRegistered.project, serializableImageRef(ref), {
      assetId: assetRegistered.asset.assetId,
      initialAlignment: { opacity: IMPORTED_SHEET_IMAGE_INITIAL_OPACITY },
    })
    project = registered.project
    if (ref.objectUrl) runtimeUpdates[registered.source.sourceId] = ref.objectUrl
    const targetPage = plan.pages[plan.startPageIndex + index]
    if (!targetPage) continue
    project = assignSheetSourceToPage(project, targetPage.pageId, registered.source.sourceId)
    if (ref.objectUrl) calibrationTargets.push({
      pageId: targetPage.pageId,
      sourceId: registered.source.sourceId,
      sourceIdentity: paperSheetCalibrationSourceIdentity(registered.source),
      imageUrl: ref.objectUrl,
    })
  }

  return { project, runtimeUpdates, calibrationTargets }
}
