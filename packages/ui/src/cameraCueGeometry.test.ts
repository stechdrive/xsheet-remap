import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { buildCameraCuePageLayouts, cameraCueLabelLayoutForPage, cameraCueSegmentsForPage } from './cameraCueGeometry'

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
})
