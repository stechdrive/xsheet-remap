import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultProject,
  createProjectDocumentFromCutProject,
  createTimedRangeCue,
  standardA3SheetTemplate,
  timelineLanesForLayout,
  type CutGroupProjectDocument,
  type CutProject,
} from '@xsheet-remap/core'
import { createAppDialogueAudioActions } from './app-dialogue-audio-actions'
import {
  createDefaultDialogueAudioCutState,
  dialogueAudioCutStateFromDocument,
  updateDialogueAudioCutStateInDocument,
} from './dialogueAudioProject'

describe('app dialogue audio actions', () => {
  it('auto-creates provisional dialogue regions without guessing a timesheet lane', () => {
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
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 24, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 3, frameEnd: 8, status: 'pending' }]

    const next = actions.autoCreateDialogueRegions(state, 'dialogue-1', ['vad-1'])

    expect(project.timedRangeCues).toEqual([])
    expect(next.assignments).toEqual([])
    expect(next.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 3, frameEnd: 8, candidateIds: ['vad-1'], status: 'ready' })
    expect(next.tracks[0].speechCandidates[0]).toMatchObject({ status: 'pending' })
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

  it('links to a pre-existing cue and moves only that dialogue region to the cue start on request', () => {
    const baseProject = createDefaultProject()
    const laneId = timelineLanesForLayout(baseProject).sound![0].laneId
    const created = createTimedRangeCue(baseProject, {
      role: 'sound',
      laneId,
      frameStart: 30,
      frameEnd: 40,
      label: '先に作ったラベル',
      text: '',
    })
    const projectRef = { current: created.project }
    let document: CutGroupProjectDocument = createProjectDocumentFromCutProject(created.project, { sheetTemplate: standardA3SheetTemplate })
    const state = createDefaultDialogueAudioCutState(1)
    state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
    state.tracks[0].clips = [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 48 }]
    state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'pending' }]
    document = updateDialogueAudioCutStateInDocument(document, document.activeCutId, state, 1, created.project.logicalSheet.durationFrames)
    const actions = createAppDialogueAudioActions({
      projectRef,
      template: standardA3SheetTemplate,
      revisionId: 'revision-1',
      frameMin: 1,
      frameMax: 144,
      setProjectDocument: update => {
        document = typeof update === 'function' ? update(document) : update
      },
      setSoundCueDialog: vi.fn(),
      commitProject: vi.fn(),
    })

    actions.handleCandidateLinked(
      { trackId: 'dialogue-1', candidateIds: ['vad-1'], revisionId: 'revision-1' },
      created.cue.cueId,
      'move-audio-to-cue',
    )

    const restored = dialogueAudioCutStateFromDocument(document, document.activeCutId, 1, created.project.logicalSheet.durationFrames)
    expect(restored.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 30, frameEnd: 38 })
    expect(restored.assignments[0]).toMatchObject({ cueId: created.cue.cueId, regionRefs: [expect.objectContaining({ trackId: 'dialogue-1' })] })
    expect(projectRef.current.logicalSheet.durationFrames).toBe(baseProject.logicalSheet.durationFrames)
  })

  it('keeps an automatic dialogue region beyond the timesheet cut without changing the cut', () => {
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

    const next = actions.autoCreateDialogueRegions(state, 'dialogue-1', ['long-vad'])

    expect(next.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 60, frameEnd: 90 })
    expect(commitProject).not.toHaveBeenCalled()
    expect(projectRef.current.timedRangeCues).toEqual([])
  })
})
