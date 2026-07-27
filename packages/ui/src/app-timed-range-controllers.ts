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
import type { SoundCueAudioAlignment } from './SoundCueDialog'
import type { DialogueSoundCueChangeIntent } from './dialogueAudioBinding'

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
  cancelTimingDraft: () => void
  clearSelection: () => void
  selectRange: (range: SheetRangeSelection, project?: CutProject) => void
  setSelectedTextAnnotationId: (annotationId: string | null) => void
  setSelectedKeyId: (keyId: string | null) => void
  setSheetSelection: Dispatch<SetStateAction<SheetSelection>>
  setSoundClipboard: Dispatch<SetStateAction<SoundCueClipboard | null>>
  setSoundDialog: Dispatch<SetStateAction<SoundCueDialogState | null>>
  setSoundLabelHistory: Dispatch<SetStateAction<string[]>>
  soundDialog: SoundCueDialogState | null
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
  onSoundCuePlacementConflict?: (message: string) => void
  setCameraClipboard: Dispatch<SetStateAction<CameraCueClipboard | null>>
  setCameraDialog: Dispatch<SetStateAction<CameraCueDialogState | null>>
  setCameraInstructionHistory: Dispatch<SetStateAction<string[]>>
  setCameraPointLabelHistory: Dispatch<SetStateAction<string[]>>
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
    cancelTimingDraft: options.cancelTimingDraft,
    clearSelection: options.clearSelection,
    selectRange: options.selectRange,
    setSelectedTextAnnotationId: options.setSelectedTextAnnotationId,
    setSelectedKeyId: options.setSelectedKeyId,
    setSheetSelection: options.setSheetSelection,
  }
  const soundCueController = createSoundCueController({
      ...shared,
      selectedCueId: selectedSoundCueId,
      clipboard: options.soundClipboard,
      setClipboard: options.setSoundClipboard,
      setDialog: options.setSoundDialog,
      setLabelHistory: options.setSoundLabelHistory,
      dialog: options.soundDialog,
      applyAudioCandidateLink: options.applyAudioCandidateLink,
      applySoundCueProjectChange: options.applySoundCueProjectChange,
      onPlacementConflict: options.onSoundCuePlacementConflict,
    })
  const cameraCueController = createCameraCueController({
      ...shared,
      selectedCueId: selectedCameraCueId,
      clipboard: options.cameraClipboard,
      setClipboard: options.setCameraClipboard,
      setDialog: options.setCameraDialog,
      setInstructionHistory: options.setCameraInstructionHistory,
      setPointLabelHistory: options.setCameraPointLabelHistory,
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
