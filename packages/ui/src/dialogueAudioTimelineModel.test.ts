import { describe, expect, it } from 'vitest'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import {
  DIALOGUE_AUDIO_MAX_TRACK_HEIGHT,
  DIALOGUE_AUDIO_MIN_TRACK_HEIGHT,
  clampDialogueAudioTrackHeight,
  effectiveDialogueAudioPixelsPerFrame,
  ensureDialogueAudioTimelineDuration,
  fitDialogueAudioPixelsPerFrame,
} from './dialogueAudioTimelineModel'

describe('dialogue audio timeline view model', () => {
  it('fits the complete independent audio duration to the available viewport', () => {
    expect(fitDialogueAudioPixelsPerFrame(960, 240)).toBe(4)
    expect(fitDialogueAudioPixelsPerFrame(960, 9600)).toBe(0.1)
    expect(effectiveDialogueAudioPixelsPerFrame({
      fitTimeline: true,
      pixelsPerFrame: 12,
      trackHeights: {},
    }, 960, 240)).toBe(4)
  })

  it('clamps arbitrary track heights to usable limits', () => {
    expect(clampDialogueAudioTrackHeight(10)).toBe(DIALOGUE_AUDIO_MIN_TRACK_HEIGHT)
    expect(clampDialogueAudioTrackHeight(120)).toBe(120)
    expect(clampDialogueAudioTrackHeight(999)).toBe(DIALOGUE_AUDIO_MAX_TRACK_HEIGHT)
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
