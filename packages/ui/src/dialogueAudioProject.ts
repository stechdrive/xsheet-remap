import type { CutGroupProjectDocument } from '@xsheet-remap/core'

export const DIALOGUE_AUDIO_EXTENSION = 'xsheet-remap.dialogue-audio'
export const DIALOGUE_AUDIO_SCHEMA_VERSION = 7

export type DialogueAudioVadPreset = 'quiet' | 'normal' | 'noisy'
export type DialogueAudioVadMode = 'off' | 'candidates' | 'auto-region'

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
  cueFrameStart: number
  cueFrameEnd: number
  provisional: boolean
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

export function dialogueAudioCutStateFromDocument(
  document: CutGroupProjectDocument,
  cutId: string,
  frameOrigin: number,
  cutDurationFrames = 144,
): DialogueAudioCutState {
  const fallback = createDefaultDialogueAudioCutState(frameOrigin, cutDurationFrames)
  const extension = document.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  if (!extension || !isRecord(extension.data)) return fallback
  const cuts = isRecord(extension.data.cuts) ? extension.data.cuts : null
  const value = cuts?.[cutId]
  if (extension.schemaVersion === 1) return migrateV1CutState(value, fallback, frameOrigin)
  if (![2, 3, 4, 5, 6, DIALOGUE_AUDIO_SCHEMA_VERSION].includes(extension.schemaVersion)) return fallback
  return normalizeCutState(value, fallback, frameOrigin)
}

export function updateDialogueAudioCutStateInDocument(
  document: CutGroupProjectDocument,
  cutId: string,
  cutState: DialogueAudioCutState,
  frameOrigin: number,
  cutDurationFrames = 144,
): CutGroupProjectDocument {
  const extension = document.extensions?.[DIALOGUE_AUDIO_EXTENSION]
  const currentData = extension && [2, 3, 4, 5, 6, DIALOGUE_AUDIO_SCHEMA_VERSION].includes(extension.schemaVersion) && isRecord(extension.data)
    ? extension.data
    : {}
  const currentCuts = isRecord(currentData.cuts) ? currentData.cuts : {}
  const normalized = normalizeCutState(
    pruneUnusedDialogueAudioAssets(cutState),
    createDefaultDialogueAudioCutState(frameOrigin, cutDurationFrames),
    frameOrigin,
  )
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
        sourceName: `旧形式の音声トラック${index + 1}`,
      })
    }
    const speechRanges = normalizeRanges(raw.speechRanges)
    return {
      ...defaultTrack,
      color: typeof raw.color === 'string' && raw.color ? raw.color : defaultTrack.color,
      clips: audioDataUrl && durationFrames > 0 ? [{
        clipId: `dialogue-v1-clip-${index + 1}`,
        placementId: `dialogue-v1-clip-${index + 1}`,
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
      dialogueRegions: [],
      vadMode: 'candidates',
      muted: raw.muted === true,
    }
  })
  const activeTrackId = typeof value.activeTrackId === 'string' && tracks.some(track => track.trackId === value.activeTrackId)
    ? value.activeTrackId
    : tracks[0].trackId
  return {
    timelineDurationFrames: requiredTimelineDurationFrames({ assets, tracks }, frameOrigin, fallback.timelineDurationFrames),
    activeTrackId,
    detectionSensitivity: clampNumber(value.detectionSensitivity, 0, 1, fallback.detectionSensitivity),
    detectionStability: fallback.detectionStability,
    detectionPreset: fallback.detectionPreset,
    assets,
    tracks,
    assignments: [],
  }
}

function normalizeCutState(value: unknown, fallback: DialogueAudioCutState, frameOrigin: number): DialogueAudioCutState {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return fallback
  const assets = Array.isArray(value.assets) ? value.assets.flatMap(normalizeAsset) : []
  const assetIds = new Set(assets.map(asset => asset.assetId))
  const rawTracks = value.tracks
  let tracks = fallback.tracks.map((defaultTrack, index) => normalizeTrackState(rawTracks[index], defaultTrack, assetIds))
  let assignments = Array.isArray(value.assignments)
    ? value.assignments.flatMap(item => normalizeAssignment(item, tracks))
    : []
  if (assignments.length === 0 && Array.isArray(value.bindings)) {
    const migrated = migrateLegacyBindings(value.bindings, tracks, assetIds)
    tracks = migrated.tracks
    assignments = migrated.assignments
  }
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
    ? value.speechCandidates.flatMap(normalizeCandidate)
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
  const cueFrameStart = integer(value.cueFrameStart, Number.NaN)
  const cueFrameEnd = integer(value.cueFrameEnd, Number.NaN)
  if (!Number.isFinite(cueFrameStart) || !Number.isFinite(cueFrameEnd) || cueFrameEnd < cueFrameStart) return []
  const status = value.status === 'review' || value.status === 'orphaned' ? value.status : 'linked'
  return [{
    assignmentId,
    cueId,
    revisionId,
    regionRefs,
    headPaddingFrames: integer(value.headPaddingFrames, 0),
    tailPaddingFrames: integer(value.tailPaddingFrames, 0),
    cueFrameStart,
    cueFrameEnd,
    provisional: value.provisional === true,
    status,
    reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
  }]
}

