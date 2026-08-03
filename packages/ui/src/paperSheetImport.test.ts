import { describe, expect, it } from 'vitest'
import { createDefaultProject, digitalStandardSheetTemplate, standardA3SheetTemplate, updateLogicalSheetSettings } from '@xsheet-remap/core'
import { importPaperSheetSourceRefs, paperSheetImportDurationFrames, paperSheetImportPlan } from './paperSheetImport'

describe('paperSheetImportDurationFrames', () => {
  it('extends a paged sheet to fit every imported image from the selected page', () => {
    expect(paperSheetImportDurationFrames({
      currentDurationFrames: 144,
      startPageIndex: 1,
      imageCount: 3,
      template: standardA3SheetTemplate,
    })).toBe(576)
  })

  it('never shortens an existing cut when replacing fewer paper sheets', () => {
    expect(paperSheetImportDurationFrames({
      currentDurationFrames: 576,
      startPageIndex: 0,
      imageCount: 1,
      template: standardA3SheetTemplate,
    })).toBe(576)
  })

  it('does not invent pages for a continuous template', () => {
    expect(paperSheetImportDurationFrames({
      currentDurationFrames: 240,
      startPageIndex: 0,
      imageCount: 4,
      template: digitalStandardSheetTemplate,
    })).toBe(240)
  })

  it('uses display pages and extends only official duration when pre-roll is visible', () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), {
      durationFrames: 144,
      workRange: { preRollFrames: 24, postRollFrames: 0, showPreRoll: true, showPostRoll: true },
    })

    const plan = paperSheetImportPlan({ project, startPageId: 'page_2', imageCount: 1, template: standardA3SheetTemplate })

    expect(plan.startPageIndex).toBe(1)
    expect(plan.displayDurationFrames).toBe(288)
    expect(plan.durationFrames).toBe(264)
    expect(plan.pages).toHaveLength(2)
  })

  it('keeps every selected file distinct within one batch even when all metadata matches', () => {
    const result = importPaperSheetSourceRefs({
      project: createDefaultProject(),
      startPageId: 'page_1',
      template: standardA3SheetTemplate,
      refs: [
        { name: 'same.png', size: 4, lastModified: 1, contentHash: 'sha256:same', objectUrl: 'blob:first' },
        { name: 'same.png', size: 4, lastModified: 1, contentHash: 'sha256:same', objectUrl: 'blob:second' },
      ],
    })

    expect(result?.project.sheetView.sources).toHaveLength(2)
    expect(result?.project.assets).toHaveLength(2)
    expect(result?.project.sheetView.pages.find(page => page.pageId === 'page_1')?.sourceId).not.toBe(
      result?.project.sheetView.pages.find(page => page.pageId === 'page_2')?.sourceId,
    )
  })
})
