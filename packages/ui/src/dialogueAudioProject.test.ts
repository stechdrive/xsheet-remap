import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  commitHistory,
  createDefaultProject,
  createProjectDocumentFromCutProject,
  createProjectHistory,
  parseProjectDocument,
  undoHistory,
} from '@xsheet-remap/core'
import {
  createDefaultDialogueAudioCutState,
  dialogueAudioCutStateFromProject,
  DIALOGUE_AUDIO_EXTENSION,
  DIALOGUE_AUDIO_SCHEMA_VERSION,
  pruneUnusedDialogueAudioAssets,
  updateDialogueAudioCutStateInProject,
} from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

describe('dialogue audio project state', () => {
  it('stores audio inside the cut project so project history restores it atomically', () => {
    const source = createDefaultProject()
    const state = audioState()
    const withAudio = updateDialogueAudioCutStateInProject(source, state, 1, 144)
    const history = commitHistory(createProjectHistory(source), withAudio)

    expect(dialogueAudioCutStateFromProject(history.present, 1).tracks[0].clips).toHaveLength(1)
    expect(dialogueAudioCutStateFromProject(undoHistory(history).present, 1).tracks[0].clips).toEqual([])
  })

  it('round-trips the cut extension through the canonical project document', () => {
    const project = updateDialogueAudioCutStateInProject(createDefaultProject(), audioState(), 1, 144)
    const document = createProjectDocumentFromCutProject(project)
    const restored = activeCutProjectFromDocument(parseProjectDocument(structuredClone(document)))

    expect(restored.extensions?.[DIALOGUE_AUDIO_EXTENSION]?.schemaVersion).toBe(DIALOGUE_AUDIO_SCHEMA_VERSION)
    expect(dialogueAudioCutStateFromProject(restored, 1).tracks[0].clips[0]).toMatchObject({
      placementId: 'placement-1',
      timelineStartFrame: 12,
      durationFrames: 24,
    })
  })

  it('round-trips stable many-to-one SOUND binding members', () => {
    let state = audioState()
    state.tracks[0].speechCandidates = [
      { candidateId: 'base', frameStart: 14, frameEnd: 18, status: 'pending' },
      { candidateId: 'patch', frameStart: 28, frameEnd: 32, status: 'pending' },
    ]
    const cue = {
      cueId: 'cue-1',
      role: 'sound' as const,
      laneId: 'sound_lane_1',
      frameStart: 12,
      frameEnd: 35,
      label: '主人公',
      text: '',
    }
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['base'], cue, 'revision-1')
    state = linkDialogueAudioCandidates(state, 'dialogue-1', ['patch'], cue, 'revision-1')
    const source = {
      ...createDefaultProject(),
      timedRangeCues: [cue],
    }
    const project = updateDialogueAudioCutStateInProject(source, state, 1, 144)
    const restored = activeCutProjectFromDocument(parseProjectDocument(
      structuredClone(createProjectDocumentFromCutProject(project)),
    ))
    const binding = dialogueAudioCutStateFromProject(restored, 1).soundBindings[0]

    expect(binding.bindingId).toBeTruthy()
    expect(new Set(binding.members.map(member => member.memberId)).size).toBe(2)
    expect(binding.members.map(member => member.regionRef.regionId)).toEqual([
      'dialogue-region',
      'dialogue-region-2',
    ])
  })

  it('keeps each shared cut audio extension independent', () => {
    const first = updateDialogueAudioCutStateInProject(createDefaultProject(), audioState(), 1, 144)
    const firstDocument = createProjectDocumentFromCutProject(first)
    const document = addBlankSharedCutToProjectDocument(firstDocument, first)
    expect(document.cuts[0].extensions?.[DIALOGUE_AUDIO_EXTENSION]).toBeTruthy()
    expect(document.cuts[1].extensions?.[DIALOGUE_AUDIO_EXTENSION]).toBeUndefined()
    expect(document.extensions?.[DIALOGUE_AUDIO_EXTENSION]).toBeUndefined()
  })

  it('does not derive the stored audio workspace from the timesheet duration', () => {
    const project = createDefaultProject()
    const empty = dialogueAudioCutStateFromProject(project, 1, 144)
    expect(empty.timelineDurationFrames).toBe(1)

    const withAudio = updateDialogueAudioCutStateInProject(project, audioState(), 1, 144)
    expect(dialogueAudioCutStateFromProject(withAudio, 1, 24).timelineDurationFrames).toBe(35)
  })

  it('rejects unknown audio schemas instead of attempting compatibility migration', () => {
    const project = {
      ...createDefaultProject(),
      extensions: {
        [DIALOGUE_AUDIO_EXTENSION]: { schemaVersion: 99, data: audioState() },
      },
    }
    expect(dialogueAudioCutStateFromProject(project, 1).tracks.every(track => track.clips.length === 0)).toBe(true)
  })

  it('removes audio assets that no clip references', () => {
    const state = audioState()
    state.assets.push({
      assetId: 'unused',
      audioDataUrl: 'data:audio/wav;base64,VU5VU0VE',
      durationFrames: 1,
      waveform: [],
    })
    expect(pruneUnusedDialogueAudioAssets(state).assets.map(asset => asset.assetId)).toEqual(['asset-1'])
  })
})

function audioState() {
  const state = createDefaultDialogueAudioCutState(1)
  state.assets = [{
    assetId: 'asset-1',
    audioDataUrl: 'data:audio/wav;base64,UklGRg==',
    durationFrames: 24,
    waveform: [0.2, 0.4],
  }]
  state.tracks[0].clips = [{
    clipId: 'clip-1',
    placementId: 'placement-1',
    assetId: 'asset-1',
    timelineStartFrame: 12,
    sourceOffsetFrames: 0,
    durationFrames: 24,
  }]
  return state
}
