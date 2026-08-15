import {
  cellRectForHit,
  createDefaultProject,
  createSheetPages,
  digitalStandardSheetTemplate,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  standardA3SheetTemplate,
  timelineLanesForLayout,
  timingHitForFrame,
} from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { candidateToHit, enumerateTemplateTimingHits, rangeRectsForPage, rangeSelectionFromHits } from './sheetInteraction'

describe('template timing hit usage', () => {
  it('does not create interactive cells for ignored grid regions', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const ignored = template.regions.find(region => region.regionId === 'left_cell_grid')!
    ignored.usage = 'ignored'

    const hits = enumerateTemplateTimingHits(template, 'cell')

    expect(hits.some(hit => hit.regionId === ignored.regionId)).toBe(false)
    expect(hits.some(hit => hit.regionId === 'right_cell_grid')).toBe(true)
  })

  it('keeps render-only grids visible for output without creating editing hits', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const renderOnly = template.regions.find(region => region.regionId === 'right_cell_grid')!
    renderOnly.usage = 'render-only'

    const hits = enumerateTemplateTimingHits(template, 'cell')

    expect(hits.some(hit => hit.regionId === 'left_cell_grid')).toBe(true)
    expect(hits.some(hit => hit.regionId === renderOnly.regionId)).toBe(false)
  })

  it('keeps explicitly declared reference grids interactive', () => {
    const hits = enumerateTemplateTimingHits(structuredClone(standardA3SheetTemplate), 'action')

    expect(hits.some(hit => hit.regionId === 'left_action_grid')).toBe(true)
    expect(hits.some(hit => hit.regionId === 'right_action_grid')).toBe(true)
  })

  it('keeps a digital CELL range aligned when logical timeline lanes expand the canvas', () => {
    const project = createDefaultProject()
    const paperTracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)
    const durationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
    const frameOrigin = logicalSheetDisplayFrameStart(project.logicalSheet)
    const timelineLanes = timelineLanesForLayout(project)
    expect(timelineLanes.camera).toHaveLength(6)
    const page = createSheetPages(digitalStandardSheetTemplate, durationFrames, frameOrigin)[0]
    const anchor = timingHitForFrame(digitalStandardSheetTemplate, 'cell', 'E', 13, durationFrames, frameOrigin, paperTracks)
    const focus = timingHitForFrame(digitalStandardSheetTemplate, 'cell', 'E', 42, durationFrames, frameOrigin, paperTracks)
    if (!page || !anchor || !focus) throw new Error('digital CELL range fixture could not be created')
    const range = rangeSelectionFromHits(digitalStandardSheetTemplate, anchor, focus, paperTracks)
    if (!range) throw new Error('digital CELL range could not be selected')

    const expectedAnchorRect = cellRectForHit(digitalStandardSheetTemplate, anchor, durationFrames, frameOrigin, {
      paperTracks,
      timelineLanes,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    const staleRangeRect = rangeRectsForPage(digitalStandardSheetTemplate, range, page, { paperTracks })[0]
    const rangeRect = rangeRectsForPage(digitalStandardSheetTemplate, range, page, {
      paperTracks,
      timelineLanes,
      durationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    })[0]

    expect(staleRangeRect?.x).not.toBe(expectedAnchorRect?.x)
    expect(rangeRect).toMatchObject({
      x: expectedAnchorRect?.x,
      y: expectedAnchorRect?.y,
      w: expectedAnchorRect?.w,
    })
    expect(rangeRect?.h).toBeCloseTo((expectedAnchorRect?.h ?? 0) * 30)
  })

  it('maps an OCR candidate on a project track beyond the template defaults', () => {
    const paperTracks = Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index))
    const candidate = { paperTrack: 'L', frame: 10, sheetRole: 'cell' as const }

    expect(candidateToHit(digitalStandardSheetTemplate, 144, 1, candidate)).toBeNull()
    expect(candidateToHit(digitalStandardSheetTemplate, 144, 1, candidate, paperTracks)).toMatchObject({
      paperTrack: 'L',
      frame: 10,
      role: 'cell',
    })
  })
})
