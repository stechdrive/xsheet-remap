import type { DialogueAudioCutState } from './dialogueAudioProject'

export const DIALOGUE_AUDIO_MIN_PIXELS_PER_FRAME = 0.5
export const DIALOGUE_AUDIO_MAX_PIXELS_PER_FRAME = 24
export const DIALOGUE_AUDIO_DEFAULT_PIXELS_PER_FRAME = 4
export const DIALOGUE_AUDIO_MIN_TRACK_HEIGHT = 52
export const DIALOGUE_AUDIO_MAX_TRACK_HEIGHT = 196
export const DIALOGUE_AUDIO_DEFAULT_TRACK_HEIGHT = 88

const VIEW_PREFERENCE_KEY = 'xsheet:editor:dialogue-audio-view-v1'

export type DialogueAudioTrackHeightPreset = 'small' | 'medium' | 'large'

export interface DialogueAudioViewPreferences {
  fitTimeline: boolean
  pixelsPerFrame: number
  trackHeights: Record<string, number>
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
  state.bindings.forEach(binding => {
    frameEnd = Math.max(frameEnd, binding.cueFrameEnd)
  })
  return Math.max(1, frameEnd - frameOrigin + 1)
}

export function ensureDialogueAudioTimelineDuration(
  state: DialogueAudioCutState,
  frameOrigin: number,
  minimumDurationFrames: number,
): DialogueAudioCutState {
  const timelineDurationFrames = requiredDialogueAudioTimelineDuration(state, frameOrigin, minimumDurationFrames)
  return timelineDurationFrames === state.timelineDurationFrames ? state : { ...state, timelineDurationFrames }
}
