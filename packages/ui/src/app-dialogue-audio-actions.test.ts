import { describe, expect, it, vi } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import {
  commitHistory,
  createDefaultProject,
  createProjectHistory,
  createTimedRangeCue,
  deleteTimedRangeCue,
  redoHistory,
  standardA3SheetTemplate,
  timelineLanesForLayout,
  undoHistory,
  updateTimedRangeCue,
  type CutProject,
} from '@xsheet-remap/core'
import { applyDialogueAudioProjectChange, createAppDialogueAudioActions } from './app-dialogue-audio-actions'
import type { SoundCueDialogState } from './appTypes'
import {
  createDefaultDialogueAudioCutState,
  dialogueAudioCutStateFromProject,
  updateDialogueAudioCutStateInProject,
} from './dialogueAudioProject'
import { synchronizeDialogueAssignmentsAfterAudioEdit } from './dialogueAudioBinding'
import { moveDialogueAudioClip } from './dialogueAudioEditing'

describe('app dialogue audio actions', () => {
  it('auto-creates dialogue regions without guessing a timesheet lane', () => {
    const actions = actionsFor(createDefaultProject())
    const state = sourceAudioState()

    const next = actions.autoCreateDialogueRegions(state, 'dialogue-1', ['vad-1'])

    expect(next.assignments).toEqual([])
    expect(next.tracks[0].dialogueRegions[0]).toMatchObject({
      frameStart: 12,
      frameEnd: 20,
      candidateIds: ['vad-1'],
      status: 'ready',
    })
  })

  it('opens one SOUND dialog spanning multiple selected VAD regions', () => {
    const setSoundCueDialog = vi.fn()
    const actions = actionsFor(createDefaultProject(), { setSoundCueDialog })

    actions.openSoundCueEditorForAudioCandidate('dialogue-1', ['vad-1', 'vad-2'], 12, 35)

    expect(setSoundCueDialog).toHaveBeenCalledWith(expect.objectContaining({
      frameStart: 12,
      frameEnd: 35,
      audioCandidate: { trackId: 'dialogue-1', candidateIds: ['vad-1', 'vad-2'], revisionId: 'revision-1' },
    }))
  })

  it('links to a pre-existing cue and moves only that region to the cue start', () => {
    const project = projectWithCueAndAudio(30, 40)
    const actions = actionsFor(project)
    const cueId = project.timedRangeCues[0].cueId

    const linked = actions.applyCandidateLink(project, candidateRequest(), cueId, 'move-audio-to-cue')
    const state = dialogueAudioCutStateFromProject(linked, 1)

    expect(state.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 30, frameEnd: 38 })
    expect(state.assignments[0]).toMatchObject({ cueId, regionRefs: [{ trackId: 'dialogue-1', regionId: 'dialogue-region' }] })
    expect(linked.logicalSheet.durationFrames).toBe(project.logicalSheet.durationFrames)
  })

  it('moves all linked audio with a sheet-side body move and preserves padding', () => {
    const linked = linkedProject()
    const actions = actionsFor(linked)
    const cue = linked.timedRangeCues[0]
    const movedCueProject = updateTimedRangeCue(linked, cue.cueId, {
      laneId: cue.laneId,
      frameStart: cue.frameStart + 8,
      frameEnd: cue.frameEnd + 8,
    })

    const moved = actions.applySoundCueProjectChange(linked, movedCueProject)
    const state = dialogueAudioCutStateFromProject(moved, 1)

    expect(state.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 20, frameEnd: 28 })
    expect(state.assignments[0]).toMatchObject({
      headPaddingFrames: 2,
      tailPaddingFrames: 0,
    })
    expect(state.tracks[0].clips.some(clip => clip.timelineStartFrame === 20 && clip.durationFrames === 9)).toBe(true)
  })

  it('treats sheet-side edge resizing as padding without moving audio', () => {
    const linked = linkedProject()
    const actions = actionsFor(linked)
    const cue = linked.timedRangeCues[0]
    const resizedCueProject = updateTimedRangeCue(linked, cue.cueId, {
      laneId: cue.laneId,
      frameStart: cue.frameStart,
      frameEnd: cue.frameEnd + 5,
    })

    const resized = actions.applySoundCueProjectChange(linked, resizedCueProject)
    const state = dialogueAudioCutStateFromProject(resized, 1)

    expect(state.tracks[0].dialogueRegions[0]).toMatchObject({ frameStart: 12, frameEnd: 20 })
    expect(state.assignments[0]).toMatchObject({ headPaddingFrames: 2, tailPaddingFrames: 5 })
    expect(state.tracks[0].clips).toEqual(dialogueAudioCutStateFromProject(linked, 1).tracks[0].clips)
  })

  it('undoes and redoes a linked sheet/audio move as one exact project snapshot', () => {
    const linked = linkedProject()
    const actions = actionsFor(linked)
    const cue = linked.timedRangeCues[0]
    const movedCueProject = updateTimedRangeCue(linked, cue.cueId, {
      laneId: cue.laneId,
      frameStart: cue.frameStart + 6,
      frameEnd: cue.frameEnd + 6,
    })
    const moved = actions.applySoundCueProjectChange(linked, movedCueProject)
    const committed = commitHistory(createProjectHistory(linked), moved)

    const undone = undoHistory(committed)
    expect(undone.present).toEqual(linked)
    expect(redoHistory(undone).present).toEqual(moved)
  })

  it('undoes and redoes an audio-side move and its SOUND update as one exact snapshot', () => {
    const linked = linkedProject()
    const sourceState = dialogueAudioCutStateFromProject(linked, 1)
    const movedTrack = moveDialogueAudioClip(sourceState.tracks[0], 'clip-1', 7)
    const movedState = {
      ...sourceState,
      tracks: sourceState.tracks.map(track => track.trackId === movedTrack.trackId ? movedTrack : track),
    }
    const synchronized = synchronizeDialogueAssignmentsAfterAudioEdit(
      movedState,
      linked.timedRangeCues.filter(cue => cue.role === 'sound'),
      'revision-1',
    )
    const moved = applyDialogueAudioProjectChange(linked, {
      cutState: synchronized.state,
      cueUpdates: synchronized.cueUpdates,
    })
    const committed = commitHistory(createProjectHistory(linked), moved)

    expect(moved.timedRangeCues[0]).toMatchObject({ frameStart: 16, frameEnd: 26 })
    expect(dialogueAudioCutStateFromProject(moved, 1).tracks[0].dialogueRegions[0]).toMatchObject({
      frameStart: 18,
      frameEnd: 26,
    })
    expect(undoHistory(committed).present).toEqual(linked)
    expect(redoHistory(undoHistory(committed)).present).toEqual(moved)
  })

  it('moves linked regions from multiple fixed audio tracks as one cue group', () => {
    let project = linkedProject()
    const state = dialogueAudioCutStateFromProject(project, 1)
    state.tracks[1].clips = [{
      clipId: 'clip-2',
      placementId: 'placement-2',
      assetId: 'asset-1',
      timelineStartFrame: 25,
      sourceOffsetFrames: 0,
      durationFrames: 20,
    }]
    state.tracks[1].speechCandidates = [{ candidateId: 'vad-2', frameStart: 30, frameEnd: 34, status: 'pending' }]
    project = updateDialogueAudioCutStateInProject(project, state, 1)
    const actions = actionsFor(project)
    project = actions.applyCandidateLink(
      project,
      { trackId: 'dialogue-2', candidateIds: ['vad-2'], revisionId: 'revision-1' },
      project.timedRangeCues[0].cueId,
      'keep-offset',
    )
    const cue = project.timedRangeCues[0]
    const movedCueProject = updateTimedRangeCue(project, cue.cueId, {
      laneId: cue.laneId,
      frameStart: cue.frameStart + 4,
      frameEnd: cue.frameEnd + 4,
    })

    const moved = actionsFor(project).applySoundCueProjectChange(project, movedCueProject)
    const movedState = dialogueAudioCutStateFromProject(moved, 1)

    expect(movedState.assignments[0].regionRefs).toEqual([
      { trackId: 'dialogue-1', regionId: 'dialogue-region' },
      { trackId: 'dialogue-2', regionId: 'dialogue-region-2' },
    ])
    expect(movedState.tracks[0].dialogueRegions[0].frameStart).toBe(16)
    expect(movedState.tracks[1].dialogueRegions[0].frameStart).toBe(34)
  })

  it('marks a deleted linked cue for review and restores the complete link with Undo', () => {
    const linked = linkedProject()
    const withoutCue = deleteTimedRangeCue(linked, linked.timedRangeCues[0].cueId)
    const reconciled = actionsFor(linked).applySoundCueProjectChange(linked, withoutCue)
    const state = dialogueAudioCutStateFromProject(reconciled, 1)
    expect(state.assignments[0]).toMatchObject({
      status: 'review',
      reviewReason: 'リンク先の音響指示が見つかりません。',
    })

    const history = commitHistory(createProjectHistory(linked), reconciled)
    expect(undoHistory(history).present).toEqual(linked)
  })

  it('commits audio and linked cue updates through one project commit', () => {
    const linked = linkedProject()
    const projectRef = { current: linked }
    const commitProject = vi.fn((next: CutProject) => { projectRef.current = next })
    const actions = createAppDialogueAudioActions({
      projectRef,
      template: standardA3SheetTemplate,
      revisionId: 'revision-1',
      frameMin: 1,
      frameMax: 144,
      setSoundCueDialog: vi.fn(),
      commitProject,
      replaceProject: vi.fn(),
    })
    const movedState = dialogueAudioCutStateFromProject(linked, 1)
    movedState.tracks[0].clips = movedState.tracks[0].clips.map(clip => ({ ...clip, timelineStartFrame: clip.timelineStartFrame + 4 }))

    actions.handleCutStateChange({
      cutState: movedState,
      cueUpdates: [{ cueId: linked.timedRangeCues[0].cueId, frameStart: 14, frameEnd: 24 }],
    })

    expect(commitProject).toHaveBeenCalledTimes(1)
    const committed = commitProject.mock.calls[0][0]
    expect(committed.timedRangeCues[0]).toMatchObject({ frameStart: 14, frameEnd: 24 })
    expect(dialogueAudioCutStateFromProject(committed, 1).tracks[0].clips[0].timelineStartFrame).toBe(5)
  })
})

