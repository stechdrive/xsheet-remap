import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import {
  DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT,
  DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT,
  DIALOGUE_AUDIO_MAX_PANEL_HEIGHT,
  DIALOGUE_AUDIO_MIN_PANEL_HEIGHT,
  DIALOGUE_AUDIO_MAX_TRACK_HEIGHT,
  DIALOGUE_AUDIO_MIN_TRACK_HEIGHT,
  DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS,
  clampDialogueAudioPanelHeight,
  clampDialogueAudioTrackHeight,
  defaultDialogueAudioViewPreferences,
  dialogueAudioContentEndFrame,
  dialogueAudioPixelsPerFrameFromZoomSlider,
  dialogueAudioZoomSliderValue,
  effectiveDialogueAudioPixelsPerFrame,
  ensureDialogueAudioTimelineDuration,
  fitDialogueAudioPixelsPerFrame,
  loadDialogueAudioViewPreferences,
  planDialogueAudioClipPlayback,
  planDialogueAudioRulerTicks,
  saveDialogueAudioViewPreferences,
} from './dialogueAudioTimelineModel'

afterEach(() => {
  localStorage.clear()
})

describe('dialogue audio timeline view model', () => {
  it('starts with compact small tracks and migrates the former untouched panel default', () => {
    expect(defaultDialogueAudioViewPreferences()).toMatchObject({
      panelHeight: 288,
      trackHeights: {},
    })
    expect(DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT).toBe(DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.small)

    saveDialogueAudioViewPreferences({
      fitTimeline: true,
      pixelsPerFrame: 4,
      panelHeight: 480,
      trackHeights: {},
    })
    expect(loadDialogueAudioViewPreferences().panelHeight).toBe(DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT)

    saveDialogueAudioViewPreferences({
      fitTimeline: true,
      pixelsPerFrame: 4,
      panelHeight: 480,
      trackHeights: { 'dialogue-1': DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.large },
    })
    expect(loadDialogueAudioViewPreferences()).toMatchObject({
      panelHeight: 480,
      trackHeights: { 'dialogue-1': DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS.large },
    })
  })

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

  it('derives the audio content end only from placed clips', () => {
    const state = createDefaultDialogueAudioCutState(1, 144)
    expect(dialogueAudioContentEndFrame(state)).toBeNull()

    state.tracks[0].speechCandidates = [{ candidateId: 'candidate', frameStart: 120, frameEnd: 150, status: 'pending' }]
    state.tracks[0].clips = [{
      clipId: 'clip-a',
      placementId: 'clip-a',
      assetId: 'asset-a',
      timelineStartFrame: 10,
      sourceOffsetFrames: 0,
      durationFrames: 24,
    }]
    state.tracks[2].clips = [{
      clipId: 'clip-b',
      placementId: 'clip-b',
      assetId: 'asset-b',
      timelineStartFrame: 70,
      sourceOffsetFrames: 0,
      durationFrames: 12,
    }]

    expect(dialogueAudioContentEndFrame(state)).toBe(81)
  })

  it('does not extend the stored audio workspace merely because a linked timesheet cue is longer', () => {
    const state = createDefaultDialogueAudioCutState(1, 144)
    state.soundBindings = [{
      bindingId: 'binding',
      cueId: 'cue',
      revisionId: 'revision',
      members: [{
        memberId: 'member',
        regionRef: { trackId: 'dialogue-1', regionId: 'missing' },
      }],
      headPaddingFrames: 0,
      tailPaddingFrames: 0,
      status: 'orphaned',
    }]
    expect(ensureDialogueAudioTimelineDuration(state, 1, 1).timelineDurationFrames).toBe(1)
  })

  it('plans moved clip playback from its current timeline position after the cut is extended', () => {
    const segment = planDialogueAudioClipPlayback({
      clipId: 'moved',
      placementId: 'placement',
      assetId: 'asset',
      timelineStartFrame: 181,
      sourceOffsetFrames: 24,
      durationFrames: 48,
    }, 145, 288, 24, {
      sampleLength: 96_000,
      sampleRate: 48_000,
    })

    expect(segment).toEqual({
      timelineFrameStart: 181,
      delaySeconds: 1.5,
      sourceOffsetSeconds: 1,
      durationSeconds: 1,
    })
  })

  it('clamps a rounded final source frame to real PCM samples instead of scheduling an invalid range', () => {
    const segment = planDialogueAudioClipPlayback({
      clipId: 'tail',
      placementId: 'placement',
      assetId: 'asset',
      timelineStartFrame: 49,
      sourceOffsetFrames: 48,
      durationFrames: 1,
    }, 1, 96, 24, {
      sampleLength: 96_100,
      sampleRate: 48_000,
    })

    expect(segment).toEqual({
      timelineFrameStart: 49,
      delaySeconds: 2,
      sourceOffsetSeconds: 2,
      durationSeconds: 100 / 48_000,
    })
    expect(planDialogueAudioClipPlayback({
      clipId: 'past-tail',
      placementId: 'placement',
      assetId: 'asset',
      timelineStartFrame: 50,
      sourceOffsetFrames: 49,
      durationFrames: 1,
    }, 1, 96, 24, {
      sampleLength: 96_100,
      sampleRate: 48_000,
    })).toBeNull()
  })
})
