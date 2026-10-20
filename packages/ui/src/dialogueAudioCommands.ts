import { createDialogueAudioTrack, type DialogueAudioClip, type DialogueAudioCutState, type DialogueAudioTrackState, type DialogueRegionReference } from './dialogueAudioProject'

export function addDialogueAudioTrack(state: DialogueAudioCutState, name?: string): DialogueAudioCutState {
  let sequence = state.tracks.length + 1
  while (state.tracks.some(track => track.trackId === `dialogue-${sequence}`)) sequence++
  const track = createDialogueAudioTrack(`dialogue-${sequence}`, state.tracks.length, name)
  return { ...state, activeTrackId: track.trackId, tracks: [...state.tracks, track] }
}

export function removeDialogueAudioTrack(state: DialogueAudioCutState, trackId: string): DialogueAudioCutState {
  const removed = editableTrack(state, trackId)
  if (state.tracks.length === 1) throw new Error('最後の音声トラックは削除できません。クリップを削除してください。')
  const tracks = state.tracks.filter(track => track !== removed)
  // Keep semantic labels and their orphaned source anchors after deleting sound.
  const owner = tracks[0]
  const regionIds = new Map(removed.dialogueRegions.map(region => [region.regionId, `${trackId}:${region.regionId}`]))
  return { ...state, activeTrackId: state.activeTrackId === trackId ? owner.trackId : state.activeTrackId,
    tracks: tracks.map(track => track !== owner ? track : { ...track, dialogueRegions: [...track.dialogueRegions, ...removed.dialogueRegions.map(region => ({ ...region, regionId: regionIds.get(region.regionId)!, status: 'orphaned' as const }))] }),
    soundBindings: state.soundBindings.map(binding => ({ ...binding, members: binding.members.map(member => member.regionRef.trackId !== trackId ? member : {
      ...member, regionRef: { trackId: owner.trackId, regionId: regionIds.get(member.regionRef.regionId)! },
    }) })),
  }
}

export function reorderDialogueAudioTrack(state: DialogueAudioCutState, trackId: string, index: number): DialogueAudioCutState {
  const track = state.tracks.find(item => item.trackId === trackId)
  if (!track) return state
  const tracks = state.tracks.filter(item => item !== track)
  tracks.splice(Math.max(0, Math.min(tracks.length, index)), 0, track)
  return { ...state, tracks }
}

export function splitDialogueAudioClips(state: DialogueAudioCutState, clipIds: string[], frame: number): DialogueAudioCutState {
  const selected = new Set(clipIds), ids = new Set(state.tracks.flatMap(track => track.clips.map(clip => clip.clipId)))
  let changed = false
  const tracks = state.tracks.map(track => ({ ...track, clips: track.clips.flatMap(clip => {
    if (!selected.has(clip.clipId) || frame <= clip.timelineStartFrame || frame >= clip.timelineStartFrame + clip.durationFrames) return [clip]
    editableTrack(state, track.trackId)
    let id = `${clip.clipId}-split`; while (ids.has(id)) id += '-2'; ids.add(id)
    const left = frame - clip.timelineStartFrame
    changed = true
    return [{ ...clip, durationFrames: left }, { ...clip, clipId: id, timelineStartFrame: frame, sourceOffsetFrames: clip.sourceOffsetFrames + left, durationFrames: clip.durationFrames - left }]
  }) }))
  return changed ? { ...state, tracks } : state
}

export function moveDialogueClips(state: DialogueAudioCutState, sourceTrackId: string, clipIds: string[], delta: number, destinationTrackId = sourceTrackId, frameOrigin = 1): DialogueAudioCutState {
  const source = editableTrack(state, sourceTrackId), destination = editableTrack(state, destinationTrackId)
  const selected = new Set(clipIds), moved = source.clips.filter(clip => selected.has(clip.clipId)).map(clip => ({ ...clip, timelineStartFrame: clip.timelineStartFrame + delta }))
  if (!moved.length || delta === 0 && source === destination) return state
  if (moved.some(clip => clip.timelineStartFrame < frameOrigin)) throw new Error('音声をタイムラインの開始より前には移動できません。')
  const remaining = destination.clips.filter(clip => source !== destination || !selected.has(clip.clipId))
  assertNoNewOverlap(moved, remaining)
  return { ...state, activeTrackId: destinationTrackId, tracks: state.tracks.map(track => {
    if (track === destination) return { ...track, clips: sortClips([...remaining, ...moved]) }
    if (track === source) return { ...track, clips: track.clips.filter(clip => !selected.has(clip.clipId)) }
    return track
  }) }
}

