import { describe, expect, it } from 'vitest'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { insertDialogueAudioSilence, moveDialogueAudioClip, moveDialogueRegionAudioToFrame, rippleDeleteDialogueAudioRange } from './dialogueAudioEditing'
import {
  assignDialogueRegionsToCue,
  createDialogueRegionFromCandidates,
  linkDialogueAudioCandidates,
  synchronizeDialogueAssignmentsAfterAudioEdit,
  synchronizeDialogueAssignmentsFromCues,
} from './dialogueAudioBinding'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'

const cue = (frameStart = 10, frameEnd = 38, cueId = 'cue-1', laneId = 'sound_lane_1'): TimedRangeCue => ({
  cueId, role: 'sound', laneId, frameStart, frameEnd, label: '主人公', text: '',
})

function sourceState() {
  const state = createDefaultDialogueAudioCutState(1)
  state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
  state.tracks[0].clips = [{
    clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48,
  }]
  state.tracks[0].speechCandidates = [
    { candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'pending' },
    { candidateId: 'vad-2', frameStart: 24, frameEnd: 35, status: 'pending' },
  ]
  return state
}

function linkedState() {
  return linkDialogueAudioCandidates(sourceState(), 'dialogue-1', ['vad-1', 'vad-2'], cue(), 'revision-1')
}

