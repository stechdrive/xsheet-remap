import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  type DialogueAudioClip,
  type DialogueAudioCutState,
  type DialogueAudioTrackState,
  type DialogueRegion,
  type DialogueRegionAudioAnchor,
  type DialogueRegionReference,
  type DialogueSoundAssignment,
  type DialogueSpeechCandidate,
} from './dialogueAudioProject'
import { moveDialogueRegionAudioToFrame } from './dialogueAudioEditing'

export interface DialogueAssignmentResolution {
  frameStart: number
  frameEnd: number
  complete: boolean
}

export function createDialogueRegionFromCandidates(
  state: DialogueAudioCutState,
  trackId: string,
  candidateIds: string[],
): { state: DialogueAudioCutState; region: DialogueRegion } | null {
  const track = state.tracks.find(item => item.trackId === trackId)
  if (!track) return null
  const selectedIds = new Set(candidateIds)
  const candidates = track.speechCandidates.filter(candidate => selectedIds.has(candidate.candidateId))
  if (candidates.length === 0) return null
  const orderedIds = candidates.map(candidate => candidate.candidateId).sort()
  const existing = track.dialogueRegions.find(region =>
    region.candidateIds.length === orderedIds.length
    && [...region.candidateIds].sort().every((candidateId, index) => candidateId === orderedIds[index]))
  if (existing) return { state, region: existing }
  const anchors = anchorsForCandidates(track.clips, candidates)
  const region: DialogueRegion = {
    regionId: nextId('dialogue-region', new Set(state.tracks.flatMap(item => item.dialogueRegions.map(itemRegion => itemRegion.regionId)))),
    frameStart: Math.min(...candidates.map(candidate => candidate.frameStart)),
    frameEnd: Math.max(...candidates.map(candidate => candidate.frameEnd)),
    candidateIds: orderedIds,
    anchors,
    headPaddingFrames: 0,
    tailPaddingFrames: 0,
    status: anchors.length > 0 ? 'ready' : 'orphaned',
    reviewReason: anchors.length > 0 ? undefined : '対応する音声クリップがありません。',
  }
  return {
    region,
    state: {
      ...state,
      tracks: state.tracks.map(item => item.trackId === trackId
        ? { ...item, dialogueRegions: [...item.dialogueRegions, region].sort(compareRegions) }
        : item),
    },
  }
}

export function assignDialogueRegionsToCue(
  state: DialogueAudioCutState,
  regionRefsInput: DialogueRegionReference[],
  cue: Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>,
  revisionId: string,
  soundCues: Array<Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>> = [cue],
): DialogueAudioCutState {
  const regionRefs = uniqueRegionRefs(regionRefsInput).filter(ref => regionForRef(state, ref))
  if (regionRefs.length === 0) return state
  const selectedKeys = new Set(regionRefs.map(regionRefKey))
  const target = state.assignments.find(item => item.cueId === cue.cueId && item.revisionId === revisionId)
  const retainedAssignments = state.assignments.flatMap(assignment => {
    if (assignment.revisionId !== revisionId || assignment === target) return assignment === target ? [] : [assignment]
    const retainedRefs = assignment.regionRefs.filter(ref => !selectedKeys.has(regionRefKey(ref)))
    if (retainedRefs.length === 0) return []
    const retainedResolution = resolveRegionRefs(state, retainedRefs)
    const retainedCue = soundCues.find(item => item.cueId === assignment.cueId)
    return [{
      ...assignment,
      regionRefs: retainedRefs,
      headPaddingFrames: retainedResolution && retainedCue ? retainedResolution.frameStart - retainedCue.frameStart : assignment.headPaddingFrames,
      tailPaddingFrames: retainedResolution && retainedCue ? retainedCue.frameEnd - retainedResolution.frameEnd : assignment.tailPaddingFrames,
      status: retainedResolution ? (retainedResolution.complete ? 'linked' as const : 'review' as const) : 'orphaned' as const,
      reviewReason: retainedResolution ? (retainedResolution.complete ? undefined : 'リンク音声の一部が削除されています。') : 'リンク対象の音声がありません。',
    }]
  })
  const targetRefs = uniqueRegionRefs([...(target?.regionRefs ?? []), ...regionRefs])
  const resolution = resolveRegionRefs(state, targetRefs)
  const assignment: DialogueSoundAssignment = {
    assignmentId: target?.assignmentId
      ?? nextId(`dialogue-assignment-${cue.cueId}`, new Set(state.assignments.map(item => item.assignmentId))),
    cueId: cue.cueId,
    revisionId,
    regionRefs: targetRefs,
    headPaddingFrames: resolution ? resolution.frameStart - cue.frameStart : 0,
    tailPaddingFrames: resolution ? cue.frameEnd - resolution.frameEnd : 0,
    status: resolution ? (resolution.complete ? 'linked' : 'review') : 'orphaned',
    reviewReason: resolution ? (resolution.complete ? undefined : 'リンク音声の一部が削除されています。') : 'リンク対象の音声がありません。',
  }
  const assignedCandidateIdsByTrack = new Map<string, Set<string>>()
  for (const ref of targetRefs) {
    const region = regionForRef(state, ref)
    if (!region) continue
    assignedCandidateIdsByTrack.set(ref.trackId, new Set([
      ...(assignedCandidateIdsByTrack.get(ref.trackId) ?? []),
      ...region.candidateIds,
    ]))
  }
  return {
    ...state,
    assignments: [...retainedAssignments, assignment],
    tracks: state.tracks.map(track => {
      const assignedCandidateIds = assignedCandidateIdsByTrack.get(track.trackId)
      if (!assignedCandidateIds) return track
      return {
        ...track,
        speechCandidates: track.speechCandidates.map(candidate => !assignedCandidateIds.has(candidate.candidateId) ? candidate : {
          ...candidate,
          status: 'linked',
          reviewReason: undefined,
        }),
      }
    }),
  }
}

