import type { Dispatch, SetStateAction } from 'react'
import {
  createTimedRangeCue,
  deleteTimedRangeCue,
  updateTimedRangeCue,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, SheetSelection, SoundCueClipboard, SoundCueDialogState } from './appTypes'
import type { SoundCueAudioAlignment, SoundCueDialogSubmit } from './SoundCueDialog'
import type { DialogueSoundCueChangeIntent } from './dialogueAudioBinding'
import {
  buildSoundCueClipboard,
  cueForId,
  cutSoundCuesToClipboard,
  deleteSoundCuesInRange,
  pasteSoundCueClipboard,
  recordSoundLabelHistory,
  resolveAvailableSoundCueLane,
  SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE,
  soundLaneIdForRange,
} from './soundCueEditing'

interface SoundCueControllerOptions {
  project: CutProject
  getProject: () => CutProject
  template: SheetTemplate
  rangeSelection: SheetRangeSelection | null
  selectedCueId: string | null
  clipboard: SoundCueClipboard | null
  frameMin: number
  frameMax: number
  commitProject: (project: CutProject) => void
  commitTimingDraft: (advance: boolean) => CutProject
  cancelTimingDraft: () => void
  clearSelection: () => void
  selectRange: (range: SheetRangeSelection, project?: CutProject) => void
  setSelectedTextAnnotationId: (annotationId: string | null) => void
  setSelectedKeyId: (keyId: string | null) => void
  setSheetSelection: Dispatch<SetStateAction<SheetSelection>>
  setClipboard: Dispatch<SetStateAction<SoundCueClipboard | null>>
  setDialog: Dispatch<SetStateAction<SoundCueDialogState | null>>
  setLabelHistory: Dispatch<SetStateAction<string[]>>
  dialog: SoundCueDialogState | null
  applyAudioCandidateLink?: (
    project: CutProject,
    candidate: NonNullable<SoundCueDialogState['audioCandidate']>,
    cueId: string,
    alignment: SoundCueAudioAlignment,
  ) => CutProject
  applySoundCueProjectChange?: (
    previousProject: CutProject,
    nextProject: CutProject,
    intent?: DialogueSoundCueChangeIntent,
  ) => CutProject
  onPlacementConflict?: (message: string) => void
}