function actionsFor(project: CutProject, overrides: {
  setSoundCueDialog?: Dispatch<SetStateAction<SoundCueDialogState | null>>
} = {}) {
  const projectRef = { current: project }
  return createAppDialogueAudioActions({
    projectRef,
    template: standardA3SheetTemplate,
    revisionId: 'revision-1',
    frameMin: 1,
    frameMax: 144,
    setSoundCueDialog: overrides.setSoundCueDialog ?? vi.fn(),
    commitProject: next => { projectRef.current = next },
    replaceProject: next => { projectRef.current = next },
  })
}

function candidateRequest() {
  return { trackId: 'dialogue-1', candidateIds: ['vad-1'], revisionId: 'revision-1' }
}

function sourceAudioState() {
  const state = createDefaultDialogueAudioCutState(1)
  state.assets = [{ assetId: 'asset-1', audioDataUrl: 'data:audio/wav;base64,UklGRg==', durationFrames: 48, waveform: [] }]
  state.tracks[0].clips = [{
    clipId: 'clip-1',
    placementId: 'placement-1',
    assetId: 'asset-1',
    timelineStartFrame: 1,
    sourceOffsetFrames: 0,
    durationFrames: 48,
  }]
  state.tracks[0].speechCandidates = [{ candidateId: 'vad-1', frameStart: 12, frameEnd: 20, status: 'pending' }]
  return state
}

function projectWithCueAndAudio(frameStart: number, frameEnd: number) {
  const base = createDefaultProject()
  const laneId = timelineLanesForLayout(base).sound![0].laneId
  const created = createTimedRangeCue(base, {
    role: 'sound',
    laneId,
    frameStart,
    frameEnd,
    label: '主人公',
    text: 'はい',
  })
  return updateDialogueAudioCutStateInProject(created.project, sourceAudioState(), 1, created.project.logicalSheet.durationFrames)
}

function linkedProject() {
  const project = projectWithCueAndAudio(10, 20)
  return actionsFor(project).applyCandidateLink(project, candidateRequest(), project.timedRangeCues[0].cueId, 'keep-offset')
}
