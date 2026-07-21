import { describe, expect, it } from 'vitest'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { insertDialogueAudioSilence, moveDialogueAudioClip, rippleDeleteDialogueAudioRange } from './dialogueAudioEditing'
import {
  linkDialogueAudioCandidates,
  synchronizeDialogueBindingsAfterAudioEdit,
  synchronizeDialogueBindingsFromCues,
} from './dialogueAudioBinding'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'

const cue = (frameStart = 10, frameEnd = 38): TimedRangeCue => ({
  cueId: 'cue-1', role: 'sound', laneId: 'sound_lane_1', frameStart, frameEnd, label: '主人公', text: '',
})

function linkedState() {
  const state = createDefaultDialogueAudioCutState(1)
  state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
  state.tracks[0].clips = [{
    clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48,
  }]
  state.tracks[0].speechCandidates = [
    { candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'pending' },
    { candidateId: 'vad-2', frameStart: 24, frameEnd: 35, status: 'pending' },
  ]
  return linkDialogueAudioCandidates(state, 'dialogue-1', ['vad-1', 'vad-2'], cue(), 'revision-1')
}

describe('dialogue SOUND/audio bindings', () => {
  it('binds multiple discontinuous VAD regions to one deliberately wider SOUND label', () => {
    const state = linkedState()
    expect(state.bindings).toHaveLength(1)
    expect(state.bindings[0]).toMatchObject({
      cueId: 'cue-1', trackId: 'dialogue-1', headPaddingFrames: 2, tailPaddingFrames: 3, status: 'linked',
    })
    expect(state.bindings[0].anchors.flatMap(anchor => anchor.candidateIds).sort()).toEqual(['vad-1', 'vad-2'])
  })

  it('moves the label with its audio while preserving manual head and tail padding', () => {
    const state = linkedState()
    const movedTrack = moveDialogueAudioClip(state.tracks[0], 'clip-1', 9)
    const moved = { ...state, tracks: state.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    const synchronized = synchronizeDialogueBindingsAfterAudioEdit(moved, [cue()], 'revision-1')
    expect(synchronized.cueUpdates).toEqual([{ cueId: 'cue-1', frameStart: 18, frameEnd: 46 }])
  })

  it('treats a sheet-side label stretch as padding and does not move audio', () => {
    const state = linkedState()
    const stretched = synchronizeDialogueBindingsFromCues(state, [cue(10, 40)], 'revision-1')
    expect(stretched.tracks[0].clips[0].timelineStartFrame).toBe(1)
    expect(stretched.bindings[0]).toMatchObject({ tailPaddingFrames: 5, cueFrameEnd: 40 })
    const movedTrack = moveDialogueAudioClip(stretched.tracks[0], 'clip-1', 9)
    const moved = { ...stretched, tracks: stretched.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track) }
    expect(synchronizeDialogueBindingsAfterAudioEdit(moved, [cue(10, 40)], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 18, frameEnd: 48 }])
  })

  it('confirms a provisional binding when the temporary label is renamed', () => {
    const state = linkDialogueAudioCandidates(
      createDefaultDialogueAudioCutState(1),
      'dialogue-1',
      [],
      cue(),
      'revision-1',
      true,
    )
    expect(state.bindings).toEqual([])

    const linked = linkedState()
    linked.bindings[0] = { ...linked.bindings[0], provisional: true }
    const confirmed = synchronizeDialogueBindingsFromCues(linked, [{ ...cue(), label: '主人公' }], 'revision-1')
    expect(confirmed.bindings[0].provisional).toBe(false)
  })

  it('preserves anchors across a split and expands the label around inserted silence', () => {
    const state = linkedState()
    const editedTrack = insertDialogueAudioSilence(state.tracks[0], 22, 3)
    expect(new Set(editedTrack.clips.map(clip => clip.placementId))).toEqual(new Set(['placement-1']))
    const edited = { ...state, tracks: state.tracks.map(track => track.trackId === editedTrack.trackId ? editedTrack : track) }
    expect(synchronizeDialogueBindingsAfterAudioEdit(edited, [cue()], 'revision-1').cueUpdates)
      .toEqual([{ cueId: 'cue-1', frameStart: 10, frameEnd: 41 }])
  })

  it('keeps the SOUND and marks it orphaned when all anchored audio is deleted', () => {
    const state = linkedState()
    const editedTrack = rippleDeleteDialogueAudioRange(state.tracks[0], { frameStart: 1, frameEnd: 48 })
    const edited = { ...state, tracks: state.tracks.map(track => track.trackId === editedTrack.trackId ? editedTrack : track) }
    const synchronized = synchronizeDialogueBindingsAfterAudioEdit(edited, [cue()], 'revision-1')
    expect(synchronized.cueUpdates).toEqual([])
    expect(synchronized.state.bindings[0]).toMatchObject({ status: 'orphaned' })
  })

  it('leaves ordinary audio-less SOUND labels unbound', () => {
    const state = createDefaultDialogueAudioCutState(1)
    const synchronized = synchronizeDialogueBindingsFromCues(state, [cue()], 'revision-1')
    expect(synchronized).toBe(state)
    expect(synchronized.bindings).toEqual([])
  })
})
