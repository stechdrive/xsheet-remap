import type { CutGroupProjectDocument } from '@xsheet-remap/core'

export const DIALOGUE_AUDIO_EXTENSION = 'xsheet-remap.dialogue-audio'
export const DIALOGUE_AUDIO_SCHEMA_VERSION = 2

export type DialogueSpeechCandidateStatus = 'pending' | 'linked' | 'ignored' | 'review'

export interface DialogueCandidateCueLink {
  revisionId: string
  cueId: string
}

export interface DialogueSpeechRange {
  frameStart: number
  frameEnd: number
}

export interface DialogueSpeechCandidate extends DialogueSpeechRange {
  candidateId: string
  status: DialogueSpeechCandidateStatus
  cueId?: string
  revisionId?: string
  cueLinks?: DialogueCandidateCueLink[]
  reviewReason?: string
}

export interface DialogueAudioAsset {
  assetId: string
  audioDataUrl: string
  durationFrames: number
  waveform: number[]
  sourceName?: string
}

export interface DialogueAudioClip {
  clipId: string
  assetId: string
  timelineStartFrame: number
  sourceOffsetFrames: number
  durationFrames: number
}

export interface DialogueAudioTrackState {
  trackId: string
  name: string
  color: string
  clips: DialogueAudioClip[]
  speechCandidates: DialogueSpeechCandidate[]
  muted: boolean
  solo: boolean
}

export interface DialogueAudioCutState {
  activeTrackId: string
  detectionSensitivity: number
  assets: DialogueAudioAsset[]
  tracks: DialogueAudioTrackState[]
}

const TRACK_COLORS = ['#d7855f', '#5f9aaa', '#8a82b5']

export function createDefaultDialogueAudioCutState(frameOrigin: number): DialogueAudioCutState {
  void frameOrigin
  const tracks = TRACK_COLORS.map((color, index): DialogueAudioTrackState => ({
    trackId: `dialogue-${index + 1}`,
    name: `セリフ ${index + 1}`,
    color,
    clips: [],
    speechCandidates: [],
    muted: false,
    solo: false,
  }))
  return { activeTrackId: tracks[0].trackId, detectionSensitivity: 0.52, assets: [], tracks }
}