function migrateLegacyBindings(
  values: unknown[],
  sourceTracks: DialogueAudioTrackState[],
  assetIds: Set<string>,
): { tracks: DialogueAudioTrackState[]; assignments: DialogueSoundAssignment[] } {
  let tracks = sourceTracks
  const assignments: DialogueSoundAssignment[] = []
  for (const value of values) {
    if (!isRecord(value)) continue
    const bindingId = normalizedId(value.bindingId)
    const cueId = normalizedId(value.cueId)
    const revisionId = normalizedId(value.revisionId)
    const trackId = normalizedId(value.trackId)
    const track = tracks.find(item => item.trackId === trackId)
    if (!bindingId || !cueId || !revisionId || !track) continue
    const anchors = Array.isArray(value.anchors)
      ? value.anchors.flatMap(item => normalizeRegionAnchor(item, assetIds))
      : []
    const cueFrameStart = integer(value.cueFrameStart, Number.NaN)
    const cueFrameEnd = integer(value.cueFrameEnd, Number.NaN)
    if (!Number.isFinite(cueFrameStart) || !Number.isFinite(cueFrameEnd) || cueFrameEnd < cueFrameStart) continue
    const headPaddingFrames = integer(value.headPaddingFrames, 0)
    const tailPaddingFrames = integer(value.tailPaddingFrames, 0)
    const candidateIds = [...new Set(anchors.flatMap(anchor => anchor.candidateIds))]
    const candidateRanges = track.speechCandidates.filter(candidate => candidateIds.includes(candidate.candidateId))
    const inferredFrameStart = candidateRanges.length > 0 ? Math.min(...candidateRanges.map(candidate => candidate.frameStart)) : cueFrameStart + headPaddingFrames
    const inferredFrameEnd = candidateRanges.length > 0 ? Math.max(...candidateRanges.map(candidate => candidate.frameEnd)) : cueFrameEnd - tailPaddingFrames
    const regionId = uniqueRegionId(`${bindingId}-region`, tracks)
    const region: DialogueRegion = {
      regionId,
      frameStart: Math.min(inferredFrameStart, inferredFrameEnd),
      frameEnd: Math.max(inferredFrameStart, inferredFrameEnd),
      candidateIds,
      anchors,
      headPaddingFrames: 0,
      tailPaddingFrames: 0,
      status: anchors.length > 0 ? 'ready' : 'orphaned',
      reviewReason: anchors.length > 0 ? undefined : '旧形式の音声アンカーが見つかりません。',
    }
    tracks = tracks.map(item => item.trackId === trackId ? { ...item, dialogueRegions: [...item.dialogueRegions, region] } : item)
    assignments.push({
      assignmentId: bindingId,
      cueId,
      revisionId,
      regionRefs: [{ trackId, regionId }],
      headPaddingFrames,
      tailPaddingFrames,
      cueFrameStart,
      cueFrameEnd,
      provisional: value.provisional === true,
      status: anchors.length > 0 ? (value.status === 'review' ? 'review' : 'linked') : 'orphaned',
      reviewReason: typeof value.reviewReason === 'string' ? value.reviewReason.slice(0, 160) : undefined,
    })
  }
  return { tracks, assignments }
}

function uniqueRegionId(prefix: string, tracks: DialogueAudioTrackState[]): string {
  const usedIds = new Set(tracks.flatMap(track => track.dialogueRegions.map(region => region.regionId)))
  if (!usedIds.has(prefix)) return prefix
  let sequence = 2
  while (usedIds.has(`${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
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

function normalizedId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : ''
}

function normalizeVadPreset(value: unknown, fallback: DialogueAudioVadPreset): DialogueAudioVadPreset {
  return value === 'normal' || value === 'noisy' || value === 'quiet' ? value : fallback
}

function normalizeVadMode(value: unknown, fallback: DialogueAudioVadMode): DialogueAudioVadMode {
  if (value === 'auto-sound') return 'auto-region'
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