export function linkDialogueAudioCandidates(
  state: DialogueAudioCutState,
  trackId: string,
  candidateIds: string[],
  cue: Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>,
  revisionId: string,
): DialogueAudioCutState {
  const created = createDialogueRegionFromCandidates(state, trackId, candidateIds)
  return created
    ? assignDialogueRegionsToCue(created.state, [{ trackId, regionId: created.region.regionId }], cue, revisionId)
    : state
}

export function synchronizeDialogueAssignmentsFromCues(
  state: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): DialogueAudioCutState {
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  let changed = false
  const assignments = state.assignments.map(assignment => {
    if (assignment.revisionId !== revisionId) return assignment
    const cue = cueById.get(assignment.cueId)
    if (!cue) {
      if (assignment.status === 'review' && assignment.reviewReason === 'リンク先の音響指示が見つかりません。') return assignment
      changed = true
      return { ...assignment, status: 'review' as const, reviewReason: 'リンク先の音響指示が見つかりません。' }
    }
    const resolution = resolveDialogueAssignment(state, assignment)
    const next = {
      ...assignment,
      headPaddingFrames: resolution ? resolution.frameStart - cue.frameStart : assignment.headPaddingFrames,
      tailPaddingFrames: resolution ? cue.frameEnd - resolution.frameEnd : assignment.tailPaddingFrames,
    }
    if (next.headPaddingFrames === assignment.headPaddingFrames
      && next.tailPaddingFrames === assignment.tailPaddingFrames) return assignment
    changed = true
    return next
  })
  return changed ? { ...state, assignments } : state
}

export function applySoundCueChangesToDialogueAudio(
  stateInput: DialogueAudioCutState,
  previousSoundCues: TimedRangeCue[],
  nextSoundCues: TimedRangeCue[],
  revisionId: string,
): DialogueAudioCutState {
  const previousById = new Map(previousSoundCues.map(cue => [cue.cueId, cue]))
  const nextById = new Map(nextSoundCues.map(cue => [cue.cueId, cue]))
  let state = stateInput
  for (const assignment of stateInput.assignments) {
    if (assignment.revisionId !== revisionId) continue
    const previous = previousById.get(assignment.cueId)
    const next = nextById.get(assignment.cueId)
    if (!previous || !next) continue
    const startDelta = next.frameStart - previous.frameStart
    const endDelta = next.frameEnd - previous.frameEnd
    if (startDelta === 0 || startDelta !== endDelta) continue
    for (const ref of assignment.regionRefs) {
      const region = regionForRef(state, ref)
      if (!region) continue
      state = moveDialogueRegionAudioToFrame(state, ref.trackId, ref.regionId, region.frameStart + startDelta)
    }
  }
  return synchronizeDialogueAssignmentsFromCues(state, nextSoundCues, revisionId)
}

