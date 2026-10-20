import { describe, expect, it } from 'vitest'
import { buildClipRegistrationPlan, createDefaultProject, createProjectDocumentFromCutProject, ensureClipDocument } from '@xsheet-remap/core'
import { withDialogueAudioPlan } from './clipAudioExportPlan'
import { createDefaultDialogueAudioCutState, DIALOGUE_AUDIO_EXTENSION, dialogueAudioCutStateFromProject, updateDialogueAudioCutStateInProject } from './dialogueAudioProject'
import { removeDialogueAudioTrack } from './dialogueAudioCommands'

describe('CLIP audio export ownership', () => {
  function fixture() {
    const project = ensureClipDocument(createDefaultProject())
    project.logicalSheet.frameOrigin = 101
    project.clipDocument = { ...project.clipDocument!, source: { fileName: 'source.clip', fileHash: 'a'.repeat(64), dataUrl: 'data:application/x-clip-studio;base64,AA==' }, timelineIds: { cut_1: 'native-timeline' } }
    const state = createDefaultDialogueAudioCutState(101)
    const assetId = `clip-audio:${'a'.repeat(20)}:42:native-timeline:${'b'.repeat(32)}`
    state.assets = [{ assetId, audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 120, waveform: [], sourceName: '収録音声' }]
    state.tracks[0].clips = [{ clipId: 'voice', placementId: 'voice', assetId, timelineStartFrame: 113, sourceOffsetFrames: 6, durationFrames: 24 }]
    project.extensions = { [DIALOGUE_AUDIO_EXTENSION]: { schemaVersion: 2, data: state } }
    return project
  }
  it('migrates legacy CLIP provenance, preserves native identity, and converts a nonzero sheet origin once', () => {
    const project = fixture(), state = dialogueAudioCutStateFromProject(project, 101)
    expect(state.managedClipSources).toEqual([{ fileHash: 'a'.repeat(64), layerId: 42, timelineId: 'native-timeline' }])
    expect(state.assets[0].sourceItemId).toBe('b'.repeat(32))
    state.tracks[0].solo = true
    const document = createProjectDocumentFromCutProject(updateDialogueAudioCutStateInProject(project, state, 101))
    const audio = withDialogueAudioPlan(document, buildClipRegistrationPlan(document, 'action')).timelines[0].audio!
    expect(audio.replacedLayerIds).toEqual([42])
    expect(audio.tracks[0]).toMatchObject({ sourceLayerId: 42, muted: false, clips: [{ startFrame: 12, sourceOffsetFrames: 6, durationFrames: 24 }] })
    expect(audio.assets[0].sourceItemId).toBe('b'.repeat(32))
    expect(() => withDialogueAudioPlan({ ...document, clipDocument: { ...document.clipDocument!, source: { ...document.clipDocument!.source!, fileHash: 'c'.repeat(64) } } }, buildClipRegistrationPlan(document, 'action'))).toThrow('一致しません')
  })
  it('retains deletion ownership when the last imported placement and its asset are removed', () => {
    const project = fixture(), state = removeDialogueAudioTrack(dialogueAudioCutStateFromProject(project, 101), 'dialogue-1')
    const document = createProjectDocumentFromCutProject(updateDialogueAudioCutStateInProject(project, state, 101))
    const audio = withDialogueAudioPlan(document, buildClipRegistrationPlan(document, 'action')).timelines[0].audio!
    expect(audio).toEqual({ replacedLayerIds: [42], tracks: [], assets: [] })
  })
  it('recovers the original native timeline for a legacy single-cut audio-only import', () => {
    const project = fixture()
    project.clipDocument!.timelineIds = {}
    const document = createProjectDocumentFromCutProject(project)
    const plan = withDialogueAudioPlan(document, buildClipRegistrationPlan(document, 'action'))
    expect(plan.timelines[0].sourceTimelineId).toBe('native-timeline')
    expect(plan.timelines[0].audio!.tracks[0].sourceLayerId).toBe(42)
  })
})
