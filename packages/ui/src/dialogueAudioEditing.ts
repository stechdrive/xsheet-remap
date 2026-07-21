import type {
  DialogueAudioClip,
  DialogueAudioTrackState,
  DialogueSpeechCandidate,
  DialogueSpeechRange,
} from './dialogueAudioProject'

export interface DialogueAudioRange {
  frameStart: number
  frameEnd: number
}

export interface DialogueAudioClipboard {
  spanFrames: number
  clips: Array<Omit<DialogueAudioClip, 'clipId' | 'placementId' | 'timelineStartFrame'> & { offsetFrames: number }>
  candidates: Array<Pick<DialogueSpeechCandidate, 'frameStart' | 'frameEnd'> & { offsetStart: number; offsetEnd: number }>
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
  const delta = timelineStartFrame - source.timelineStartFrame
  if (delta === 0) return track
  const sourceEnd = source.timelineStartFrame + source.durationFrames - 1
  return {
    ...track,
    clips: orderedClips(track.clips.map(clip => clip.clipId === clipId ? { ...clip, timelineStartFrame } : clip)),
    speechCandidates: track.speechCandidates.map(candidate => {
      if (candidate.frameStart >= source.timelineStartFrame && candidate.frameEnd <= sourceEnd) {
        return { ...candidate, frameStart: candidate.frameStart + delta, frameEnd: candidate.frameEnd + delta }
      }
      if (!rangesOverlap(candidate, { frameStart: source.timelineStartFrame, frameEnd: sourceEnd })) return candidate
      return { ...candidate, status: 'review', reviewReason: '複数クリップにまたがるVAD区間の音声が移動されました。' }
    }),
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

export function replaceDialogueAudioRangeWithClip(
  track: DialogueAudioTrackState,
  range: DialogueAudioRange,
  clip: DialogueAudioClip,
  detectedRanges: DialogueSpeechRange[],
): DialogueAudioTrackState {
  const silenced = silenceDialogueAudioRange(track, range)
  const unaffected = silenced.speechCandidates.filter(candidate => !rangesOverlap(candidate, range))
  const affectedProcessed = silenced.speechCandidates.filter(candidate => rangesOverlap(candidate, range))
  const nextCandidates = reconcileDialogueSpeechCandidates(
    affectedProcessed,
    detectedRanges,
    track.trackId,
  )
  return {
    ...silenced,
    clips: orderedClips([...silenced.clips, clip]),
    speechCandidates: [...unaffected, ...nextCandidates].sort(compareCandidates),
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
      }] : []
    }),
    candidates: track.speechCandidates.flatMap(candidate => {
      if (!rangesOverlap(candidate, range)) return []
      const frameStart = Math.max(candidate.frameStart, range.frameStart)
      const frameEnd = Math.min(candidate.frameEnd, range.frameEnd)
      return [{ frameStart, frameEnd, offsetStart: frameStart - range.frameStart, offsetEnd: frameEnd - range.frameStart }]
    }),
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
  const clips = clipboard.clips.map(clip => {
    const clipId = nextUniqueId(`${track.trackId}-clip-paste`, usedClipIds)
    usedClipIds.add(clipId)
    return {
      clipId,
      placementId: clipId,
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
    }
  })
  return {
    ...prepared,
    clips: orderedClips([...prepared.clips, ...clips]),
    speechCandidates: [...prepared.speechCandidates, ...candidates].sort(compareCandidates),
  }
}

export function reconcileDialogueSpeechCandidates(
  existing: DialogueSpeechCandidate[],
  detectedRanges: DialogueSpeechRange[],
  trackId: string,
): DialogueSpeechCandidate[] {
  const processed = existing.filter(candidate => candidate.status !== 'pending')
  const usedProcessed = new Set<string>()
  const usedIds = new Set(existing.map(candidate => candidate.candidateId))
  const result: DialogueSpeechCandidate[] = []
  for (const detected of detectedRanges.map(range => normalizeDialogueAudioRange(range.frameStart, range.frameEnd))) {
    const match = processed
      .filter(candidate => !usedProcessed.has(candidate.candidateId))
      .map(candidate => ({ candidate, score: overlapRatio(candidate, detected) }))
      .sort((left, right) => right.score - left.score)[0]
    if (match && match.score >= 0.25) {
      usedProcessed.add(match.candidate.candidateId)
      result.push({ ...match.candidate, ...detected })
      continue
    }
    const candidateId = nextUniqueId(`${trackId}-candidate`, usedIds)
    usedIds.add(candidateId)
    result.push({ candidateId, ...detected, status: 'pending' })
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

export function ignoreDialogueSpeechCandidate(track: DialogueAudioTrackState, candidateId: string): DialogueAudioTrackState {
  return {
    ...track,
    speechCandidates: track.speechCandidates.map(candidate => candidate.candidateId === candidateId
      ? { ...candidate, status: 'ignored', cueId: undefined, revisionId: undefined, reviewReason: undefined }
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
