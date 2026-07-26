import { describe, expect, it } from 'vitest'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'
import {
  applyDialogueAudioMarqueeSelection,
  collectDialogueAudioMarqueeEntities,
  dialogueAudioSelectionFrameRange,
  EMPTY_DIALOGUE_AUDIO_SELECTION,
  reconcileDialogueAudioSelection,
  toggleDialogueAudioSelectionEntity,
} from './dialogueAudioSelectionModel'

describe('dialogueAudioSelectionModel', () => {
  it('keeps object selection independent from a time range', () => {
    const selected = toggleDialogueAudioSelectionEntity(EMPTY_DIALOGUE_AUDIO_SELECTION, {
      kind: 'candidate',
      trackId: 'dialogue-1',
      id: 'candidate-1',
    }, false)
    expect(selected).toEqual({
      entities: [{ kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' }],
      timeRange: null,
    })
  })

  it('marquee-selects mixed objects and hides analysis candidates already represented by a region', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'clip-1',
      assetId: 'asset-1',
      timelineStartFrame: 10,
      sourceOffsetFrames: 0,
      durationFrames: 20,
    }]
    state.tracks[0].speechCandidates = [
      { candidateId: 'candidate-1', frameStart: 12, frameEnd: 18, status: 'pending' },
      { candidateId: 'candidate-linked', frameStart: 20, frameEnd: 24, status: 'linked' },
    ]
    state.tracks[0].dialogueRegions = [{
      regionId: 'region-1',
      candidateIds: ['candidate-linked'],
      frameStart: 20,
      frameEnd: 24,
      anchors: [],
      headPaddingFrames: 0,
      tailPaddingFrames: 0,
      status: 'ready',
    }]

    expect(collectDialogueAudioMarqueeEntities(state, ['dialogue-1'], {
      frameStart: 11,
      frameEnd: 25,
    })).toEqual([
      { kind: 'clip', trackId: 'dialogue-1', id: 'clip-1' },
      { kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' },
      { kind: 'region', trackId: 'dialogue-1', id: 'region-1' },
    ])
  })

  it('adds marquee hits without replacing an existing selection when modified', () => {
    const initial = {
      entities: [{ kind: 'clip' as const, trackId: 'dialogue-2', id: 'clip-2' }],
      timeRange: null,
    }
    expect(applyDialogueAudioMarqueeSelection(initial, [
      { kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' },
    ], true).entities).toEqual([
      { kind: 'clip', trackId: 'dialogue-2', id: 'clip-2' },
      { kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' },
    ])
  })

  it('reconciles deleted IDs and resolves the remaining selection envelope', () => {
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].speechCandidates = [{
      candidateId: 'candidate-1',
      frameStart: 12,
      frameEnd: 24,
      status: 'pending',
    }]
    const reconciled = reconcileDialogueAudioSelection({
      entities: [
        { kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' },
        { kind: 'clip', trackId: 'dialogue-1', id: 'deleted' },
      ],
      timeRange: null,
    }, state)
    expect(reconciled.entities).toEqual([
      { kind: 'candidate', trackId: 'dialogue-1', id: 'candidate-1' },
    ])
    expect(dialogueAudioSelectionFrameRange(reconciled, state)).toEqual({
      frameStart: 12,
      frameEnd: 24,
    })
  })
})
