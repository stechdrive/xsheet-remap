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
import { moveDialogueRegionAudioToFrame, transformDialogueRegionInterval } from './dialogueAudioEditing'
import {
  resolveAvailableSoundCueLane,
  SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE,
} from './soundCueEditing'

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
  onPlacementConflict?: (message: string) => void
}

export function createAppDialogueAudioActions(options: AppDialogueAudioActionsOptions) {
  function handleCutStateChange(change: DialogueAudioProjectChange) {
    const source = options.projectRef.current
    const result = applyDialogueAudioProjectChangeResult(source, change)
    if (result.conflict) {
      options.onPlacementConflict?.(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
      return false
    }
    if (change.recordHistory === false) options.replaceProject(result.project)
    else options.commitProject(result.project)
    return true
  }

  function applyCandidateLink(
    project: CutProject,
    candidate: NonNullable<SoundCueDialogState['audioCandidate']>,
    cueId: string,
    alignment: SoundCueAudioAlignment,
  ): CutProject {
    let nextProject = project
    let cue = nextProject.timedRangeCues.find(item => item.cueId === cueId && item.role === 'sound')
    if (!cue) return project
    const state = dialogueAudioCutStateFromProject(
      nextProject,
      nextProject.logicalSheet.frameOrigin,
      nextProject.logicalSheet.durationFrames,
    )
    const created = createDialogueRegionFromCandidates(state, candidate.trackId, candidate.candidateIds)
    if (!created) return project
    let positioned = alignment === 'move-audio-to-cue'
      ? moveDialogueRegionAudioToFrame(created.state, candidate.trackId, created.region.regionId, cue.frameStart)
      : created.state
    if (alignment === 'move-audio-to-cue') {
      const movedRegion = positioned.tracks
        .find(track => track.trackId === candidate.trackId)
        ?.dialogueRegions.find(region => region.regionId === created.region.regionId)
      if (movedRegion) {
        positioned = transformDialogueRegionInterval(
          positioned,
          candidate.trackId,
          movedRegion.regionId,
          cue.frameStart,
          cue.frameEnd,
        )
      }
    } else if (alignment === 'move-cue-to-audio') {
      const placement = resolveAvailableSoundCueLane(
        nextProject,
        cue.laneId,
        created.region.frameStart,
        created.region.frameEnd,
        cue.cueId,
      )
      if (!placement) {
        options.onPlacementConflict?.(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
        return project
      }
      nextProject = updateTimedRangeCue(nextProject, cue.cueId, {
        laneId: placement.laneId,
        frameStart: created.region.frameStart,
        frameEnd: created.region.frameEnd,
      })
      cue = nextProject.timedRangeCues.find(item => item.cueId === cueId && item.role === 'sound')
      if (!cue) return project
    }
    const assigned = assignDialogueRegionsToCue(
      positioned,
      [{ trackId: candidate.trackId, regionId: created.region.regionId }],
      cue,
      candidate.revisionId,
      nextProject.timedRangeCues.filter(item => item.role === 'sound'),
    )
    return updateDialogueAudioCutStateInProject(
      nextProject,
      assigned,
      nextProject.logicalSheet.frameOrigin,
      nextProject.logicalSheet.durationFrames,
    )
  }

  function applySoundCueProjectChange(previousProject: CutProject, nextProject: CutProject): CutProject {
    if (!previousProject.extensions?.[DIALOGUE_AUDIO_EXTENSION]) return nextProject
    const placedProject = resolveChangedSoundCuePlacements(previousProject, nextProject)
    if (!placedProject) {
      options.onPlacementConflict?.(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
      return previousProject
    }
    const previousCues = previousProject.timedRangeCues.filter(cue => cue.role === 'sound')
    const nextCues = placedProject.timedRangeCues.filter(cue => cue.role === 'sound')
    const sourceState = dialogueAudioCutStateFromProject(
      previousProject,
      previousProject.logicalSheet.frameOrigin,
      previousProject.logicalSheet.durationFrames,
    )
    const nextState = applySoundCueChangesToDialogueAudio(sourceState, previousCues, nextCues, options.revisionId)
    return updateDialogueAudioCutStateInProject(
      placedProject,
      nextState,
      placedProject.logicalSheet.frameOrigin,
      placedProject.logicalSheet.durationFrames,
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
  return applyDialogueAudioProjectChangeResult(project, change).project
}

export function applyDialogueAudioProjectChangeResult(
  project: CutProject,
  change: DialogueAudioProjectChange,
): { project: CutProject; conflict: boolean } {
  let next = project
  for (const update of change.cueUpdates ?? []) {
    const cue = next.timedRangeCues.find(item => item.cueId === update.cueId && item.role === 'sound')
    if (cue) {
      const placement = resolveAvailableSoundCueLane(
        next,
        cue.laneId,
        update.frameStart,
        update.frameEnd,
        cue.cueId,
      )
      if (!placement) return { project, conflict: true }
      next = updateTimedRangeCue(next, cue.cueId, {
        laneId: placement.laneId,
        frameStart: update.frameStart,
        frameEnd: update.frameEnd,
      })
    }
  }
  return {
    project: updateDialogueAudioCutStateInProject(
      next,
      change.cutState,
      next.logicalSheet.frameOrigin,
      next.logicalSheet.durationFrames,
    ),
    conflict: false,
  }
}

function resolveChangedSoundCuePlacements(previousProject: CutProject, nextProject: CutProject): CutProject | null {
  const previousById = new Map(previousProject.timedRangeCues.map(cue => [cue.cueId, cue]))
  let placed = nextProject
  for (const cue of nextProject.timedRangeCues.filter(item => item.role === 'sound')) {
    const previous = previousById.get(cue.cueId)
    if (previous
      && previous.laneId === cue.laneId
      && previous.frameStart === cue.frameStart
      && previous.frameEnd === cue.frameEnd) continue
    const placement = resolveAvailableSoundCueLane(placed, cue.laneId, cue.frameStart, cue.frameEnd, cue.cueId)
    if (!placement) return null
    if (placement.reassigned) {
      placed = updateTimedRangeCue(placed, cue.cueId, { laneId: placement.laneId })
    }
  }
  return placed
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
