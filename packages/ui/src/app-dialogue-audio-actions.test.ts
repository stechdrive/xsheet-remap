import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate, type CutProject } from '@xsheet-remap/core'
import { createAppDialogueAudioActions } from './app-dialogue-audio-actions'
import { createDefaultDialogueAudioCutState } from './dialogueAudioProject'

describe('app dialogue audio actions', () => {
  it('auto-creates provisional SOUND labels and revision bindings for new VAD regions', () => {
    let project = createDefaultProject()
    const projectRef = { current: project }
    const actions = createAppDialogueAudioActions({
      projectRef,
      template: standardA3SheetTemplate,
      revisionId: 'revision-1',
      frameMin: 1,
      frameMax: 144,
      setProjectDocument: vi.fn(),
      setSoundCueDialog: vi.fn(),
      commitProject: (next: CutProject) => { project = next; projectRef.current = next },
    })
    const state = createDefaultDialogueAudioCutState(1)
    state.tracks[0].name = '主人公'
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]

    const next = actions.autoCreateSoundCues(state, 'dialogue-1', ['vad-1'])

    expect(project.timedRangeCues[0]).toMatchObject({ role: 'sound', frameStart: 3, frameEnd: 8, label: '仮・主人公 1' })
    expect(next.bindings[0]).toMatchObject({ cueId: project.timedRangeCues[0].cueId, provisional: true, status: 'linked' })
    expect(next.tracks[0].speechCandidates[0]).toMatchObject({ status: 'linked' })
  })

  it('opens one SOUND dialog spanning multiple selected VAD regions', () => {
    const setSoundCueDialog = vi.fn()
    const projectRef = { current: createDefaultProject() }
    const actions = createAppDialogueAudioActions({
      projectRef,
      template: standardA3SheetTemplate,
      revisionId: 'revision-1',
      frameMin: 1,
      frameMax: 144,
      setProjectDocument: vi.fn(),
      setSoundCueDialog,
      commitProject: vi.fn(),
    })
    actions.openSoundCueEditorForAudioCandidate('dialogue-1', ['vad-1', 'vad-2'], 12, 35)
    expect(setSoundCueDialog).toHaveBeenCalledWith(expect.objectContaining({
      frameStart: 12,
      frameEnd: 35,
      audioCandidate: { trackId: 'dialogue-1', candidateIds: ['vad-1', 'vad-2'], revisionId: 'revision-1' },
    }))
  })

  it('does not silently truncate an automatic SOUND candidate beyond the paper cut', () => {
    const projectRef = { current: createDefaultProject() }
    const commitProject = vi.fn()
    const actions = createAppDialogueAudioActions({
      projectRef,
      template: standardA3SheetTemplate,
      revisionId: 'revision-1',
      frameMin: 1,
      frameMax: 72,
      setProjectDocument: vi.fn(),
      setSoundCueDialog: vi.fn(),
      commitProject,
    })
    const state = createDefaultDialogueAudioCutState(1, 96)
    state.tracks[0].speechCandidates = [{ candidateId: 'long-vad', frameStart: 60, frameEnd: 90, status: 'pending' }]

    const next = actions.autoCreateSoundCues(state, 'dialogue-1', ['long-vad'])

    expect(next).toBe(state)
    expect(commitProject).not.toHaveBeenCalled()
    expect(projectRef.current.timedRangeCues).toEqual([])
  })
})
