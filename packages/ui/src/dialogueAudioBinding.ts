import type { TimedRangeCue } from '@xsheet-remap/core'
import {
  type DialogueAudioClip,
  type DialogueAudioCutState,
  type DialogueCueAudioAnchor,
  type DialogueCueAudioBinding,
  type DialogueSpeechCandidate,
} from './dialogueAudioProject'

export interface DialogueBindingResolution {
  frameStart: number
  frameEnd: number
  complete: boolean
}

export function linkDialogueAudioCandidates(
  state: DialogueAudioCutState,
  trackId: string,
  candidateIds: string[],
  cue: Pick<TimedRangeCue, 'cueId' | 'frameStart' | 'frameEnd'>,
  revisionId: string,
  provisional = false,
): DialogueAudioCutState {
  const track = state.tracks.find(item => item.trackId === trackId)
  if (!track) return state
  const selectedIds = new Set(candidateIds)
  const candidates = track.speechCandidates.filter(candidate => selectedIds.has(candidate.candidateId))
  if (candidates.length === 0) return state
  const anchors = anchorsForCandidates(track.clips, candidates)
  const envelope = anchorTimelineEnvelope(track.clips, anchors)
  const usedBindingIds = new Set(state.bindings.map(binding => binding.bindingId))
  const bindingId = nextBindingId(`dialogue-binding-${cue.cueId}`, usedBindingIds)
  const binding: DialogueCueAudioBinding = {
    bindingId,
    cueId: cue.cueId,
    revisionId,
    trackId,
    anchors,
    headPaddingFrames: envelope ? envelope.frameStart - cue.frameStart : 0,
    tailPaddingFrames: envelope ? cue.frameEnd - envelope.frameEnd : 0,
    cueFrameStart: cue.frameStart,
    cueFrameEnd: cue.frameEnd,
    provisional,
    status: anchors.length > 0 ? 'linked' : 'orphaned',
    reviewReason: anchors.length > 0 ? undefined : '対応する音声クリップがありません。',
  }
  return {
    ...state,
    bindings: [
      ...state.bindings.filter(item => !(item.cueId === cue.cueId && item.revisionId === revisionId)),
      binding,
    ],
    tracks: state.tracks.map(item => item.trackId !== trackId ? item : {
      ...item,
      speechCandidates: item.speechCandidates.map(candidate => !selectedIds.has(candidate.candidateId) ? candidate : {
        ...candidate,
        status: 'linked',
        cueId: cue.cueId,
        revisionId,
        cueLinks: [
          ...(candidate.cueLinks ?? []).filter(link => link.revisionId !== revisionId),
          { cueId: cue.cueId, revisionId },
        ],
        reviewReason: undefined,
      }),
    }),
  }
}

export function migrateLegacyDialogueBindings(
  state: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): DialogueAudioCutState {
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  let next = state
  for (const track of state.tracks) {
    const candidateIdsByCue = new Map<string, string[]>()
    for (const candidate of track.speechCandidates) {
      const link = candidate.cueLinks?.find(item => item.revisionId === revisionId)
      if (!link || next.bindings.some(binding => binding.revisionId === revisionId && binding.cueId === link.cueId)) continue
      candidateIdsByCue.set(link.cueId, [...(candidateIdsByCue.get(link.cueId) ?? []), candidate.candidateId])
    }
    for (const [cueId, candidateIds] of candidateIdsByCue) {
      const cue = cueById.get(cueId)
      if (cue) next = linkDialogueAudioCandidates(next, track.trackId, candidateIds, cue, revisionId)
    }
  }
  return next
}

export function synchronizeDialogueBindingsFromCues(
  state: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): DialogueAudioCutState {
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  let changed = false
  const bindings = state.bindings.map(binding => {
    if (binding.revisionId !== revisionId) return binding
    const cue = cueById.get(binding.cueId)
    if (!cue) {
      if (binding.status === 'review' && binding.reviewReason === 'リンク先のSOUNDが見つかりません。') return binding
      changed = true
      return { ...binding, status: 'review' as const, reviewReason: 'リンク先のSOUNDが見つかりません。' }
    }
    const provisional = binding.provisional && cue.label.startsWith('仮・')
    if (cue.frameStart === binding.cueFrameStart && cue.frameEnd === binding.cueFrameEnd && provisional === binding.provisional) return binding
    const resolution = resolveDialogueBinding(state, binding)
    changed = true
    return {
      ...binding,
      headPaddingFrames: resolution ? resolution.frameStart - cue.frameStart : binding.headPaddingFrames,
      tailPaddingFrames: resolution ? cue.frameEnd - resolution.frameEnd : binding.tailPaddingFrames,
      cueFrameStart: cue.frameStart,
      cueFrameEnd: cue.frameEnd,
      provisional,
    }
  })
  return changed ? { ...state, bindings } : state
}