export function createSoundCueController(options: SoundCueControllerOptions) {
  const selectedCue = cueForId(options.project, options.selectedCueId)

  function selectCue(cueId: string) {
    const cue = cueForId(options.project, cueId)
    if (!cue) return
    options.commitTimingDraft(false)
    options.setSelectedTextAnnotationId(null)
    options.setSelectedKeyId(null)
    options.setSheetSelection({ kind: 'cue', cueId })
    options.cancelTimingDraft()
  }

  function openEditor(cueId: string) {
    const cue = cueForId(options.project, cueId)
    if (!cue || cue.role !== 'sound') return
    selectCue(cueId)
    options.setDialog({
      mode: 'edit',
      cueId,
      laneId: cue.laneId,
      frameStart: cue.frameStart,
      frameEnd: cue.frameEnd,
    })
  }

  function openEditorForRange(range: SheetRangeSelection) {
    const laneId = soundLaneIdForRange(options.template, range)
    if (range.role !== 'sound' || !laneId) return
    options.selectRange(range)
    options.setDialog({
      mode: 'create',
      laneId,
      frameStart: range.frameStart,
      frameEnd: range.frameEnd,
    })
  }

  function submitDialog(input: SoundCueDialogSubmit) {
    const sourceProject = options.getProject()
    if (input.existingCueId && options.dialog?.audioCandidate) {
      const cue = sourceProject.timedRangeCues.find(item => item.cueId === input.existingCueId && item.role === 'sound')
      if (!cue) return
      const alignment = input.alignment ?? 'move-cue-to-audio'
      const frameStart = alignment === 'move-cue-to-audio' ? input.frameStart : cue.frameStart
      const frameEnd = alignment === 'move-cue-to-audio' ? input.frameEnd : cue.frameEnd
      const placement = resolveAvailableSoundCueLane(sourceProject, cue.laneId, frameStart, frameEnd, cue.cueId)
      if (!placement) return notifyPlacementConflict()
      let next = updateTimedRangeCue(sourceProject, cue.cueId, {
        laneId: placement.laneId,
        frameStart,
        frameEnd,
      })
      next = options.applyAudioCandidateLink?.(next, options.dialog.audioCandidate, cue.cueId, alignment) ?? next
      if (next !== sourceProject) options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: cue.cueId })
    } else if (input.cueId) {
      const placement = resolveAvailableSoundCueLane(sourceProject, input.laneId, input.frameStart, input.frameEnd, input.cueId)
      if (!placement) return notifyPlacementConflict()
      const updated = updateTimedRangeCue(sourceProject, input.cueId, { ...input, laneId: placement.laneId })
      const next = options.applySoundCueProjectChange?.(sourceProject, updated, 'resize-cue') ?? updated
      if (next !== sourceProject) options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: input.cueId })
    } else {
      const placement = resolveAvailableSoundCueLane(sourceProject, input.laneId, input.frameStart, input.frameEnd)
      if (!placement) return notifyPlacementConflict()
      const created = createTimedRangeCue(sourceProject, {
        role: 'sound',
        laneId: placement.laneId,
        frameStart: input.frameStart,
        frameEnd: input.frameEnd,
        label: input.label,
        text: input.text,
      })
      const next = options.dialog?.audioCandidate
        ? options.applyAudioCandidateLink?.(created.project, options.dialog.audioCandidate, created.cue.cueId, 'move-cue-to-audio') ?? created.project
        : created.project
      options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: created.cue.cueId })
    }
    options.setLabelHistory(current => recordSoundLabelHistory(current, input.label))
    options.setDialog(null)
  }

  function transform(
    cueId: string,
    updates: { laneId: string; frameStart: number; frameEnd: number },
    intent: DialogueSoundCueChangeIntent = 'resize-cue',
  ) {
    const sourceProject = options.getProject()
    const placement = resolveAvailableSoundCueLane(sourceProject, updates.laneId, updates.frameStart, updates.frameEnd, cueId)
    if (!placement) return notifyPlacementConflict()
    const updated = updateTimedRangeCue(sourceProject, cueId, { ...updates, laneId: placement.laneId })
    const next = options.applySoundCueProjectChange?.(sourceProject, updated, intent) ?? updated
    if (next !== sourceProject) options.commitProject(next)
    options.setSheetSelection({ kind: 'cue', cueId })
  }

  function notifyPlacementConflict() {
    options.onPlacementConflict?.(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
  }

  function copySelection(mode: SoundCueClipboard['mode']) {
    const laneId = selectedCue?.laneId ?? soundLaneIdForRange(options.template, options.rangeSelection)
    const frameStart = selectedCue?.frameStart ?? options.rangeSelection?.frameStart
    const frameEnd = selectedCue?.frameEnd ?? options.rangeSelection?.frameEnd
    if (!laneId || frameStart === undefined || frameEnd === undefined) return
    const clipboard = buildSoundCueClipboard(options.project, {
      laneId,
      frameStart,
      frameEnd,
      mode,
      cueId: selectedCue?.cueId,
    })
    if (!clipboard) return
    options.setClipboard(clipboard)
    if (mode !== 'cut') return
    const updated = cutSoundCuesToClipboard(options.project, clipboard)
    const next = options.applySoundCueProjectChange?.(options.project, updated) ?? updated
    if (next !== options.project) options.commitProject(next)
    if (selectedCue) options.clearSelection()
    else if (options.rangeSelection) options.selectRange(options.rangeSelection, next)
  }

  function pasteSelection(mode: 'overwrite' | 'insert') {
    if (!options.clipboard) return
    const laneId = selectedCue?.laneId ?? soundLaneIdForRange(options.template, options.rangeSelection)
    const frameStart = selectedCue?.frameStart ?? options.rangeSelection?.frameStart
    if (!laneId || frameStart === undefined) return
    const result = pasteSoundCueClipboard(options.project, options.clipboard, { laneId, frameStart }, mode)
    const next = options.applySoundCueProjectChange?.(
      options.project,
      result.project,
      mode === 'insert' ? 'move-binding' : 'reconcile',
    ) ?? result.project
    if (next !== options.project) options.commitProject(next)
    const cueId = result.cueIds[0]
    if (cueId) options.setSheetSelection({ kind: 'cue', cueId })
  }

  function deleteSelection(): boolean {
    if (options.selectedCueId) {
      const updated = deleteTimedRangeCue(options.project, options.selectedCueId)
      const next = options.applySoundCueProjectChange?.(options.project, updated) ?? updated
      if (next !== options.project) options.commitProject(next)
      options.clearSelection()
      return true
    }
    const laneId = soundLaneIdForRange(options.template, options.rangeSelection)
    if (options.rangeSelection?.role !== 'sound' || !laneId) return false
    const updated = deleteSoundCuesInRange(
      options.project,
      laneId,
      options.rangeSelection.frameStart,
      options.rangeSelection.frameEnd,
    )
    const next = options.applySoundCueProjectChange?.(options.project, updated) ?? updated
    if (next !== options.project) options.commitProject(next)
    options.selectRange(options.rangeSelection, next)
    return true
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    const modifier = event.ctrlKey || event.metaKey
    const soundRangeSelected = options.rangeSelection?.role === 'sound'
    if (modifier && event.key.toLowerCase() === 'c' && (selectedCue || soundRangeSelected)) {
      event.preventDefault()
      copySelection('copy')
      return true
    }
    if (modifier && event.key.toLowerCase() === 'x' && (selectedCue || soundRangeSelected)) {
      event.preventDefault()
      copySelection('cut')
      return true
    }
    if (modifier && event.key.toLowerCase() === 'v' && options.clipboard && (selectedCue || soundRangeSelected)) {
      event.preventDefault()
      pasteSelection(event.shiftKey ? 'insert' : 'overwrite')
      return true
    }
    if (!modifier && !event.altKey && event.key === 'Enter' && options.selectedCueId) {
      event.preventDefault()
      openEditor(options.selectedCueId)
      return true
    }
    if (!modifier && !event.altKey && event.key === 'Enter' && soundRangeSelected && options.rangeSelection) {
      event.preventDefault()
      openEditorForRange(options.rangeSelection)
      return true
    }
    if (!modifier && !event.altKey && event.key === 'ArrowUp' && selectedCue) {
      event.preventDefault()
      if (selectedCue.frameStart > options.frameMin) {
        transform(selectedCue.cueId, {
          laneId: selectedCue.laneId,
          frameStart: selectedCue.frameStart - 1,
          frameEnd: selectedCue.frameEnd - 1,
        })
      }
      return true
    }
    if (!modifier && !event.altKey && event.key === 'ArrowDown' && selectedCue) {
      event.preventDefault()
      if (selectedCue.frameEnd < options.frameMax) {
        transform(selectedCue.cueId, {
          laneId: selectedCue.laneId,
          frameStart: selectedCue.frameStart + 1,
          frameEnd: selectedCue.frameEnd + 1,
        })
      }
      return true
    }
    if (!modifier && !event.altKey && event.key.startsWith('Arrow') && (selectedCue || soundRangeSelected)) {
      event.preventDefault()
      return true
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selectedCue && !soundRangeSelected) return false
      event.preventDefault()
      deleteSelection()
      return true
    }
    return false
  }

  return {
    selectedCue,
    selectCue,
    openEditor,
    openEditorForRange,
    submitDialog,
    transform,
    copySelection,
    pasteSelection,
    deleteSelection,
    handleKeyDown,
  }
}
