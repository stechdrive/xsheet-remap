import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '@xsheet-remap/core'
import {
  createDefaultDialogueAudioCutState,
  updateDialogueAudioCutStateInProject,
  type DialogueAudioClip,
} from './dialogueAudioProject'
import {
  createDialogueAudioTrackExports,
  dialogueAudioTrackExportPlans,
  renderDialogueAudioTrackPcm,
  type DialogueAudioTrackExportPlan,
} from './dialogueAudioExport'

function clip(
  clipId: string,
  assetId: string,
  timelineStartFrame: number,
  durationFrames: number,
  sourceOffsetFrames = 0,
): DialogueAudioClip {
  return {
    clipId,
    placementId: `placement-${clipId}`,
    assetId,
    timelineStartFrame,
    sourceOffsetFrames,
    durationFrames,
  }
}

describe('dialogue audio track export', () => {
  it('keeps populated intersecting tracks separate and includes muted tracks', () => {
    const initial = createDefaultProject()
    const project = {
      ...initial,
      logicalSheet: { ...initial.logicalSheet, frameOrigin: 10, durationFrames: 4, fps: 24 },
    }
    const state = createDefaultDialogueAudioCutState(10, 4)
    state.assets = [
      { assetId: 'asset-a', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 20, waveform: [] },
      { assetId: 'asset-b', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 20, waveform: [] },
    ]
    state.tracks[0].clips = [clip('before-and-in', 'asset-a', 8, 4)]
    state.tracks[1].clips = [clip('muted-in', 'asset-b', 12, 4)]
    state.tracks[1].muted = true
    state.tracks[2].clips = [clip('after', 'asset-a', 14, 2)]

    const plans = dialogueAudioTrackExportPlans(updateDialogueAudioCutStateInProject(project, state, 10, 4))

    expect(plans.map(plan => ({ trackId: plan.trackId, trackIndex: plan.trackIndex }))).toEqual([
      { trackId: 'dialogue-1', trackIndex: 0 },
      { trackId: 'dialogue-2', trackIndex: 1 },
    ])
  })

  it('renders exactly the cut duration, sums overlaps only within the track, and pads silence', () => {
    const plan: DialogueAudioTrackExportPlan = {
      trackId: 'dialogue-1',
      trackIndex: 0,
      frameOrigin: 10,
      durationFrames: 4,
      fps: 2,
      clips: [
        clip('a', 'asset-a', 11, 2),
        clip('b', 'asset-b', 11, 2),
      ],
    }
    const decoded = new Map([
      ['asset-a', { samples: new Float32Array([0.75, 0.75, 0.75, 0.75]), sampleRate: 4 }],
      ['asset-b', { samples: new Float32Array([0.75, 0.75, 0.75, 0.75]), sampleRate: 4 }],
    ])

    const output = renderDialogueAudioTrackPcm(plan, decoded, 4)

    expect(output.sampleRate).toBe(4)
    expect(output.samples).toEqual(new Float32Array([0, 0, 1, 1, 1, 1, 0, 0]))
  })

  it('clips at the cut start while preserving the source offset', () => {
    const plan: DialogueAudioTrackExportPlan = {
      trackId: 'dialogue-1',
      trackIndex: 0,
      frameOrigin: 10,
      durationFrames: 2,
      fps: 2,
      clips: [clip('crossing', 'asset-a', 9, 4, 1)],
    }
    const decoded = new Map([
      ['asset-a', { samples: new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]), sampleRate: 4 }],
    ])

    const output = renderDialogueAudioTrackPcm(plan, decoded, 4)

    expect([...output.samples]).toEqual(expect.arrayContaining([
      expect.closeTo(0.4, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0.6, 5),
      expect.closeTo(0.7, 5),
    ]))
    expect(output.samples).toHaveLength(4)
  })

  it('creates one fixed-length WAV file per populated track with stable track suffixes', async () => {
    const initial = createDefaultProject()
    const project = {
      ...initial,
      cut: { ...initial.cut, title: 'TITLE', episode: '03', cut: 'C012' },
      logicalSheet: { ...initial.logicalSheet, frameOrigin: 1, durationFrames: 2, fps: 2 },
    }
    const state = createDefaultDialogueAudioCutState(1, 2)
    state.assets = [
      { assetId: 'asset-a', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 2, waveform: [] },
      { assetId: 'asset-b', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 2, waveform: [] },
    ]
    state.tracks[0].clips = [clip('a', 'asset-a', 1, 1)]
    state.tracks[2].clips = [clip('b', 'asset-b', 2, 1)]
    const withAudio = updateDialogueAudioCutStateInProject(project, state, 1, 2)
    const context = { close: async () => undefined } as unknown as AudioContext

    const outputs = await createDialogueAudioTrackExports(withAudio, 'wav', {
      createAudioContext: () => context,
      decodeAsset: async () => ({ samples: new Float32Array([0.25, 0.25]), sampleRate: 2 }),
    })

    expect(outputs.map(output => output.fileName)).toEqual([
      'TITLE_03_C012_audio01.wav',
      'TITLE_03_C012_audio03.wav',
    ])
    expect(outputs.every(output => output.mimeType === 'audio/wav')).toBe(true)
    expect(outputs.map(output => output.bytes.length)).toEqual([96_044, 96_044])
  })
})