export function trimDialogueAudioClip(state: DialogueAudioCutState, trackId: string, clipId: string, edge: 'start' | 'end', frame: number, frameOrigin = 1): DialogueAudioCutState {
  const track = editableTrack(state, trackId), clip = track.clips.find(item => item.clipId === clipId)
  if (!clip) return state
  const asset = state.assets.find(item => item.assetId === clip.assetId)!
  const end = clip.timelineStartFrame + clip.durationFrames
  const first = Math.max(frameOrigin, clip.timelineStartFrame - clip.sourceOffsetFrames)
  const last = clip.timelineStartFrame + asset.durationFrames - clip.sourceOffsetFrames
  const boundary = Math.round(edge === 'start' ? Math.max(first, Math.min(end - 1, frame)) : Math.max(clip.timelineStartFrame + 1, Math.min(last, frame)))
  const next = edge === 'start' ? { ...clip, timelineStartFrame: boundary, sourceOffsetFrames: clip.sourceOffsetFrames + boundary - clip.timelineStartFrame, durationFrames: end - boundary }
    : { ...clip, durationFrames: boundary - clip.timelineStartFrame }
  assertNoNewOverlap([next], track.clips.filter(item => item !== clip))
  return { ...state, tracks: state.tracks.map(item => item !== track ? item : { ...track, clips: sortClips(track.clips.map(item => item === clip ? next : item)) }) }
}

/** Each SOUND creation gets independent anchors, so one clip can support several recording windows. */
export function regionsForDialogueClips(state: DialogueAudioCutState, refs: { trackId: string; clipId: string }[]): { state: DialogueAudioCutState; refs: DialogueRegionReference[] } {
  const regions: DialogueRegionReference[] = []
  const tracks = state.tracks.map(track => {
    const selected = new Set(refs.filter(ref => ref.trackId === track.trackId).map(ref => ref.clipId))
    const used = new Set(track.dialogueRegions.map(region => region.regionId))
    const created = track.clips.filter(clip => selected.has(clip.clipId)).map(clip => {
      let id = `clip-region-${clip.clipId}`; while (used.has(id)) id += '-2'; used.add(id)
      regions.push({ trackId: track.trackId, regionId: id })
      return { regionId: id, frameStart: clip.timelineStartFrame, frameEnd: clip.timelineStartFrame + clip.durationFrames - 1, candidateIds: [], headPaddingFrames: 0, tailPaddingFrames: 0, status: 'ready' as const,
        anchors: [{ anchorId: id, placementId: clip.placementId, assetId: clip.assetId, sourceFrameStart: clip.sourceOffsetFrames, sourceFrameEnd: clip.sourceOffsetFrames + clip.durationFrames - 1, candidateIds: [] }] }
    })
    return created.length ? { ...track, dialogueRegions: [...track.dialogueRegions, ...created] } : track
  })
  return { state: { ...state, tracks }, refs: regions }
}

export function isDialogueTrackAudible(state: DialogueAudioCutState, track: DialogueAudioTrackState): boolean {
  return !track.muted && (!state.tracks.some(item => item.solo) || Boolean(track.solo))
}

function editableTrack(state: DialogueAudioCutState, id: string) {
  const track = state.tracks.find(item => item.trackId === id)
  if (!track) throw new Error('音声トラックが見つかりません。')
  if (track.locked) throw new Error('音声トラックをロック解除してください。')
  return track
}
function sortClips(clips: DialogueAudioClip[]) { return clips.sort((a, b) => a.timelineStartFrame - b.timelineStartFrame || a.clipId.localeCompare(b.clipId)) }
function assertNoNewOverlap(clips: DialogueAudioClip[], others: DialogueAudioClip[]) {
  if (clips.some(clip => others.some(other => clip.timelineStartFrame < other.timelineStartFrame + other.durationFrames && other.timelineStartFrame < clip.timelineStartFrame + clip.durationFrames))) {
    throw new Error('移動先のクリップと重なります。空いている位置または別のトラックへ移動してください。')
  }
}
