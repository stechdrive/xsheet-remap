import { createDefaultProject, createSheetPages, createTimedRangeCue, digitalStandardSheetTemplate, resolveSheetTemplatePageSize, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { assetAssignedMarkerPoints, assetAssignedMarkerSize } from './sheet-selection-visuals'
import { createTimelineMemoForCue, createTimelineMemoForHit } from './timelineMemoEditing'
import { timelineMemoAnchorCellForPage, timelineMemoAnchorConnectorPoints, timelineMemoAnchorHitRect, timelineMemoAnchorMarkerRect, timelineMemoSegmentsForPage, timelineMemoStrokePointsForSegment } from './timelineMemoGeometry'

function memo(frame: number, heightFrames: number): TimelineInkMemo {
  return {
    kind: 'timeline',
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
    expect(timelineMemoAnchorCellForPage(standardA3SheetTemplate, pages[0]!, memo(146, 4), { paperTracks: ['A'] })).toBeNull()
    expect(timelineMemoAnchorCellForPage(standardA3SheetTemplate, pages[1]!, memo(146, 4), { paperTracks: ['A'] })?.pageId).toBe('page_2')
  })

  it('keeps the anchor cue on the logical frame when the memo canvas moves', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const moved = { ...memo(70, 8), placement: { ...memo(70, 8).placement, frameOffset: 5, crossOffsetUnits: 3 } }
    const anchor = timelineMemoAnchorCellForPage(standardA3SheetTemplate, page, moved, { paperTracks: ['A'] })
    const startSegment = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, moved, { paperTracks: ['A'] }).find(segment => segment.startsMemo)
    expect(anchor?.regionId).toBe('left_action_grid')
    expect(startSegment?.regionId).toBe('right_action_grid')
  })

  it('uses the shared corner-marker size on the left without colliding with the asset flag on the right', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const cell = timelineMemoAnchorCellForPage(standardA3SheetTemplate, page, memo(10, 8), { paperTracks: ['A'] })!.rect
    const surface = { widthPx: 877, heightPx: 1241 }
    const memoMarker = timelineMemoAnchorMarkerRect(cell, surface)
    const memoHit = timelineMemoAnchorHitRect(cell, surface)
    const assetMarker = assetAssignedMarkerSize(cell, surface)
    const assetXs = assetAssignedMarkerPoints(cell, surface).split(' ').map(point => Number(point.split(',')[0]))
    expect(memoMarker.x).toBe(cell.x)
    expect(memoMarker.y).toBe(cell.y)
    expect(memoMarker.x + memoMarker.w).toBeLessThan(Math.min(...assetXs))
    expect(memoMarker.w).toBe(assetMarker.width)
    expect(memoMarker.h).toBe(assetMarker.height)
    expect(memoHit.w).toBeGreaterThanOrEqual(memoMarker.w)
    expect(memoHit.h).toBeGreaterThanOrEqual(memoMarker.h)
    expect(memoHit.w * surface.widthPx).toBeCloseTo(14)
    expect(memoHit.h * surface.heightPx).toBeCloseTo(14)
    expect(memoHit.w * surface.widthPx).toBeLessThanOrEqual(16)
    expect(memoHit.h * surface.heightPx).toBeLessThanOrEqual(16)
  })

  it('draws a selected connector only after the memo canvas leaves its anchor cell', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const source = memo(10, 8)
    const anchorCell = timelineMemoAnchorCellForPage(standardA3SheetTemplate, page, source, { paperTracks: ['A'] })!
    const marker = timelineMemoAnchorMarkerRect(anchorCell.rect, { widthPx: 877, heightPx: 1241 })
    const originalRect = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, source, { paperTracks: ['A'] })[0]!.rect
    const moved = { ...source, placement: { ...source.placement, frameOffset: 8, crossOffsetUnits: 3 } }
    const movedRect = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, moved, { paperTracks: ['A'] })[0]!.rect
    expect(timelineMemoAnchorConnectorPoints(marker, originalRect, { widthPx: 877, heightPx: 1241 })).toBeNull()
    expect(timelineMemoAnchorConnectorPoints(marker, movedRect, { widthPx: 877, heightPx: 1241 })?.split(' ')).toHaveLength(4)
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

  it('creates a cue-linked memo from the selected SOUND element', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 10, frameEnd: 18, label: '話者',
    })
    const memo = createTimelineMemoForCue(created.project, standardA3SheetTemplate, created.cue)
    expect(memo?.anchor).toMatchObject({
      role: 'sound', laneId: 'sound_lane_1', frame: 10, cueId: created.cue.cueId,
    })
    expect(memo?.placement.heightFrames).toBeGreaterThanOrEqual(9)
    expect(memo?.placement.crossOffsetUnits).not.toBe(0)
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const anchor = timelineMemoAnchorCellForPage(standardA3SheetTemplate, page, memo!, { paperTracks: ['A'] })!.rect
    const segment = timelineMemoSegmentsForPage(standardA3SheetTemplate, page, memo!, { paperTracks: ['A'] })[0]!.rect
    const overlapsHorizontally = Math.min(anchor.x + anchor.w, segment.x + segment.w) > Math.max(anchor.x, segment.x)
    expect(overlapsHorizontally).toBe(false)
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
