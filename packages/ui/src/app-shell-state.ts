import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  commitHistory, createProjectDocumentFromCutProject, createProjectHistory, defaultCorrectionLayerId,
  type AnnotationText, type CutGroupProjectDocument, type CutProject, type ProjectHistory, type RecognitionCandidate, type SheetTemplate, type SheetTimingRole,
} from '@xsheet-remap/core'
import type { NativeDragDropPayload } from '@xsheet-remap/adapters'
import type { CameraCueClipboard, CameraCueDialogState, EditMode, ExportOperationNotice, Panel, SheetSelection, SoundCueClipboard, SoundCueDialogState, TimingClipboard, TimingEditSession, TimingExportDialogState, XdtsImportDialogState } from './appTypes'
import type { SheetImageExportOptions } from './cleanSheetExport'
import { DEFAULT_TEXT_FONT_SIZE_PX } from './sheetTextLayout'
import type { AssetDropMenuState, AutoCalibrationOverlayState, FrameOperationDialogState, SheetScrollRequest, StatusHints } from './app-foundation'
import type { MainAppKind } from './app-foundation'
import { loadSoundLabelHistory, saveSoundLabelHistory } from './soundCueEditing'
import {
  loadCameraInstructionHistory,
  loadCameraPointLabelHistory,
  saveCameraInstructionHistory,
  saveCameraPointLabelHistory,
} from './cameraCueEditing'
import { createPreferredProject } from './mainAppPreferences'
import type { SoundCueNavigationRequest } from './workspaceInteractionPolicy'

export const DEFAULT_PEN_COLOR = '#000000'
export const DEFAULT_PEN_WIDTH = 0.002

interface WorkspaceHistorySnapshot {
  project: CutProject
  template: SheetTemplate
}

interface WorkspaceHistory {
  past: WorkspaceHistorySnapshot[]
  present: WorkspaceHistorySnapshot
  future: WorkspaceHistorySnapshot[]
}

