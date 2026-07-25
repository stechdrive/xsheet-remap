import type {
  DialogueAudioClip,
  DialogueAudioCutState,
  DialogueAudioTrackState,
  DialogueSpeechCandidate,
  DialogueSpeechRange,
  DialogueSpeechSource,
} from './dialogueAudioProject'

export function moveDialogueRegionAudioToFrame(
  state: DialogueAudioCutState,
  trackId: string,
  regionId: string,
  targetFrameStartInput: number,
): DialogueAudioCutState {
  const track = state.tracks.find(item => item.trackId === trackId)
  const region = track?.dialogueRegions.find(item => item.regionId === regionId)
  if (!track || !region || region.anchors.length === 0) return state
  const targetFrameStart = Math.round(targetFrameStartInput)
  const delta = targetFrameStart - region.frameStart
  if (delta === 0) return state
  const anchors = region.anchors
  const usedClipIds = new Set(track.clips.map(clip => clip.clipId))
  const clips = track.clips.flatMap(clip => {
    const clipSourceStart = clip.sourceOffsetFrames
    const clipSourceEnd = clip.sourceOffsetFrames + clip.durationFrames - 1
    const relevant = anchors.filter(anchor =>
      anchor.placementId === clip.placementId
      && anchor.assetId === clip.assetId
      && anchor.sourceFrameStart <= clipSourceEnd
      && anchor.sourceFrameEnd >= clipSourceStart)
    if (relevant.length === 0) return [clip]
    const boundaries = new Set([clipSourceStart, clipSourceEnd + 1])
    relevant.forEach(anchor => {
      boundaries.add(Math.max(clipSourceStart, anchor.sourceFrameStart))
      boundaries.add(Math.min(clipSourceEnd, anchor.sourceFrameEnd) + 1)
    })
    const sortedBoundaries = [...boundaries].sort((left, right) => left - right)
    return sortedBoundaries.slice(0, -1).map((sourceOffsetFrames, index) => {
      const sourceEnd = sortedBoundaries[index + 1] - 1
      const selected = relevant.some(anchor => anchor.sourceFrameStart <= sourceOffsetFrames && anchor.sourceFrameEnd >= sourceEnd)
      const clipId = sortedBoundaries.length === 2
        ? clip.clipId
        : nextUniqueId(`${clip.clipId}-region`, usedClipIds)
      usedClipIds.add(clipId)
      return {
        ...clip,
        clipId,
        timelineStartFrame: clip.timelineStartFrame + sourceOffsetFrames - clip.sourceOffsetFrames + (selected ? delta : 0),
        sourceOffsetFrames,
        durationFrames: sourceEnd - sourceOffsetFrames + 1,
      }
    })
  })
  const movedCandidateIds = new Set(region.candidateIds)
  const nextTrack: DialogueAudioTrackState = {
    ...track,
    clips: orderedClips(clips),
    speechCandidates: track.speechCandidates.map(candidate => movedCandidateIds.has(candidate.candidateId)
      ? { ...candidate, frameStart: candidate.frameStart + delta, frameEnd: candidate.frameEnd + delta }
      : candidate),
    dialogueRegions: track.dialogueRegions.map(item => item.regionId === regionId
      ? { ...item, frameStart: item.frameStart + delta, frameEnd: item.frameEnd + delta }
      : item),
  }
  return {
    ...state,
    tracks: state.tracks.map(item => item.trackId === trackId ? nextTrack : item),
  }
}

export interface DialogueAudioRange {
  frameStart: number
  frameEnd: number
}

export interface DialogueAudioClipboard {
  spanFrames: number
  clips: Array<Omit<DialogueAudioClip, 'clipId' | 'placementId' | 'timelineStartFrame'> & {
    offsetFrames: number
    placementKey: string
  }>
  candidates: Array<Pick<DialogueSpeechCandidate, 'frameStart' | 'frameEnd'> & {
    offsetStart: number
    offsetEnd: number
    source?: Omit<DialogueSpeechSource, 'placementId'> & { placementKey: string }
  }>
}

