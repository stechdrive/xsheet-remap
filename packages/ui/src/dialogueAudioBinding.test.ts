import { describe, expect, it } from 'vitest'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { insertDialogueAudioSilence, moveDialogueAudioClip, moveDialogueRegionAudioToFrame, restoreDialogueSpeechCandidate, rippleDeleteDialogueAudioRange } from './dialogueAudioEditing'
import {
  bindDialogueRegionsToCue,
  createDialogueRegionFromCandidates,
  linkDialogueAudioCandidates,
  removeDialogueAudioRegion,
  synchronizeDialogueBindingsAfterAudioEdit,
  synchronizeDialogueBindingsFromCues,
  unlinkDialogueAudioCue,
  unlinkDialogueAudioRegion,
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

describe('dialogue region and SOUND bindings', () => {
  it('groups discontinuous VAD candidates into one continuous semantic region and assigns it to a wider cue', () => {
    const state = linkedState()
    expect(state.tracks[0].dialogueRegions).toEqual([
      expect.objectContaining({ frameStart: 12, frameEnd: 35, candidateIds: ['vad-1', 'vad-2'], status: 'ready' }),
    ])
    expect(state.soundBindings).toEqual([
      expect.objectContaining({
        cueId: 'cue-1',
        members: [expect.objectContaining({
          regionRef: { trackId: 'dialogue-1', regionId: state.tracks[0].dialogueRegions[0].regionId },
        })],
        headPaddingFrames: 2,
        tailPaddingFrames: 3,
        status: 'linked',
      }),
    ])
    expect(state.tracks[0].dialogueRegions[0].anchors.flatMap(anchor => anchor.candidateIds).sort()).toEqual(['vad-1', 'vad-2'])
  })

  it('anchors a detected range to its source placement instead of every overlapping clip', () => {
    const state = sourceState()
    state.assets.push({ assetId: 'asset-2', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] })
    state.tracks[0].clips.push({
      clipId: 'clip-2', placementId: 'placement-2', assetId: 'asset-2', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48,
    })
    state.tracks[0].speechCandidates = [{
      candidateId: 'vad-1',
      frameStart: 12,
      frameEnd: 20,
      status: 'pending',
      source: {
        placementId: 'placement-1',
        assetId: 'asset-1',
        sourceFrameStart: 11,
        sourceFrameEnd: 19,
      },
    }]
    const linked = linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1'], cue(10, 22), 'revision-1')
    expect(linked.tracks[0].dialogueRegions[0].anchors).toEqual([
      expect.objectContaining({ placementId: 'placement-1', assetId: 'asset-1' }),
    ])

    const movedOtherTrack = moveDialogueAudioClip(linked.tracks[0], 'clip-2', 20)
    const movedOther = { ...linked, tracks: linked.tracks.map(track => track.trackId === movedOtherTrack.trackId ? movedOtherTrack : track) }
    expect(synchronizeDialogueBindingsAfterAudioEdit(movedOther, [cue(10, 22)], 'revision-1').cueUpdates).toEqual([])
  })

  it('lets one cue aggregate regions from different fixed audio tracks', () => {
    let state = sourceState()
    state.tracks[1].clips = [{
      clipId: 'clip-2', placementId: 'placement-2', assetId: 'asset-1', timelineStartFrame: 30, sourceOffsetFrames: 0, durationFrames: 18,
    }]
    state.tracks[1].speechCandidates = [{ candidateId: 'vad-b', frameStart: 32, frameEnd: 40, status: 'pending' }]
    const first = createDialogueRegionFromCandidates(state, 'dialogue-1', ['vad-1'])!
    const second = createDialogueRegionFromCandidates(first.state, 'dialogue-2', ['vad-b'])!
    state = bindDialogueRegionsToCue(second.state, [
      { trackId: 'dialogue-1', regionId: first.region.regionId },
    ], cue(10, 42), 'revision-1')
    state = bindDialogueRegionsToCue(state, [
      { trackId: 'dialogue-2', regionId: second.region.regionId },
    ], cue(10, 42), 'revision-1')

    expect(state.soundBindings[0].members.map(member => member.regionRef)).toEqual([
      { trackId: 'dialogue-1', regionId: first.region.regionId },
      { trackId: 'dialogue-2', regionId: second.region.regionId },
    ])
  })

  it('supports region-level reassignment between arbitrary cue lanes', () => {
    const created = createDialogueRegionFromCandidates(sourceState(), 'dialogue-1', ['vad-1'])!
    const ref = { trackId: 'dialogue-1', regionId: created.region.regionId }
    const assignedA = bindDialogueRegionsToCue(created.state, [ref], cue(12, 20, 'cue-a', 'sound_lane_1'), 'revision-1')
    const assignedB = bindDialogueRegionsToCue(assignedA, [ref], cue(12, 20, 'cue-b', 'sound_lane_3'), 'revision-1')
    expect(assignedB.soundBindings).toEqual([
      expect.objectContaining({ cueId: 'cue-b', members: [expect.objectContaining({ regionRef: ref })] }),
    ])
  })

  it('moves the label with its audio while preserving manual head and tail padding', () => {
    const state = linkedState()
    const movedTrack = moveDialogueAudioClip(state.tracks[0], 'clip-1', 9)
    const moved = { ...state, tracks: state.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    expect(synchronizeDialogueBindingsAfterAudioEdit(moved, [cue()], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 18, frameEnd: 46 }])
  })

  it('treats a cue-side stretch as assignment padding without moving audio', () => {
    const state = linkedState()
    const stretched = synchronizeDialogueBindingsFromCues(state, [cue(10, 40)], 'revision-1')
    expect(stretched.tracks[0].clips[0].timelineStartFrame).toBe(1)
    expect(stretched.soundBindings[0]).toMatchObject({ tailPaddingFrames: 5 })
    const movedTrack = moveDialogueAudioClip(stretched.tracks[0], 'clip-1', 9)
    const moved = { ...stretched, tracks: stretched.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    expect(synchronizeDialogueBindingsAfterAudioEdit(moved, [cue(10, 40)], 'revision-1').cueUpdates)
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
    expect(synchronizeDialogueBindingsAfterAudioEdit(edited, [cue()], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 10, frameEnd: 41 }])
  })

  it('keeps the assignment and marks it orphaned when all anchored audio is deleted', () => {
    const state = linkedState()
    const editedTrack = rippleDeleteDialogueAudioRange(state.tracks[0], { frameStart: 1, frameEnd: 48 })
    const edited = { ...state, tracks: state.tracks.map(track => track.trackId === editedTrack.trackId ? editedTrack : track) }
    const synchronized = synchronizeDialogueBindingsAfterAudioEdit(edited, [cue()], 'revision-1')
    expect(synchronized.cueUpdates).toEqual([])
    expect(synchronized.state.soundBindings[0]).toMatchObject({ status: 'orphaned' })
    expect(synchronized.state.tracks[0].dialogueRegions[0]).toMatchObject({ status: 'orphaned' })
  })

  it('leaves ordinary audio-less cues unassigned', () => {
    const state = createDefaultDialogueAudioCutState(1)
    const synchronized = synchronizeDialogueBindingsFromCues(state, [cue()], 'revision-1')
    expect(synchronized).toBe(state)
    expect(synchronized.soundBindings).toEqual([])
  })

  it('unlinks one region without deleting its audio, VAD candidate, or semantic region', () => {
    const state = linkedState()
    const region = state.tracks[0].dialogueRegions[0]
    const unlinked = unlinkDialogueAudioRegion(state, { trackId: 'dialogue-1', regionId: region.regionId }, 'revision-1')
    expect(unlinked.soundBindings).toEqual([])
    expect(unlinked.tracks[0].clips).toEqual(state.tracks[0].clips)
    expect(unlinked.tracks[0].dialogueRegions).toEqual(state.tracks[0].dialogueRegions)
    expect(unlinked.tracks[0].speechCandidates.map(candidate => candidate.status)).toEqual(['pending', 'pending'])
  })

  it('preserves the cue range when one of several linked regions is unlinked', () => {
    const source = sourceState()
    const first = createDialogueRegionFromCandidates(source, 'dialogue-1', ['vad-1'])!
    const second = createDialogueRegionFromCandidates(first.state, 'dialogue-1', ['vad-2'])!
    const assigned = bindDialogueRegionsToCue(second.state, [
      { trackId: 'dialogue-1', regionId: first.region.regionId },
      { trackId: 'dialogue-1', regionId: second.region.regionId },
    ], cue(), 'revision-1')
    const unlinked = unlinkDialogueAudioRegion(
      assigned,
      { trackId: 'dialogue-1', regionId: first.region.regionId },
      'revision-1',
    )
    const repadded = synchronizeDialogueBindingsFromCues(unlinked, [cue()], 'revision-1')

    expect(repadded.soundBindings[0].members.map(member => member.regionRef)).toEqual([
      { trackId: 'dialogue-1', regionId: second.region.regionId },
    ])
    expect(synchronizeDialogueBindingsAfterAudioEdit(repadded, [cue()], 'revision-1').cueUpdates).toEqual([])
  })

  it('unlinks a cue assignment while preserving every referenced region', () => {
    const state = linkedState()
    const unlinked = unlinkDialogueAudioCue(state, 'cue-1', 'revision-1')
    expect(unlinked.soundBindings).toEqual([])
    expect(unlinked.tracks[0].dialogueRegions).toHaveLength(1)
    expect(unlinked.tracks[0].clips).toEqual(state.tracks[0].clips)
  })

  it('dissolves a semantic region while preserving audio and VAD candidates', () => {
    const state = linkedState()
    const region = state.tracks[0].dialogueRegions[0]
    const removed = removeDialogueAudioRegion(state, 'dialogue-1', region.regionId)
    expect(removed.soundBindings).toEqual([])
    expect(removed.tracks[0].dialogueRegions).toEqual([])
    expect(removed.tracks[0].clips).toEqual(state.tracks[0].clips)
    expect(removed.tracks[0].speechCandidates).toHaveLength(2)
  })

  it('restores an ignored candidate to a pending VAD candidate', () => {
    const track = sourceState().tracks[0]
    track.speechCandidates[0] = { ...track.speechCandidates[0], status: 'ignored' }
    expect(restoreDialogueSpeechCandidate(track, 'vad-1').speechCandidates[0].status).toBe('pending')
  })
})