export function dialogueAudioCutStateFromDocument(
  document: CutGroupProjectDocument,
  cutId: string,
  frameOrigin: number,
): DialogueAudioCutState {
  const fallback = createDefaultDialogueAudioCutState(frameOrigin)
  const extension = document.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  if (!extension || !isRecord(extension.data)) return fallback
  const cuts = isRecord(extension.data.cuts) ? extension.data.cuts : null
  const value = cuts?.[cutId]
  if (extension.schemaVersion === 1) return migrateV1CutState(value, fallback, frameOrigin)
  if (extension.schemaVersion !== DIALOGUE_AUDIO_SCHEMA_VERSION) return fallback
  return normalizeCutState(value, fallback)
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
  const normalized = normalizeCutState(pruneUnusedDialogueAudioAssets(cutState), createDefaultDialogueAudioCutState(frameOrigin))
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

export function linkDialogueAudioCandidate(
  cutState: DialogueAudioCutState,
  trackId: string,
  candidateId: string,
  cueId: string,
  revisionId: string,
): DialogueAudioCutState {
  return {
    ...cutState,
    tracks: cutState.tracks.map(track => track.trackId !== trackId ? track : {
      ...track,
      speechCandidates: track.speechCandidates.map(candidate => candidate.candidateId !== candidateId ? candidate : {
        ...candidate,
        status: 'linked',
        cueId,
        revisionId,
        cueLinks: [
          ...(candidate.cueLinks ?? []).filter(link => link.revisionId !== revisionId),
          { cueId, revisionId },
        ],
        reviewReason: undefined,
      }),
    }),
  }
}

export function pruneUnusedDialogueAudioAssets(cutState: DialogueAudioCutState): DialogueAudioCutState {
  const used = new Set(cutState.tracks.flatMap(track => track.clips.map(clip => clip.assetId)))
  const assets = cutState.assets.filter(asset => used.has(asset.assetId))
  return assets.length === cutState.assets.length ? cutState : { ...cutState, assets }
}

function migrateV1CutState(value: unknown, fallback: DialogueAudioCutState, frameOrigin: number): DialogueAudioCutState {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return fallback
  const rawTracks = value.tracks
  const assets: DialogueAudioAsset[] = []
  const tracks = fallback.tracks.map((defaultTrack, index): DialogueAudioTrackState => {
    const raw = rawTracks[index]
    if (!isRecord(raw)) return defaultTrack
    const audioDataUrl = typeof raw.audioDataUrl === 'string' && raw.audioDataUrl.startsWith('data:audio/') ? raw.audioDataUrl : undefined
    const durationFrames = Math.max(0, integer(raw.durationFrames, 0))
    const assetId = `dialogue-v1-${index + 1}`
    if (audioDataUrl) {
      assets.push({
        assetId,
        audioDataUrl,
        durationFrames,
        waveform: normalizeWaveform(raw.waveform),
        sourceName: `${typeof raw.name === 'string' ? raw.name : defaultTrack.name}（旧形式）`,
      })
    }
    const speechRanges = normalizeRanges(raw.speechRanges)
    return {
      ...defaultTrack,
      name: normalizedTrackName(raw.name, defaultTrack.name),
      color: typeof raw.color === 'string' && raw.color ? raw.color : defaultTrack.color,
      clips: audioDataUrl && durationFrames > 0 ? [{
        clipId: `dialogue-v1-clip-${index + 1}`,
        assetId,
        timelineStartFrame: integer(raw.audioStartFrame, frameOrigin),
        sourceOffsetFrames: 0,
        durationFrames,
      }] : [],
      speechCandidates: speechRanges.map((range, rangeIndex) => ({
        candidateId: `dialogue-v1-candidate-${index + 1}-${rangeIndex + 1}`,
        ...range,
        status: 'pending',
      })),
      muted: raw.muted === true,
      solo: raw.solo === true,
    }
  })
  const activeTrackId = typeof value.activeTrackId === 'string' && tracks.some(track => track.trackId === value.activeTrackId)
    ? value.activeTrackId
    : tracks[0].trackId
  return {
    activeTrackId,
    detectionSensitivity: clampNumber(value.detectionSensitivity, 0, 1, fallback.detectionSensitivity),
    assets,
    tracks,
  }
}

function normalizeCutState(value: unknown, fallback: DialogueAudioCutState): DialogueAudioCutState {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return fallback
  const assets = Array.isArray(value.assets) ? value.assets.flatMap(normalizeAsset) : []
  const assetIds = new Set(assets.map(asset => asset.assetId))
  const rawTracks = value.tracks
  const tracks = fallback.tracks.map((defaultTrack, index) => normalizeTrackState(rawTracks[index], defaultTrack, assetIds))
  const activeTrackId = typeof value.activeTrackId === 'string' && tracks.some(track => track.trackId === value.activeTrackId)
    ? value.activeTrackId
    : tracks[0].trackId
  return {
    activeTrackId,
    detectionSensitivity: clampNumber(value.detectionSensitivity, 0, 1, fallback.detectionSensitivity),
    assets,
    tracks,
  }
}

function normalizeAsset(value: unknown): DialogueAudioAsset[] {
  if (!isRecord(value)) return []
  const assetId = normalizedId(value.assetId)
  const audioDataUrl = typeof value.audioDataUrl === 'string' && value.audioDataUrl.startsWith('data:audio/') ? value.audioDataUrl : ''
  if (!assetId || !audioDataUrl) return []
  return [{
    assetId,
    audioDataUrl,
    durationFrames: Math.max(0, integer(value.durationFrames, 0)),
    waveform: normalizeWaveform(value.waveform),
    sourceName: typeof value.sourceName === 'string' ? value.sourceName.slice(0, 160) : undefined,
  }]
}

function normalizeTrackState(value: unknown, fallback: DialogueAudioTrackState, assetIds: Set<string>): DialogueAudioTrackState {
  if (!isRecord(value)) return fallback
  const clips = Array.isArray(value.clips) ? value.clips.flatMap(item => normalizeClip(item, assetIds)) : []
  const speechCandidates = Array.isArray(value.speechCandidates)
    ? value.speechCandidates.flatMap(normalizeCandidate)
    : []
  return {
    trackId: fallback.trackId,
    name: normalizedTrackName(value.name, fallback.name),
    color: typeof value.color === 'string' && value.color ? value.color : fallback.color,
    clips: clips.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.clipId.localeCompare(right.clipId)),
    speechCandidates: speechCandidates.sort((left, right) => left.frameStart - right.frameStart || left.candidateId.localeCompare(right.candidateId)),
    muted: value.muted === true,
    solo: value.solo === true,
  }
}