export function normalizeDialogueAudioRange(frameStart: number, frameEnd: number): DialogueAudioRange {
  return {
    frameStart: Math.round(Math.min(frameStart, frameEnd)),
    frameEnd: Math.round(Math.max(frameStart, frameEnd)),
  }
}

export function moveDialogueAudioClip(
  track: DialogueAudioTrackState,
  clipId: string,
  timelineStartFrameInput: number,
): DialogueAudioTrackState {
  const source = track.clips.find(clip => clip.clipId === clipId)
  if (!source) return track
  const timelineStartFrame = Math.round(timelineStartFrameInput)
  return moveDialogueAudioClips(track, [clipId], timelineStartFrame - source.timelineStartFrame)
}

export function moveDialogueAudioClips(
  track: DialogueAudioTrackState,
  clipIdsInput: string[],
  deltaFramesInput: number,
): DialogueAudioTrackState {
  const selectedIds = new Set(clipIdsInput)
  const selectedClips = track.clips.filter(clip => selectedIds.has(clip.clipId))
  const deltaFrames = Math.round(deltaFramesInput)
  if (selectedClips.length === 0 || deltaFrames === 0) return track
  return {
    ...track,
    clips: orderedClips(track.clips.map(clip => selectedIds.has(clip.clipId)
      ? { ...clip, timelineStartFrame: clip.timelineStartFrame + deltaFrames }
      : clip)),
    speechCandidates: track.speechCandidates
      .map(candidate => moveCandidateWithSelectedClips(candidate, track.clips, selectedIds, deltaFrames))
      .sort(compareCandidates),
  }
}

export function silenceDialogueAudioRange(track: DialogueAudioTrackState, rangeInput: DialogueAudioRange): DialogueAudioTrackState {
  const range = normalizeDialogueAudioRange(rangeInput.frameStart, rangeInput.frameEnd)
  return {
    ...track,
    clips: track.clips.flatMap(clip => subtractRangeFromClip(clip, range)),
    speechCandidates: track.speechCandidates.flatMap(candidate => {
      if (!rangesOverlap(candidate, range)) return [candidate]
      if (candidate.status === 'linked' || candidate.status === 'review') {
        return [{ ...candidate, status: 'review', reviewReason: 'リンク済み区間の音声が無音化されました。' }]
      }
      return []
    }),
  }
}

export function rippleDeleteDialogueAudioRange(track: DialogueAudioTrackState, rangeInput: DialogueAudioRange): DialogueAudioTrackState {
  const range = normalizeDialogueAudioRange(rangeInput.frameStart, rangeInput.frameEnd)
  const frameCount = range.frameEnd - range.frameStart + 1
  const clips = track.clips.flatMap(clip => subtractRangeFromClip(clip, range)).map(clip => (
    clip.timelineStartFrame > range.frameEnd
      ? { ...clip, timelineStartFrame: clip.timelineStartFrame - frameCount }
      : clip
  ))
  return {
    ...track,
    clips: orderedClips(clips),
    speechCandidates: track.speechCandidates.flatMap(candidate => transformCandidateAfterDelete(candidate, range, frameCount)),
  }
}

