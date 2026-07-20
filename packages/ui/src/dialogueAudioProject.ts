import type { CutGroupProjectDocument } from '@xsheet-remap/core'

export const DIALOGUE_AUDIO_EXTENSION = 'xsheet-remap.dialogue-audio'
export const DIALOGUE_AUDIO_SCHEMA_VERSION = 1

export interface DialogueSpeechRange {
  frameStart: number
  frameEnd: number
}

export interface DialogueAudioTrackState {
  trackId: string
  name: string
  color: string
  audioDataUrl?: string
  audioStartFrame: number
  durationFrames: number
  waveform: number[]
  speechRanges: DialogueSpeechRange[]
  muted: boolean
  solo: boolean
}

export interface DialogueAudioCutState {
  activeTrackId: string
  detectionSensitivity: number
  tracks: DialogueAudioTrackState[]
}

const TRACK_COLORS = ['#d7855f', '#5f9aaa', '#8a82b5']

export function createDefaultDialogueAudioCutState(frameOrigin: number): DialogueAudioCutState {
  const tracks = TRACK_COLORS.map((color, index): DialogueAudioTrackState => ({
    trackId: `dialogue-${index + 1}`,
    name: `セリフ ${index + 1}`,
    color,
    audioStartFrame: Math.round(frameOrigin),
    durationFrames: 0,
    waveform: [],
    speechRanges: [],
    muted: false,
    solo: false,
  }))
  return { activeTrackId: tracks[0].trackId, detectionSensitivity: 0.52, tracks }
}

export function dialogueAudioCutStateFromDocument(
  document: CutGroupProjectDocument,
  cutId: string,
  frameOrigin: number,
): DialogueAudioCutState {
  const fallback = createDefaultDialogueAudioCutState(frameOrigin)
  const extension = document.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  if (!extension || extension.schemaVersion !== DIALOGUE_AUDIO_SCHEMA_VERSION || !isRecord(extension.data)) return fallback
  const cuts = isRecord(extension.data.cuts) ? extension.data.cuts : null
  return normalizeCutState(cuts?.[cutId], fallback)
}

export function updateDialogueAudioCutStateInDocument(
  document: CutGroupProjectDocument,
  cutId: string,
  cutState: DialogueAudioCutState,
  frameOrigin: number,
): CutGroupProjectDocument {
  const extension = document.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  const currentData = extension?.schemaVersion === DIALOGUE_AUDIO_SCHEMA_VERSION && isRecord(extension.data)
    ? extension.data
    : {}
  const currentCuts = isRecord(currentData.cuts) ? currentData.cuts : {}
  const normalized = normalizeCutState(cutState, createDefaultDialogueAudioCutState(frameOrigin))
  return {
    ...document,
    extensions: {
      ...document.extensions,
      [DIALOGUE_AUDIO_EXTENSION]: {
        schemaVersion: DIALOGUE_AUDIO_SCHEMA_VERSION,
        data: { ...currentData, cuts: { ...currentCuts, [cutId]: normalized } },
      },
    },
  }
}

function normalizeCutState(value: unknown, fallback: DialogueAudioCutState): DialogueAudioCutState {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return fallback
  const rawTracks = value.tracks
  const tracks = fallback.tracks.map((defaultTrack, index) => normalizeTrackState(rawTracks[index], defaultTrack))
  const activeTrackId = typeof value.activeTrackId === 'string' && tracks.some(track => track.trackId === value.activeTrackId)
    ? value.activeTrackId
    : tracks[0].trackId
  return {
    activeTrackId,
    detectionSensitivity: clampNumber(value.detectionSensitivity, 0, 1, fallback.detectionSensitivity),
    tracks,
  }
}

function normalizeTrackState(value: unknown, fallback: DialogueAudioTrackState): DialogueAudioTrackState {
  if (!isRecord(value)) return fallback
  const speechRanges = Array.isArray(value.speechRanges)
    ? value.speechRanges.flatMap(range => {
      if (!isRecord(range)) return []
      const frameStart = integer(range.frameStart, Number.NaN)
      const frameEnd = integer(range.frameEnd, Number.NaN)
      return Number.isFinite(frameStart) && Number.isFinite(frameEnd) && frameEnd >= frameStart
        ? [{ frameStart, frameEnd }]
        : []
    })
    : []
  const waveform = Array.isArray(value.waveform)
    ? value.waveform.slice(0, 4096).map(sample => clampNumber(sample, 0, 1, 0))
    : []
  return {
    trackId: fallback.trackId,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 32) : fallback.name,
    color: typeof value.color === 'string' && value.color ? value.color : fallback.color,
    audioDataUrl: typeof value.audioDataUrl === 'string' && value.audioDataUrl.startsWith('data:audio/') ? value.audioDataUrl : undefined,
    audioStartFrame: integer(value.audioStartFrame, fallback.audioStartFrame),
    durationFrames: Math.max(0, integer(value.durationFrames, 0)),
    waveform,
    speechRanges,
    muted: value.muted === true,
    solo: value.solo === true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}
