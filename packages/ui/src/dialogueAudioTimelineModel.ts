import type { DialogueAudioClip, DialogueAudioCutState } from './dialogueAudioProject'

export const DIALOGUE_AUDIO_MIN_PIXELS_PER_FRAME = 0.5
export const DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME = 24
export const DIALOGUE_AUDIO_DEFAULT_PIXELS_PER_FRAME = 4
export const DIALOGUE_AUDIO_MIN_TRACK_HEIGHT = 52
export const DIALOGUE_AUDIO_MAX_TRACK_HEIGHT = 196
export const DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT = 88
export const DIALOGUE_AUDIO_MIN_PANEL_HEIGHT = 180
export const DIALOGUE_AUDIO_MAX_PANEL_HEIGHT = 720
export const DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT = 480

const VIEW_PREFERENCE_KEY = 'xsheet:editor:dialogue-audio-view-v1'
const RULER_MIN_SECOND_LABEL_SPACING = 38
const RULER_MIN_FRAME_LABEL_SPACING = 12

export type DialogueAudioTrackHeightPreset = 'small' | 'medium' | 'large'

export interface DialogueAudioViewPreferences {
  fitTimeline: boolean
  pixelsPerFrame: number
  panelHeight: number
  trackHeights: Record<string, number>
}

export interface DialogueAudioRulerPlan {
  secondTicks: Array<{ offsetFrames: number; second: number }>
  frameTicks: Array<{ offsetFrames: number; frameInSecond: number }>
}

export interface DialogueAudioPlaybackSegment {
  timelineFrameStart: number
  delaySeconds: number
  sourceOffsetSeconds: number
  durationSeconds: number
}

export const DIALOGUE_AUDIO_TRACK_HEIGHT_PRESETS: Record<DialogueAudioTrackHeightPreset, number> = {
  small: 60,
  medium: DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT,
  large: 132,
}

export function defaultDialogueAudioViewPreferences(): DialogueAudioViewPreferences {
  return {
    fitTimeline: true,
    pixelsPerFrame: DIALOGUE_AUDIO_DEFAULT_PIXELS_PER_FRAME,
    panelHeight: DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT,
    trackHeights: {},
  }
}

export function loadDialogueAudioViewPreferences(): DialogueAudioViewPreferences {
  const fallback = defaultDialogueAudioViewPreferences()
  if (typeof localStorage === 'undefined') return fallback
  try {
    const value = JSON.parse(localStorage.getItem(VIEW_PREFERENCE_KEY) ?? '') as Partial<DialogueAudioViewPreferences>
    const trackHeights = Object.fromEntries(
      Object.entries(value.trackHeights ?? {}).map(([trackId, height]) => [trackId, clampDialogueAudioTrackHeight(height)]),
    )
    return {
      fitTimeline: value.fitTimeline !== false,
      pixelsPerFrame: clampDialogueAudioPixelsPerFrame(value.pixelsPerFrame ?? fallback.pixelsPerFrame),
      panelHeight: clampDialogueAudioPanelHeight(value.panelHeight),
      trackHeights,
    }
  } catch {
    return fallback
  }
}

export function saveDialogueAudioViewPreferences(value: DialogueAudioViewPreferences): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(VIEW_PREFERENCE_KEY, JSON.stringify(value))
  } catch {
    // Storage may be disabled. View settings are deliberately non-project state.
  }
}

export function clampDialogueAudioTrackHeight(value: unknown): number {
  const height = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT
  return Math.max(DIALOGUE_AUDIO_MIN_TRACK_HEIGHT, Math.min(DIALOGUE_AUDIO_MAX_TRACK_HEIGHT, height))
}

export function clampDialogueAudioPixelsPerFrame(value: number): number {
  return Math.max(DIALOGUE_AUDIO_MIN_PIXELS_PER_FRAME, Math.min(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME, value))
}

export function clampDialogueAudioPanelHeight(value: unknown, maximum = DIALOGUE_AUDIO_MAX_PANEL_HEIGHT): number {
  const height = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DIALOGUE_AUDIO_DEFAULT_PANEL_HEIGHT
  return Math.max(DIALOGUE_AUDIO_MIN_PANEL_HEIGHT, Math.min(Math.max(DIALOGUE_AUDIO_MIN_PANEL_HEIGHT, maximum), height))
}

export function fitDialogueAudioPixelsPerFrame(viewportWidth: number, durationFrames: number): number {
  return Math.max(0.01, Math.min(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME, Math.max(1, viewportWidth) / Math.max(1, durationFrames)))
}

export function effectiveDialogueAudioPixelsPerFrame(
  preference: DialogueAudioViewPreferences,
  viewportWidth: number,
  durationFrames: number,
): number {
  const fit = fitDialogueAudioPixelsPerFrame(viewportWidth, durationFrames)
  return preference.fitTimeline ? fit : Math.max(fit, clampDialogueAudioPixelsPerFrame(preference.pixelsPerFrame))
}

export function dialogueAudioZoomSliderValue(pixelsPerFrame: number, fittedPixelsPerFrame: number): number {
  const minimum = Math.max(0.01, Math.min(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME, fittedPixelsPerFrame))
  const value = Math.max(minimum, Math.min(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME, pixelsPerFrame))
  if (minimum >= DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME) return 100
  return Math.round(
    Math.log(value / minimum) / Math.log(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME / minimum) * 100,
  )
}

