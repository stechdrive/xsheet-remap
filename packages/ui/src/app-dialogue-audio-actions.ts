import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  timelineLanesForLayout,
  updateActiveCutProjectInDocument,
  updateTimedRangeCue,
  type CutGroupProjectDocument,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SoundCueDialogState } from './appTypes'
import type { SoundCueAudioAlignment } from './SoundCueDialog'
import {
  dialogueAudioCutStateFromDocument,
  updateDialogueAudioCutStateInDocument,
  type DialogueAudioCutState,
} from './dialogueAudioProject'
import { assignDialogueRegionsToCue, createDialogueRegionFromCandidates } from './dialogueAudioBinding'
import { moveDialogueRegionAudioToFrame } from './dialogueAudioEditing'

interface AppDialogueAudioActionsOptions {
  projectRef: MutableRefObject<CutProject>
  template: SheetTemplate
  revisionId: string
  frameMin: number
  frameMax: number
  setProjectDocument: Dispatch<SetStateAction<CutGroupProjectDocument>>
  setSoundCueDialog: Dispatch<SetStateAction<SoundCueDialogState | null>>
  commitProject: (project: CutProject) => void
}

export function createAppDialogueAudioActions(options: AppDialogueAudioActionsOptions) {
  function updateDocumentAudio(transform: (state: DialogueAudioCutState) => DialogueAudioCutState) {
    options.setProjectDocument(current => {
      const project = options.projectRef.current
      const document = updateActiveCutProjectInDocument(current, project, { sheetTemplate: options.template })
      const state = dialogueAudioCutStateFromDocument(
        document,
        document.activeCutId,
        project.logicalSheet.frameOrigin,
        project.logicalSheet.durationFrames,
      )
      return updateDialogueAudioCutStateInDocument(
        document,
        document.activeCutId,
        transform(state),
        project.logicalSheet.frameOrigin,
        project.logicalSheet.durationFrames,
      )
    })
  }

  function handleCutStateChange(cutState: DialogueAudioCutState) {
    updateDocumentAudio(() => cutState)
  }

  function handleCandidateLinked(
    candidate: NonNullable<SoundCueDialogState['audioCandidate']>,
    cueId: string,
    alignment: SoundCueAudioAlignment,
  ) {
    updateDocumentAudio(state => {
      const cue = options.projectRef.current.timedRangeCues.find(item => item.cueId === cueId && item.role === 'sound')
      if (!cue) return state
      const created = createDialogueRegionFromCandidates(state, candidate.trackId, candidate.candidateIds)
      if (!created) return state
      const positioned = alignment === 'move-audio-to-cue'
        ? moveDialogueRegionAudioToFrame(created.state, candidate.trackId, created.region.regionId, cue.frameStart)
        : created.state
      return assignDialogueRegionsToCue(
        positioned,
        [{ trackId: candidate.trackId, regionId: created.region.regionId }],
        cue,
        candidate.revisionId,
      )
    })
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

  function handleTransformSoundCues(updates: Array<{ cueId: string; frameStart: number; frameEnd: number }>) {
    let next = options.projectRef.current
    for (const update of updates) {
      const cue = next.timedRangeCues.find(item => item.cueId === update.cueId && item.role === 'sound')
      if (cue) next = updateTimedRangeCue(next, cue.cueId, { laneId: cue.laneId, frameStart: update.frameStart, frameEnd: update.frameEnd })
    }
    if (next !== options.projectRef.current) options.commitProject(next)
  }

  return {
    handleCutStateChange,
    handleCandidateLinked,
    openSoundCueEditorForAudioCandidate,
    autoCreateDialogueRegions,
    handleTransformSoundCues,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
