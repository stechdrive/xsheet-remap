import {
  createDefaultProject,
  standardA3SheetTemplate,
  updateCorrectionLayers,
  type CorrectionLayer,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { readJsonFile, saveJsonFile } from '@xsheet-remap/adapters'
import { useState } from 'react'
import { APP_VERSION } from './appVersion'
import { uiText } from './i18n'
import { TemplateWorkspace } from './TemplateWorkspace'
import {
  createPaperTemplateDraftFromImage,
  createTemplateDraft,
  readFileAsDataUrl,
  templateJsonFileName,
  type TemplateDraftKind,
} from './templateDrafts'
import { readTemplateImageMetadata } from './templateImageMetadata'

export function TemplateEditorApp() {
  const [template, setTemplate] = useState<SheetTemplate>(() => structuredClone(standardA3SheetTemplate))
  const [project, setProject] = useState<CutProject>(() => createDefaultProject())
  const [workspaceKey, setWorkspaceKey] = useState(0)

  async function loadTemplate(files: FileList | null): Promise<SheetTemplate | null> {
    const file = files?.[0]
    if (!file) return null
    try {
      return await readJsonFile<SheetTemplate>(file)
    } catch (error) {
      window.alert(uiText.template.loadFailed(errorMessage(error)))
      return null
    }
  }

  function applyTemplate(nextTemplate: SheetTemplate) {
    setTemplate(nextTemplate)
  }

  function newTemplateDraft(kind: TemplateDraftKind): SheetTemplate {
    return createTemplateDraft(kind, template)
  }

  async function createPaperTemplate(files: FileList | null): Promise<SheetTemplate | null> {
    const file = files?.[0]
    if (!file) return null
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const imageSize = await readTemplateImageMetadata(file, dataUrl)
      return createPaperTemplateDraftFromImage(file, dataUrl, imageSize)
    } catch (error) {
      window.alert(uiText.template.referenceImageLoadFailed(errorMessage(error)))
      return null
    }
  }

  async function saveTemplate(nextTemplate: SheetTemplate) {
    try {
      await saveJsonFile(nextTemplate, templateJsonFileName(nextTemplate))
    } catch (error) {
      window.alert(uiText.template.saveFailed(errorMessage(error)))
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

  function resetWorkspace() {
    setTemplate(structuredClone(standardA3SheetTemplate))
    setProject(createDefaultProject())
    setWorkspaceKey(current => current + 1)
  }

  return (
    <div className="templateEditorAppShell">
      <header className="templateEditorAppHeader">
        <span className="topBrand">
          <strong>xsheet-template</strong>
          <span className="appVersion">v{APP_VERSION}</span>
        </span>
        <button type="button" onClick={resetWorkspace}>リセット</button>
      </header>
      <main className="templateEditorAppMain">
        <TemplateWorkspace
          key={workspaceKey}
          project={project}
          template={template}
          onLoadTemplate={loadTemplate}
          onSaveTemplate={nextTemplate => void saveTemplate(nextTemplate)}
          onApplyTemplate={applyTemplate}
          onCreateTemplateDraft={newTemplateDraft}
          onCreatePaperTemplateFromImage={createPaperTemplate}
          onUpdateCorrectionLayers={applyCorrectionLayers}
        />
      </main>
      <footer className="statusBar">
        <span>{template.name}</span>
        <span className="statusIssueSummary">{template.page.widthPx} x {template.page.heightPx}px</span>
      </footer>
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
