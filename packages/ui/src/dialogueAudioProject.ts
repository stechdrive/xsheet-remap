import type { CutProject } from '@xsheet-remap/core'

export const DIALOGUE_AUDIO_EXTENSION = 'xsheet-remap.dialogue-audio'
export const DIALOGUE_AUDIO_SCHEMA_VERSION = 1

export type DialogueAudioVadPreset = 'quiet' | 'normal' | 'noisy'
export type DialogueAudioVadMode = 'off' | 'candidates' | 'auto-region'

export type DialogueSpeechCandidateStatus = 'pending' | 'linked' | 'ignored' | 'review'

export interface DialogueSpeechRange {
  frameStart: number
  frameEnd: number
}

export interface DialogueSpeechSource {
  placementId: string
  assetId: string
  sourceFrameStart: number
  sourceFrameEnd: number
}

export interface DialogueSpeechCandidate extends DialogueSpeechRange {
  candidateId: string
  status: DialogueSpeechCandidateStatus
  /** Stable source identity used when clips overlap or a placement is split. */
  source?: DialogueSpeechSource
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
  /** Stable placement lineage. Split clips keep this ID; pasted clips receive a new one. */
  placementId: string
  assetId: string
  timelineStartFrame: number
  sourceOffsetFrames: number
  durationFrames: number
}

export interface DialogueAudioTrackState {
  trackId: string
  color: string
  clips: DialogueAudioClip[]
  speechCandidates: DialogueSpeechCandidate[]
  dialogueRegions: DialogueRegion[]
  vadMode: DialogueAudioVadMode
  muted: boolean
}

export interface DialogueRegionAudioAnchor {
  anchorId: string
  placementId: string
  assetId: string
  sourceFrameStart: number
  sourceFrameEnd: number
  candidateIds: string[]
}

export interface DialogueRegion extends DialogueSpeechRange {
  regionId: string
  candidateIds: string[]
  anchors: DialogueRegionAudioAnchor[]
  headPaddingFrames: number
  tailPaddingFrames: number
  status: 'ready' | 'review' | 'orphaned'
  reviewReason?: string
}

export interface DialogueRegionReference {
  trackId: string
  regionId: string
}

export interface DialogueSoundAssignment {
  assignmentId: string
  cueId: string
  revisionId: string
  regionRefs: DialogueRegionReference[]
  headPaddingFrames: number
  tailPaddingFrames: number
  status: 'linked' | 'review' | 'orphaned'
  reviewReason?: string
}

export interface DialogueAudioCutState {
  /** Length of the editable audio workspace. It shares the cut origin, but is independent from the timesheet cut length and audio content end. */
  timelineDurationFrames: number
  activeTrackId: string
  detectionSensitivity: number
  detectionStability: number
  detectionPreset: DialogueAudioVadPreset
  assets: DialogueAudioAsset[]
  tracks: DialogueAudioTrackState[]
  assignments: DialogueSoundAssignment[]
}

const TRACK_COLORS = ['#d7855f', '#5f9aaa', '#8a82b5']

export function createDefaultDialogueAudioCutState(frameOrigin: number, cutDurationFrames = 1): DialogueAudioCutState {
  void frameOrigin
  void cutDurationFrames
  const tracks = TRACK_COLORS.map((color, index): DialogueAudioTrackState => ({
    trackId: `dialogue-${index + 1}`,
    color,
    clips: [],
    speechCandidates: [],
    dialogueRegions: [],
    vadMode: 'candidates',
    muted: false,
  }))
  return {
    timelineDurationFrames: 1,
    activeTrackId: tracks[0].trackId,
    detectionSensitivity: 0.5,
    detectionStability: 0.4,
    detectionPreset: 'quiet',
    assets: [],
    tracks,
    assignments: [],
  }
}

export function dialogueAudioCutStateFromProject(
  project: CutProject,
  frameOrigin: number,
  cutDurationFrames = 144,
): DialogueAudioCutState {
  const fallback = createDefaultDialogueAudioCutState(frameOrigin, cutDurationFrames)
  const extension = project.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  if (!extension || extension.schemaVersion !== DIALOGUE_AUDIO_SCHEMA_VERSION) return fallback
  return normalizeCutState(extension.data, fallback, frameOrigin)
}

export function updateDialogueAudioCutStateInProject(
  project: CutProject,
  cutState: DialogueAudioCutState,
  frameOrigin: number,
  cutDurationFrames = 144,
): CutProject {
  const normalized = normalizeCutState(
    pruneUnusedDialogueAudioAssets(cutState),
    createDefaultDialogueAudioCutState(frameOrigin, cutDurationFrames),
    frameOrigin,
  )
  return {
    ...project,
    extensions: {
      ...project.extensions,
      [DIALOGUE_AUDIO_EXTENSION]: {
        schemaVersion: DIALOGUE_AUDIO_SCHEMA_VERSION,
        data: normalized,
      },
    },
  }
}

