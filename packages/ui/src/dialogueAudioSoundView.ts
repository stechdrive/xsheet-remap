import type { LogicalTimelineLane, TimedRangeCue } from '@xsheet-remap/core'
import type { DialogueAudioCutState, DialogueSoundBinding } from './dialogueAudioProject'

export const SOUND_LIST_HEADER_HEIGHT = 28
export const SOUND_LIST_ROW_HEIGHT = 26

export function dialogueSoundLanes(lanes: LogicalTimelineLane[], cues: TimedRangeCue[]): LogicalTimelineLane[] {
  const result = [...lanes].sort((a, b) => a.order - b.order)
  const known = new Set(result.map(lane => lane.laneId))
  for (const cue of cues) {
    if (known.has(cue.laneId)) continue
    known.add(cue.laneId)
    result.push({ laneId: cue.laneId, label: `列 ${result.length + 1}`, order: result.length })
  }
  return result
}

export function soundListHeight(lanes: LogicalTimelineLane[], expanded: boolean): number {
  return SOUND_LIST_HEADER_HEIGHT + (expanded ? lanes.length * SOUND_LIST_ROW_HEIGHT : 0)
}

/** Resolve source anchors so split clips and several tracks retain the same instruction. */
export function linkedDialogueClips(state: DialogueAudioCutState, binding: DialogueSoundBinding | undefined): Array<{ trackId: string; clipId: string }> {
  if (!binding) return []
  return state.tracks.flatMap(track => {
    const ids = new Set(binding.members.filter(member => member.regionRef.trackId === track.trackId).map(member => member.regionRef.regionId))
    const anchors = track.dialogueRegions.filter(region => ids.has(region.regionId)).flatMap(region => region.anchors)
    return track.clips.filter(clip => anchors.some(anchor =>
      anchor.placementId === clip.placementId && anchor.assetId === clip.assetId
      && anchor.sourceFrameStart < clip.sourceOffsetFrames + clip.durationFrames
      && anchor.sourceFrameEnd >= clip.sourceOffsetFrames))
      .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)
      .map(clip => ({ trackId: track.trackId, clipId: clip.clipId }))
  })
}