export function insertDialogueAudioSilence(track: DialogueAudioTrackState, atFrameInput: number, frameCountInput: number): DialogueAudioTrackState {
  const atFrame = Math.round(atFrameInput)
  const frameCount = Math.max(1, Math.round(frameCountInput))
  const clips = track.clips.flatMap(clip => {
    const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
    if (clipEnd < atFrame) return [clip]
    if (clip.timelineStartFrame >= atFrame) return [{ ...clip, timelineStartFrame: clip.timelineStartFrame + frameCount }]
    const leftDuration = atFrame - clip.timelineStartFrame
    const rightDuration = clip.durationFrames - leftDuration
    return [
      { ...clip, durationFrames: leftDuration },
      {
        ...clip,
        clipId: `${clip.clipId}-split-${atFrame}`,
        timelineStartFrame: atFrame + frameCount,
        sourceOffsetFrames: clip.sourceOffsetFrames + leftDuration,
        durationFrames: rightDuration,
      },
    ]
  })
  return {
    ...track,
    clips: orderedClips(clips),
    speechCandidates: track.speechCandidates.map(candidate => {
      if (candidate.frameEnd < atFrame) return candidate
      if (candidate.frameStart >= atFrame) {
        return { ...candidate, frameStart: candidate.frameStart + frameCount, frameEnd: candidate.frameEnd + frameCount }
      }
      return { ...candidate, frameEnd: candidate.frameEnd + frameCount }
    }),
  }
}

export function addDialogueAudioClip(
  track: DialogueAudioTrackState,
  clip: DialogueAudioClip,
): DialogueAudioTrackState {
  return {
    ...track,
    clips: orderedClips([...track.clips, clip]),
  }
}

export function copyDialogueAudioRange(track: DialogueAudioTrackState, rangeInput: DialogueAudioRange): DialogueAudioClipboard {
  const range = normalizeDialogueAudioRange(rangeInput.frameStart, rangeInput.frameEnd)
  return {
    spanFrames: range.frameEnd - range.frameStart + 1,
    clips: track.clips.flatMap(clip => {
      const sliced = sliceClipToRange(clip, range)
      return sliced ? [{
        assetId: sliced.assetId,
        sourceOffsetFrames: sliced.sourceOffsetFrames,
        durationFrames: sliced.durationFrames,
        offsetFrames: sliced.timelineStartFrame - range.frameStart,
        placementKey: sliced.placementId,
      }] : []
    }),
    candidates: track.speechCandidates.flatMap(candidate => {
      if (!rangesOverlap(candidate, range)) return []
      const frameStart = Math.max(candidate.frameStart, range.frameStart)
      const frameEnd = Math.min(candidate.frameEnd, range.frameEnd)
      return [{
        frameStart,
        frameEnd,
        offsetStart: frameStart - range.frameStart,
        offsetEnd: frameEnd - range.frameStart,
        source: clipboardSourceForCandidate(candidate, frameStart, frameEnd),
      }]
    }),
  }
}

export function copyDialogueAudioClips(track: DialogueAudioTrackState, clipIdsInput: string[]): DialogueAudioClipboard | null {
  const selectedIds = new Set(clipIdsInput)
  const clips = track.clips.filter(clip => selectedIds.has(clip.clipId))
  if (clips.length === 0) return null
  const frameStart = Math.min(...clips.map(clip => clip.timelineStartFrame))
  const frameEnd = Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames - 1))
  const candidates = track.speechCandidates.filter(candidate =>
    candidateBelongsExclusivelyToSelectedClips(candidate, track.clips, selectedIds))
  return {
    spanFrames: frameEnd - frameStart + 1,
    clips: clips.map(clip => ({
      assetId: clip.assetId,
      sourceOffsetFrames: clip.sourceOffsetFrames,
      durationFrames: clip.durationFrames,
      offsetFrames: clip.timelineStartFrame - frameStart,
      placementKey: clip.placementId,
    })),
    candidates: candidates.map(candidate => ({
      frameStart: candidate.frameStart,
      frameEnd: candidate.frameEnd,
      offsetStart: candidate.frameStart - frameStart,
      offsetEnd: candidate.frameEnd - frameStart,
      source: candidate.source ? {
        placementKey: candidate.source.placementId,
        assetId: candidate.source.assetId,
        sourceFrameStart: candidate.source.sourceFrameStart,
        sourceFrameEnd: candidate.source.sourceFrameEnd,
      } : undefined,
    })),
  }
}

