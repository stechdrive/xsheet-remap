import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { buildSoundCueTextLayout, soundCueSegmentsForPage } from './soundCueGeometry'

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
})
