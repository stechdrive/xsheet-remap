import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  createDefaultDialogueAudioCutState,
  dialogueAudioCutStateFromDocument,
  DIALOGUE_AUDIO_EXTENSION,
  updateDialogueAudioCutStateInDocument,
} from './dialogueAudioProject'

describe('dialogue audio project extension', () => {
  it('creates exactly three editable tracks for a new cut', () => {
    const state = createDefaultDialogueAudioCutState(1)
    expect(state.tracks).toHaveLength(3)
    expect(state.tracks.map(track => track.name)).toEqual(['セリフ 1', 'セリフ 2', 'セリフ 3'])
    expect(state.tracks.every(track => track.audioStartFrame === 1)).toBe(true)
  })

  it('stores audio per cut without replacing unrelated extensions', () => {
    const project = createDefaultProject()
    const document = {
      ...createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate }),
      extensions: { existing: { schemaVersion: 2, data: { keep: true } } },
    }
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0] = {
      ...state.tracks[0],
      name: '主人公',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 48,
      speechRanges: [{ frameStart: 3, frameEnd: 16 }],
    }
    const updated = updateDialogueAudioCutStateInDocument(document, document.activeCutId, state, 1)
    expect(updated.extensions?.existing).toEqual(document.extensions.existing)
    expect(updated.extensions?.[DIALOGUE_AUDIO_EXTENSION]?.required).toBeUndefined()
    expect(dialogueAudioCutStateFromDocument(updated, document.activeCutId, 1).tracks[0]).toMatchObject({
      name: '主人公', durationFrames: 48, speechRanges: [{ frameStart: 3, frameEnd: 16 }],
    })
    expect(dialogueAudioCutStateFromDocument(updated, 'another-cut', 12).tracks[0].audioStartFrame).toBe(12)
  })
})