export function pasteDialogueAudioClipboard(
  track: DialogueAudioTrackState,
  clipboard: DialogueAudioClipboard,
  atFrameInput: number,
  mode: 'overwrite' | 'insert',
): DialogueAudioTrackState {
  const atFrame = Math.round(atFrameInput)
  const prepared = mode === 'insert'
    ? insertDialogueAudioSilence(track, atFrame, clipboard.spanFrames)
    : silenceDialogueAudioRange(track, { frameStart: atFrame, frameEnd: atFrame + clipboard.spanFrames - 1 })
  const usedClipIds = new Set(prepared.clips.map(item => item.clipId))
  const usedPlacementIds = new Set(prepared.clips.map(item => item.placementId))
  const pastedPlacementIds = new Map<string, string>()
  const clips = clipboard.clips.map(clip => {
    const clipId = nextUniqueId(`${track.trackId}-clip-paste`, usedClipIds)
    usedClipIds.add(clipId)
    let placementId = pastedPlacementIds.get(clip.placementKey)
    if (!placementId) {
      placementId = nextUniqueId(`${track.trackId}-placement-paste`, usedPlacementIds)
      usedPlacementIds.add(placementId)
      pastedPlacementIds.set(clip.placementKey, placementId)
    }
    return {
      clipId,
      placementId,
      assetId: clip.assetId,
      timelineStartFrame: atFrame + clip.offsetFrames,
      sourceOffsetFrames: clip.sourceOffsetFrames,
      durationFrames: clip.durationFrames,
    }
  })
  const usedCandidateIds = new Set(prepared.speechCandidates.map(candidate => candidate.candidateId))
  const candidates = clipboard.candidates.map(candidate => {
    const candidateId = nextUniqueId(`${track.trackId}-candidate-paste`, usedCandidateIds)
    usedCandidateIds.add(candidateId)
    return {
      candidateId,
      frameStart: atFrame + candidate.offsetStart,
      frameEnd: atFrame + candidate.offsetEnd,
      status: 'pending' as const,
      source: candidate.source && pastedPlacementIds.has(candidate.source.placementKey) ? {
        placementId: pastedPlacementIds.get(candidate.source.placementKey)!,
        assetId: candidate.source.assetId,
        sourceFrameStart: candidate.source.sourceFrameStart,
        sourceFrameEnd: candidate.source.sourceFrameEnd,
      } : undefined,
    }
  })
  return {
    ...prepared,
    clips: orderedClips([...prepared.clips, ...clips]),
    speechCandidates: [...prepared.speechCandidates, ...candidates].sort(compareCandidates),
  }
}

export function removeDialogueAudioClips(
  track: DialogueAudioTrackState,
  clipIdsInput: string[],
): DialogueAudioTrackState {
  const removedIds = new Set(clipIdsInput)
  if (!track.clips.some(clip => removedIds.has(clip.clipId))) return track
  const remainingClips = track.clips.filter(clip => !removedIds.has(clip.clipId))
  return {
    ...track,
    clips: remainingClips,
    speechCandidates: track.speechCandidates.flatMap(candidate => {
      const removedCoverage = candidateCoverage(candidate, track.clips.filter(clip => removedIds.has(clip.clipId)))
      if (!removedCoverage) return [candidate]
      const remainingCoverage = candidateCoverage(candidate, remainingClips)
      if (remainingCoverage) {
        return [{
          ...candidate,
          status: 'review' as const,
          reviewReason: 'VAD区間に対応する音声クリップの一部が削除されました。',
        }]
      }
      if (candidate.status === 'linked' || candidate.status === 'review') {
        return [{
          ...candidate,
          status: 'review' as const,
          reviewReason: 'リンク済みVAD区間の音声クリップが削除されました。',
        }]
      }
      return []
    }),
  }
}

export interface DialogueSpeechDetectionSource {
  placementId: string
  assetId: string
  timelineStartFrame: number
  sourceOffsetFrames: number
  sourceFrameStart: number
  sourceFrameEnd: number
}

