import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import {
  CAMERA_OVERLAP_PIVOT_MARK_GRID_RATIO,
  CAMERA_RANGE_MARKER_HEIGHT_GRID_RATIO,
  CAMERA_RANGE_MARKER_WIDTH_GRID_RATIO,
  buildCameraCuePageLayouts,
  cameraCueLabelLayoutForPage,
  cameraCuePointLayoutsForPage,
  cameraCueSegmentsForPage,
  cameraOverlapFillPolygonsForSegment,
  cameraOverlapPivotMarkForSegment,
  cameraOverlapPivotPosition,
  cameraOverlapPathsForSegment,
  cameraRangeMarkerGeometryForSegment,
  cameraRangePathData,
  cameraRangePathsForSegment,
} from './cameraCueGeometry'
import { defaultTimingTextFontSizePx } from './sheetTextLayout'

describe('CAMERA cue geometry', () => {
  const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
  const paperTracks = createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)

  it('clips one logical instruction across the two A3 CAMERA regions', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_1', role: 'camera', laneId: 'camera_lane_1', frameStart: 70, frameEnd: 76, label: 'PAN', text: '', source: 'manual',
      camera: { shape: 'range', startLabel: 'A', endLabel: 'B' },
    }
    const segments = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })
    expect(segments.map(segment => [segment.regionId, segment.frameStart, segment.frameEnd, segment.startsCue, segment.endsCue])).toEqual([
      ['left_camera_grid', 70, 72, true, false],
      ['right_camera_grid', 73, 76, false, true],
    ])
  })

  it('uses vertical auto placement for a long range and logical region coordinates for a manual box', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_2', role: 'camera', laneId: 'camera_lane_2', frameStart: 1, frameEnd: 30, label: 'トラックバックPAN', text: '', source: 'manual',
      camera: { shape: 'range', startLabel: '', endLabel: '' },
    }
    const segments = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })
    const automatic = cameraCueLabelLayoutForPage(standardA3SheetTemplate, page, cue, { widthPx: 1754, heightPx: 2481 }, segments)
    expect(automatic?.orientation).toBe('vertical')
    expect(automatic?.overflow).toBe(false)
    expect(automatic?.rect).not.toEqual(segments[0]!.rect)
    expect((automatic?.rect.w ?? 0) * (automatic?.rect.h ?? 0)).toBeLessThan(segments[0]!.rect.w * segments[0]!.rect.h)
    expect(rectIsContainedBy(automatic!.rect, automatic!.regionRect)).toBe(true)
    expect(verticalProgress(automatic!.rect, segments[0]!.rect)).toBeGreaterThanOrEqual(0.25)
    expect(verticalProgress(automatic!.rect, segments[0]!.rect)).toBeLessThanOrEqual(0.45)

    const manualCue: TimedRangeCue = {
      ...cue,
      camera: { ...cue.camera!, labelPlacement: { mode: 'manual', frameOffset: 4, xRatio: 0.5, widthRatio: 0.4, heightFrames: 5 } },
    }
    const manual = cameraCueLabelLayoutForPage(standardA3SheetTemplate, page, manualCue, { widthPx: 1754, heightPx: 2481 }, segments)
    expect(manual).toMatchObject({ orientation: 'horizontal', manual: true, overflow: false })
    expect(manual?.rect.x).toBeCloseTo(segments[0]!.regionRect.x + segments[0]!.regionRect.w * 0.5)
    expect(manual?.rect.h).toBeCloseTo(segments[0]!.rowHeight * 5)
    expect(manual?.connector?.to).toEqual({
      x: manual!.rect.x + manual!.rect.w / 2,
      y: manual!.rect.y + manual!.rect.h / 2,
    })
  })

  it('keeps a fade label inside its interval and permits overlap with its own drawing', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_fade', role: 'camera', laneId: 'camera_lane_2', frameStart: 1, frameEnd: 18, label: 'FI撮影指示', text: '', source: 'manual',
      camera: { shape: 'fade-in', startLabel: '', endLabel: '' },
    }
    const layout = buildCameraCuePageLayouts(standardA3SheetTemplate, page, [cue], { widthPx: 1754, heightPx: 2481 }, { paperTracks })[0]
    expect(layout?.segments).toHaveLength(1)
    expect(layout?.label).not.toBeNull()
    expect(layout?.label?.rect).not.toEqual(layout?.segments[0]?.rect)
    expect(intersectionArea(layout!.label!.rect, layout!.segments[0]!.rect)).toBeGreaterThan(0)
    expect(verticalProgress(layout!.label!.rect, layout!.segments[0]!.rect)).toBeGreaterThanOrEqual(0.25)
    expect(verticalProgress(layout!.label!.rect, layout!.segments[0]!.rect)).toBeLessThanOrEqual(0.5)
    expect(rectIsContainedBy(layout!.label!.rect, layout!.label!.regionRect)).toBe(true)
  })

  it('uses a one-line layout for a short interval without treating it as overflow', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_short', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 2,
      label: 'PAN', text: '', source: 'manual', camera: { shape: 'range', startLabel: '', endLabel: '' },
    }
    const layout = buildCameraCuePageLayouts(standardA3SheetTemplate, page, [cue], { widthPx: 1754, heightPx: 2481 }, { paperTracks })[0]!
    expect(layout.label).toMatchObject({ orientation: 'horizontal', overflow: false })
    expect(verticalProgress(layout.label!.rect, layout.segments[0]!.rect)).toBeCloseTo(0.5)
    expect(rectIsContainedBy(layout.label!.rect, layout.label!.regionRect)).toBe(true)
  })

  it('protects the single OL crossing while placing its label toward the start side', () => {
    const cue = { ...overlapCue(1, 24, 12), label: 'E2E OL' }
    const layout = buildCameraCuePageLayouts(standardA3SheetTemplate, page, [cue], { widthPx: 1754, heightPx: 2481 }, { paperTracks })[0]!
    const segment = layout.segments[0]!
    const label = layout.label!
    const pivot = cameraOverlapPathsForSegment(cue, segment)[0]![1]!

    expect(label.orientation).toBe('vertical')
    expect(label.overflow).toBe(false)
    expect(rectContainsPoint(label.rect, pivot)).toBe(false)
    expect(verticalProgress(label.rect, segment.rect)).toBeGreaterThanOrEqual(0.2)
    expect(verticalProgress(label.rect, segment.rect)).toBeLessThanOrEqual(0.45)
    expect(rectIsContainedBy(label.rect, label.regionRect)).toBe(true)
  })

  it('reports impossible text without allowing its box to leave the CAMERA region', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_overflow', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24,
      label: '非常に長いCAMERA指示'.repeat(100), text: '', source: 'manual',
      camera: { shape: 'range', startLabel: '', endLabel: '' },
    }
    const layout = buildCameraCuePageLayouts(standardA3SheetTemplate, page, [cue], { widthPx: 1754, heightPx: 2481 }, { paperTracks })[0]!.label!
    expect(layout.overflow).toBe(true)
    expect(rectIsContainedBy(layout.rect, layout.regionRect)).toBe(true)
    expect(layout.fontSizePx).toBe(defaultTimingTextFontSizePx(standardA3SheetTemplate, 'cell'))
  })

  it('draws an even overlap on the boundary after its anchor with a 0.65-grid pivot mark', () => {
    const cue = overlapCue(1, 24, 12)
    const segment = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })[0]!
    const [forward = [], reverse = []] = cameraOverlapPathsForSegment(cue, segment)
    const mark = cameraOverlapPivotMarkForSegment(cue, segment)!
    const centerX = segment.rect.x + segment.rect.w / 2
    const pivotY = segment.rect.y + 12 * segment.rowHeight

    expect(cameraOverlapPivotPosition(cue)).toBe(13)
    expect(forward).toHaveLength(3)
    expect(reverse).toHaveLength(3)
    expect(forward.map(point => point.x)).toEqual([
      segment.rect.x,
      centerX,
      segment.rect.x + segment.rect.w,
    ])
    expect(reverse.map(point => point.x)).toEqual([
      segment.rect.x + segment.rect.w,
      centerX,
      segment.rect.x,
    ])
    expect(forward[1]).toEqual({ x: centerX, y: pivotY })
    expect(reverse[1]).toEqual({ x: centerX, y: pivotY })
    expect(sharedPathPoints(forward, reverse)).toEqual([{ x: centerX, y: pivotY }])
    expect(mark.y).toBeCloseTo(pivotY)
    expect((mark.x1 + mark.x2) / 2).toBeCloseTo(centerX)
    expect((mark.x2 - mark.x1) / segment.rect.w).toBeCloseTo(CAMERA_OVERLAP_PIVOT_MARK_GRID_RATIO)
    const fills = cameraOverlapFillPolygonsForSegment(cue, segment)
    expect(fills).toHaveLength(2)
    expect(fills[0]).toEqual([forward[0], reverse[0], reverse[1], forward[1]])
    expect(fills[1]).toEqual([forward[1], reverse[1], reverse[2], forward[2]])
  })

  it('sizes range endpoint triangles from the resolved template grid', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_marker', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 12,
      label: 'PAN', text: '', source: 'manual', camera: { shape: 'range', startLabel: '', endLabel: '' },
    }
    const segment = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })[0]!
    const marker = cameraRangeMarkerGeometryForSegment(segment, { widthPx: 1754, heightPx: 2481 })
    expect(marker.height / segment.rowHeight).toBeCloseTo(CAMERA_RANGE_MARKER_HEIGHT_GRID_RATIO)
    expect(marker.width / segment.rect.w).toBeLessThanOrEqual(CAMERA_RANGE_MARKER_WIDTH_GRID_RATIO + 0.000001)
    expect(marker.start).toHaveLength(3)
    expect(marker.end).toHaveLength(3)
    expect(marker.start[2]!.x).toBeCloseTo(segment.rect.x + segment.rect.w / 2)
    expect(marker.end[2]!.x).toBeCloseTo(segment.rect.x + segment.rect.w / 2)
    expect(marker.start[2]!.y - segment.rect.y).toBeLessThanOrEqual(segment.rowHeight)
  })

  it('connects wave paths to the triangle tips and switches style at intermediate points', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_wave', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24,
      label: 'Follow', text: '', source: 'manual',
      camera: {
        shape: 'range',
        pathStyle: 'wave',
        points: [{ pointId: 'mid', role: 'intermediate', frameOffset: 11, label: 'B' }],
        segmentStyles: [
          { endPointId: 'mid', style: 'straight' },
          { endPointId: 'cue-end', style: 'wave' },
        ],
      },
    }
    const pageSize = { widthPx: 1754, heightPx: 2481 }
    const segment = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })[0]!
    const marker = cameraRangeMarkerGeometryForSegment(segment, pageSize)
    const paths = cameraRangePathsForSegment(cue, segment, pageSize)

    expect(paths.map(path => [path.endPointId, path.style])).toEqual([
      ['mid', 'straight'],
      ['cue-end', 'wave'],
    ])
    expect(paths[0]?.commands[0]).toMatchObject({ kind: 'move', y: marker.start[2]?.y })
    expect(paths[1]?.commands.at(-1)).toMatchObject({ y: marker.end[2]?.y })
    expect(cameraRangePathData(paths[0]!.commands)).toContain(' L ')
    expect(cameraRangePathData(paths[1]!.commands)).toContain(' C ')
    expect(paths[0]?.commands.at(-1)?.y).toBeCloseTo(paths[1]?.commands[0]?.y ?? 0)
  })

  it('draws an odd overlap at the center of its anchor frame', () => {
    const cue = overlapCue(1, 23, 12)
    const segment = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })[0]!
    const [forward = [], reverse = []] = cameraOverlapPathsForSegment(cue, segment)
    const mark = cameraOverlapPivotMarkForSegment(cue, segment)!
    const centerX = segment.rect.x + segment.rect.w / 2
    const pivotY = segment.rect.y + 11.5 * segment.rowHeight

    expect(cameraOverlapPivotPosition(cue)).toBe(12.5)
    expect(forward[1]).toEqual({ x: centerX, y: pivotY })
    expect(reverse[1]).toEqual({ x: centerX, y: pivotY })
    expect(mark.y).toBeCloseTo(pivotY)
  })

  it('preserves one logical overlap crossing when A3 columns and pages clip the instruction', () => {
    const columnCue = overlapCue(70, 76, 73)
    const columnSegments = cameraCueSegmentsForPage(standardA3SheetTemplate, page, columnCue, { paperTracks })
    expect(columnSegments).toHaveLength(2)
    expect(columnSegments.flatMap(segment => {
      const [forward = [], reverse = []] = cameraOverlapPathsForSegment(columnCue, segment)
      return sharedPathPoints(forward, reverse)
    })).toHaveLength(1)

    const pages = createSheetPages(standardA3SheetTemplate, 288, 1)
    const pageCue = overlapCue(140, 150, 145)
    const pageSegments = pages.flatMap(sheetPage => cameraCueSegmentsForPage(
      standardA3SheetTemplate,
      sheetPage,
      pageCue,
      { paperTracks },
    ))
    expect(pageSegments).toHaveLength(2)
    expect(pageSegments.flatMap(segment => {
      const [forward = [], reverse = []] = cameraOverlapPathsForSegment(pageCue, segment)
      return sharedPathPoints(forward, reverse)
    })).toHaveLength(1)
  })

  it('uses the template timing-cell font size as the CAMERA label base size', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_font', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24, label: 'PAN', text: '', source: 'manual',
      camera: { shape: 'range', startLabel: '', endLabel: '' },
    }
    const standardSegments = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })
    const standard = cameraCueLabelLayoutForPage(standardA3SheetTemplate, page, cue, { widthPx: 1754, heightPx: 2481 }, standardSegments)
    expect(standard?.fontSizePx).toBe(defaultTimingTextFontSizePx(standardA3SheetTemplate, 'cell'))
    expect(standard?.fontSizePx).toBe(18)

    const customTemplate = {
      ...standardA3SheetTemplate,
      regions: standardA3SheetTemplate.regions.map(region => region.grid?.role === 'cell'
        ? { ...region, grid: { ...region.grid, typography: { ...region.grid.typography, cellFontSize: { value: 26, unit: 'px' as const } } } }
        : region),
    }
    const customPage = createSheetPages(customTemplate, 144, 1)[0]!
    const customSegments = cameraCueSegmentsForPage(customTemplate, customPage, cue, { paperTracks })
    const custom = cameraCueLabelLayoutForPage(customTemplate, customPage, cue, { widthPx: 1754, heightPx: 2481 }, customSegments)
    expect(custom?.fontSizePx).toBe(defaultTimingTextFontSizePx(customTemplate, 'cell'))
    expect(custom?.fontSizePx).toBe(26)
  })

  it('anchors CAMERA point labels to exact frames and clamps them inside the CAMERA region', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_points', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24, label: 'PAN', text: '', source: 'manual',
      camera: {
        shape: 'range',
        points: [
          { pointId: 'start', role: 'start', frameOffset: 0, label: 'START' },
          { pointId: 'mid', role: 'intermediate', frameOffset: 11, label: 'MID' },
          { pointId: 'end', role: 'end', frameOffset: 23, label: 'END' },
        ],
      },
    }
    const segments = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })
    const layouts = cameraCuePointLayoutsForPage(standardA3SheetTemplate, cue, segments, { widthPx: 1754, heightPx: 2481 })
    expect(layouts.map(layout => layout.frame)).toEqual([1, 12, 24])
    expect(layouts.every(layout => layout.fontSizePx === defaultTimingTextFontSizePx(standardA3SheetTemplate, 'cell'))).toBe(true)
    expect(layouts.every(layout => layout.rect.x >= layout.regionRect.x
      && layout.rect.x + layout.rect.w <= layout.regionRect.x + layout.regionRect.w)).toBe(true)
  })
})

