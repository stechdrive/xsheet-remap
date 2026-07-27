import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  type DialogueAudioClip,
  type DialogueAudioCutState,
  type DialogueAudioTrackState,
  type DialogueRegion,
  type DialogueRegionAudioAnchor,
  type DialogueRegionReference,
  type DialogueSoundBinding,
  type DialogueSpeechCandidate,
} from './dialogueAudioProject'
import { moveDialogueAudioClips, moveDialogueRegionAudioToFrame } from './dialogueAudioEditing'

export interface DialogueBindingResolution {
  frameStart: number
  frameEnd: number
  complete: boolean
}

export type DialogueSoundBindingCommand =
  | {
      type: 'add-members'
      cue: Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>
      regionRefs: DialogueRegionReference[]
      revisionId: string
      soundCues?: Array<Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>>
    }
  | { type: 'remove-member'; regionRef: DialogueRegionReference; revisionId: string }
  | { type: 'remove-binding'; cueId: string; revisionId: string }

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

export function applyDialogueSoundBindingCommand(
  state: DialogueAudioCutState,
  command: DialogueSoundBindingCommand,
): DialogueAudioCutState {
  if (command.type === 'add-members') {
    return bindDialogueRegionsToCue(
      state,
      command.regionRefs,
      command.cue,
      command.revisionId,
      command.soundCues ?? [command.cue],
    )
  }
  if (command.type === 'remove-member') {
    return unlinkDialogueAudioRegion(state, command.regionRef, command.revisionId)
  }
  return unlinkDialogueAudioCue(state, command.cueId, command.revisionId)
}

