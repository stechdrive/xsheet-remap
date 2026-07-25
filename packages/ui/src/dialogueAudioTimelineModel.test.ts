import { describe, expect, it } from 'vitest'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import {
  DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT,
  DIALOGUE_AUDIO_MAX_PANEL_HEIGHT,
  DIALOGUE_AUDIO_MIN_PANEL_HEIGHT,
  DIALOGUE_AUDIO_MAX_TRACK_HEIGHT,
  DIALOGUE_AUDIO_MIN_TRACK_HEIGHT,
  clampDialogueAudioPanelHeight,
  clampDialogueAudioTrackHeight,
  dialogueAudioPixelsPerFrameFromZoomSlider,
  dialogueAudioZoomSliderValue,
  effectiveDialogueAudioPixelsPerFrame,
  ensureDialogueAudioTimelineDuration,
  fitDialogueAudioPixelsPerFrame,
  planDialogueAudioRulerTicks,
} from './dialogueAudioTimelineModel'

describe('dialogue audio timeline view model', () => {
  it('fits the complete independent audio duration to the available viewport', () => {
    expect(fitDialogueAudioPixelsPerFrame(960, 240)).toBe(4)
    expect(fitDialogueAudioPixelsPerFrame(960, 9600)).toBe(0.1)
    expect(effectiveDialogueAudioPixelsPerFrame({
      fitTimeline: true,
      pixelsPerFrame: 12,
      panelHeight: DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT,
      trackHeights: {},
    }, 960, 240)).toBe(4)
  })

  it('clamps arbitrary track heights to usable limits', () => {
    expect(clampDialogueAudioTrackHeight(10)).toBe(DIALOGUE_AUDIO_MIN_TRACK_HEIGHT)
    expect(clampDialogueAudioTrackHeight(120)).toBe(120)
    expect(clampDialogueAudioTrackHeight(999)).toBe(DIALOGUE_AUDIO_MAX_TRACK_HEIGHT)
  })

  it('clamps the bottom panel height while allowing a compact scrollable view', () => {
    expect(clampDialogueAudioPanelHeight(undefined)).toBe(DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT)
    expect(clampDialogueAudioPanelHeight(40)).toBe(DIALOGUE_AUDIO_MIN_PANEL_HEIGHT)
    expect(clampDialogueAudioPanelHeight(900)).toBe(DIALOGUE_AUDIO_MAX_PANEL_HEIGHT)
    expect(clampDialogueAudioPanelHeight(600, 420)).toBe(420)
  })

  it('maps zoom to a unitless logarithmic slider', () => {
    expect(dialogueAudioZoomSliderValue(4, 4)).toBe(0)
    expect(dialogueAudioZoomSliderValue(24, 4)).toBe(100)
    const middlePixels = dialogueAudioPixelsPerFrameFromZoomSlider(50, 4)
    expect(dialogueAudioZoomSliderValue(middlePixels, 4)).toBe(50)
  })

  it('shows seconds separately and exposes as many in-second frame numbers as zoom allows', () => {
    const detailed = planDialogueAudioRulerTicks(48, 24, 24)
    expect(detailed.secondTicks).toEqual([
      { offsetFrames: 0, second: 0 },
      { offsetFrames: 24, second: 1 },
    ])
    expect(detailed.frameTicks.slice(0, 25)).toEqual([
      ...Array.from({ length: 24 }, (_, index) => ({ offsetFrames: index, frameInSecond: index + 1 })),
      { offsetFrames: 24, frameInSecond: 1 },
    ])

    const fitted = planDialogueAudioRulerTicks(48, 24, 4)
    expect(fitted.frameTicks.slice(0, 4)).toEqual([
      { offsetFrames: 0, frameInSecond: 1 },
      { offsetFrames: 3, frameInSecond: 4 },
      { offsetFrames: 6, frameInSecond: 7 },
      { offsetFrames: 9, frameInSecond: 10 },
    ])

    const overview = planDialogueAudioRulerTicks(2400, 24, 0.5)
    expect(overview.secondTicks.slice(0, 3)).toEqual([
      { offsetFrames: 0, second: 0 },
      { offsetFrames: 120, second: 5 },
      { offsetFrames: 240, second: 10 },
    ])
    expect(overview.frameTicks).toEqual([])
  })

  it('expands to the furthest clip without shrinking an existing audio duration', () => {
    const state = createDefaultDialogueAudioCutState(1, 72)
    state.timelineDurationFrames = 120
    state.assets = [{ assetId: 'asset', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 180, waveform: [] }]
    state.tracks[0].clips = [{
      clipId: 'clip',
      placementId: 'clip',
      assetId: 'asset',
      timelineStartFrame: 20,
      sourceOffsetFrames: 0,
      durationFrames: 180,
    }]

    expect(ensureDialogueAudioTimelineDuration(state, 1, 48).timelineDurationFrames).toBe(199)
  })
})
