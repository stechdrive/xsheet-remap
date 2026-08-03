import { describe, expect, it } from 'vitest'
import {
  assignSheetSourceToPage,
  createDefaultProject,
  registerSheetSource,
  removeSheetSource,
  type SheetCalibrationPointPair,
} from '@xsheet-remap/core'
import { applyDetectedPaperSheetCalibration, paperSheetCalibrationSourceIdentity } from './paperSheetAutoCalibration'

const points: SheetCalibrationPointPair[] = [
  { pointId: 'tl', label: 'TL', source: { x: 0.1, y: 0.1 }, target: { x: 0, y: 0 } },
  { pointId: 'tr', label: 'TR', source: { x: 0.9, y: 0.1 }, target: { x: 1, y: 0 } },
  { pointId: 'br', label: 'BR', source: { x: 0.9, y: 0.9 }, target: { x: 1, y: 1 } },
  { pointId: 'bl', label: 'BL', source: { x: 0.1, y: 0.9 }, target: { x: 0, y: 1 } },
]

describe('applyDetectedPaperSheetCalibration', () => {
  it('applies an async result to the current page of a moved source', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'paper.png' })
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const moved = assignSheetSourceToPage(assigned, 'page_3', registered.source.sourceId)

    const applied = applyDetectedPaperSheetCalibration({
      project: moved,
      pageId: 'page_1',
      sourceId: registered.source.sourceId,
      sourceIdentity: paperSheetCalibrationSourceIdentity(registered.source),
      points,
    })

    expect(applied?.pageId).toBe('page_3')
    expect(applied?.project.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId).toBeUndefined()
    expect(applied?.project.sheetView.sources[0]?.alignment.corners.tl).toEqual({ x: 0.1, y: 0.1 })
  })

  it('discards an async result after its source is deleted', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'paper.png' })
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const removed = removeSheetSource(assigned, registered.source.sourceId)

    expect(applyDetectedPaperSheetCalibration({
      project: removed,
      pageId: 'page_1',
      sourceId: registered.source.sourceId,
      sourceIdentity: paperSheetCalibrationSourceIdentity(registered.source),
      points,
    })).toBeNull()
  })

  it('discards an async result when a deleted source id is reused by another image', () => {
    const original = registerSheetSource(createDefaultProject(), { name: 'paper-a.png', contentHash: 'sha256:a' })
    const originalAssigned = assignSheetSourceToPage(original.project, 'page_1', original.source.sourceId)
    const removed = removeSheetSource(originalAssigned, original.source.sourceId)
    const replacement = registerSheetSource(removed, { name: 'paper-b.png', contentHash: 'sha256:b' })
    const replacementAssigned = assignSheetSourceToPage(replacement.project, 'page_1', replacement.source.sourceId)

    expect(replacement.source.sourceId).toBe(original.source.sourceId)
    expect(applyDetectedPaperSheetCalibration({
      project: replacementAssigned,
      pageId: 'page_1',
      sourceId: original.source.sourceId,
      sourceIdentity: paperSheetCalibrationSourceIdentity(original.source),
      points,
    })).toBeNull()
    expect(replacementAssigned.sheetView.sources[0]?.alignment.calibration).toBeUndefined()
  })
})
