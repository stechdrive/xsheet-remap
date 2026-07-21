import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  createTimedRangeCue,
  timelineLanesForLayout,
  updateActiveCutProjectInDocument,
  updateTimedRangeCue,
  type CutGroupProjectDocument,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SoundCueDialogState } from './appTypes'
import {
  dialogueAudioCutStateFromDocument,
  updateDialogueAudioCutStateInDocument,
  type DialogueAudioCutState,
} from './dialogueAudioProject'
import { linkDialogueAudioCandidates } from './dialogueAudioBinding'

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
      const state = dialogueAudioCutStateFromDocument(document, document.activeCutId, project.logicalSheet.frameOrigin)
      return updateDialogueAudioCutStateInDocument(
        document,
        document.activeCutId,
        transform(state),
        project.logicalSheet.frameOrigin,
      )
    })
  }

  function handleCutStateChange(cutState: DialogueAudioCutState) {
    updateDocumentAudio(() => cutState)
  }

  function handleCandidateLinked(
    candidate: NonNullable<SoundCueDialogState['audioCandidate']>,
    cueId: string,
  ) {
    updateDocumentAudio(state => {
      const cue = options.projectRef.current.timedRangeCues.find(item => item.cueId === cueId && item.role === 'sound')
      return cue
        ? linkDialogueAudioCandidates(state, candidate.trackId, candidate.candidateIds, cue, candidate.revisionId)
        : state
    })
  }

  function openSoundCueEditorForAudioCandidate(trackId: string, candidateIds: string[], frameStart: number, frameEnd: number) {
    const lane = timelineLanesForLayout(options.projectRef.current).sound?.[0]
    if (!lane) return
    options.setSoundCueDialog({
      mode: 'create',
      laneId: lane.laneId,
      frameStart: clamp(frameStart, options.frameMin, options.frameMax),
      frameEnd: clamp(frameEnd, options.frameMin, options.frameMax),
      audioCandidate: { trackId, candidateIds, revisionId: options.revisionId },
    })
  }

  function autoCreateSoundCues(
    stateInput: DialogueAudioCutState,
    trackId: string,
    candidateIds: string[],
  ): DialogueAudioCutState {
    const lane = timelineLanesForLayout(options.projectRef.current).sound?.[0]
    const track = stateInput.tracks.find(item => item.trackId === trackId)
    if (!lane || !track) return stateInput
    let project = options.projectRef.current
    let state = stateInput
    let sequence = project.timedRangeCues.filter(cue => cue.role === 'sound' && cue.label.startsWith(`仮・${track.name}`)).length + 1
    for (const candidateId of candidateIds) {
      const candidate = track.speechCandidates.find(item => item.candidateId === candidateId)
      if (!candidate || state.bindings.some(binding => binding.revisionId === options.revisionId && binding.anchors.some(anchor => anchor.candidateIds.includes(candidateId)))) continue
      const created = createTimedRangeCue(project, {
        role: 'sound',
        laneId: lane.laneId,
        frameStart: Math.max(options.frameMin, candidate.frameStart),
        frameEnd: Math.min(options.frameMax, candidate.frameEnd),
        label: `仮・${track.name} ${sequence}`,
        text: '',
      })
      sequence += 1
      project = created.project
      state = linkDialogueAudioCandidates(state, trackId, [candidateId], created.cue, options.revisionId, true)
    }
    if (project !== options.projectRef.current) options.commitProject(project)
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
    autoCreateSoundCues,
    handleTransformSoundCues,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
