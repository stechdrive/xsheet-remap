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
import {
  buildSoundCueClipboard,
  cueForId,
  cutSoundCuesToClipboard,
  deleteSoundCuesInRange,
  pasteSoundCueClipboard,
  recordSoundLabelHistory,
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
  onAudioCandidateLinked?: (candidate: NonNullable<SoundCueDialogState['audioCandidate']>, cueId: string, alignment: SoundCueAudioAlignment) => void
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
      const alignment = input.alignment ?? 'keep-offset'
      const next = alignment === 'move-cue-to-audio'
        ? updateTimedRangeCue(sourceProject, cue.cueId, {
            laneId: cue.laneId,
            frameStart: input.frameStart,
            frameEnd: input.frameEnd,
          })
        : sourceProject
      if (next !== sourceProject) options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: cue.cueId })
      options.onAudioCandidateLinked?.(options.dialog.audioCandidate, cue.cueId, alignment)
    } else if (input.cueId) {
      const next = updateTimedRangeCue(sourceProject, input.cueId, input)
      if (next !== sourceProject) options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: input.cueId })
    } else {
      const created = createTimedRangeCue(sourceProject, {
        role: 'sound',
        laneId: input.laneId,
        frameStart: input.frameStart,
        frameEnd: input.frameEnd,
        label: input.label,
        text: input.text,
      })
      options.commitProject(created.project)
      options.setSheetSelection({ kind: 'cue', cueId: created.cue.cueId })
      if (options.dialog?.audioCandidate) options.onAudioCandidateLinked?.(options.dialog.audioCandidate, created.cue.cueId, 'keep-offset')
    }
    options.setLabelHistory(current => recordSoundLabelHistory(current, input.label))
    options.setDialog(null)
  }

  function transform(cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) {
    const sourceProject = options.getProject()
    const next = updateTimedRangeCue(sourceProject, cueId, updates)
    if (next !== sourceProject) options.commitProject(next)
    options.setSheetSelection({ kind: 'cue', cueId })
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
    const next = cutSoundCuesToClipboard(options.project, clipboard)
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
    if (result.project !== options.project) options.commitProject(result.project)
    const cueId = result.cueIds[0]
    if (cueId) options.setSheetSelection({ kind: 'cue', cueId })
  }

  function deleteSelection(): boolean {
    if (options.selectedCueId) {
      const next = deleteTimedRangeCue(options.project, options.selectedCueId)
      if (next !== options.project) options.commitProject(next)
      options.clearSelection()
      return true
    }
    const laneId = soundLaneIdForRange(options.template, options.rangeSelection)
    if (options.rangeSelection?.role !== 'sound' || !laneId) return false
    const next = deleteSoundCuesInRange(
      options.project,
      laneId,
      options.rangeSelection.frameStart,
      options.rangeSelection.frameEnd,
    )
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