export function useAppShellState(appKind: MainAppKind) {
  const [initialWorkspace] = useState(() => createInitialWorkspace(appKind))
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceHistory>(() => {
    const projectHistory = createProjectHistory(initialWorkspace.project)
    return {
      past: [],
      present: { project: projectHistory.present, template: initialWorkspace.template },
      future: [],
    }
  })
  const history = useMemo<ProjectHistory>(() => projectHistoryFromWorkspaceHistory(workspaceHistory), [workspaceHistory])
  const setHistory = useCallback<Dispatch<SetStateAction<ProjectHistory>>>(update => {
    setWorkspaceHistory(current => {
      const currentProjectHistory = projectHistoryFromWorkspaceHistory(current)
      const nextProjectHistory = typeof update === 'function' ? update(currentProjectHistory) : update
      if (nextProjectHistory === currentProjectHistory) return current
      return workspaceHistoryFromProjectHistory(nextProjectHistory, current)
    })
  }, [])
  const setTemplate = useCallback<Dispatch<SetStateAction<SheetTemplate>>>(update => {
    setWorkspaceHistory(current => {
      const nextTemplate = typeof update === 'function' ? update(current.present.template) : update
      if (nextTemplate === current.present.template) return current
      return {
        ...current,
        present: { ...current.present, template: nextTemplate },
      }
    })
  }, [])
  const commitWorkspace = useCallback((nextProject: CutProject, nextTemplate: SheetTemplate) => {
    setWorkspaceHistory(current => {
      const nextProjectHistory = commitHistory(projectHistoryFromWorkspaceHistory(current), nextProject)
      return {
        past: [...current.past, current.present],
        present: { project: nextProjectHistory.present, template: nextTemplate },
        future: [],
      }
    })
  }, [])
  const [projectDocument, setProjectDocument] = useState(() => initialWorkspace.document)
  const [savedProjectDocumentSignature, setSavedProjectDocumentSignature] = useState(() => JSON.stringify(initialWorkspace.document))
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)
  const paperSheetInputRef = useRef<HTMLInputElement | null>(null)
  const project = workspaceHistory.present.project
  const projectRef = useRef(project)
  const template = workspaceHistory.present.template
  const [runtimeSourceImageUrls, setRuntimeSourceImageUrls] = useState<Record<string, string>>({})
  const [recognitionCandidates, setRecognitionCandidates] = useState<RecognitionCandidate[]>([])
  const [recognitionRole, setRecognitionRole] = useState<SheetTimingRole>('action')
  const [recognitionRunning, setRecognitionRunning] = useState(false)
  const [recognitionProgress, setRecognitionProgress] = useState<{ completed: number; total: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState<string | null>(null)
  const [autoCalibrationRunning, setAutoCalibrationRunning] = useState(false)
  const [autoCalibrationMessage, setAutoCalibrationMessage] = useState<string | null>(null)
  const [autoCalibrationOverlay, setAutoCalibrationOverlay] = useState<AutoCalibrationOverlayState | null>(null)
  const [calibrationLoupeOpen, setCalibrationLoupeOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('sheet')
  const [editMode, setEditMode] = useState<EditMode>('new')
  const [zoom, setZoom] = useState(1)
  const [zoomMode, setZoomMode] = useState(false)
  const [showTemplate, setShowTemplate] = useState(true)
  const [showTemplateGuides, setShowTemplateGuides] = useState(true)
  const [showTemplateLabels, setShowTemplateLabels] = useState(true)
  const [showInputContent, setShowInputContent] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [penColor, setPenColor] = useState(DEFAULT_PEN_COLOR)
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH)
  const [eraserWidth, setEraserWidth] = useState(0.018)
  const [textFontSizePx, setTextFontSizePx] = useState(DEFAULT_TEXT_FONT_SIZE_PX)
  const [memoTextFontSizePx, setMemoTextFontSizePx] = useState(DEFAULT_TEXT_FONT_SIZE_PX)
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null)
  const [editingTextAnnotationId, setEditingTextAnnotationId] = useState<string | null>(null)
  const [textAnnotationClipboard, setTextAnnotationClipboard] = useState<AnnotationText | null>(null)
  const [sheetSelection, setSheetSelection] = useState<SheetSelection>({ kind: 'none' })
  const [audioPlayhead, setAudioPlayhead] = useState({
    cutId: initialWorkspace.document.activeCutId,
    frame: initialWorkspace.project.logicalSheet.frameOrigin,
  })
  const [soundCueNavigationRequest, setSoundCueNavigationRequest] = useState<SoundCueNavigationRequest | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [sheetScrollRequest, setSheetScrollRequest] = useState<SheetScrollRequest | null>(null)
  const [timingClipboard, setTimingClipboard] = useState<TimingClipboard | null>(null)
  const [soundCueClipboard, setSoundCueClipboard] = useState<SoundCueClipboard | null>(null)
  const [soundCueDialog, setSoundCueDialog] = useState<SoundCueDialogState | null>(null)
  const [cameraCueClipboard, setCameraCueClipboard] = useState<CameraCueClipboard | null>(null)
  const [cameraCueDialog, setCameraCueDialog] = useState<CameraCueDialogState | null>(null)
  const [soundLabelHistory, setSoundLabelHistory] = useState<string[]>(loadSoundLabelHistory)
  const [cameraInstructionHistory, setCameraInstructionHistory] = useState<string[]>(loadCameraInstructionHistory)
  const [cameraPointLabelHistory, setCameraPointLabelHistory] = useState<string[]>(loadCameraPointLabelHistory)
  const [statusHints, setStatusHints] = useState<StatusHints>({})
  const [timingEditSession, setTimingEditSessionState] = useState<TimingEditSession | null>(null)
  const timingEditSessionRef = useRef<TimingEditSession | null>(null)
  const setTimingEditSession = useCallback<Dispatch<SetStateAction<TimingEditSession | null>>>(nextState => {
    const next = typeof nextState === 'function'
      ? nextState(timingEditSessionRef.current)
      : nextState
    timingEditSessionRef.current = next
    setTimingEditSessionState(next)
  }, [])
  const [sheetImageExportDraft, setSheetImageExportDraft] = useState<SheetImageExportOptions | null>(null)
  const [sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen] = useState(false)
  const [appHelpDialogOpen, setAppHelpDialogOpen] = useState(false)
  const [timingExportDialog, setTimingExportDialog] = useState<TimingExportDialogState | null>(null)
  const [exportOperationNotice, setExportOperationNotice] = useState<ExportOperationNotice | null>(null)
  const [xdtsImportDialog, setXdtsImportDialog] = useState<XdtsImportDialogState | null>(null)
  const [frameOperationDialog, setFrameOperationDialog] = useState<FrameOperationDialogState | null>(null)
  const [assetDropMenu, setAssetDropMenu] = useState<AssetDropMenuState | null>(null)
  const [activeCorrectionLayerIdState, setActiveCorrectionLayerIdState] = useState(() => defaultCorrectionLayerId(initialWorkspace.project) ?? '')
  const nativeFileDropHandlerRef = useRef<(paths: string[], position: { x: number; y: number }) => void>(() => undefined)
  const nativeDragDropPayloadHandlerRef = useRef<(payload: NativeDragDropPayload, source: string) => void>(() => undefined)
  const nativeFileDropDedupeRef = useRef<{ signature: string; timestamp: number } | null>(null)

  useEffect(() => saveSoundLabelHistory(soundLabelHistory), [soundLabelHistory])
  useEffect(() => saveCameraInstructionHistory(cameraInstructionHistory), [cameraInstructionHistory])
  useEffect(() => saveCameraPointLabelHistory(cameraPointLabelHistory), [cameraPointLabelHistory])

  return {
    history, setHistory, commitWorkspace, projectDocument, setProjectDocument, savedProjectDocumentSignature, setSavedProjectDocumentSignature, projectFilePath, setProjectFilePath, paperSheetInputRef, project, projectRef, template, setTemplate,
    runtimeSourceImageUrls, setRuntimeSourceImageUrls, recognitionCandidates, setRecognitionCandidates, recognitionRole, setRecognitionRole,
    recognitionRunning, setRecognitionRunning, recognitionProgress, setRecognitionProgress, recognitionMessage, setRecognitionMessage,
    autoCalibrationRunning, setAutoCalibrationRunning, autoCalibrationMessage, setAutoCalibrationMessage, autoCalibrationOverlay, setAutoCalibrationOverlay,
    calibrationLoupeOpen, setCalibrationLoupeOpen, panel, setPanel, editMode, setEditMode, zoom, setZoom, zoomMode, setZoomMode,
    showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides, showTemplateLabels, setShowTemplateLabels,
    showInputContent, setShowInputContent, showAnnotations, setShowAnnotations, penColor, setPenColor,
    penWidth, setPenWidth, eraserWidth, setEraserWidth, textFontSizePx, setTextFontSizePx, memoTextFontSizePx, setMemoTextFontSizePx, selectedTextAnnotationId, setSelectedTextAnnotationId,
    editingTextAnnotationId, setEditingTextAnnotationId, textAnnotationClipboard, setTextAnnotationClipboard, sheetSelection, setSheetSelection,
    audioPlayhead, setAudioPlayhead, soundCueNavigationRequest, setSoundCueNavigationRequest,
    selectedKeyId, setSelectedKeyId, sheetScrollRequest, setSheetScrollRequest, timingClipboard, setTimingClipboard,
    soundCueClipboard, setSoundCueClipboard, soundCueDialog, setSoundCueDialog, soundLabelHistory, setSoundLabelHistory,
    cameraCueClipboard, setCameraCueClipboard, cameraCueDialog, setCameraCueDialog,
    cameraInstructionHistory, setCameraInstructionHistory, cameraPointLabelHistory, setCameraPointLabelHistory,
    statusHints, setStatusHints,
    timingEditSession, timingEditSessionRef, setTimingEditSession, sheetImageExportDraft, setSheetImageExportDraft,
    sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen,
    timingExportDialog, setTimingExportDialog, exportOperationNotice, setExportOperationNotice, xdtsImportDialog, setXdtsImportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    activeCorrectionLayerIdState, setActiveCorrectionLayerIdState, nativeFileDropHandlerRef, nativeDragDropPayloadHandlerRef, nativeFileDropDedupeRef,
  }
}

