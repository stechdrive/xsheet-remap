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
import {
  dialogueAudioCutStateFromDocument,
  linkDialogueAudioCandidate,
  updateDialogueAudioCutStateInDocument,
  type DialogueAudioCutState,
} from './dialogueAudioProject'

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
    updateDocumentAudio(state => linkDialogueAudioCandidate(
      state,
      candidate.trackId,
      candidate.candidateId,
      cueId,
      candidate.revisionId,
    ))
  }

  function openSoundCueEditorForAudioCandidate(trackId: string, candidateId: string, frameStart: number, frameEnd: number) {
    const lane = timelineLanesForLayout(options.projectRef.current).sound?.[0]
    if (!lane) return
    options.setSoundCueDialog({
      mode: 'create',
      laneId: lane.laneId,
      frameStart: clamp(frameStart, options.frameMin, options.frameMax),
      frameEnd: clamp(frameEnd, options.frameMin, options.frameMax),
      audioCandidate: { trackId, candidateId, revisionId: options.revisionId },
    })
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
    handleTransformSoundCues,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