export function synchronizeDialogueAssignmentsAfterAudioEdit(
  stateInput: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): { state: DialogueAudioCutState; cueUpdates: Array<{ cueId: string; frameStart: number; frameEnd: number }> } {
  let changed = false
  const tracks = stateInput.tracks.map(track => {
    let trackChanged = false
    const dialogueRegions = track.dialogueRegions.map(region => {
      const resolution = resolveDialogueRegion(track, region)
      if (!resolution) {
        if (region.status === 'orphaned' && region.reviewReason === 'リンク対象の音声がありません。') return region
        trackChanged = true
        return { ...region, status: 'orphaned' as const, reviewReason: 'リンク対象の音声がありません。' }
      }
      const frameStart = resolution.frameStart - region.headPaddingFrames
      const frameEnd = Math.max(frameStart, resolution.frameEnd + region.tailPaddingFrames)
      const status = resolution.complete ? 'ready' as const : 'review' as const
      const reviewReason = resolution.complete ? undefined : 'セリフ区間の音声の一部が削除されています。'
      if (region.frameStart === frameStart && region.frameEnd === frameEnd && region.status === status && region.reviewReason === reviewReason) return region
      trackChanged = true
      return { ...region, frameStart, frameEnd, status, reviewReason }
    })
    if (!trackChanged) return track
    changed = true
    return { ...track, dialogueRegions }
  })
  const stateWithRegions = changed ? { ...stateInput, tracks } : stateInput
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  const cueUpdates: Array<{ cueId: string; frameStart: number; frameEnd: number }> = []
  const assignments = stateWithRegions.assignments.map(assignment => {
    if (assignment.revisionId !== revisionId) return assignment
    const resolution = resolveDialogueAssignment(stateWithRegions, assignment)
    if (!resolution) {
      if (assignment.status === 'orphaned' && assignment.reviewReason === 'リンク対象の音声がありません。') return assignment
      changed = true
      return { ...assignment, status: 'orphaned' as const, reviewReason: 'リンク対象の音声がありません。' }
    }
    const frameStart = resolution.frameStart - assignment.headPaddingFrames
    const frameEnd = Math.max(frameStart, resolution.frameEnd + assignment.tailPaddingFrames)
    const cue = cueById.get(assignment.cueId)
    if (cue && (cue.frameStart !== frameStart || cue.frameEnd !== frameEnd)) cueUpdates.push({ cueId: cue.cueId, frameStart, frameEnd })
    const status = resolution.complete ? 'linked' as const : 'review' as const
    const reviewReason = resolution.complete ? undefined : 'リンク音声の一部が削除されています。'
    if (assignment.status === status && assignment.reviewReason === reviewReason) return assignment
    changed = true
    return { ...assignment, status, reviewReason }
  })
  return { state: changed ? { ...stateWithRegions, assignments } : stateWithRegions, cueUpdates }
}

export function resolveDialogueRegion(
  track: Pick<DialogueAudioTrackState, 'clips'>,
  region: Pick<DialogueRegion, 'anchors' | 'headPaddingFrames' | 'tailPaddingFrames'>,
): DialogueAssignmentResolution | null {
  const resolution = anchorTimelineEnvelope(track.clips, region.anchors)
  return resolution ? {
    frameStart: resolution.frameStart - region.headPaddingFrames,
    frameEnd: resolution.frameEnd + region.tailPaddingFrames,
    complete: resolution.complete,
  } : null
}

export function resolveDialogueAssignment(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  assignment: Pick<DialogueSoundAssignment, 'regionRefs'>,
): DialogueAssignmentResolution | null {
  return resolveRegionRefs(state, assignment.regionRefs)
}

export function assignmentForCue(state: DialogueAudioCutState, cueId: string, revisionId: string): DialogueSoundAssignment | undefined {
  return state.assignments.find(assignment => assignment.cueId === cueId && assignment.revisionId === revisionId)
}