export function pruneUnusedDialogueAudioAssets(cutState: DialogueAudioCutState): DialogueAudioCutState {
  const used = new Set(cutState.tracks.flatMap(track => track.clips.map(clip => clip.assetId)))
  const assets = cutState.assets.filter(asset => used.has(asset.assetId))
  return assets.length === cutState.assets.length ? cutState : { ...cutState, assets }
}

function normalizeCutState(value: unknown, fallback: DialogueAudioCutState, frameOrigin: number): DialogueAudioCutState {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return fallback
  const assets = Array.isArray(value.assets) ? value.assets.flatMap(normalizeAsset) : []
  const assetIds = new Set(assets.map(asset => asset.assetId))
  const rawTracks = value.tracks
  const tracks = fallback.tracks.map((defaultTrack, index) => normalizeTrackState(rawTracks[index], defaultTrack, assetIds))
  const assignments = Array.isArray(value.assignments)
    ? value.assignments.flatMap(item => normalizeAssignment(item, tracks))
    : []
  const activeTrackId = typeof value.activeTrackId === 'string' && tracks.some(track => track.trackId === value.activeTrackId)
    ? value.activeTrackId
    : tracks[0].trackId
  return {
    timelineDurationFrames: requiredTimelineDurationFrames(
      { assets, tracks },
      frameOrigin,
      Math.max(fallback.timelineDurationFrames, integer(value.timelineDurationFrames, fallback.timelineDurationFrames)),
    ),
    activeTrackId,
    detectionSensitivity: clampNumber(value.detectionSensitivity, 0, 1, fallback.detectionSensitivity),
    detectionStability: clampNumber(value.detectionStability, 0, 1, fallback.detectionStability),
    detectionPreset: normalizeVadPreset(value.detectionPreset, fallback.detectionPreset),
    assets,
    tracks,
    assignments,
  }
}

function requiredTimelineDurationFrames(
  state: Pick<DialogueAudioCutState, 'assets' | 'tracks'>,
  frameOrigin: number,
  minimum: number,
): number {
  let frameEnd = frameOrigin + Math.max(1, minimum) - 1
  state.tracks.forEach(track => {
    track.clips.forEach(clip => {
      frameEnd = Math.max(frameEnd, clip.timelineStartFrame + clip.durationFrames - 1)
    })
    track.speechCandidates.forEach(candidate => {
      frameEnd = Math.max(frameEnd, candidate.frameEnd)
    })
    track.dialogueRegions.forEach(region => {
      frameEnd = Math.max(frameEnd, region.frameEnd)
    })
  })
  return Math.max(1, frameEnd - frameOrigin + 1)
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
    ? value.speechCandidates.flatMap(item => normalizeCandidate(item, assetIds))
    : []
  const candidateIds = new Set(speechCandidates.map(candidate => candidate.candidateId))
  const dialogueRegions = Array.isArray(value.dialogueRegions)
    ? value.dialogueRegions.flatMap(item => normalizeRegion(item, assetIds, candidateIds))
    : []
  return {
    trackId: fallback.trackId,
    color: typeof value.color === 'string' && value.color ? value.color : fallback.color,
    clips: clips.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.clipId.localeCompare(right.clipId)),
    speechCandidates: speechCandidates.sort((left, right) => left.frameStart - right.frameStart || left.candidateId.localeCompare(right.candidateId)),
    dialogueRegions: dialogueRegions.sort((left, right) => left.frameStart - right.frameStart || left.regionId.localeCompare(right.regionId)),
    vadMode: normalizeVadMode(value.vadMode, fallback.vadMode),
    muted: value.muted === true,
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
    placementId: normalizedId(value.placementId) || clipId,
    assetId,
    timelineStartFrame: integer(value.timelineStartFrame, 1),
    sourceOffsetFrames: Math.max(0, integer(value.sourceOffsetFrames, 0)),
    durationFrames,
  }]
}

function normalizeCandidate(value: unknown, assetIds: Set<string>): DialogueSpeechCandidate[] {
  if (!isRecord(value)) return []
  const candidateId = normalizedId(value.candidateId)
  const frameStart = integer(value.frameStart, Number.NaN)
  const frameEnd = integer(value.frameEnd, Number.NaN)
  if (!candidateId || !Number.isFinite(frameStart) || !Number.isFinite(frameEnd) || frameEnd < frameStart) return []
  const status: DialogueSpeechCandidateStatus = value.status === 'linked' || value.status === 'ignored' || value.status === 'review'
    ? value.status
    : 'pending'
  return [{
    candidateId,
    frameStart,
    frameEnd,
    status,
    source: normalizeSpeechSource(value.source, assetIds),
    reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
  }]
}