export function synchronizeDialogueBindingsAfterAudioEdit(
  stateInput: DialogueAudioCutState,
  soundCues: TimedRangeCue[],
  revisionId: string,
): { state: DialogueAudioCutState; cueUpdates: Array<{ cueId: string; frameStart: number; frameEnd: number }> } {
  const state = synchronizeDialogueBindingsFromCues(stateInput, soundCues, revisionId)
  const cueById = new Map(soundCues.map(cue => [cue.cueId, cue]))
  const cueUpdates: Array<{ cueId: string; frameStart: number; frameEnd: number }> = []
  let changed = state !== stateInput
  const bindings = state.bindings.map(binding => {
    if (binding.revisionId !== revisionId) return binding
    const resolution = resolveDialogueBinding(state, binding)
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
    if (binding.cueFrameStart === frameStart && binding.cueFrameEnd === frameEnd && binding.status === status && binding.reviewReason === reviewReason) return binding
    changed = true
    return { ...binding, cueFrameStart: frameStart, cueFrameEnd: frameEnd, status, reviewReason }
  })
  return { state: changed ? { ...state, bindings } : state, cueUpdates }
}

export function resolveDialogueBinding(
  state: Pick<DialogueAudioCutState, 'tracks'>,
  binding: DialogueCueAudioBinding,
): DialogueBindingResolution | null {
  const track = state.tracks.find(item => item.trackId === binding.trackId)
  if (!track || binding.anchors.length === 0) return null
  const mapped: Array<{ frameStart: number; frameEnd: number }> = []
  let complete = true
  for (const anchor of binding.anchors) {
    let coveredFrames = 0
    for (const clip of track.clips) {
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

export function bindingForCue(state: DialogueAudioCutState, cueId: string, revisionId: string): DialogueCueAudioBinding | undefined {
  return state.bindings.find(binding => binding.cueId === cueId && binding.revisionId === revisionId)
}

export function bindingForCandidate(state: DialogueAudioCutState, candidateId: string, revisionId: string): DialogueCueAudioBinding | undefined {
  return state.bindings.find(binding => binding.revisionId === revisionId && binding.anchors.some(anchor => anchor.candidateIds.includes(candidateId)))
}

function anchorsForCandidates(clips: DialogueAudioClip[], candidates: DialogueSpeechCandidate[]): DialogueCueAudioAnchor[] {
  const raw: DialogueCueAudioAnchor[] = []
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

function mergeAnchors(anchors: DialogueCueAudioAnchor[]): DialogueCueAudioAnchor[] {
  return anchors
    .sort((left, right) => left.placementId.localeCompare(right.placementId) || left.sourceFrameStart - right.sourceFrameStart)
    .reduce<DialogueCueAudioAnchor[]>((result, anchor) => {
      const previous = result.at(-1)
      if (previous && previous.placementId === anchor.placementId && previous.assetId === anchor.assetId && anchor.sourceFrameStart <= previous.sourceFrameEnd + 1) {
        previous.sourceFrameEnd = Math.max(previous.sourceFrameEnd, anchor.sourceFrameEnd)
        previous.candidateIds = [...new Set([...previous.candidateIds, ...anchor.candidateIds])]
      } else result.push({ ...anchor, candidateIds: [...anchor.candidateIds] })
      return result
    }, [])
}

function anchorTimelineEnvelope(clips: DialogueAudioClip[], anchors: DialogueCueAudioAnchor[]): DialogueBindingResolution | null {
  return resolveDialogueBinding({ tracks: [{ trackId: 'track', name: '', color: '', clips, speechCandidates: [], vadMode: 'candidates', muted: false, solo: false }] }, {
    bindingId: '', cueId: '', revisionId: '', trackId: 'track', anchors,
    headPaddingFrames: 0, tailPaddingFrames: 0, cueFrameStart: 0, cueFrameEnd: 0,
    provisional: false, status: 'linked',
  })
}

function nextBindingId(prefix: string, usedIds: Set<string>): string {
  if (!usedIds.has(prefix)) return prefix
  let sequence = 2
  while (usedIds.has(`${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}
