import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  timelineLanesForLayout,
  updateTimedRangeCue,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SoundCueDialogState } from './appTypes'
import type { SoundCueAudioAlignment } from './SoundCueDialog'
import {
  DIALOGUE_AUDIO_EXTENSION,
  dialogueAudioCutStateFromProject,
  updateDialogueAudioCutStateInProject,
  type DialogueAudioCutState,
} from './dialogueAudioProject'
import {
  applySoundCueChangesToDialogueAudio,
  assignDialogueRegionsToCue,
  createDialogueRegionFromCandidates,
} from './dialogueAudioBinding'
import { moveDialogueRegionAudioToFrame } from './dialogueAudioEditing'

export interface DialogueAudioProjectChange {
  cutState: DialogueAudioCutState
  cueUpdates?: Array<{ cueId: string; frameStart: number; frameEnd: number }>
  recordHistory?: boolean
}

interface AppDialogueAudioActionsOptions {
  projectRef: MutableRefObject<CutProject>
  template: SheetTemplate
  revisionId: string
  frameMin: number
  frameMax: number
  setSoundCueDialog: Dispatch<SetStateAction<SoundCueDialogState | null>>
  commitProject: (project: CutProject) => void
  replaceProject: (project: CutProject) => void
}

export function createAppDialogueAudioActions(options: AppDialogueAudioActionsOptions) {
  function handleCutStateChange(change: DialogueAudioProjectChange) {
    const source = options.projectRef.current
    const next = applyDialogueAudioProjectChange(source, change)
    if (change.recordHistory === false) options.replaceProject(next)
    else options.commitProject(next)
  }

  function applyCandidateLink(
    project: CutProject,
    candidate: NonNullable<SoundCueDialogState['audioCandidate']>,
    cueId: string,
    alignment: SoundCueAudioAlignment,
  ): CutProject {
    const cue = project.timedRangeCues.find(item => item.cueId === cueId && item.role === 'sound')
    if (!cue) return project
    const state = dialogueAudioCutStateFromProject(
      project,
      project.logicalSheet.frameOrigin,
      project.logicalSheet.durationFrames,
    )
    const created = createDialogueRegionFromCandidates(state, candidate.trackId, candidate.candidateIds)
    if (!created) return project
    const positioned = alignment === 'move-audio-to-cue'
      ? moveDialogueRegionAudioToFrame(created.state, candidate.trackId, created.region.regionId, cue.frameStart)
      : created.state
    const assigned = assignDialogueRegionsToCue(
      positioned,
      [{ trackId: candidate.trackId, regionId: created.region.regionId }],
      cue,
      candidate.revisionId,
      project.timedRangeCues.filter(item => item.role === 'sound'),
    )
    return updateDialogueAudioCutStateInProject(
      project,
      assigned,
      project.logicalSheet.frameOrigin,
      project.logicalSheet.durationFrames,
    )
  }

  function applySoundCueProjectChange(previousProject: CutProject, nextProject: CutProject): CutProject {
    if (!previousProject.extensions?.[DIALOGUE_AUDIO_EXTENSION]) return nextProject
    const previousCues = previousProject.timedRangeCues.filter(cue => cue.role === 'sound')
    const nextCues = nextProject.timedRangeCues.filter(cue => cue.role === 'sound')
    const sourceState = dialogueAudioCutStateFromProject(
      previousProject,
      previousProject.logicalSheet.frameOrigin,
      previousProject.logicalSheet.durationFrames,
    )
    const nextState = applySoundCueChangesToDialogueAudio(sourceState, previousCues, nextCues, options.revisionId)
    return updateDialogueAudioCutStateInProject(
      nextProject,
      nextState,
      nextProject.logicalSheet.frameOrigin,
      nextProject.logicalSheet.durationFrames,
    )
  }

  function openSoundCueEditorForAudioCandidate(trackId: string, candidateIds: string[], frameStart: number, frameEnd: number, cueId?: string) {
    const lane = timelineLanesForLayout(options.projectRef.current).sound?.[0]
    if (!lane) return
    options.setSoundCueDialog({
      mode: 'create',
      laneId: lane.laneId,
      frameStart: clamp(frameStart, options.frameMin, options.frameMax),
      frameEnd: clamp(frameEnd, options.frameMin, options.frameMax),
      audioCandidate: { trackId, candidateIds, revisionId: options.revisionId, ...(cueId ? { cueId } : {}) },
    })
  }

  function autoCreateDialogueRegions(
    stateInput: DialogueAudioCutState,
    trackId: string,
    candidateIds: string[],
  ): DialogueAudioCutState {
    const track = stateInput.tracks.find(item => item.trackId === trackId)
    if (!track) return stateInput
    let state = stateInput
    for (const candidateId of candidateIds) {
      const candidate = track.speechCandidates.find(item => item.candidateId === candidateId)
      if (!candidate || state.tracks.some(item => item.dialogueRegions.some(region => region.candidateIds.includes(candidateId)))) continue
      state = createDialogueRegionFromCandidates(state, trackId, [candidateId])?.state ?? state
    }
    return state
  }

  return {
    handleCutStateChange,
    applyCandidateLink,
    applySoundCueProjectChange,
    openSoundCueEditorForAudioCandidate,
    autoCreateDialogueRegions,
  }
}

export function applyDialogueAudioProjectChange(
  project: CutProject,
  change: DialogueAudioProjectChange,
): CutProject {
  let next = project
  for (const update of change.cueUpdates ?? []) {
    const cue = next.timedRangeCues.find(item => item.cueId === update.cueId && item.role === 'sound')
    if (cue) {
      next = updateTimedRangeCue(next, cue.cueId, {
        laneId: cue.laneId,
        frameStart: update.frameStart,
        frameEnd: update.frameEnd,
      })
    }
  }
  return updateDialogueAudioCutStateInProject(
    next,
    change.cutState,
    next.logicalSheet.frameOrigin,
    next.logicalSheet.durationFrames,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