function normalizeClip(value: unknown, assetIds: Set<string>): DialogueAudioClip[] {
  if (!isRecord(value)) return []
  const clipId = normalizedId(value.clipId)
  const assetId = normalizedId(value.assetId)
  const durationFrames = Math.max(0, integer(value.durationFrames, 0))
  if (!clipId || !assetId || !assetIds.has(assetId) || durationFrames < 1) return []
  return [{
    clipId,
    assetId,
    timelineStartFrame: integer(value.timelineStartFrame, 1),
    sourceOffsetFrames: Math.max(0, integer(value.sourceOffsetFrames, 0)),
    durationFrames,
  }]
}

function normalizeCandidate(value: unknown): DialogueSpeechCandidate[] {
  if (!isRecord(value)) return []
  const candidateId = normalizedId(value.candidateId)
  const frameStart = integer(value.frameStart, Number.NaN)
  const frameEnd = integer(value.frameEnd, Number.NaN)
  if (!candidateId || !Number.isFinite(frameStart) || !Number.isFinite(frameEnd) || frameEnd < frameStart) return []
  const status: DialogueSpeechCandidateStatus = value.status === 'linked' || value.status === 'ignored' || value.status === 'review'
    ? value.status
    : 'pending'
  const cueId = typeof value.cueId === 'string' && value.cueId ? value.cueId : undefined
  const revisionId = typeof value.revisionId === 'string' && value.revisionId ? value.revisionId : undefined
  const cueLinks = Array.isArray(value.cueLinks) ? value.cueLinks.flatMap(item => {
    if (!isRecord(item)) return []
    const linkCueId = normalizedId(item.cueId)
    const linkRevisionId = normalizedId(item.revisionId)
    return linkCueId && linkRevisionId ? [{ cueId: linkCueId, revisionId: linkRevisionId }] : []
  }) : (cueId && revisionId ? [{ cueId, revisionId }] : [])
  return [{
    candidateId,
    frameStart,
    frameEnd,
    status: status === 'linked' && !cueId ? 'review' : status,
    cueId,
    revisionId,
    cueLinks,
    reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
  }]
}

function normalizeRanges(value: unknown): DialogueSpeechRange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(range => {
    if (!isRecord(range)) return []
    const frameStart = integer(range.frameStart, Number.NaN)
    const frameEnd = integer(range.frameEnd, Number.NaN)
    return Number.isFinite(frameStart) && Number.isFinite(frameEnd) && frameEnd >= frameStart
      ? [{ frameStart, frameEnd }]
      : []
  })
}

function normalizeWaveform(value: unknown): number[] {
  return Array.isArray(value) ? value.slice(0, 4096).map(sample => clampNumber(sample, 0, 1, 0)) : []
}

function normalizedTrackName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : fallback
}

function normalizedId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : ''
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
