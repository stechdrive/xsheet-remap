import {
  createDefaultProject,
  standardA3SheetTemplate,
  updateCorrectionLayers,
  type CorrectionLayer,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { saveJsonFile, type SaveFileResult } from '@xsheet-remap/adapters'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton } from './AppControls'
import { APP_VERSION } from './appVersion'
import { loadSheetTemplate } from './app-template-import'
import { HelpIcon } from './app-navigation'
import { uiText } from './i18n'
import { TemplateStartScreen } from './TemplateStartScreen'
import { TemplateWorkspace, type TemplateWorkspaceDraftState } from './template-workspace-workspace'
import { TemplateEditorHelpDialog } from './TemplateEditorHelp'
import { Tooltip } from './Tooltip'
import {
  createPaperTemplateDraftFromImage,
  createTemplateDraft,
  readFileAsDataUrl,
  templateJsonFileName,
  type TemplateDraftKind,
} from './templateDrafts'
import { clearTemplateDraftRecovery, loadTemplateDraftRecovery, saveTemplateDraftRecovery, type TemplateDraftRecovery } from './templateDraftRecovery'
import { readTemplateImageMetadata } from './templateImageMetadata'

export function TemplateEditorApp() {
  const [template, setTemplate] = useState<SheetTemplate>(() => structuredClone(standardA3SheetTemplate))
  const [project, setProject] = useState<CutProject>(() => createDefaultProject())
  const [view, setView] = useState<'start' | 'workspace'>('start')
  const [initialDraftTemplate, setInitialDraftTemplate] = useState<SheetTemplate>(() => structuredClone(standardA3SheetTemplate))
  const [initialDraftDirty, setInitialDraftDirty] = useState(false)
  const draftStateRef = useRef<TemplateWorkspaceDraftState>({ template: structuredClone(standardA3SheetTemplate), dirty: false })
  const recoverySaveTimerRef = useRef<number | null>(null)
  const [draftSummary, setDraftSummary] = useState(() => ({
    dirty: false,
    name: standardA3SheetTemplate.name,
    widthPx: standardA3SheetTemplate.page.widthPx,
    heightPx: standardA3SheetTemplate.page.heightPx,
  }))
  const [recovery, setRecovery] = useState<TemplateDraftRecovery | null>(null)
  const [workspaceKey, setWorkspaceKey] = useState(0)
  const [helpDialogOpen, setHelpDialogOpen] = useState(false)

  useEffect(() => {
    let active = true
    void loadTemplateDraftRecovery().then(record => {
      if (active) setRecovery(record)
    })
    return () => { active = false }
  }, [])

  const handleDraftStateChange = useCallback((state: TemplateWorkspaceDraftState) => {
    draftStateRef.current = state
    setDraftSummary(current => {
      const next = {
        dirty: state.dirty,
        name: state.template.name,
        widthPx: state.template.page.widthPx,
        heightPx: state.template.page.heightPx,
      }
      return current.dirty === next.dirty
        && current.name === next.name
        && current.widthPx === next.widthPx
        && current.heightPx === next.heightPx
        ? current
        : next
    })
    if (recoverySaveTimerRef.current !== null) window.clearTimeout(recoverySaveTimerRef.current)
    if (!state.dirty) {
      recoverySaveTimerRef.current = null
      void clearTemplateDraftRecovery()
      return
    }
    recoverySaveTimerRef.current = window.setTimeout(() => {
      recoverySaveTimerRef.current = null
      void saveTemplateDraftRecovery(state.template)
    }, 500)
  }, [])

  useEffect(() => () => {
    if (recoverySaveTimerRef.current !== null) window.clearTimeout(recoverySaveTimerRef.current)
  }, [])

  async function loadTemplate(files: FileList | null): Promise<SheetTemplate | null> {
    try {
      return await loadSheetTemplate(files)
    } catch (error) {
      window.alert(uiText.template.loadFailed(errorMessage(error)))
      return null
    }
  }

  function applyTemplate(nextTemplate: SheetTemplate) {
    setTemplate(nextTemplate)
  }

  function newTemplateDraft(kind: TemplateDraftKind): SheetTemplate {
    return createTemplateDraft(kind, draftStateRef.current.template)
  }

  async function createPaperTemplate(file: File): Promise<SheetTemplate | null> {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const imageSize = await readTemplateImageMetadata(file, dataUrl)
      return createPaperTemplateDraftFromImage(file, dataUrl, imageSize)
    } catch (error) {
      window.alert(uiText.template.referenceImageLoadFailed(errorMessage(error)))
      return null
    }
  }

  async function saveTemplate(nextTemplate: SheetTemplate): Promise<SaveFileResult> {
    try {
      return await saveJsonFile(nextTemplate, templateJsonFileName(nextTemplate))
    } catch (error) {
      window.alert(uiText.template.saveFailed(errorMessage(error)))
      return { saved: false }
    }
  }

  function applyCorrectionLayers(layers: CorrectionLayer[]): boolean {
    try {
      setProject(current => updateCorrectionLayers(current, layers))
      return true
    } catch (error) {
      window.alert(errorMessage(error))
      return false
    }
  }

  function beginWorkspace(nextTemplate: SheetTemplate, dirty: boolean) {
    cancelPendingRecoverySave()
    const cloned = structuredClone(nextTemplate)
    setTemplate(cloned)
    setInitialDraftTemplate(cloned)
    setInitialDraftDirty(dirty)
    draftStateRef.current = { template: cloned, dirty }
    setDraftSummary({ dirty, name: cloned.name, widthPx: cloned.page.widthPx, heightPx: cloned.page.heightPx })
    setProject(createDefaultProject())
    setWorkspaceKey(current => current + 1)
    setView('workspace')
  }

  async function beginPaperTemplateFromImage(file: File) {
    const created = await createPaperTemplate(file)
    if (created) beginWorkspace(created, true)
  }

  async function beginExistingTemplate(file: File) {
    const loaded = await loadTemplate(asFileList(file))
    if (loaded) beginWorkspace(loaded, false)
  }

  function returnToStart() {
    cancelPendingRecoverySave()
    setView('start')
    setRecovery(null)
    void clearTemplateDraftRecovery()
  }

  async function discardRecovery() {
    cancelPendingRecoverySave()
    await clearTemplateDraftRecovery()
    setRecovery(null)
  }

  function cancelPendingRecoverySave() {
    if (recoverySaveTimerRef.current === null) return
    window.clearTimeout(recoverySaveTimerRef.current)
    recoverySaveTimerRef.current = null
  }

  return (
    <div className="templateEditorAppShell">
      <header className="templateEditorAppHeader">
        <span className="topBrand">
          <strong>xsheet-template</strong>
          <span className="appVersion">v{APP_VERSION}</span>
        </span>
        <div className="templateEditorAppActions">
          <Tooltip label="xsheet-templateの使い方を開く">
            <IconButton onClick={() => setHelpDialogOpen(true)} aria-label="ヘルプ"><HelpIcon /></IconButton>
          </Tooltip>
        </div>
      </header>
      <main className="templateEditorAppMain">
        {view === 'start' ? (
          <TemplateStartScreen
            onCreateA3Standard={() => beginWorkspace(createTemplateDraft('paper-standard', template), true)}
            onCreatePaperFromImage={beginPaperTemplateFromImage}
            onCreateDigital={() => beginWorkspace(createTemplateDraft('digital-standard', template), true)}
            onOpenTemplateJson={beginExistingTemplate}
            recovery={recovery ? {
              templateName: recovery.template.name || recovery.template.templateId || '名称未設定',
              savedAtLabel: new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(recovery.savedAt)),
              onRestore: () => { beginWorkspace(recovery.template, true); setRecovery(null) },
              onDiscard: discardRecovery,
            } : null}
          />
        ) : (
          <TemplateWorkspace
            key={workspaceKey}
            mode="standalone"
            project={project}
            template={template}
            initialDraftTemplate={initialDraftTemplate}
            initialDraftDirty={initialDraftDirty}
            onLoadTemplate={loadTemplate}
            onSaveTemplate={saveTemplate}
            onApplyTemplate={applyTemplate}
            onCreateTemplateDraft={newTemplateDraft}
            onUpdateCorrectionLayers={applyCorrectionLayers}
            onDraftStateChange={handleDraftStateChange}
            onReturnToStart={returnToStart}
          />
        )}
      </main>
      <footer className="statusBar">
        <span>{view === 'start' ? 'テンプレートの作り方を選択' : draftSummary.name}</span>
        {view === 'workspace' && <span className="statusIssueSummary">{draftSummary.widthPx} x {draftSummary.heightPx}px</span>}
      </footer>
      {helpDialogOpen && <TemplateEditorHelpDialog onClose={() => setHelpDialogOpen(false)} />}
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asFileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
  } as unknown as FileList
}
