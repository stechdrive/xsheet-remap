import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate } from '@xsheet-remap/core'
import { createSoundCueController } from './app-sound-cue-controller'

describe('sound cue controller audio integration', () => {
  it('creates a SOUND cue from an audio candidate and reports the revision link', () => {
    const source = createDefaultProject()
    let current = source
    const onAudioCandidateLinked = vi.fn()
    const controller = createSoundCueController({
      project: source,
      getProject: () => current,
      template: standardA3SheetTemplate,
      rangeSelection: null,
      selectedCueId: null,
      clipboard: null,
      frameMin: 1,
      frameMax: 144,
      commitProject: project => { current = project },
      commitTimingDraft: () => current,
      clearSelection: vi.fn(),
      selectRange: vi.fn(),
      setSelectedTextAnnotationId: vi.fn(),
      setSelectedKeyId: vi.fn(),
      setSheetSelection: vi.fn(),
      setValueDraft: vi.fn(),
      setValueDraftActive: vi.fn(),
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
      onAudioCandidateLinked,
    })
    controller.submitDialog({ laneId: 'sound_lane_1', frameStart: 12, frameEnd: 24, label: '主人公', text: '行こう' })
    expect(current.timedRangeCues).toEqual([
      expect.objectContaining({ role: 'sound', frameStart: 12, frameEnd: 24, label: '主人公', text: '行こう' }),
    ])
    expect(onAudioCandidateLinked).toHaveBeenCalledWith(
      { trackId: 'dialogue-1', candidateIds: ['candidate-1'], revisionId: 'revision-1' },
      current.timedRangeCues[0].cueId,
    )
  })
})
