import type { Dispatch, SetStateAction } from 'react'
import {
  createTimedRangeCue,
  deleteTimedRangeCue,
  updateTimedRangeCue,
  transformCameraInstructionRange,
  type CameraInstruction,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { CameraCueClipboard, CameraCueDialogState, SheetRangeSelection, SheetSelection } from './appTypes'
import type { CameraCueDialogSubmit } from './CameraCueDialog'
import {
  buildCameraCueClipboard,
  cameraLaneIdForRange,
  cutCameraCuesToClipboard,
  deleteCameraCuesInRange,
  pasteCameraCueClipboard,
} from './cameraCueEditing'
import { recordCameraInstructionHistory, recordCameraPointLabelHistory } from './cameraCueEditing'
import { timedRangeCueForId } from './timedRangeCueEditing'

export interface CameraCueTransformUpdates {
  laneId?: string
  frameStart?: number
  frameEnd?: number
  camera?: CameraInstruction
}

interface CameraCueControllerOptions {
  project: CutProject
  getProject: () => CutProject
  template: SheetTemplate
  rangeSelection: SheetRangeSelection | null
  selectedCueId: string | null
  clipboard: CameraCueClipboard | null
  frameMin: number
  frameMax: number
  commitProject: (project: CutProject) => void
  commitTimingDraft: (advance: boolean) => CutProject
  clearSelection: () => void
  selectRange: (range: SheetRangeSelection, project?: CutProject) => void
  setSelectedTextAnnotationId: (annotationId: string | null) => void
  setSelectedKeyId: (keyId: string | null) => void
  setSheetSelection: Dispatch<SetStateAction<SheetSelection>>
  setValueDraft: Dispatch<SetStateAction<string>>
  setValueDraftActive: Dispatch<SetStateAction<boolean>>
  setClipboard: Dispatch<SetStateAction<CameraCueClipboard | null>>
  setDialog: Dispatch<SetStateAction<CameraCueDialogState | null>>
  setInstructionHistory: Dispatch<SetStateAction<string[]>>
  setPointLabelHistory: Dispatch<SetStateAction<string[]>>
}

export function createCameraCueController(options: CameraCueControllerOptions) {
  const selectedCue = timedRangeCueForId(options.project, options.selectedCueId)

  function selectCue(cueId: string) {
    const cue = timedRangeCueForId(options.project, cueId)
    if (!cue || cue.role !== 'camera') return
    options.commitTimingDraft(false)
    options.setSelectedTextAnnotationId(null)
    options.setSelectedKeyId(null)
    options.setSheetSelection({ kind: 'cue', cueId })
    options.setValueDraft('')
    options.setValueDraftActive(false)
  }

  function openEditor(cueId: string) {
    const cue = timedRangeCueForId(options.project, cueId)
    if (!cue || cue.role !== 'camera') return
    selectCue(cueId)
    options.setDialog({ mode: 'edit', cueId, laneId: cue.laneId, frameStart: cue.frameStart, frameEnd: cue.frameEnd })
  }

  function openEditorForRange(range: SheetRangeSelection) {
    const laneId = cameraLaneIdForRange(options.template, range)
    if (range.role !== 'camera' || !laneId) return
    options.selectRange(range)
    options.setDialog({ mode: 'create', laneId, frameStart: range.frameStart, frameEnd: range.frameEnd })
  }

  function submitDialog(input: CameraCueDialogSubmit) {
    const sourceProject = options.getProject()
    if (input.cueId) {
      const next = updateTimedRangeCue(sourceProject, input.cueId, input)
      if (next !== sourceProject) options.commitProject(next)
      options.setSheetSelection({ kind: 'cue', cueId: input.cueId })
    } else {
      const created = createTimedRangeCue(sourceProject, { role: 'camera', ...input })
      options.commitProject(created.project)
      options.setSheetSelection({ kind: 'cue', cueId: created.cue.cueId })
    }
    options.setInstructionHistory(current => recordCameraInstructionHistory(current, input.label))
    options.setPointLabelHistory(current => recordCameraPointLabelHistory(
      current,
      input.camera.points?.map(point => point.label) ?? [],
    ))
    options.setDialog(null)
  }

  function transform(cueId: string, updates: CameraCueTransformUpdates) {
    const sourceProject = options.getProject()
    const cue = timedRangeCueForId(sourceProject, cueId)
    if (!cue || cue.role !== 'camera') return
    const frameStart = updates.frameStart ?? cue.frameStart
    const frameEnd = updates.frameEnd ?? cue.frameEnd
    const rangeChanged = frameStart !== cue.frameStart || frameEnd !== cue.frameEnd
    const camera = updates.camera ?? (rangeChanged && cue.camera
      ? transformCameraInstructionRange(cue.camera, cue.frameStart, cue.frameEnd, frameStart, frameEnd)
      : cue.camera)
    const next = updateTimedRangeCue(sourceProject, cueId, { ...updates, camera })
    if (next !== sourceProject) options.commitProject(next)
    options.setSheetSelection({ kind: 'cue', cueId })
  }

  function copySelection(mode: CameraCueClipboard['mode']) {
    const laneId = selectedCue?.laneId ?? cameraLaneIdForRange(options.template, options.rangeSelection)
    const frameStart = selectedCue?.frameStart ?? options.rangeSelection?.frameStart
    const frameEnd = selectedCue?.frameEnd ?? options.rangeSelection?.frameEnd
    if (!laneId || frameStart === undefined || frameEnd === undefined) return
    const clipboard = buildCameraCueClipboard(options.project, { laneId, frameStart, frameEnd, mode, cueId: selectedCue?.cueId })
    if (!clipboard) return
    options.setClipboard(clipboard)
    if (mode !== 'cut') return
    const next = cutCameraCuesToClipboard(options.project, clipboard)
    if (next !== options.project) options.commitProject(next)
    if (selectedCue) options.clearSelection()
    else if (options.rangeSelection) options.selectRange(options.rangeSelection, next)
  }

  function pasteSelection(mode: 'overwrite' | 'insert') {
    if (!options.clipboard) return
    const laneId = selectedCue?.laneId ?? cameraLaneIdForRange(options.template, options.rangeSelection)
    const frameStart = selectedCue?.frameStart ?? options.rangeSelection?.frameStart
    if (!laneId || frameStart === undefined) return
    const result = pasteCameraCueClipboard(options.project, options.clipboard, { laneId, frameStart }, mode)
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
    const laneId = cameraLaneIdForRange(options.template, options.rangeSelection)
    if (options.rangeSelection?.role !== 'camera' || !laneId) return false
    const next = deleteCameraCuesInRange(options.project, laneId, options.rangeSelection.frameStart, options.rangeSelection.frameEnd)
    if (next !== options.project) options.commitProject(next)
    options.selectRange(options.rangeSelection, next)
    return true
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    const modifier = event.ctrlKey || event.metaKey
    const cameraRangeSelected = options.rangeSelection?.role === 'camera'
    if (modifier && event.key.toLowerCase() === 'c' && (selectedCue || cameraRangeSelected)) {
      event.preventDefault(); copySelection('copy'); return true
    }
    if (modifier && event.key.toLowerCase() === 'x' && (selectedCue || cameraRangeSelected)) {
      event.preventDefault(); copySelection('cut'); return true
    }
    if (modifier && event.key.toLowerCase() === 'v' && options.clipboard && (selectedCue || cameraRangeSelected)) {
      event.preventDefault(); pasteSelection(event.shiftKey ? 'insert' : 'overwrite'); return true
    }
    if (!modifier && !event.altKey && event.key === 'Enter' && options.selectedCueId) {
      event.preventDefault(); openEditor(options.selectedCueId); return true
    }
    if (!modifier && !event.altKey && event.key === 'Enter' && cameraRangeSelected && options.rangeSelection) {
      event.preventDefault(); openEditorForRange(options.rangeSelection); return true
    }
    if (!modifier && !event.altKey && event.key === 'ArrowUp' && selectedCue) {
      event.preventDefault()
      if (selectedCue.frameStart > options.frameMin) transform(selectedCue.cueId, { frameStart: selectedCue.frameStart - 1, frameEnd: selectedCue.frameEnd - 1 })
      return true
    }
    if (!modifier && !event.altKey && event.key === 'ArrowDown' && selectedCue) {
      event.preventDefault()
      if (selectedCue.frameEnd < options.frameMax) transform(selectedCue.cueId, { frameStart: selectedCue.frameStart + 1, frameEnd: selectedCue.frameEnd + 1 })
      return true
    }
    if (!modifier && !event.altKey && event.key.startsWith('Arrow') && (selectedCue || cameraRangeSelected)) {
      event.preventDefault(); return true
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selectedCue && !cameraRangeSelected) return false
      event.preventDefault(); deleteSelection(); return true
    }
    return false
  }

  return { selectedCue, selectCue, openEditor, openEditorForRange, submitDialog, transform, copySelection, pasteSelection, deleteSelection, handleKeyDown }
}
