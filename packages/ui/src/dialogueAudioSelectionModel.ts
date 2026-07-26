import type { DialogueAudioCutState, DialogueAudioTrackState } from './dialogueAudioProject'
import type { DialogueAudioRange } from './dialogueAudioEditing'

export type DialogueAudioSelectionEntityKind = 'clip' | 'candidate' | 'region'

export interface DialogueAudioSelectionEntity {
  kind: DialogueAudioSelectionEntityKind
  trackId: string
  id: string
}

export interface DialogueAudioTimeRangeSelection extends DialogueAudioRange {
  trackId: string
}

export interface DialogueAudioSelectionState {
  entities: DialogueAudioSelectionEntity[]
  timeRange: DialogueAudioTimeRangeSelection | null
}

export const EMPTY_DIALOGUE_AUDIO_SELECTION: DialogueAudioSelectionState = {
  entities: [],
  timeRange: null,
}

export function dialogueAudioSelectionEntityKey(entity: DialogueAudioSelectionEntity): string {
  return `${entity.kind}:${entity.trackId}:${entity.id}`
}

export function dialogueAudioSelectionContains(
  selection: DialogueAudioSelectionState,
  entity: DialogueAudioSelectionEntity,
): boolean {
  const key = dialogueAudioSelectionEntityKey(entity)
  return selection.entities.some(item => dialogueAudioSelectionEntityKey(item) === key)
}

export function replaceDialogueAudioSelection(
  entities: DialogueAudioSelectionEntity[],
): DialogueAudioSelectionState {
  return {
    entities: uniqueDialogueAudioSelectionEntities(entities),
    timeRange: null,
  }
}

export function toggleDialogueAudioSelectionEntity(
  selection: DialogueAudioSelectionState,
  entity: DialogueAudioSelectionEntity,
  additive: boolean,
): DialogueAudioSelectionState {
  if (!additive) return replaceDialogueAudioSelection([entity])
  const key = dialogueAudioSelectionEntityKey(entity)
  const contains = selection.entities.some(item => dialogueAudioSelectionEntityKey(item) === key)
  return replaceDialogueAudioSelection(contains
    ? selection.entities.filter(item => dialogueAudioSelectionEntityKey(item) !== key)
    : [...selection.entities, entity])
}

export function applyDialogueAudioMarqueeSelection(
  initial: DialogueAudioSelectionState,
  hits: DialogueAudioSelectionEntity[],
  additive: boolean,
): DialogueAudioSelectionState {
  if (!additive) return replaceDialogueAudioSelection(hits)
  return replaceDialogueAudioSelection([...initial.entities, ...hits])
}

export function collectDialogueAudioMarqueeEntities(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  trackIds: string[],
  range: DialogueAudioRange,
): DialogueAudioSelectionEntity[] {
  const includedTracks = new Set(trackIds)
  return state.tracks.flatMap(track => {
    if (!includedTracks.has(track.trackId)) return []
    const regionCandidateIds = new Set(track.dialogueRegions.flatMap(region => region.candidateIds))
    return [
      ...track.clips
        .filter(clip => rangesOverlap(
          range,
          {
            frameStart: clip.timelineStartFrame,
            frameEnd: clip.timelineStartFrame + clip.durationFrames - 1,
          },
        ))
        .map(clip => ({ kind: 'clip' as const, trackId: track.trackId, id: clip.clipId })),
      ...track.speechCandidates
        .filter(candidate => !regionCandidateIds.has(candidate.candidateId) && rangesOverlap(range, candidate))
        .map(candidate => ({ kind: 'candidate' as const, trackId: track.trackId, id: candidate.candidateId })),
      ...track.dialogueRegions
        .filter(region => rangesOverlap(range, region))
        .map(region => ({ kind: 'region' as const, trackId: track.trackId, id: region.regionId })),
    ]
  })
}

export function reconcileDialogueAudioSelection(
  selection: DialogueAudioSelectionState,
  state: Pick<DialogueAudioCutState, 'tracks'>,
): DialogueAudioSelectionState {
  const tracks = new Map(state.tracks.map(track => [track.trackId, track]))
  const entities = selection.entities.filter(entity => {
    const track = tracks.get(entity.trackId)
    return track ? trackContainsEntity(track, entity) : false
  })
  if (entities.length === selection.entities.length) return selection
  return { ...selection, entities }
}

export function dialogueAudioSelectionFrameRange(
  selection: DialogueAudioSelectionState,
  state: Pick<DialogueAudioCutState, 'tracks'>,
): DialogueAudioRange | null {
  if (selection.timeRange) return selection.timeRange
  const ranges = selection.entities.flatMap(entity => {
    const track = state.tracks.find(item => item.trackId === entity.trackId)
    if (!track) return []
    if (entity.kind === 'clip') {
      const clip = track.clips.find(item => item.clipId === entity.id)
      return clip ? [{
        frameStart: clip.timelineStartFrame,
        frameEnd: clip.timelineStartFrame + clip.durationFrames - 1,
      }] : []
    }
    if (entity.kind === 'candidate') {
      const candidate = track.speechCandidates.find(item => item.candidateId === entity.id)
      return candidate ? [{ frameStart: candidate.frameStart, frameEnd: candidate.frameEnd }] : []
    }
    const region = track.dialogueRegions.find(item => item.regionId === entity.id)
    return region ? [{ frameStart: region.frameStart, frameEnd: region.frameEnd }] : []
  })
  return ranges.length > 0 ? {
    frameStart: Math.min(...ranges.map(range => range.frameStart)),
    frameEnd: Math.max(...ranges.map(range => range.frameEnd)),
  } : null
}

function uniqueDialogueAudioSelectionEntities(
  entities: DialogueAudioSelectionEntity[],
): DialogueAudioSelectionEntity[] {
  const keys = new Set<string>()
  return entities.filter(entity => {
    const key = dialogueAudioSelectionEntityKey(entity)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

function trackContainsEntity(
  track: DialogueAudioTrackState,
  entity: DialogueAudioSelectionEntity,
): boolean {
  if (entity.kind === 'clip') return track.clips.some(clip => clip.clipId === entity.id)
  if (entity.kind === 'candidate') return track.speechCandidates.some(candidate => candidate.candidateId === entity.id)
  return track.dialogueRegions.some(region => region.regionId === entity.id)
}

function rangesOverlap(left: DialogueAudioRange, right: DialogueAudioRange): boolean {
  return left.frameStart <= right.frameEnd && right.frameStart <= left.frameEnd
}