export function reconcileDialogueSpeechCandidates(
  existing: DialogueSpeechCandidate[],
  detectedRanges: DialogueSpeechRange[],
  trackId: string,
  detectionSource?: DialogueSpeechDetectionSource,
): DialogueSpeechCandidate[] {
  const processed = existing.filter(candidate =>
    candidate.status !== 'pending'
    && (!detectionSource || candidateIsInDetectionScope(candidate, detectionSource)))
  const retained = detectionSource
    ? existing.filter(candidate => !candidateIsInDetectionScope(candidate, detectionSource))
    : []
  const usedProcessed = new Set<string>()
  const usedIds = new Set(existing.map(candidate => candidate.candidateId))
  const result: DialogueSpeechCandidate[] = [...retained]
  for (const detected of detectedRanges.map(range => normalizeDialogueAudioRange(range.frameStart, range.frameEnd))) {
    const match = processed
      .filter(candidate => !usedProcessed.has(candidate.candidateId))
      .map(candidate => ({ candidate, score: overlapRatio(candidate, detected) }))
      .sort((left, right) => right.score - left.score)[0]
    if (match && match.score >= 0.25) {
      usedProcessed.add(match.candidate.candidateId)
      result.push({
        ...match.candidate,
        ...detected,
        source: detectionSource ? sourceForDetectedRange(detected, detectionSource) : match.candidate.source,
      })
      continue
    }
    const candidateId = nextUniqueId(`${trackId}-candidate`, usedIds)
    usedIds.add(candidateId)
    result.push({
      candidateId,
      ...detected,
      status: 'pending',
      source: detectionSource ? sourceForDetectedRange(detected, detectionSource) : undefined,
    })
  }
  for (const candidate of processed) {
    if (usedProcessed.has(candidate.candidateId)) continue
    if (candidate.status === 'ignored') {
      result.push(candidate)
      continue
    }
    result.push({
      ...candidate,
      status: 'review',
      reviewReason: candidate.reviewReason ?? '再検出結果に対応する発話が見つかりませんでした。',
    })
  }
  return result.sort(compareCandidates)
}

function candidateIsInDetectionScope(
  candidate: DialogueSpeechCandidate,
  source: DialogueSpeechDetectionSource,
): boolean {
  return candidate.source?.placementId === source.placementId
    && candidate.source.assetId === source.assetId
    && candidate.source.sourceFrameStart <= source.sourceFrameEnd
    && candidate.source.sourceFrameEnd >= source.sourceFrameStart
}

function sourceForDetectedRange(
  detected: DialogueAudioRange,
  source: DialogueSpeechDetectionSource,
): DialogueSpeechSource {
  return {
    placementId: source.placementId,
    assetId: source.assetId,
    sourceFrameStart: source.sourceOffsetFrames + detected.frameStart - source.timelineStartFrame,
    sourceFrameEnd: source.sourceOffsetFrames + detected.frameEnd - source.timelineStartFrame,
  }
}

export function ignoreDialogueSpeechCandidate(track: DialogueAudioTrackState, candidateId: string): DialogueAudioTrackState {
  return {
    ...track,
    speechCandidates: track.speechCandidates.map(candidate => candidate.candidateId === candidateId
      ? { ...candidate, status: 'ignored', cueId: undefined, revisionId: undefined, reviewReason: undefined }
      : candidate),
  }
}

export function restoreDialogueSpeechCandidate(track: DialogueAudioTrackState, candidateId: string): DialogueAudioTrackState {
  return {
    ...track,
    speechCandidates: track.speechCandidates.map(candidate => candidate.candidateId === candidateId && candidate.status === 'ignored'
      ? { ...candidate, status: 'pending', reviewReason: undefined }
      : candidate),
  }
}

export function nextUniqueId(prefix: string, usedIds: ReadonlySet<string>): string {
  let sequence = 1
  let candidate = `${prefix}-${sequence}`
  while (usedIds.has(candidate)) {
    sequence += 1
    candidate = `${prefix}-${sequence}`
  }
  return candidate
}

