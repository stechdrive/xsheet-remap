import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '@xsheet-remap/core'
import { createDefaultDialogueAudioCutState, dialogueAudioCutStateFromProject, updateDialogueAudioCutStateInProject, DIALOGUE_AUDIO_EXTENSION } from './dialogueAudioProject'
import { addDialogueAudioTrack, moveDialogueClips, regionsForDialogueClips, removeDialogueAudioTrack, reorderDialogueAudioTrack, splitDialogueAudioClips, trimDialogueAudioClip } from './dialogueAudioCommands'
import { applySoundCueChangesToDialogueAudio, bindDialogueRegionsToCue, synchronizeDialogueBindingsAfterAudioEdit } from './dialogueAudioBinding'
function fixture() {
  const state = createDefaultDialogueAudioCutState(1)
  state.assets = [{ assetId: 'voice', sourceName: '仮音声', audioDataUrl: 'data:audio/wav;base64,AA==', waveform: [], durationFrames: 120 }]
  state.tracks[0].clips = [{ clipId: 'a', placementId: 'placement', assetId: 'voice', timelineStartFrame: 25, sourceOffsetFrames: 12, durationFrames: 48 }]
  return state
}
describe('clip workspace commands', () => {
  it('rejects a SOUND move that would put its linked audio before the sheet origin without mutating either', () => {
    const cue = { cueId: 'sound', role: 'sound' as const, laneId: 'sound_lane_1', label: '収録枠', text: '', frameStart: 31, frameEnd: 60 }
    const created = regionsForDialogueClips(fixture(), [{ trackId: 'dialogue-1', clipId: 'a' }])
    const state = bindDialogueRegionsToCue(created.state, created.refs, cue, 'sheet-main')
    const before = structuredClone(state)
    const next = { ...cue, frameStart: 1, frameEnd: 30 }
    expect(() => applySoundCueChangesToDialogueAudio(state, [cue], [next], 'sheet-main', 'move-binding')).toThrow('開始より前')
    expect(state).toEqual(before)
    const moved = applySoundCueChangesToDialogueAudio(state, [cue], [next], 'sheet-main', 'move-binding', -10)
    expect(moved.tracks[0].clips[0].timelineStartFrame).toBe(-5)
  })
  it('migrates v2 and saves 64 named/reordered tracks without truncation or changing their IDs', () => {
    let state = fixture()
    for (let i = 3; i < 64; i++) state = addDialogueAudioTrack(state)
    state = reorderDialogueAudioTrack(state, 'dialogue-1', 63)
    const project = { ...createDefaultProject(), extensions: { [DIALOGUE_AUDIO_EXTENSION]: { schemaVersion: 2, data: state } } }
    const restored = dialogueAudioCutStateFromProject(updateDialogueAudioCutStateInProject(project, dialogueAudioCutStateFromProject(project, 1), 1), 1)
    expect(restored.tracks).toHaveLength(64)
    expect(restored.tracks[63]).toMatchObject({ trackId: 'dialogue-1', name: '音声 1', clips: state.tracks[63].clips })
    expect(restored.activeTrackId).toBe('dialogue-64')
  })
  it('splits non-destructively, then moves across tracks and trims within source bounds', () => {
    const original = fixture(), split = splitDialogueAudioClips(original, ['a'], 49)
    expect(split.tracks[0].clips.map(clip => [clip.placementId, clip.sourceOffsetFrames, clip.durationFrames])).toEqual([['placement', 12, 24], ['placement', 36, 24]])
    const moved = moveDialogueClips(split, 'dialogue-1', ['a-split'], 12, 'dialogue-2')
    expect(moved.tracks[1].clips[0].timelineStartFrame).toBe(61)
    const trimmed = trimDialogueAudioClip(moved, 'dialogue-2', 'a-split', 'start', 67)
    expect(trimmed.tracks[1].clips[0]).toMatchObject({ timelineStartFrame: 67, sourceOffsetFrames: 42, durationFrames: 18 })
    expect(original.tracks[0].clips).toHaveLength(1)
    expect(trimmed.assets[0]).toBe(original.assets[0])
    expect(() => moveDialogueClips(split, 'dialogue-1', ['a-split'], -12)).toThrow('重なります')
    split.tracks[0].locked = true
    expect(() => trimDialogueAudioClip(split, 'dialogue-1', 'a', 'end', 30)).toThrow('ロック')
  })
  it('keeps independent SOUND windows through split, track transfer, fixed mode and deletion', () => {
    const cue = { cueId: 'sound', role: 'sound' as const, laneId: 'sound_lane_1', label: '収録枠', text: '', frameStart: 19, frameEnd: 84 }
    const created = regionsForDialogueClips(fixture(), [{ trackId: 'dialogue-1', clipId: 'a' }])
    let state = bindDialogueRegionsToCue(created.state, created.refs, cue, 'sheet-main')
    state = splitDialogueAudioClips(state, ['a'], 49)
    expect(synchronizeDialogueBindingsAfterAudioEdit(state, [cue], 'sheet-main').cueUpdates).toEqual([])
    state = moveDialogueClips(state, 'dialogue-1', ['a-split'], 12, 'dialogue-2')
    expect(synchronizeDialogueBindingsAfterAudioEdit(state, [cue], 'sheet-main').cueUpdates).toEqual([{ cueId: 'sound', frameStart: 19, frameEnd: 96 }])
    state.soundBindings[0].rangeMode = 'fixed'
    const fixed = synchronizeDialogueBindingsAfterAudioEdit(state, [cue], 'sheet-main')
    expect(fixed.cueUpdates).toEqual([])
    expect(fixed.state.soundBindings[0]).toMatchObject({ headPaddingFrames: 6, tailPaddingFrames: 0 })
    state = removeDialogueAudioTrack(state, 'dialogue-1')
    state = removeDialogueAudioTrack(state, 'dialogue-2')
    const deleted = synchronizeDialogueBindingsAfterAudioEdit(state, [cue], 'sheet-main')
    expect(deleted.cueUpdates).toEqual([])
    expect(deleted.state.soundBindings[0].status).toBe('orphaned')
  })
})
