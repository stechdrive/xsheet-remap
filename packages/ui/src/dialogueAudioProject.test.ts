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
    const state = createDefaultDialogueAudioCutState(1)
    expect(state.tracks).toHaveLength(3)
    expect(state.tracks.map(track => track.name)).toEqual(['セリフ 1', 'セリフ 2', 'セリフ 3'])
    expect(state.tracks.every(track => track.clips.length === 0)).toBe(true)
    expect(state.assets).toEqual([])
    expect(state.bindings).toEqual([])
    expect(state.tracks.every(track => track.vadMode === 'candidates')).toBe(true)
    expect(state).toMatchObject({ detectionPreset: 'quiet', detectionStability: 0.4, detectionSensitivity: 0.5 })
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
      name: '主人公',
      clips: [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 3, sourceOffsetFrames: 0, durationFrames: 48 }],
      speechCandidates: [{ candidateId: 'candidate-1', frameStart: 3, frameEnd: 16, status: 'pending' }],
    }
    const linked = linkDialogueAudioCandidates(state, 'dialogue-1', ['candidate-1'], { cueId: 'cue-1', frameStart: 3, frameEnd: 16 }, 'revision-1')
    const updated = updateDialogueAudioCutStateInDocument(document, document.activeCutId, linked, 1)
    expect(updated.extensions?.existing).toEqual(document.extensions.existing)
    expect(updated.extensions?.[DIALOGUE_AUDIO_EXTENSION]?.schemaVersion).toBe(DIALOGUE_AUDIO_SCHEMA_VERSION)
    expect(dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1).tracks[0]).toMatchObject({
      name: '主人公',
      clips: [{ timelineStartFrame: 3, durationFrames: 48 }],
      speechCandidates: [{ candidateId: 'candidate-1', cueLinks: [{ cueId: 'cue-1', revisionId: 'revision-1' }] }],
    })
    expect(dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1).bindings[0]).toMatchObject({
      cueId: 'cue-1', trackId: 'dialogue-1', status: 'linked',
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
      name: '旧トラック',
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
    expect(dialogueAudioCutStateFromDocument(v3Document, document.activeCutId, 1)).toMatchObject({ bindings: [] })
  })
})