function subtractRangeFromClip(clip: DialogueAudioClip, range: DialogueAudioRange): DialogueAudioClip[] {
  const clipStart = clip.timelineStartFrame
  const clipEnd = clipStart + clip.durationFrames - 1
  if (clipEnd < range.frameStart || clipStart > range.frameEnd) return [clip]
  const result: DialogueAudioClip[] = []
  if (clipStart < range.frameStart) {
    result.push({ ...clip, durationFrames: range.frameStart - clipStart })
  }
  if (clipEnd > range.frameEnd) {
    const timelineStartFrame = range.frameEnd + 1
    result.push({
      ...clip,
      clipId: `${clip.clipId}-split-${timelineStartFrame}`,
      timelineStartFrame,
      sourceOffsetFrames: clip.sourceOffsetFrames + (timelineStartFrame - clipStart),
      durationFrames: clipEnd - range.frameEnd,
    })
  }
  return result
}

function sliceClipToRange(clip: DialogueAudioClip, range: DialogueAudioRange): DialogueAudioClip | null {
  const clipEnd = clip.timelineStartFrame + clip.durationFrames - 1
  const frameStart = Math.max(clip.timelineStartFrame, range.frameStart)
  const frameEnd = Math.min(clipEnd, range.frameEnd)
  if (frameEnd < frameStart) return null
  return {
    ...clip,
    timelineStartFrame: frameStart,
    sourceOffsetFrames: clip.sourceOffsetFrames + (frameStart - clip.timelineStartFrame),
    durationFrames: frameEnd - frameStart + 1,
  }
}

function transformCandidateAfterDelete(
  candidate: DialogueSpeechCandidate,
  range: DialogueAudioRange,
  frameCount: number,
): DialogueSpeechCandidate[] {
  if (candidate.frameEnd < range.frameStart) return [candidate]
  if (candidate.frameStart > range.frameEnd) {
    return [{ ...candidate, frameStart: candidate.frameStart - frameCount, frameEnd: candidate.frameEnd - frameCount }]
  }
  const hasLeft = candidate.frameStart < range.frameStart
  const hasRight = candidate.frameEnd > range.frameEnd
  if (!hasLeft && !hasRight) {
    if (candidate.status !== 'linked' && candidate.status !== 'review') return []
    return [{
      ...candidate,
      frameStart: range.frameStart,
      frameEnd: range.frameStart,
      status: 'review',
      reviewReason: 'リンク済み区間の音声がリップル削除されました。',
    }]
  }
  return [{
    ...candidate,
    frameStart: hasLeft ? candidate.frameStart : range.frameStart,
    frameEnd: hasRight ? candidate.frameEnd - frameCount : range.frameStart - 1,
  }]
}

function moveCandidateWithSelectedClips(
  candidate: DialogueSpeechCandidate,
  clips: DialogueAudioClip[],
  selectedIds: Set<string>,
  deltaFrames: number,
): DialogueSpeechCandidate {
  const selectedClips = clips.filter(clip => selectedIds.has(clip.clipId))
  const unselectedClips = clips.filter(clip => !selectedIds.has(clip.clipId))
  const selectedCoverage = candidateCoverage(candidate, selectedClips)
  if (!selectedCoverage) return candidate
  const unselectedCoverage = candidateCoverage(candidate, unselectedClips)
  if (!unselectedCoverage && candidateBelongsExclusivelyToSelectedClips(candidate, clips, selectedIds)) {
    return {
      ...candidate,
      frameStart: candidate.frameStart + deltaFrames,
      frameEnd: candidate.frameEnd + deltaFrames,
    }
  }
  return {
    ...candidate,
    status: 'review',
    reviewReason: 'VAD区間が移動対象と未選択の音声クリップにまたがっています。',
  }
}