export function assignmentForRegion(state: DialogueAudioCutState, ref: DialogueRegionReference, revisionId: string): DialogueSoundAssignment | undefined {
  const key = regionRefKey(ref)
  return state.assignments.find(assignment => assignment.revisionId === revisionId && assignment.regionRefs.some(item => regionRefKey(item) === key))
}

export function assignmentForCandidate(state: DialogueAudioCutState, candidateId: string, revisionId: string): DialogueSoundAssignment | undefined {
  for (const assignment of state.assignments) {
    if (assignment.revisionId !== revisionId) continue
    for (const ref of assignment.regionRefs) {
      if (regionForRef(state, ref)?.candidateIds.includes(candidateId)) return assignment
    }
  }
  return undefined
}

export function unlinkDialogueAudioRegion(
  state: DialogueAudioCutState,
  ref: DialogueRegionReference,
  revisionId: string,
): DialogueAudioCutState {
  const key = regionRefKey(ref)
  const assignments = state.assignments.flatMap(assignment => {
    if (assignment.revisionId !== revisionId) return [assignment]
    const regionRefs = assignment.regionRefs.filter(item => regionRefKey(item) !== key)
    return regionRefs.length > 0 ? [{ ...assignment, regionRefs }] : []
  })
  return refreshCandidateLinkStatus({ ...state, assignments })
}

export function unlinkDialogueAudioCue(
  state: DialogueAudioCutState,
  cueId: string,
  revisionId: string,
): DialogueAudioCutState {
  return refreshCandidateLinkStatus({
    ...state,
    assignments: state.assignments.filter(assignment => assignment.cueId !== cueId || assignment.revisionId !== revisionId),
  })
}

export function removeDialogueAudioRegion(
  state: DialogueAudioCutState,
  trackId: string,
  regionId: string,
): DialogueAudioCutState {
  const key = regionRefKey({ trackId, regionId })
  const assignments = state.assignments.flatMap(assignment => {
    const regionRefs = assignment.regionRefs.filter(ref => regionRefKey(ref) !== key)
    return regionRefs.length > 0 ? [{ ...assignment, regionRefs }] : []
  })
  return refreshCandidateLinkStatus({
    ...state,
    assignments,
    tracks: state.tracks.map(track => track.trackId === trackId
      ? { ...track, dialogueRegions: track.dialogueRegions.filter(region => region.regionId !== regionId) }
      : track),
  })
}

function refreshCandidateLinkStatus(state: DialogueAudioCutState): DialogueAudioCutState {
  const linkedCandidateIdsByTrack = new Map<string, Set<string>>()
  for (const assignment of state.assignments) {
    for (const ref of assignment.regionRefs) {
      const region = regionForRef(state, ref)
      if (!region) continue
      linkedCandidateIdsByTrack.set(ref.trackId, new Set([
        ...(linkedCandidateIdsByTrack.get(ref.trackId) ?? []),
        ...region.candidateIds,
      ]))
    }
  }
  return {
    ...state,
    tracks: state.tracks.map(track => {
      const linkedIds = linkedCandidateIdsByTrack.get(track.trackId) ?? new Set<string>()
      return {
        ...track,
        speechCandidates: track.speechCandidates.map(candidate => {
          if (linkedIds.has(candidate.candidateId)) {
            return candidate.status === 'pending'
              ? { ...candidate, status: 'linked' as const, reviewReason: undefined }
              : candidate
          }
          return candidate.status === 'linked'
            ? { ...candidate, status: 'pending' as const, reviewReason: undefined }
            : candidate
        }),
      }
    }),
  }
}

function resolveRegionRefs(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  refs: DialogueRegionReference[],
): DialogueAssignmentResolution | null {
  const resolutions = refs.flatMap(ref => {
    const track = state.tracks.find(item => item.trackId === ref.trackId)
    const region = track?.dialogueRegions.find(item => item.regionId === ref.regionId)
    if (!track || !region) return []
    const resolution = resolveDialogueRegion(track, region)
    return resolution ? [resolution] : []
  })
  if (resolutions.length === 0) return null
  return {
    frameStart: Math.min(...resolutions.map(item => item.frameStart)),
    frameEnd: Math.max(...resolutions.map(item => item.frameEnd)),
    complete: resolutions.length === refs.length && resolutions.every(item => item.complete),
  }
}