function createInitialWorkspace(appKind: MainAppKind): {
  project: CutProject
  template: SheetTemplate
  document: CutGroupProjectDocument
} {
  const { project, preset } = createPreferredProject(appKind)
  return {
    project,
    template: preset.sheetTemplate,
    document: createProjectDocumentFromCutProject(project, { sheetTemplate: preset.sheetTemplate }),
  }
}

function projectHistoryFromWorkspaceHistory(history: WorkspaceHistory): ProjectHistory {
  return {
    past: history.past.map(snapshot => snapshot.project),
    present: history.present.project,
    future: history.future.map(snapshot => snapshot.project),
  }
}

function workspaceHistoryFromProjectHistory(projectHistory: ProjectHistory, current: WorkspaceHistory): WorkspaceHistory {
  const templateByProject = new Map<CutProject, SheetTemplate>([
    ...current.past.map(snapshot => [snapshot.project, snapshot.template] as const),
    [current.present.project, current.present.template] as const,
    ...current.future.map(snapshot => [snapshot.project, snapshot.template] as const),
  ])
  const snapshot = (project: CutProject): WorkspaceHistorySnapshot => ({
    project,
    template: templateByProject.get(project) ?? current.present.template,
  })
  return {
    past: projectHistory.past.map(snapshot),
    present: snapshot(projectHistory.present),
    future: projectHistory.future.map(snapshot),
  }
}