function normalizeSpeechSource(value: unknown, assetIds: Set<string>): DialogueSpeechSource | undefined {
  if (!isRecord(value)) return undefined
  const placementId = normalizedId(value.placementId)
  const assetId = normalizedId(value.assetId)
  const sourceFrameStart = Math.max(0, integer(value.sourceFrameStart, Number.NaN))
  const sourceFrameEnd = Math.max(0, integer(value.sourceFrameEnd, Number.NaN))
  if (!placementId || !assetIds.has(assetId) || !Number.isFinite(sourceFrameStart) || !Number.isFinite(sourceFrameEnd) || sourceFrameEnd < sourceFrameStart) {
    return undefined
  }
  return { placementId, assetId, sourceFrameStart, sourceFrameEnd }
}

function normalizeRegion(value: unknown, assetIds: Set<string>, availableCandidateIds: Set<string>): DialogueRegion[] {
  if (!isRecord(value)) return []
  const regionId = normalizedId(value.regionId)
  const frameStart = integer(value.frameStart, Number.NaN)
  const frameEnd = integer(value.frameEnd, Number.NaN)
  if (!regionId || !Number.isFinite(frameStart) || !Number.isFinite(frameEnd) || frameEnd < frameStart) return []
  const candidateIds = Array.isArray(value.candidateIds)
    ? value.candidateIds.map(normalizedId).filter(candidateId => availableCandidateIds.has(candidateId))
    : []
  const anchors = Array.isArray(value.anchors)
    ? value.anchors.flatMap(item => normalizeRegionAnchor(item, assetIds))
    : []
  const sourceStatus = value.status === 'review' || value.status === 'orphaned' ? value.status : 'ready'
  return [{
    regionId,
    frameStart,
    frameEnd,
    candidateIds,
    anchors,
    headPaddingFrames: integer(value.headPaddingFrames, 0),
    tailPaddingFrames: integer(value.tailPaddingFrames, 0),
    status: anchors.length === 0 && sourceStatus === 'ready' ? 'orphaned' : sourceStatus,
    reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
  }]
}

function normalizeRegionAnchor(value: unknown, assetIds: Set<string>): DialogueRegionAudioAnchor[] {
  if (!isRecord(value)) return []
  const anchorId = normalizedId(value.anchorId)
  const placementId = normalizedId(value.placementId)
  const assetId = normalizedId(value.assetId)
  const sourceFrameStart = Math.max(0, integer(value.sourceFrameStart, Number.NaN))
  const sourceFrameEnd = Math.max(0, integer(value.sourceFrameEnd, Number.NaN))
  if (!anchorId || !placementId || !assetIds.has(assetId) || !Number.isFinite(sourceFrameStart) || !Number.isFinite(sourceFrameEnd) || sourceFrameEnd < sourceFrameStart) return []
  const candidateIds = Array.isArray(value.candidateIds) ? value.candidateIds.map(normalizedId).filter(Boolean) : []
  return [{ anchorId, placementId, assetId, sourceFrameStart, sourceFrameEnd, candidateIds }]
}

function normalizeAssignment(value: unknown, tracks: DialogueAudioTrackState[]): DialogueSoundAssignment[] {
  if (!isRecord(value)) return []
  const assignmentId = normalizedId(value.assignmentId)
  const cueId = normalizedId(value.cueId)
  const revisionId = normalizedId(value.revisionId)
  if (!assignmentId || !cueId || !revisionId) return []
  const regionIdsByTrack = new Map(tracks.map(track => [track.trackId, new Set(track.dialogueRegions.map(region => region.regionId))]))
  const regionRefs = Array.isArray(value.regionRefs) ? value.regionRefs.flatMap((item): DialogueRegionReference[] => {
    if (!isRecord(item)) return []
    const trackId = normalizedId(item.trackId)
    const regionId = normalizedId(item.regionId)
    return regionIdsByTrack.get(trackId)?.has(regionId) ? [{ trackId, regionId }] : []
  }) : []
  if (regionRefs.length === 0) return []
  const status = value.status === 'review' || value.status === 'orphaned' ? value.status : 'linked'
  return [{
    assignmentId,
    cueId,
    revisionId,
    regionRefs,
    headPaddingFrames: integer(value.headPaddingFrames, 0),
    tailPaddingFrames: integer(value.tailPaddingFrames, 0),
    status,
    reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
  }]
}

function normalizeWaveform(value: unknown): number[] {
  return Array.isArray(value) ? value.slice(0, 4096).map(sample => clampNumber(sample, 0, 1, 0)) : []
}

function normalizedId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : ''
}

function normalizeVadPreset(value: unknown, fallback: DialogueAudioVadPreset): DialogueAudioVadPreset {
  return value === 'normal' || value === 'noisy' || value === 'quiet' ? value : fallback
}

function normalizeVadMode(value: unknown, fallback: DialogueAudioVadMode): DialogueAudioVadMode {
  return value === 'off' || value === 'candidates' || value === 'auto-region' ? value : fallback
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
