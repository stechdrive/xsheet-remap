import type { Dispatch, SetStateAction } from 'react'
import type { CutProject, SheetTemplate } from '@xsheet-remap/core'
import type {
  CameraCueClipboard,
  CameraCueDialogState,
  SheetRangeSelection,
  SheetSelection,
  SoundCueClipboard,
  SoundCueDialogState,
} from './appTypes'
import { createCameraCueController } from './app-camera-cue-controller'
import { createSoundCueController } from './app-sound-cue-controller'

interface AppTimedRangeControllersOptions {
  project: CutProject
  getProject: () => CutProject
  template: SheetTemplate
  rangeSelection: SheetRangeSelection | null
  selectedCueId: string | null
  soundClipboard: SoundCueClipboard | null
  cameraClipboard: CameraCueClipboard | null
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
  setSoundClipboard: Dispatch<SetStateAction<SoundCueClipboard | null>>
  setSoundDialog: Dispatch<SetStateAction<SoundCueDialogState | null>>
  setSoundLabelHistory: Dispatch<SetStateAction<string[]>>
  setCameraClipboard: Dispatch<SetStateAction<CameraCueClipboard | null>>
  setCameraDialog: Dispatch<SetStateAction<CameraCueDialogState | null>>
}

export function createAppTimedRangeControllers(options: AppTimedRangeControllersOptions) {
  const selectedTimedRangeCue = options.selectedCueId
    ? options.project.timedRangeCues.find(cue => cue.cueId === options.selectedCueId) ?? null
    : null
  const selectedSoundCueId = selectedTimedRangeCue?.role === 'sound' ? selectedTimedRangeCue.cueId : null
  const selectedCameraCueId = selectedTimedRangeCue?.role === 'camera' ? selectedTimedRangeCue.cueId : null
  const shared = {
    project: options.project,
    getProject: options.getProject,
    template: options.template,
    rangeSelection: options.rangeSelection,
    frameMin: options.frameMin,
    frameMax: options.frameMax,
    commitProject: options.commitProject,
    commitTimingDraft: options.commitTimingDraft,
    clearSelection: options.clearSelection,
    selectRange: options.selectRange,
    setSelectedTextAnnotationId: options.setSelectedTextAnnotationId,
    setSelectedKeyId: options.setSelectedKeyId,
    setSheetSelection: options.setSheetSelection,
    setValueDraft: options.setValueDraft,
    setValueDraftActive: options.setValueDraftActive,
  }
  const soundCueController = createSoundCueController({
      ...shared,
      selectedCueId: selectedSoundCueId,
      clipboard: options.soundClipboard,
      setClipboard: options.setSoundClipboard,
      setDialog: options.setSoundDialog,
      setLabelHistory: options.setSoundLabelHistory,
    })
  const cameraCueController = createCameraCueController({
      ...shared,
      selectedCueId: selectedCameraCueId,
      clipboard: options.cameraClipboard,
      setClipboard: options.setCameraClipboard,
      setDialog: options.setCameraDialog,
    })
  function handleTimedRangeKeyDown(event: KeyboardEvent): boolean {
    if (selectedCameraCueId || options.rangeSelection?.role === 'camera') {
      return cameraCueController.handleKeyDown(event)
    }
    if (selectedSoundCueId || options.rangeSelection?.role === 'sound') {
      return soundCueController.handleKeyDown(event)
    }
    return false
  }
  return {
    selectedTimedRangeCue,
    selectedSoundCueId,
    selectedSoundCue: soundCueController.selectedCue,
    selectedCameraCueId,
    selectedCameraCue: cameraCueController.selectedCue,
    soundCueController,
    cameraCueController,
    handleSoundCueSelect: soundCueController.selectCue,
    openSoundCueEditor: soundCueController.openEditor,
    openSoundCueEditorForRange: soundCueController.openEditorForRange,
    submitSoundCueDialog: soundCueController.submitDialog,
    handleTransformSoundCue: soundCueController.transform,
    copySelectedSoundCueRange: soundCueController.copySelection,
    pasteSelectedSoundCueRange: soundCueController.pasteSelection,
    handleCameraCueSelect: cameraCueController.selectCue,
    openCameraCueEditor: cameraCueController.openEditor,
    openCameraCueEditorForRange: cameraCueController.openEditorForRange,
    submitCameraCueDialog: cameraCueController.submitDialog,
    handleTransformCameraCue: cameraCueController.transform,
    copySelectedCameraCueRange: cameraCueController.copySelection,
    pasteSelectedCameraCueRange: cameraCueController.pasteSelection,
    handleTimedRangeKeyDown,
  }
}