function regionForRef(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  ref: DialogueRegionReference,
): DialogueRegion | undefined {
  return state.tracks.find(track => track.trackId === ref.trackId)?.dialogueRegions.find(region => region.regionId === ref.regionId)
}

function anchorsForCandidates(clips: DialogueAudioClip[], candidates: DialogueSpeechCandidate[]): DialogueRegionAudioAnchor[] {
  const raw: DialogueRegionAudioAnchor[] = []
  for (const candidate of candidates) {
    for (const clip of clips) {
      const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
      const frameStart = Math.max(candidate.frameStart, clip.timelineStartFrame)
      const frameEnd = Math.min(candidate.frameEnd, clipEnd)
      if (frameEnd < frameStart) continue
      raw.push({
        anchorId: `${candidate.candidateId}-${clip.clipId}`,
        placementId: clip.placementId,
        assetId: clip.assetId,
        sourceFrameStart: clip.sourceOffsetFrames + frameStart - clip.timelineStartFrame,
        sourceFrameEnd: clip.sourceOffsetFrames + frameEnd - clip.timelineStartFrame,
        candidateIds: [candidate.candidateId],
      })
    }
  }
  return mergeAnchors(raw)
}

function mergeAnchors(anchors: DialogueRegionAudioAnchor[]): DialogueRegionAudioAnchor[] {
  return anchors
    .sort((left, right) => left.placementId.localeCompare(right.placementId) || left.sourceFrameStart - right.sourceFrameStart)
    .reduce<DialogueRegionAudioAnchor[]>((result, anchor) => {
      const previous = result.at(-1)
      if (previous && previous.placementId === anchor.placementId && previous.assetId === anchor.assetId && anchor.sourceFrameStart <= previous.sourceFrameEnd + 1) {
        previous.sourceFrameEnd = Math.max(previous.sourceFrameEnd, anchor.sourceFrameEnd)
        previous.candidateIds = [...new Set([...previous.candidateIds, ...anchor.candidateIds])]
      } else result.push({ ...anchor, candidateIds: [...anchor.candidateIds] })
      return result
    }, [])
}

function anchorTimelineEnvelope(clips: DialogueAudioClip[], anchors: DialogueRegionAudioAnchor[]): DialogueAssignmentResolution | null {
  if (anchors.length === 0) return null
  const mapped: Array<{ frameStart: number; frameEnd: number }> = []
  let complete = true
  for (const anchor of anchors) {
    let coveredFrames = 0
    for (const clip of clips) {
      if (clip.placementId !== anchor.placementId || clip.assetId !== anchor.assetId) continue
      const clipSourceEnd = clip.sourceOffsetFrames + clip.durationFrames - 1
      const sourceStart = Math.max(anchor.sourceFrameStart, clip.sourceOffsetFrames)
      const sourceEnd = Math.min(anchor.sourceFrameEnd, clipSourceEnd)
      if (sourceEnd < sourceStart) continue
      coveredFrames += sourceEnd - sourceStart + 1
      mapped.push({
        frameStart: clip.timelineStartFrame + sourceStart - clip.sourceOffsetFrames,
        frameEnd: clip.timelineStartFrame + sourceEnd - clip.sourceOffsetFrames,
      })
    }
    if (coveredFrames < anchor.sourceFrameEnd - anchor.sourceFrameStart + 1) complete = false
  }
  if (mapped.length === 0) return null
  return {
    frameStart: Math.min(...mapped.map(item => item.frameStart)),
    frameEnd: Math.max(...mapped.map(item => item.frameEnd)),
    complete,
  }
}

function uniqueRegionRefs(refs: DialogueRegionReference[]): DialogueRegionReference[] {
  const seen = new Set<string>()
  return refs.filter(ref => {
    const key = regionRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function regionRefKey(ref: DialogueRegionReference): string {
  return `${ref.trackId}\u0000${ref.regionId}`
}

function compareRegions(left: DialogueRegion, right: DialogueRegion): number {
  return left.frameStart - right.frameStart || left.regionId.localeCompare(right.regionId)
}

function nextId(prefix: string, usedIds: Set<string>): string {
  if (!usedIds.has(prefix)) return prefix
  let sequence = 2
  while (usedIds.has(`${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}
