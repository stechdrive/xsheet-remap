import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  commitHistory, createDefaultProject, createProjectDocumentFromCutProject, createProjectHistory, defaultCorrectionLayerId,
  standardA3SheetTemplate, type AnnotationText, type CutProject, type ProjectHistory, type RecognitionCandidate, type SheetTemplate, type SheetTimingRole,
} from '@xsheet-remap/core'
import type { NativeDragDropPayload } from '@xsheet-remap/adapters'
import type { EditMode, Panel, Selection, SheetRangeSelection, TimingClipboard, TimingExportDialogState } from './appTypes'
import type { SheetImageExportOptions } from './cleanSheetExport'
import { DEFAULT_TEXT_FONT_SIZE_PX } from './sheetTextLayout'
import type { AssetDropMenuState, AutoCalibrationOverlayState, FrameOperationDialogState, SheetScrollRequest, StatusHints } from './app-foundation'

interface WorkspaceHistorySnapshot {
  project: CutProject
  template: SheetTemplate
}

interface WorkspaceHistory {
  past: WorkspaceHistorySnapshot[]
  present: WorkspaceHistorySnapshot
  future: WorkspaceHistorySnapshot[]
}

export function useAppShellState() {
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceHistory>(() => {
    const projectHistory = createProjectHistory(createDefaultProject())
    return {
      past: [],
      present: { project: projectHistory.present, template: standardA3SheetTemplate },
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
  const [projectDocument, setProjectDocument] = useState(() => createProjectDocumentFromCutProject(createDefaultProject()))
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
  const [penColor, setPenColor] = useState('#d52b2b')
  const [penWidth, setPenWidth] = useState(0.004)
  const [eraserWidth, setEraserWidth] = useState(0.018)
  const [textFontSizePx, setTextFontSizePx] = useState(DEFAULT_TEXT_FONT_SIZE_PX)
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null)
  const [editingTextAnnotationId, setEditingTextAnnotationId] = useState<string | null>(null)
  const [textAnnotationClipboard, setTextAnnotationClipboard] = useState<AnnotationText | null>(null)
  const [selection, setSelection] = useState<Selection>({ hit: null, keyId: null })
  const [rangeSelection, setRangeSelection] = useState<SheetRangeSelection | null>(null)
  const [sheetScrollRequest, setSheetScrollRequest] = useState<SheetScrollRequest | null>(null)
  const [timingClipboard, setTimingClipboard] = useState<TimingClipboard | null>(null)
  const [statusHints, setStatusHints] = useState<StatusHints>({})
  const [valueDraft, setValueDraft] = useState('')
  const [valueDraftActive, setValueDraftActive] = useState(false)
  const [sheetImageExportDraft, setSheetImageExportDraft] = useState<SheetImageExportOptions | null>(null)
  const [sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen] = useState(false)
  const [appHelpDialogOpen, setAppHelpDialogOpen] = useState(false)
  const [timingExportDialog, setTimingExportDialog] = useState<TimingExportDialogState | null>(null)
  const [frameOperationDialog, setFrameOperationDialog] = useState<FrameOperationDialogState | null>(null)
  const [assetDropMenu, setAssetDropMenu] = useState<AssetDropMenuState | null>(null)
  const [activeCorrectionLayerIdState, setActiveCorrectionLayerIdState] = useState(() => defaultCorrectionLayerId(createDefaultProject()) ?? '')
  const nativeFileDropHandlerRef = useRef<(paths: string[], position: { x: number; y: number }) => void>(() => undefined)
  const nativeDragDropPayloadHandlerRef = useRef<(payload: NativeDragDropPayload, source: string) => void>(() => undefined)
  const nativeFileDropDedupeRef = useRef<{ signature: string; timestamp: number } | null>(null)

  return {
    history, setHistory, commitWorkspace, projectDocument, setProjectDocument, projectFilePath, setProjectFilePath, paperSheetInputRef, project, projectRef, template, setTemplate,
    runtimeSourceImageUrls, setRuntimeSourceImageUrls, recognitionCandidates, setRecognitionCandidates, recognitionRole, setRecognitionRole,
    recognitionRunning, setRecognitionRunning, recognitionProgress, setRecognitionProgress, recognitionMessage, setRecognitionMessage,
    autoCalibrationRunning, setAutoCalibrationRunning, autoCalibrationMessage, setAutoCalibrationMessage, autoCalibrationOverlay, setAutoCalibrationOverlay,
    calibrationLoupeOpen, setCalibrationLoupeOpen, panel, setPanel, editMode, setEditMode, zoom, setZoom, zoomMode, setZoomMode,
    showTemplate, setShowTemplate, showTemplateGuides, setShowTemplateGuides, showTemplateLabels, setShowTemplateLabels,
    showInputContent, setShowInputContent, showAnnotations, setShowAnnotations, penColor, setPenColor,
    penWidth, setPenWidth, eraserWidth, setEraserWidth, textFontSizePx, setTextFontSizePx, selectedTextAnnotationId, setSelectedTextAnnotationId,
    editingTextAnnotationId, setEditingTextAnnotationId, textAnnotationClipboard, setTextAnnotationClipboard, selection, setSelection,
    rangeSelection, setRangeSelection, sheetScrollRequest, setSheetScrollRequest, timingClipboard, setTimingClipboard, statusHints, setStatusHints,
    valueDraft, setValueDraft, valueDraftActive, setValueDraftActive, sheetImageExportDraft, setSheetImageExportDraft,
    sheetLevelCorrectionDialogOpen, setSheetLevelCorrectionDialogOpen, appHelpDialogOpen, setAppHelpDialogOpen,
    timingExportDialog, setTimingExportDialog, frameOperationDialog, setFrameOperationDialog, assetDropMenu, setAssetDropMenu,
    activeCorrectionLayerIdState, setActiveCorrectionLayerIdState, nativeFileDropHandlerRef, nativeDragDropPayloadHandlerRef, nativeFileDropDedupeRef,
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
