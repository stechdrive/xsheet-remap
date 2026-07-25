import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  createDefaultDialogueAudioCutState,
  dialogueAudioCutStateFromDocument,
  DIALOGUE_AUDIO_EXTENSION,
  DIALOGUE_AUDIO_SCHEMA_VERSION,
  updateDialogueAudioCutStateInDocument,
} from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

describe('dialogue audio project extension', () => {
  it('creates exactly three non-destructive tracks for a new cut', () => {
    const state = createDefaultDialogueAudioCutState(1, 144)
    expect(state.tracks).toHaveLength(3)
    expect(state.tracks.map(track => track.trackId)).toEqual(['dialogue-1', 'dialogue-2', 'dialogue-3'])
    expect(state.tracks.every(track => track.clips.length === 0)).toBe(true)
    expect(state.assets).toEqual([])
    expect(state.assignments).toEqual([])
    expect(state.tracks.every(track => track.dialogueRegions.length === 0)).toBe(true)
    expect(state.timelineDurationFrames).toBe(1)
    expect(state.tracks.every(track => track.vadMode === 'candidates')).toBe(true)
    expect(state).toMatchObject({ detectionPreset: 'quiet', detectionStability: 0.4, detectionSensitivity: 0.5 })
  })

  it('keeps the audio timeline longer than the paper cut and never truncates placed audio', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })
    const state = createDefaultDialogueAudioCutState(1, 72)
    state.assets = [{ assetId: 'long-take', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 180, waveform: [] }]
    state.tracks[0].clips = [{
      clipId: 'long-clip',
      placementId: 'long-clip',
      assetId: 'long-take',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 180,
    }]
    const updated = updateDialogueAudioCutStateInDocument(document, document.activeCutId, state, 1, 72)
    const restored = dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1, 48)

    expect(restored.timelineDurationFrames).toBe(180)
    expect(restored.tracks[0].clips[0].durationFrames).toBe(180)
  })

  it('stores shared audio assets and revision-specific candidate links per cut', () => {
    const project = createDefaultProject()
    const document = {
      ...createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate }),
      extensions: { existing: { schemaVersion: 2, data: { keep: true } } },
    }
    const state = createDefaultDialogueAudioCutState(1)
    state.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 48,
      waveform: [0, 0.5, 1],
    }]
    state.tracks[0] = {
      ...state.tracks[0],
      clips: [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 3, sourceOffsetFrames: 0, durationFrames: 48 }],
      speechCandidates: [{ candidateId: 'candidate-1', frameStart: 3, frameEnd: 16, status: 'pending' }],
    }
    const linked = linkDialogueAudioCandidates(state, 'dialogue-1', ['candidate-1'], { cueId: 'cue-1', frameStart: 3, frameEnd: 16 }, 'revision-1')
    const updated = updateDialogueAudioCutStateInDocument(document, document.activeCutId, linked, 1)
    expect(updated.extensions?.existing).toEqual(document.extensions.existing)
    expect(updated.extensions?.[DIALOGUE_AUDIO_EXTENSION]?.schemaVersion).toBe(DIALOGUE_AUDIO_SCHEMA_VERSION)
    expect(dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1).tracks[0]).toMatchObject({
      clips: [{ timelineStartFrame: 3, durationFrames: 48 }],
      speechCandidates: [{ candidateId: 'candidate-1', cueLinks: [{ cueId: 'cue-1', revisionId: 'revision-1' }] }],
    })
    expect(dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1).assignments[0]).toMatchObject({
      cueId: 'cue-1', regionRefs: [{ trackId: 'dialogue-1', regionId: linked.tracks[0].dialogueRegions[0].regionId }], status: 'linked',
    })
  })

  it('migrates the v1 single-waveform format without discarding audio', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })
    const legacy = {
      ...document,
      extensions: {
        [DIALOGUE_AUDIO_EXTENSION]: {
          schemaVersion: 1,
          data: {
            cuts: {
              [document.activeCutId]: {
                activeTrackId: 'dialogue-1',
                detectionSensitivity: 0.4,
                tracks: [{
                  name: '旧トラック',
                  audioDataUrl: 'data:audio/wav;base64,UklGRg==',
                  audioStartFrame: 10,
                  durationFrames: 24,
                  waveform: [0.2, 0.8],
                  speechRanges: [{ frameStart: 12, frameEnd: 20 }],
                }],
              },
            },
          },
        },
      },
    }
    const migrated = dialogueAudioCutStateFromDocument(legacy, document.activeCutId, 1)
    expect(migrated.assets).toHaveLength(1)
    expect(migrated.tracks[0]).toMatchObject({
      clips: [{ timelineStartFrame: 10, durationFrames: 24 }],
      speechCandidates: [{ frameStart: 12, frameEnd: 20, status: 'pending' }],
    })
    expect(migrated).toMatchObject({ detectionPreset: 'quiet', detectionStability: 0.4 })
  })

  it('upgrades v2 and v3 cuts with binding defaults while preserving the other cuts', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })
    const legacyState = createDefaultDialogueAudioCutState(1)
    const v2State: Record<string, unknown> = { ...legacyState }
    delete v2State.detectionPreset
    delete v2State.detectionStability
    const legacyDocument = {
      ...document,
      extensions: {
        [DIALOGUE_AUDIO_EXTENSION]: {
          schemaVersion: 2,
          data: { cuts: { [document.activeCutId]: v2State, untouched: v2State } },
        },
      },
    }
    const migrated = dialogueAudioCutStateFromDocument(legacyDocument, document.activeCutId, 1)
    expect(migrated).toMatchObject({ detectionPreset: 'quiet', detectionStability: 0.4 })
    const updated = updateDialogueAudioCutStateInDocument(legacyDocument, document.activeCutId, migrated, 1)
    expect((updated.extensions?.[DIALOGUE_AUDIO_EXTENSION]?.data as { cuts: Record<string, unknown> }).cuts.untouched).toEqual(v2State)

    const v3Document = {
      ...legacyDocument,
      extensions: { [DIALOGUE_AUDIO_EXTENSION]: { schemaVersion: 3, data: { cuts: { [document.activeCutId]: v2State } } } },
    }
    expect(dialogueAudioCutStateFromDocument(v3Document, document.activeCutId, 1)).toMatchObject({ assignments: [] })
  })

  it('migrates schema 6 cue bindings into region-level assignments without losing source anchors', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })
    const legacyState = createDefaultDialogueAudioCutState(1) as unknown as Record<string, unknown>
    const tracks = legacyState.tracks as Array<Record<string, unknown>>
    legacyState.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
    tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48 }]
    tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'linked', cueId: 'cue-1', revisionId: 'revision-1' }]
    tracks.forEach(track => { delete track.dialogueRegions })
    delete legacyState.assignments
    legacyState.bindings = [{
      bindingId: 'binding-1',
      cueId: 'cue-1',
      revisionId: 'revision-1',
      trackId: 'dialogue-1',
      anchors: [{
        anchorId: 'anchor-1',
        placementId: 'placement-1',
        assetId: 'asset-1',
        sourceFrameStart: 11,
        sourceFrameEnd: 19,
        candidateIds: ['vad-1'],
      }],
      headPaddingFrames: 2,
      tailPaddingFrames: 3,
      cueFrameStart: 10,
      cueFrameEnd: 23,
      provisional: false,
      status: 'linked',
    }]
    const legacyDocument = {
      ...document,
      extensions: {
        [DIALOGUE_AUDIO_EXTENSION]: {
          schemaVersion: 6,
          data: { cuts: { [document.activeCutId]: legacyState } },
        },
      },
    }

    const migrated = dialogueAudioCutStateFromDocument(legacyDocument, document.activeCutId, 1)
    expect(migrated.tracks[0].dialogueRegions[0]).toMatchObject({
      frameStart: 12,
      frameEnd: 20,
      candidateIds: ['vad-1'],
      anchors: [expect.objectContaining({ placementId: 'placement-1', sourceFrameStart: 11, sourceFrameEnd: 19 })],
    })
    expect(migrated.assignments[0]).toMatchObject({
      assignmentId: 'binding-1',
      cueId: 'cue-1',
      regionRefs: [{ trackId: 'dialogue-1', regionId: 'binding-1-region' }],
      headPaddingFrames: 2,
      tailPaddingFrames: 3,
    })
  })

  it('drops the retired solo flag from previously saved tracks', () => {
    const project = createDefaultProject()
    const document = createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })
    const legacyState = createDefaultDialogueAudioCutState(1) as unknown as { tracks: Array<Record<string, unknown>> }
    legacyState.tracks[0].solo = true
    const legacyDocument = {
      ...document,
      extensions: {
        [DIALOGUE_AUDIO_EXTENSION]: {
          schemaVersion: DIALOGUE_AUDIO_SCHEMA_VERSION,
          data: { cuts: { [document.activeCutId]: legacyState } },
        },
      },
    }

    const restored = dialogueAudioCutStateFromDocument(legacyDocument, document.activeCutId, 1)
    expect('solo' in restored.tracks[0]).toBe(false)
  })
})
