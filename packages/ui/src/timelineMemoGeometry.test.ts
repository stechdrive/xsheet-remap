import { createDefaultProject, createSheetPages, digitalStandardSheetTemplate, resolveSheetTemplatePageSize, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { createTimelineMemoForHit } from './timelineMemoEditing'
import { timelineMemoSegmentsForPage, timelineMemoStrokePointsForSegment } from './timelineMemoGeometry'

function memo(frame: number, heightFrames: number): TimelineInkMemo {
  return {
    memoId: 'memo_1',
    anchor: { role: 'action', frame, paperTrack: 'A' },
    placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames },
    strokes: [],
    order: 1,
  }
}

describe('timeline memo geometry', () => {
  it('splits one memo at the A3 six-second paper wrap without changing its logical size', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const segments = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, memo(70, 8), { paperTracks: ['A'] })
    expect(segments).toHaveLength(2)
    expect(segments.map(segment => [segment.regionId, segment.memoYStart, segment.memoYEnd])).toEqual([
      ['left_action_grid', 0, 3],
      ['right_action_grid', 3, 8],
    ])
    expect(segments[0]?.endsMemo).toBe(false)
    expect(segments[1]?.startsMemo).toBe(false)
  })

  it('follows repeated pages and only appears on the anchored page interval', () => {
    const pages = createSheetPages(standardA3SheetTemplate, 288, 1)
    expect(timelineMemoSegmentsForPage(standardA3SheetTemplate, pages[0]!, memo(146, 4), { paperTracks: ['A'] })).toHaveLength(0)
    expect(timelineMemoSegmentsForPage(standardA3SheetTemplate, pages[1]!, memo(146, 4), { paperTracks: ['A'] })).toHaveLength(1)
  })

  it('clips a stroke into each wrap segment while retaining logical points', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const segments = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, memo(70, 8), { paperTracks: ['A'] })
    const points = [{ x: 1, y: 1 }, { x: 2, y: 6 }]
    const left = timelineMemoStrokePointsForSegment(segments[0]!, points)
    const right = timelineMemoStrokePointsForSegment(segments[1]!, points)
    expect(left.at(-1)?.y).toBe(3)
    expect(right[0]?.y).toBe(3)
    expect(right.at(-1)?.y).toBe(6)
  })

  it('uses the selected duration and resolves the physical default width only at creation', () => {
    const project = createDefaultProject()
    const hit = { regionId: 'left_action_grid', role: 'action' as const, frame: 10, rowIndex: 9, columnIndex: 0, columnId: 'action_a', label: 'A', paperTrack: 'A' }
    const created = createTimelineMemoForHit(project, standardA3SheetTemplate, hit, null)
    expect(created?.placement.heightFrames).toBe(12)
    expect(created?.placement.widthUnits).toBeGreaterThan(1)
  })

  it('uses the matching selected frame range as the initial memo duration', () => {
    const project = createDefaultProject()
    const anchorHit = { regionId: 'left_action_grid', role: 'action' as const, frame: 10, rowIndex: 9, columnIndex: 0, columnId: 'action_a', label: 'A', paperTrack: 'A' }
    const focusHit = { ...anchorHit, frame: 18, rowIndex: 17 }
    const created = createTimelineMemoForHit(project, standardA3SheetTemplate, { ...anchorHit, frame: 12, rowIndex: 11 }, {
      role: 'action', inputMode: 'point-event', frameStart: 10, frameEnd: 18, anchorFrame: 10, focusFrame: 18,
      columnId: anchorHit.columnId, paperTracks: ['A'], paperTrack: 'A', flowGroupId: 'main_action', anchorHit, focusHit,
    })
    expect(created?.anchor.frame).toBe(10)
    expect(created?.placement.heightFrames).toBe(9)
  })

  it('preserves the stored memo aspect when switching between paper and digital templates', () => {
    const stored = memo(12, 16)
    const paperPage = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const digitalPage = createSheetPages(digitalStandardSheetTemplate, 144, 1)[0]!
    const paper = timelineMemoSegmentsForPage(standardA3SheetTemplate, paperPage, stored, { paperTracks: ['A'] })[0]!
    const digital = timelineMemoSegmentsForPage(digitalStandardSheetTemplate, digitalPage, stored, { paperTracks: ['A'] })[0]!
    const paperSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const digitalSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate)
    const paperAspect = paper.rect.w * paperSize.widthPx / (paper.rect.h * paperSize.heightPx)
    const digitalAspect = digital.rect.w * digitalSize.widthPx / (digital.rect.h * digitalSize.heightPx)
    expect(paperAspect).toBeCloseTo(stored.placement.widthUnits / stored.placement.heightFrames)
    expect(digitalAspect).toBeCloseTo(paperAspect)
  })

  it('resolves the digital pixel default against the current continuous duration', () => {
    const project = createDefaultProject()
    project.logicalSheet.durationFrames = 288
    const hit = { regionId: 'digital_action_grid', role: 'action' as const, frame: 10, rowIndex: 9, columnIndex: 0, columnId: 'digital_action_a', label: 'A', paperTrack: 'A', pageId: 'page_1' }
    const created = createTimelineMemoForHit(project, digitalStandardSheetTemplate, hit, null)!
    const page = createSheetPages(digitalStandardSheetTemplate, 288, 1)[0]!
    const segment = timelineMemoSegmentsForPage(digitalStandardSheetTemplate, page, created, { paperTracks: ['A'] })[0]!
    const pageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, 288)
    expect(segment.rect.w * pageSize.widthPx).toBeCloseTo(225)
  })
})
