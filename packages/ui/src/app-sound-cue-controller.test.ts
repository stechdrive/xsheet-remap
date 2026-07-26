import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createTimedRangeCue, standardA3SheetTemplate } from '@xsheet-remap/core'
import { createSoundCueController } from './app-sound-cue-controller'

describe('sound cue controller audio integration', () => {
  it('creates a SOUND cue from an audio candidate and reports the revision link', () => {
    const source = createDefaultProject()
    let current = source
    const applyAudioCandidateLink = vi.fn(project => project)
    const commitProject = vi.fn(project => { current = project })
    const controller = createSoundCueController({
      project: source,
      getProject: () => current,
      template: standardA3SheetTemplate,
      rangeSelection: null,
      selectedCueId: null,
      clipboard: null,
      frameMin: 1,
      frameMax: 144,
      commitProject,
      commitTimingDraft: () => current,
      cancelTimingDraft: vi.fn(),
      clearSelection: vi.fn(),
      selectRange: vi.fn(),
      setSelectedTextAnnotationId: vi.fn(),
      setSelectedKeyId: vi.fn(),
      setSheetSelection: vi.fn(),
      setClipboard: vi.fn(),
      setDialog: vi.fn(),
      setLabelHistory: vi.fn(),
      dialog: {
        mode: 'create',
        laneId: 'sound_lane_1',
        frameStart: 12,
        frameEnd: 24,
        audioCandidate: { trackId: 'dialogue-1', candidateIds: ['candidate-1'], revisionId: 'revision-1' },
      },
      applyAudioCandidateLink,
    })
    controller.submitDialog({ laneId: 'sound_lane_1', frameStart: 12, frameEnd: 24, label: '', text: 'SE' })
    expect(current.timedRangeCues).toEqual([
      expect.objectContaining({ role: 'sound', frameStart: 12, frameEnd: 24, label: '', text: 'SE' }),
    ])
    expect(applyAudioCandidateLink).toHaveBeenCalledWith(
      expect.objectContaining({ timedRangeCues: [expect.objectContaining({ frameStart: 12, frameEnd: 24 })] }),
      { trackId: 'dialogue-1', candidateIds: ['candidate-1'], revisionId: 'revision-1' },
      current.timedRangeCues[0].cueId,
      'move-cue-to-audio',
    )
    expect(commitProject).toHaveBeenCalledTimes(1)
  })

  it('links to an existing cue and can align the cue to the audio region without creating another cue', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'sound',
      laneId: 'sound_lane_1',
      frameStart: 40,
      frameEnd: 50,
      label: '既存',
      text: '',
    })
    let current = created.project
    const applyAudioCandidateLink = vi.fn(project => project)
    const commitProject = vi.fn(project => { current = project })
    const controller = createSoundCueController({
      project: current,
      getProject: () => current,
      template: standardA3SheetTemplate,
      rangeSelection: null,
      selectedCueId: null,
      clipboard: null,
      frameMin: 1,
      frameMax: 144,
      commitProject,
      commitTimingDraft: () => current,
      cancelTimingDraft: vi.fn(),
      clearSelection: vi.fn(),
      selectRange: vi.fn(),
      setSelectedTextAnnotationId: vi.fn(),
      setSelectedKeyId: vi.fn(),
      setSheetSelection: vi.fn(),
      setClipboard: vi.fn(),
      setDialog: vi.fn(),
      setLabelHistory: vi.fn(),
      dialog: {
        mode: 'create',
        laneId: 'sound_lane_1',
        frameStart: 12,
        frameEnd: 24,
        audioCandidate: { trackId: 'dialogue-1', candidateIds: ['candidate-1'], revisionId: 'revision-1' },
      },
      applyAudioCandidateLink,
    })
    controller.submitDialog({
      laneId: 'sound_lane_1',
      frameStart: 12,
      frameEnd: 24,
      label: '',
      text: '',
      existingCueId: created.cue.cueId,
      alignment: 'move-cue-to-audio',
    })
    expect(current.timedRangeCues).toHaveLength(1)
    expect(current.timedRangeCues[0]).toMatchObject({ cueId: created.cue.cueId, frameStart: 12, frameEnd: 24 })
    expect(applyAudioCandidateLink).toHaveBeenCalledWith(
      expect.objectContaining({ timedRangeCues: [expect.objectContaining({ frameStart: 12, frameEnd: 24 })] }),
      { trackId: 'dialogue-1', candidateIds: ['candidate-1'], revisionId: 'revision-1' },
      created.cue.cueId,
      'move-cue-to-audio',
    )
    expect(commitProject).toHaveBeenCalledTimes(1)
  })

  it('moves a colliding SOUND transform to the first free logical lane', () => {
    let project = createTimedRangeCue(createDefaultProject(), {
      role: 'sound',
      laneId: 'sound_lane_1',
      frameStart: 10,
      frameEnd: 20,
      label: 'A',
    }).project
    const created = createTimedRangeCue(project, {
      role: 'sound',
      laneId: 'sound_lane_1',
      frameStart: 30,
      frameEnd: 40,
      label: 'B',
    })
    project = created.project
    let current = project
    const controller = createSoundCueController({
      project,
      getProject: () => current,
      template: standardA3SheetTemplate,
      rangeSelection: null,
      selectedCueId: created.cue.cueId,
      clipboard: null,
      frameMin: 1,
      frameMax: 144,
      commitProject: next => { current = next },
      commitTimingDraft: () => current,
      cancelTimingDraft: vi.fn(),
      clearSelection: vi.fn(),
      selectRange: vi.fn(),
      setSelectedTextAnnotationId: vi.fn(),
      setSelectedKeyId: vi.fn(),
      setSheetSelection: vi.fn(),
      setClipboard: vi.fn(),
      setDialog: vi.fn(),
      setLabelHistory: vi.fn(),
      dialog: null,
    })

    controller.transform(created.cue.cueId, {
      laneId: 'sound_lane_1',
      frameStart: 15,
      frameEnd: 25,
    })

    expect(current.timedRangeCues.find(cue => cue.cueId === created.cue.cueId)).toMatchObject({
      laneId: 'sound_lane_2',
      frameStart: 15,
      frameEnd: 25,
    })
  })
})