function overlapCue(frameStart: number, frameEnd: number, pivotAnchorFrame: number): TimedRangeCue {
  return {
    cueId: `cue_overlap_${frameStart}_${frameEnd}`,
    role: 'camera',
    laneId: 'camera_lane_1',
    frameStart,
    frameEnd,
    label: 'OL',
    text: '',
    source: 'manual',
    camera: { shape: 'overlap', startLabel: '', endLabel: '', pivotAnchorFrame },
  }
}

function sharedPathPoints(
  left: Array<{ x: number; y: number }>,
  right: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  return left.filter(point => right.some(candidate =>
    Math.abs(candidate.x - point.x) < 0.0000001
    && Math.abs(candidate.y - point.y) < 0.0000001,
  ))
}

function verticalProgress(rect: { y: number; h: number }, cueRect: { y: number; h: number }): number {
  return (rect.y + rect.h / 2 - cueRect.y) / cueRect.h
}

function rectIsContainedBy(rect: { x: number; y: number; w: number; h: number }, region: { x: number; y: number; w: number; h: number }): boolean {
  return rect.x >= region.x - 0.0000001
    && rect.y >= region.y - 0.0000001
    && rect.x + rect.w <= region.x + region.w + 0.0000001
    && rect.y + rect.h <= region.y + region.h + 0.0000001
}

function rectContainsPoint(rect: { x: number; y: number; w: number; h: number }, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
}

function intersectionArea(left: { x: number; y: number; w: number; h: number }, right: { x: number; y: number; w: number; h: number }): number {
  const width = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return width * height
}
