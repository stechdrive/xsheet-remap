import {
  createDefaultProject,
  standardA3SheetTemplate,
  updateCorrectionLayers,
  type CorrectionLayer,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { saveJsonFile, type SaveFileResult } from '@xsheet-remap/adapters'
import { useCallback, useEffect, useState } from 'react'
import { IconButton } from './AppControls'
import { APP_VERSION } from './appVersion'
import { loadSheetTemplate } from './app-template-import'
import { HelpIcon } from './app-navigation'
import { uiText } from './i18n'
import { TemplateStartScreen } from './TemplateStartScreen'
import { TemplateWorkspace, type TemplateWorkspaceDraftState } from './template-workspace-workspace'
import { TemplateEditorHelpDialog } from './TemplateEditorHelp'
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
  const [draftState, setDraftState] = useState<TemplateWorkspaceDraftState>(() => ({ template: structuredClone(standardA3SheetTemplate), dirty: false }))
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

  useEffect(() => {
    if (view !== 'workspace') return
    if (!draftState.dirty) {
      void clearTemplateDraftRecovery()
      return
    }
    const timer = window.setTimeout(() => {
      void saveTemplateDraftRecovery(draftState.template)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draftState, view])

  const handleDraftStateChange = useCallback((state: TemplateWorkspaceDraftState) => {
    setDraftState(state)
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
    return createTemplateDraft(kind, draftState.template)
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
    const cloned = structuredClone(nextTemplate)
    setTemplate(cloned)
    setInitialDraftTemplate(cloned)
    setInitialDraftDirty(dirty)
    setDraftState({ template: cloned, dirty })
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
    setView('start')
    setRecovery(null)
    void clearTemplateDraftRecovery()
  }

  async function discardRecovery() {
    await clearTemplateDraftRecovery()
    setRecovery(null)
  }

  return (
    <div className="templateEditorAppShell">
      <header className="templateEditorAppHeader">
        <span className="topBrand">
          <strong>xsheet-template</strong>
          <span className="appVersion">v{APP_VERSION}</span>
        </span>
        <div className="templateEditorAppActions">
          <IconButton onClick={() => setHelpDialogOpen(true)} aria-label="ヘルプ"><HelpIcon /></IconButton>
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
        <span>{view === 'start' ? 'テンプレートの作り方を選択' : draftState.template.name}</span>
        {view === 'workspace' && <span className="statusIssueSummary">{draftState.template.page.widthPx} x {draftState.template.page.heightPx}px</span>}
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