function candidateBelongsExclusivelyToSelectedClips(
  candidate: DialogueSpeechCandidate,
  clips: DialogueAudioClip[],
  selectedIds: Set<string>,
): boolean {
  const relevant = clips.filter(clip => candidateCoverage(candidate, [clip]))
  if (relevant.length === 0 || relevant.some(clip => !selectedIds.has(clip.clipId))) return false
  if (candidate.source) return sourceRangeCovered(candidate.source, relevant)
  return relevant.some(clip =>
    candidate.frameStart >= clip.timelineStartFrame
    && candidate.frameEnd <= clip.timelineStartFrame + clip.durationFrames - 1)
}

function candidateCoverage(candidate: DialogueSpeechCandidate, clips: DialogueAudioClip[]): boolean {
  if (candidate.source) {
    return clips.some(clip =>
      clip.placementId === candidate.source!.placementId
      && clip.assetId === candidate.source!.assetId
      && clip.sourceOffsetFrames <= candidate.source!.sourceFrameEnd
      && clip.sourceOffsetFrames + clip.durationFrames - 1 >= candidate.source!.sourceFrameStart)
  }
  return clips.some(clip => rangesOverlap(candidate, {
    frameStart: clip.timelineStartFrame,
    frameEnd: clip.timelineStartFrame + clip.durationFrames - 1,
  }))
}

function sourceRangeCovered(source: DialogueSpeechSource, clips: DialogueAudioClip[]): boolean {
  const ranges = clips
    .filter(clip => clip.placementId === source.placementId && clip.assetId === source.assetId)
    .map(clip => ({
      frameStart: Math.max(source.sourceFrameStart, clip.sourceOffsetFrames),
      frameEnd: Math.min(source.sourceFrameEnd, clip.sourceOffsetFrames + clip.durationFrames - 1),
    }))
    .filter(range => range.frameEnd >= range.frameStart)
    .sort((left, right) => left.frameStart - right.frameStart)
  if (ranges.length === 0 || ranges[0].frameStart > source.sourceFrameStart) return false
  let coveredEnd = ranges[0].frameEnd
  for (const range of ranges.slice(1)) {
    if (range.frameStart > coveredEnd + 1) return false
    coveredEnd = Math.max(coveredEnd, range.frameEnd)
  }
  return coveredEnd >= source.sourceFrameEnd
}

function clipboardSourceForCandidate(
  candidate: DialogueSpeechCandidate,
  frameStart: number,
  frameEnd: number,
): DialogueAudioClipboard['candidates'][number]['source'] {
  if (!candidate.source) return undefined
  return {
    placementKey: candidate.source.placementId,
    assetId: candidate.source.assetId,
    sourceFrameStart: candidate.source.sourceFrameStart + frameStart - candidate.frameStart,
    sourceFrameEnd: candidate.source.sourceFrameEnd - (candidate.frameEnd - frameEnd),
  }
}

function rangesOverlap(left: DialogueAudioRange, right: DialogueAudioRange): boolean {
  return left.frameStart <= right.frameEnd && left.frameEnd >= right.frameStart
}

function overlapRatio(left: DialogueAudioRange, right: DialogueAudioRange): number {
  const intersection = Math.max(0, Math.min(left.frameEnd, right.frameEnd) - Math.max(left.frameStart, right.frameStart) + 1)
  const union = Math.max(left.frameEnd, right.frameEnd) - Math.min(left.frameStart, right.frameStart) + 1
  return union > 0 ? intersection / union : 0
}

function orderedClips(clips: DialogueAudioClip[]): DialogueAudioClip[] {
  return clips.filter(clip => clip.durationFrames > 0).sort((left, right) => (
    left.timelineStartFrame - right.timelineStartFrame || left.clipId.localeCompare(right.clipId)
  ))
}

function compareCandidates(left: DialogueSpeechCandidate, right: DialogueSpeechCandidate): number {
  return left.frameStart - right.frameStart || left.candidateId.localeCompare(right.candidateId)
}
