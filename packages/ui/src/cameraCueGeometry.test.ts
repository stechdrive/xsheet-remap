import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import {
  buildCameraCuePageLayouts,
  cameraCueLabelLayoutForPage,
  cameraCueSegmentsForPage,
  cameraOverlapPathsForSegment,
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
    expect(automatic?.rect).not.toEqual(segments[0]!.rect)
    expect((automatic?.rect.w ?? 0) * (automatic?.rect.h ?? 0)).toBeLessThan(segments[0]!.rect.w * segments[0]!.rect.h)

    const manualCue: TimedRangeCue = {
      ...cue,
      camera: { ...cue.camera!, labelPlacement: { mode: 'manual', frameOffset: 4, xRatio: 0.5, widthRatio: 0.4, heightFrames: 5 } },
    }
    const manual = cameraCueLabelLayoutForPage(standardA3SheetTemplate, page, manualCue, { widthPx: 1754, heightPx: 2481 }, segments)
    expect(manual).toMatchObject({ orientation: 'horizontal', manual: true })
    expect(manual?.rect.x).toBeCloseTo(segments[0]!.regionRect.x + segments[0]!.regionRect.w * 0.5)
    expect(manual?.rect.h).toBeCloseTo(segments[0]!.rowHeight * 5)
  })

  it('places a fade instruction outside its shape and returns a connector to the cue', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_fade', role: 'camera', laneId: 'camera_lane_2', frameStart: 1, frameEnd: 18, label: 'FI撮影指示', text: '', source: 'manual',
      camera: { shape: 'fade-in', startLabel: '', endLabel: '' },
    }
    const layout = buildCameraCuePageLayouts(standardA3SheetTemplate, page, [cue], { widthPx: 1754, heightPx: 2481 }, { paperTracks })[0]
    expect(layout?.segments).toHaveLength(1)
    expect(layout?.label).not.toBeNull()
    expect(layout?.label?.rect).not.toEqual(layout?.segments[0]?.rect)
    expect(layout?.label?.connector).toBeTruthy()
  })

  it('draws a 24-frame overlap with exactly one crossing at the editable pivot', () => {
    const cue = overlapCue(1, 24, 12)
    const segment = cameraCueSegmentsForPage(standardA3SheetTemplate, page, cue, { paperTracks })[0]!
    const [forward = [], reverse = []] = cameraOverlapPathsForSegment(cue, segment)
    const centerX = segment.rect.x + segment.rect.w / 2
    const pivotY = segment.rect.y + (cue.camera!.pivotFrame! - segment.frameStart + 0.5) * segment.rowHeight

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
        ? { ...region, grid: { ...region.grid, typography: { ...region.grid.typography, cellFontSizePx: 26 } } }
        : region),
    }
    const customPage = createSheetPages(customTemplate, 144, 1)[0]!
    const customSegments = cameraCueSegmentsForPage(customTemplate, customPage, cue, { paperTracks })
    const custom = cameraCueLabelLayoutForPage(customTemplate, customPage, cue, { widthPx: 1754, heightPx: 2481 }, customSegments)
    expect(custom?.fontSizePx).toBe(defaultTimingTextFontSizePx(customTemplate, 'cell'))
    expect(custom?.fontSizePx).toBe(26)
  })
})

function overlapCue(frameStart: number, frameEnd: number, pivotFrame: number): TimedRangeCue {
  return {
    cueId: `cue_overlap_${frameStart}_${frameEnd}`,
    role: 'camera',
    laneId: 'camera_lane_1',
    frameStart,
    frameEnd,
    label: 'OL',
    text: '',
    source: 'manual',
    camera: { shape: 'overlap', startLabel: '', endLabel: '', pivotFrame },
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