export function dialogueAudioPixelsPerFrameFromZoomSlider(value: number, fittedPixelsPerFrame: number): number {
  const minimum = Math.max(0.01, Math.min(DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME, fittedPixelsPerFrame))
  const position = Math.max(0, Math.min(100, value)) / 100
  if (minimum >= DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME) return DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME
  return minimum * ((DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME / minimum) ** position)
}

export function planDialogueAudioRulerTicks(
  durationFrames: number,
  fps: number,
  pixelsPerFrame: number,
): DialogueAudioRulerPlan {
  const safeDuration = Math.max(1, Math.round(durationFrames))
  const safeFps = Math.max(1, Math.round(fps))
  const safePixelsPerFrame = Math.max(0.01, pixelsPerFrame)
  const secondSpacing = safeFps * safePixelsPerFrame
  const secondStep = preferredRulerStep(RULER_MIN_SECOND_LABEL_SPACING / secondSpacing, [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  ])
  const secondTicks: DialogueAudioRulerPlan['secondTicks'] = []
  for (let second = 0; second * safeFps < safeDuration; second += secondStep) {
    secondTicks.push({ offsetFrames: second * safeFps, second })
  }

  const frameSteps = Array.from({ length: Math.max(0, safeFps - 1) }, (_, index) => index + 1)
    .filter(step => safeFps % step === 0)
  const frameStep = frameSteps.find(step => step * safePixelsPerFrame >= RULER_MIN_FRAME_LABEL_SPACING)
  const frameTicks: DialogueAudioRulerPlan['frameTicks'] = []
  if (frameStep) {
    for (let secondOffset = 0; secondOffset < safeDuration; secondOffset += safeFps) {
      for (let frameOffset = 0; frameOffset < safeFps && secondOffset + frameOffset < safeDuration; frameOffset += frameStep) {
        frameTicks.push({
          offsetFrames: secondOffset + frameOffset,
          frameInSecond: frameOffset + 1,
        })
      }
    }
  }
  return { secondTicks, frameTicks }
}

export function requiredDialogueAudioTimelineDuration(
  state: DialogueAudioCutState,
  frameOrigin: number,
  minimumDurationFrames: number,
): number {
  let frameEnd = frameOrigin + Math.max(1, minimumDurationFrames, state.timelineDurationFrames) - 1
  state.tracks.forEach(track => {
    track.clips.forEach(clip => {
      frameEnd = Math.max(frameEnd, clip.timelineStartFrame + clip.durationFrames - 1)
    })
    track.speechCandidates.forEach(candidate => {
      frameEnd = Math.max(frameEnd, candidate.frameEnd)
    })
  })
  return Math.max(1, frameEnd - frameOrigin + 1)
}

export function dialogueAudioContentEndFrame(state: DialogueAudioCutState): number | null {
  let frameEnd: number | null = null
  state.tracks.forEach(track => {
    track.clips.forEach(clip => {
      const clipFrameEnd = clip.timelineStartFrame + clip.durationFrames - 1
      frameEnd = frameEnd === null ? clipFrameEnd : Math.max(frameEnd, clipFrameEnd)
    })
  })
  return frameEnd
}

export function planDialogueAudioClipPlayback(
  clip: DialogueAudioClip,
  playbackFrameStartInput: number,
  playbackFrameEndInput: number,
  fpsInput: number,
  source: { sampleLength: number; sampleRate: number },
): DialogueAudioPlaybackSegment | null {
  const fps = Math.max(1, fpsInput)
  const sampleRate = Math.max(1, source.sampleRate)
  const sampleLength = Math.max(0, Math.round(source.sampleLength))
  const playbackFrameStart = Math.round(Math.min(playbackFrameStartInput, playbackFrameEndInput))
  const playbackFrameEnd = Math.round(Math.max(playbackFrameStartInput, playbackFrameEndInput))
  const clipFrameEnd = clip.timelineStartFrame + clip.durationFrames - 1
  const timelineFrameStart = Math.max(playbackFrameStart, clip.timelineStartFrame)
  const timelineFrameEnd = Math.min(playbackFrameEnd, clipFrameEnd)
  if (timelineFrameEnd < timelineFrameStart || sampleLength === 0) return null

  const sourceFrameStart = clip.sourceOffsetFrames + timelineFrameStart - clip.timelineStartFrame
  const sourceFrameEndExclusive = clip.sourceOffsetFrames + timelineFrameEnd - clip.timelineStartFrame + 1
  const sampleStart = clampInteger(Math.round(sourceFrameStart * sampleRate / fps), 0, sampleLength)
  const sampleEnd = clampInteger(Math.round(sourceFrameEndExclusive * sampleRate / fps), sampleStart, sampleLength)
  if (sampleEnd <= sampleStart) return null

  return {
    timelineFrameStart,
    delaySeconds: (timelineFrameStart - playbackFrameStart) / fps,
    sourceOffsetSeconds: sampleStart / sampleRate,
    durationSeconds: (sampleEnd - sampleStart) / sampleRate,
  }
}

export function ensureDialogueAudioTimelineDuration(
  state: DialogueAudioCutState,
  frameOrigin: number,
  minimumDurationFrames: number,
): DialogueAudioCutState {
  const timelineDurationFrames = requiredDialogueAudioTimelineDuration(state, frameOrigin, minimumDurationFrames)
  return timelineDurationFrames === state.timelineDurationFrames ? state : { ...state, timelineDurationFrames }
}

function preferredRulerStep(minimum: number, candidates: number[]): number {
  return candidates.find(candidate => candidate >= minimum) ?? Math.max(1, Math.ceil(minimum))
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