export function bindDialogueRegionsToCue(
  state: DialogueAudioCutState,
  regionRefsInput: DialogueRegionReference[],
  cue: Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>,
  revisionId: string,
  soundCues: Array<Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>> = [cue],
): DialogueAudioCutState {
  const regionRefs = uniqueRegionRefs(regionRefsInput).filter(ref => regionForRef(state, ref))
  if (regionRefs.length === 0) return state
  const selectedKeys = new Set(regionRefs.map(regionRefKey))
  const target = state.soundBindings.find(item => item.cueId === cue.cueId && item.revisionId === revisionId)
  const retainedBindings = state.soundBindings.flatMap(binding => {
    if (binding.revisionId !== revisionId || binding === target) return binding === target ? [] : [binding]
    const retainedMembers = binding.members.filter(member => !selectedKeys.has(regionRefKey(member.regionRef)))
    if (retainedMembers.length === 0) return []
    const retainedRefs = retainedMembers.map(member => member.regionRef)
    const retainedResolution = resolveRegionRefs(state, retainedRefs)
    const retainedCue = soundCues.find(item => item.cueId === binding.cueId)
    return [{
      ...binding,
      members: retainedMembers,
      headPaddingFrames: retainedResolution && retainedCue ? retainedResolution.frameStart - retainedCue.frameStart : binding.headPaddingFrames,
      tailPaddingFrames: retainedResolution && retainedCue ? retainedCue.frameEnd - retainedResolution.frameEnd : binding.tailPaddingFrames,
      status: retainedResolution ? (retainedResolution.complete ? 'linked' as const : 'review' as const) : 'orphaned' as const,
      reviewReason: retainedResolution ? (retainedResolution.complete ? undefined : 'リンク音声の一部が削除されています。') : 'リンク対象の音声がありません。',
    }]
  })
  const usedMemberIds = new Set(state.soundBindings.flatMap(binding => binding.members.map(member => member.memberId)))
  const targetMembers = [...(target?.members ?? [])]
  const targetKeys = new Set(targetMembers.map(member => regionRefKey(member.regionRef)))
  for (const regionRef of regionRefs) {
    const key = regionRefKey(regionRef)
    if (targetKeys.has(key)) continue
    const memberId = nextId(`dialogue-sound-member-${regionRef.trackId}-${regionRef.regionId}`, usedMemberIds)
    usedMemberIds.add(memberId)
    targetKeys.add(key)
    targetMembers.push({ memberId, regionRef })
  }
  const targetRefs = targetMembers.map(member => member.regionRef)
  const resolution = resolveRegionRefs(state, targetRefs)
  const binding: DialogueSoundBinding = {
    bindingId: target?.bindingId
      ?? nextId(`dialogue-sound-binding-${cue.cueId}`, new Set(state.soundBindings.map(item => item.bindingId))),
    cueId: cue.cueId,
    revisionId,
    members: targetMembers,
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
    soundBindings: [...retainedBindings, binding],
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
    ? bindDialogueRegionsToCue(created.state, [{ trackId, regionId: created.region.regionId }], cue, revisionId)
    : state
}

export function synchronizeDialogueBindingsFromCues(
  state: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): DialogueAudioCutState {
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  let changed = false
  const soundBindings = state.soundBindings.map(binding => {
    if (binding.revisionId !== revisionId) return binding
    const cue = cueById.get(binding.cueId)
    if (!cue) {
      if (binding.status === 'review' && binding.reviewReason === 'リンク先の音響指示が見つかりません。') return binding
      changed = true
      return { ...binding, status: 'review' as const, reviewReason: 'リンク先の音響指示が見つかりません。' }
    }
    const resolution = resolveDialogueBinding(state, binding)
    const next = {
      ...binding,
      headPaddingFrames: resolution ? resolution.frameStart - cue.frameStart : binding.headPaddingFrames,
      tailPaddingFrames: resolution ? cue.frameEnd - resolution.frameEnd : binding.tailPaddingFrames,
      status: resolution ? (resolution.complete ? 'linked' as const : 'review' as const) : 'orphaned' as const,
      reviewReason: resolution ? (resolution.complete ? undefined : 'リンク音声の一部が削除されています。') : 'リンク対象の音声がありません。',
    }
    if (next.headPaddingFrames === binding.headPaddingFrames
      && next.tailPaddingFrames === binding.tailPaddingFrames
      && next.status === binding.status
      && next.reviewReason === binding.reviewReason) return binding
    changed = true
    return next
  })
  return changed ? { ...state, soundBindings } : state
}

export type DialogueSoundCueChangeIntent = 'move-binding' | 'resize-cue' | 'reconcile'

export function applySoundCueChangesToDialogueAudio(
  stateInput: DialogueAudioCutState,
  previousSoundCues: TimedRangeCue[],
  nextSoundCues: TimedRangeCue[],
  revisionId: string,
  intent: DialogueSoundCueChangeIntent = 'reconcile',
): DialogueAudioCutState {
  const previousById = new Map(previousSoundCues.map(cue => [cue.cueId, cue]))
  const nextById = new Map(nextSoundCues.map(cue => [cue.cueId, cue]))
  let state = stateInput
  for (const binding of stateInput.soundBindings) {
    if (binding.revisionId !== revisionId) continue
    const previous = previousById.get(binding.cueId)
    const next = nextById.get(binding.cueId)
    if (!previous || !next) continue
    if (intent !== 'move-binding') continue
    const delta = next.frameStart - previous.frameStart
    if (delta === 0 || next.frameEnd - previous.frameEnd !== delta) continue
    for (const member of binding.members) {
      const ref = member.regionRef
      const region = regionForRef(state, ref)
      if (!region) continue
      state = moveDialogueRegionAudioToFrame(state, ref.trackId, ref.regionId, region.frameStart + delta)
    }
  }
  return synchronizeDialogueBindingsFromCues(state, nextSoundCues, revisionId)
}

export function synchronizeDialogueBindingsAfterAudioEdit(
  stateInput: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): { state: DialogueAudioCutState; cueUpdates: Array<{ cueId: string; frameStart: number; frameEnd: number }> } {
  let changed = false
  const tracks = stateInput.tracks.map(track => {
    let trackChanged = false
    const dialogueRegions = track.dialogueRegions.map(region => {
      const resolution = anchorTimelineEnvelope(track.clips, region.anchors)
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
  const soundBindings = stateWithRegions.soundBindings.map(binding => {
    if (binding.revisionId !== revisionId) return binding
    const resolution = resolveDialogueBinding(stateWithRegions, binding)
    if (!resolution) {
      if (binding.status === 'orphaned' && binding.reviewReason === 'リンク対象の音声がありません。') return binding
      changed = true
      return { ...binding, status: 'orphaned' as const, reviewReason: 'リンク対象の音声がありません。' }
    }
    const frameStart = resolution.frameStart - binding.headPaddingFrames
    const frameEnd = Math.max(frameStart, resolution.frameEnd + binding.tailPaddingFrames)
    const cue = cueById.get(binding.cueId)
    if (cue && (cue.frameStart !== frameStart || cue.frameEnd !== frameEnd)) cueUpdates.push({ cueId: cue.cueId, frameStart, frameEnd })
    const status = resolution.complete ? 'linked' as const : 'review' as const
    const reviewReason = resolution.complete ? undefined : 'リンク音声の一部が削除されています。'
    if (binding.status === status && binding.reviewReason === reviewReason) return binding
    changed = true
    return { ...binding, status, reviewReason }
  })
  return { state: changed ? { ...stateWithRegions, soundBindings } : stateWithRegions, cueUpdates }
}

export function createDialogueAudioClipDragPreview(
  cutState: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  activeRevisionId: string,
  trackId: string,
  clipIds: string[],
  deltaFrames: number,
): { cutState: DialogueAudioCutState; soundCues: TimedRangeCue[] } {
  const track = cutState.tracks.find(item => item.trackId === trackId)
  if (!track || deltaFrames === 0) return { cutState, soundCues }
  const movedTrack = moveDialogueAudioClips(track, clipIds, deltaFrames)
  const movedState = {
    ...cutState,
    tracks: cutState.tracks.map(item => item.trackId === trackId ? movedTrack : item),
  }
  const synchronized = synchronizeDialogueBindingsAfterAudioEdit(movedState, soundCues, activeRevisionId)
  if (synchronized.cueUpdates.length === 0) return { cutState: synchronized.state, soundCues }
  const cueUpdates = new Map(synchronized.cueUpdates.map(update => [update.cueId, update]))
  return {
    cutState: synchronized.state,
    soundCues: soundCues.map(cue => {
      const update = cueUpdates.get(cue.cueId)
      return update ? { ...cue, frameStart: update.frameStart, frameEnd: update.frameEnd } : cue
    }),
  }
}

export function resolveDialogueRegion(
  track: Pick<DialogueAudioTrackState, 'clips'>,
  region: Pick<DialogueRegion, 'anchors' | 'headPaddingFrames' | 'tailPaddingFrames'>,
): DialogueBindingResolution | null {
  const resolution = anchorTimelineEnvelope(track.clips, region.anchors)
  return resolution ? {
    frameStart: resolution.frameStart - region.headPaddingFrames,
    frameEnd: resolution.frameEnd + region.tailPaddingFrames,
    complete: resolution.complete,
  } : null
}

export function resolveDialogueBinding(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  binding: Pick<DialogueSoundBinding, 'members'>,
): DialogueBindingResolution | null {
  return resolveRegionRefs(state, binding.members.map(member => member.regionRef))
}

export function bindingForCue(state: DialogueAudioCutState, cueId: string, revisionId: string): DialogueSoundBinding | undefined {
  return state.soundBindings.find(binding => binding.cueId === cueId && binding.revisionId === revisionId)
}

export function bindingForRegion(state: DialogueAudioCutState, ref: DialogueRegionReference, revisionId: string): DialogueSoundBinding | undefined {
  const key = regionRefKey(ref)
  return state.soundBindings.find(binding =>
    binding.revisionId === revisionId
    && binding.members.some(member => regionRefKey(member.regionRef) === key))
}

export function bindingForCandidate(state: DialogueAudioCutState, candidateId: string, revisionId: string): DialogueSoundBinding | undefined {
  for (const binding of state.soundBindings) {
    if (binding.revisionId !== revisionId) continue
    for (const member of binding.members) {
      if (regionForRef(state, member.regionRef)?.candidateIds.includes(candidateId)) return binding
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
  const soundBindings = state.soundBindings.flatMap(binding => {
    if (binding.revisionId !== revisionId) return [binding]
    const members = binding.members.filter(member => regionRefKey(member.regionRef) !== key)
    return members.length > 0 ? [{ ...binding, members }] : []
  })
  return refreshCandidateLinkStatus({ ...state, soundBindings })
}

export function unlinkDialogueAudioCue(
  state: DialogueAudioCutState,
  cueId: string,
  revisionId: string,
): DialogueAudioCutState {
  return refreshCandidateLinkStatus({
    ...state,
    soundBindings: state.soundBindings.filter(binding => binding.cueId !== cueId || binding.revisionId !== revisionId),
  })
}

export function removeDialogueAudioRegion(
  state: DialogueAudioCutState,
  trackId: string,
  regionId: string,
): DialogueAudioCutState {
  const key = regionRefKey({ trackId, regionId })
  const soundBindings = state.soundBindings.flatMap(binding => {
    const members = binding.members.filter(member => regionRefKey(member.regionRef) !== key)
    return members.length > 0 ? [{ ...binding, members }] : []
  })
  return refreshCandidateLinkStatus({
    ...state,
    soundBindings,
    tracks: state.tracks.map(track => track.trackId === trackId
      ? { ...track, dialogueRegions: track.dialogueRegions.filter(region => region.regionId !== regionId) }
      : track),
  })
}

function refreshCandidateLinkStatus(state: DialogueAudioCutState): DialogueAudioCutState {
  const linkedCandidateIdsByTrack = new Map<string, Set<string>>()
  for (const binding of state.soundBindings) {
    for (const member of binding.members) {
      const region = regionForRef(state, member.regionRef)
      if (!region) continue
      linkedCandidateIdsByTrack.set(member.regionRef.trackId, new Set([
        ...(linkedCandidateIdsByTrack.get(member.regionRef.trackId) ?? []),
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
): DialogueBindingResolution | null {
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
    if (candidate.source) {
      for (const clip of clips) {
        if (clip.placementId !== candidate.source.placementId || clip.assetId !== candidate.source.assetId) continue
        const clipSourceEnd = clip.sourceOffsetFrames + clip.durationFrames - 1
        const sourceFrameStart = Math.max(candidate.source.sourceFrameStart, clip.sourceOffsetFrames)
        const sourceFrameEnd = Math.min(candidate.source.sourceFrameEnd, clipSourceEnd)
        if (sourceFrameEnd < sourceFrameStart) continue
        raw.push({
          anchorId: `${candidate.candidateId}-${clip.clipId}`,
          placementId: clip.placementId,
          assetId: clip.assetId,
          sourceFrameStart,
          sourceFrameEnd,
          candidateIds: [candidate.candidateId],
        })
      }
      continue
    }
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

function anchorTimelineEnvelope(clips: DialogueAudioClip[], anchors: DialogueRegionAudioAnchor[]): DialogueBindingResolution | null {
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