describe('dialogue region and sound assignments', () => {
  it('groups discontinuous VAD candidates into one continuous semantic region and assigns it to a wider cue', () => {
    const state = linkedState()
    expect(state.tracks[0].dialogueRegions).toEqual([
      expect.objectContaining({ frameStart: 12, frameEnd: 35, candidateIds: ['vad-1', 'vad-2'], status: 'ready' }),
    ])
    expect(state.assignments).toEqual([
      expect.objectContaining({
        cueId: 'cue-1',
        regionRefs: [{ trackId: 'dialogue-1', regionId: state.tracks[0].dialogueRegions[0].regionId }],
        headPaddingFrames: 2,
        tailPaddingFrames: 3,
        status: 'linked',
      }),
    ])
    expect(state.tracks[0].dialogueRegions[0].anchors.flatMap(anchor => anchor.candidateIds).sort()).toEqual(['vad-1', 'vad-2'])
  })

  it('lets one cue aggregate regions from different fixed audio tracks', () => {
    let state = sourceState()
    state.tracks[1].clips = [{
      clipId: 'clip-2', placementId: 'placement-2', assetId: 'asset-1', timelineStartFrame: 30, sourceOffsetFrames: 0, durationFrames: 18,
    }]
    state.tracks[1].speechCandidates = [{ candidateId: 'vad-b', frameStart: 32, frameEnd: 40, status: 'pending' }]
    const first = createDialogueRegionFromCandidates(state, 'dialogue-1', ['vad-1'])!
    const second = createDialogueRegionFromCandidates(first.state, 'dialogue-2', ['vad-b'])!
    state = assignDialogueRegionsToCue(second.state, [
      { trackId: 'dialogue-1', regionId: first.region.regionId },
    ], cue(10, 42), 'revision-1')
    state = assignDialogueRegionsToCue(state, [
      { trackId: 'dialogue-2', regionId: second.region.regionId },
    ], cue(10, 42), 'revision-1')

    expect(state.assignments[0].regionRefs).toEqual([
      { trackId: 'dialogue-1', regionId: first.region.regionId },
      { trackId: 'dialogue-2', regionId: second.region.regionId },
    ])
  })

  it('supports region-level reassignment between arbitrary cue lanes', () => {
    const created = createDialogueRegionFromCandidates(sourceState(), 'dialogue-1', ['vad-1'])!
    const ref = { trackId: 'dialogue-1', regionId: created.region.regionId }
    const assignedA = assignDialogueRegionsToCue(created.state, [ref], cue(12, 20, 'cue-a', 'sound_lane_1'), 'revision-1')
    const assignedB = assignDialogueRegionsToCue(assignedA, [ref], cue(12, 20, 'cue-b', 'sound_lane_3'), 'revision-1')
    expect(assignedB.assignments).toEqual([
      expect.objectContaining({ cueId: 'cue-b', regionRefs: [ref] }),
    ])
  })

  it('moves the label with its audio while preserving manual head and tail padding', () => {
    const state = linkedState()
    const movedTrack = moveDialogueAudioClip(state.tracks[0], 'clip-1', 9)
    const moved = { ...state, tracks: state.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    expect(synchronizeDialogueAssignmentsAfterAudioEdit(moved, [cue()], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 18, frameEnd: 46 }])
  })

  it('treats a cue-side stretch as assignment padding without moving audio', () => {
    const state = linkedState()
    const stretched = synchronizeDialogueAssignmentsFromCues(state, [cue(10, 40)], 'revision-1')
    expect(stretched.tracks[0].clips[0].timelineStartFrame).toBe(1)
    expect(stretched.assignments[0]).toMatchObject({ tailPaddingFrames: 5 })
    const movedTrack = moveDialogueAudioClip(stretched.tracks[0], 'clip-1', 9)
    const moved = { ...stretched, tracks: stretched.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    expect(synchronizeDialogueAssignmentsAfterAudioEdit(moved, [cue(10, 40)], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 18, frameEnd: 48 }])
  })

  it('moves only the anchored source slice when aligning a region to a pre-existing cue', () => {
    const created = createDialogueRegionFromCandidates(sourceState(), 'dialogue-1', ['vad-1'])!
    const moved = moveDialogueRegionAudioToFrame(created.state, 'dialogue-1', created.region.regionId, 30)
    expect(moved.tracks[0].clips.map(clip => [clip.timelineStartFrame, clip.sourceOffsetFrames, clip.durationFrames])).toEqual([
      [1, 0, 11],
      [21, 20, 28],
      [30, 11, 9],
    ])
    expect(moved.tracks[0].speechCandidates.find(item => item.candidateId === 'vad-1')).toMatchObject({ frameStart: 30, frameEnd: 38 })
    expect(moved.tracks[0].speechCandidates.find(item => item.candidateId === 'vad-2')).toMatchObject({ frameStart: 24, frameEnd: 35 })
  })

  it('preserves source anchors across a split and expands the cue around inserted silence', () => {
    const state = linkedState()
    const editedTrack = insertDialogueAudioSilence(state.tracks[0], 22, 3)
    expect(new Set(editedTrack.clips.map(clip => clip.placementId))).toEqual(new Set(['placement-1']))
    const edited = { ...state, tracks: state.tracks.map(track => track.trackId === editedTrack.trackId ? editedTrack : track) }
    expect(synchronizeDialogueAssignmentsAfterAudioEdit(edited, [cue()], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 10, frameEnd: 41 }])
  })

  it('keeps the assignment and marks it orphaned when all anchored audio is deleted', () => {
    const state = linkedState()
    const editedTrack = rippleDeleteDialogueAudioRange(state.tracks[0], { frameStart: 1, frameEnd: 48 })
    const edited = { ...state, tracks: state.tracks.map(track => track.trackId === editedTrack.trackId ? editedTrack : track) }
    const synchronized = synchronizeDialogueAssignmentsAfterAudioEdit(edited, [cue()], 'revision-1')
    expect(synchronized.cueUpdates).toEqual([])
    expect(synchronized.state.assignments[0]).toMatchObject({ status: 'orphaned' })
    expect(synchronized.state.tracks[0].dialogueRegions[0]).toMatchObject({ status: 'orphaned' })
  })

  it('leaves ordinary audio-less cues unassigned', () => {
    const state = createDefaultDialogueAudioCutState(1)
    const synchronized = synchronizeDialogueAssignmentsFromCues(state, [cue()], 'revision-1')
    expect(synchronized).toBe(state)
    expect(synchronized.assignments).toEqual([])
  })
})
