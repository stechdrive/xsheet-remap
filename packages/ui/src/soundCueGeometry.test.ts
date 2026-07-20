import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { buildSoundCuePageTextLayouts, buildSoundCueTextLayout, soundCueSegmentsForPage } from './soundCueGeometry'
import { createCanvasTextMeasurementProvider } from './textMetrics'

describe('SOUND cue geometry', () => {
  it('splits an interval at the two A3 SOUND regions while preserving one lane', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const cue: TimedRangeCue = {
      cueId: 'cue_1', role: 'sound', laneId: 'sound_lane_1', frameStart: 70, frameEnd: 76, label: 'アキラ', text: '続く', source: 'manual',
    }
    const segments = soundCueSegmentsForPage(standardA3SheetTemplate, page, cue, {
      paperTracks: createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack),
    })
    expect(segments.map(segment => [segment.regionId, segment.frameStart, segment.frameEnd, segment.startsCue, segment.endsCue])).toEqual([
      ['left_sound_grid', 70, 72, true, false],
      ['right_sound_grid', 73, 76, false, true],
    ])
  })

  it('flows dialogue once across folded A3 segments instead of repeating it in every segment', () => {
    const pages = createSheetPages(standardA3SheetTemplate, 144, 1)
    const cue: TimedRangeCue = {
      cueId: 'cue_folded', role: 'sound', laneId: 'sound_lane_1', frameStart: 70, frameEnd: 76,
      label: 'アキラ', text: '折り返して一度だけ表示', source: 'manual',
    }
    const layouts = buildSoundCuePageTextLayouts(
      standardA3SheetTemplate,
      pages,
      [cue],
      { widthPx: 1754, heightPx: 2481 },
      { paperTracks: createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack) },
    )

    expect(layouts.map(item => [item.segment.regionId, item.segment.frameStart, item.segment.frameEnd])).toEqual([
      ['left_sound_grid', 70, 72],
      ['right_sound_grid', 73, 76],
    ])
    expect(layouts.every(item => item.textLayout.textGlyphs.length > 0)).toBe(true)
    expect(layouts.flatMap(item => item.textLayout.textGlyphs).map(glyph => glyph.value).join('')).toBe(cue.text)
    expect(layouts.flatMap(item => item.textLayout.labelGlyphs).map(glyph => glyph.value).join('')).toBe(cue.label)
  })

  it('continues the same dialogue flow across A3 pages without restarting the text', () => {
    const pages = createSheetPages(standardA3SheetTemplate, 288, 1)
    const cue: TimedRangeCue = {
      cueId: 'cue_paged', role: 'sound', laneId: 'sound_lane_1', frameStart: 140, frameEnd: 150,
      label: 'ミナ', text: 'ページをまたいでも一度だけ表示', source: 'manual',
    }
    const layouts = buildSoundCuePageTextLayouts(
      standardA3SheetTemplate,
      pages,
      [cue],
      { widthPx: 1754, heightPx: 2481 },
      { paperTracks: createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack) },
    )

    expect(new Set(layouts.map(item => item.pageId)).size).toBe(2)
    expect(layouts.flatMap(item => item.textLayout.textGlyphs).map(glyph => glyph.value).join('')).toBe(cue.text)
    expect(layouts.flatMap(item => item.textLayout.labelGlyphs).map(glyph => glyph.value).join('')).toBe(cue.label)
  })

  it('never ellipsizes a label and middle-ellipsizes dialogue only when physically necessary', () => {
    const layout = buildSoundCueTextLayout(
      { x: 0.1, y: 0.1, w: 0.02, h: 0.03 },
      { widthPx: 1000, heightPx: 1000 },
      'とても長いキャラクター名',
      'これはとても長いセリフです',
      { fontSizePx: 14, minFontSizePx: 6 },
    )
    expect(layout.labelOrientation).toBe('vertical')
    expect(layout.labelGlyphs.map(glyph => glyph.value).join('')).toBe('とても長いキャラクター名')
    expect(layout.overflowLabel).toBe(true)
    expect(layout.textGlyphs).toEqual([])

    const dialogue = buildSoundCueTextLayout(
      { x: 0.1, y: 0.1, w: 0.06, h: 0.08 },
      { widthPx: 1000, heightPx: 1000 },
      'A',
      'あいうえおかきくけこさしすせそ',
      { fontSizePx: 14, minFontSizePx: 8 },
    )
    expect(dialogue.truncatedText).toBe(true)
    expect(dialogue.textGlyphs.map(glyph => glyph.value)).toContain('…')
  })

  it('places the label outside the interval by default while keeping dialogue inside', () => {
    const layout = buildSoundCueTextLayout(
      { x: 0.2, y: 0.3, w: 0.04, h: 0.1 },
      { widthPx: 1000, heightPx: 1000 },
      'アキラ',
      '走れ！',
      { regionRect: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 } },
    )
    expect(layout.labelPlacement).toBe('outside')
    expect(layout.labelOrientation).toBe('horizontal')
    expect(layout.labelBoundsPx!.yPx + layout.labelBoundsPx!.heightPx).toBeLessThan(300)
    expect(layout.labelGlyphs.every(glyph => glyph.yPx < 300)).toBe(true)
    expect(layout.textGlyphs.every(glyph => glyph.yPx > 300)).toBe(true)
  })

  it('uses an outside vertical label when the horizontal area is occupied', () => {
    const layout = buildSoundCueTextLayout(
      { x: 0.2, y: 0.3, w: 0.04, h: 0.1 },
      { widthPx: 1000, heightPx: 1000 },
      'アキラ',
      '走れ！',
      {
        regionRect: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 },
        occupiedRects: [{ x: 0.195, y: 0.282, w: 0.014, h: 0.012 }],
      },
    )
    expect(layout.labelPlacement).toBe('outside')
    expect(layout.labelOrientation).toBe('vertical')
    expect(layout.labelGlyphs.map(glyph => glyph.value).join('')).toBe('アキラ')
  })

  it('falls back inside when neither outside orientation has enough free space', () => {
    const crowded = buildSoundCueTextLayout(
      { x: 0.2, y: 0.3, w: 0.04, h: 0.1 },
      { widthPx: 1000, heightPx: 1000 },
      'アキラ',
      '走れ！',
      {
        regionRect: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 },
        occupiedRects: [{ x: 0.19, y: 0.24, w: 0.06, h: 0.06 }],
      },
    )
    expect(crowded.labelPlacement).toBe('inside')
  })

  it('allows vertical overflow while keeping outside label bounds inside the SOUND column horizontally', () => {
    const atRegionStart = buildSoundCueTextLayout(
      { x: 0.2, y: 0.1, w: 0.04, h: 0.1 },
      { widthPx: 1000, heightPx: 1000 },
      'とても長いキャラクター名',
      '走れ！',
      { regionRect: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 } },
    )
    expect(atRegionStart.labelPlacement).toBe('outside')
    expect(atRegionStart.labelBoundsPx!.yPx).toBeLessThan(100)
    expect(atRegionStart.labelBoundsPx!.xPx).toBeGreaterThanOrEqual(100)
    expect(atRegionStart.labelBoundsPx!.xPx + atRegionStart.labelBoundsPx!.widthPx).toBeLessThanOrEqual(400)
  })

  it('uses measured font width instead of a character-count estimate when choosing orientation', () => {
    const textMeasurement = createCanvasTextMeasurementProvider(() => ({
      font: '',
      measureText: () => ({ width: 80, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }) as TextMetrics,
    }))
    const layout = buildSoundCueTextLayout(
      { x: 0.2, y: 0.3, w: 0.03, h: 0.1 },
      { widthPx: 1000, heightPx: 1000 },
      'WW',
      '',
      {
        regionRect: { x: 0.18, y: 0.1, w: 0.06, h: 0.6 },
        textMeasurement,
      },
    )

    expect(layout.labelPlacement).toBe('outside')
    expect(layout.labelOrientation).toBe('vertical')
    expect(layout.labelGlyphs.map(glyph => glyph.value)).toEqual(['W', 'W'])
  })
})
