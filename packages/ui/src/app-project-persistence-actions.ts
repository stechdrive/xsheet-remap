import type { Dispatch, SetStateAction } from 'react'
import {
  updateActiveCutProjectInDocument,
  type CutGroupProjectDocument,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import {
  isXsrProjectFileName,
  saveProjectFile,
  writeProjectFile,
} from '@xsheet-remap/adapters'
import { APP_VERSION } from './appVersion'
import {
  defaultSheetImageExportOptions,
  renderSheetImageExports,
  type SheetImageExportFormat,
  type SheetImageExportOptions,
} from './cleanSheetExport'
import {
  errorMessage,
  exportCutProjectsFromDocument,
  preferredSaveDirectory,
  saveBinaryOutputs,
} from './app-foundation'
import { imageExportFilterName } from './app-navigation'
import { uiText } from './i18n'
import { projectFileName } from './outputFileNames'

export function createAppProjectPersistenceActions(options: {
  projectDocument: CutGroupProjectDocument
  template: SheetTemplate
  resolveProject: () => CutProject
  projectFilePath: string | null
  setProjectFilePath: (path: string | null) => void
  setProjectDocument: Dispatch<SetStateAction<CutGroupProjectDocument>>
  setSavedProjectDocumentSnapshot: (document: CutGroupProjectDocument) => void
  runtimeSourceImageUrls: Record<string, string>
  setSheetImageExportDraft: Dispatch<SetStateAction<SheetImageExportOptions | null>>
}) {
  function resolvedProjectDocument() {
    const sourceProject = options.resolveProject()
    return updateActiveCutProjectInDocument(options.projectDocument, sourceProject, { sheetTemplate: options.template })
  }

  async function handleSaveProjectFile(input: { saveAs?: boolean } = {}) {
    try {
      const nextDocument = resolvedProjectDocument()
      if (!input.saveAs && options.projectFilePath && isXsrProjectFileName(options.projectFilePath)) {
        await writeProjectFile(options.projectFilePath, nextDocument, { createdWith: APP_VERSION })
        options.setProjectDocument(nextDocument)
        options.setSavedProjectDocumentSnapshot(nextDocument)
        return
      }
      const sourceProject = options.resolveProject()
      const result = await saveProjectFile(nextDocument, projectFileName(nextDocument), {
        initialDirectory: preferredSaveDirectory(sourceProject),
        createdWith: APP_VERSION,
      })
      if (!result.saved) return
      if (result.path) options.setProjectFilePath(result.path)
      options.setProjectDocument(nextDocument)
      options.setSavedProjectDocumentSnapshot(nextDocument)
    } catch (error) {
      window.alert(uiText.project.saveFailed(errorMessage(error)))
    }
  }

  function handleOpenSheetImageExport(format: SheetImageExportFormat) {
    const sourceProject = options.resolveProject()
    options.setSheetImageExportDraft(defaultSheetImageExportOptions(sourceProject, options.template, format))
  }

  async function handleSaveSheetImageExport(exportOptions: SheetImageExportOptions) {
    try {
      const outputs = []
      const exportDocument = resolvedProjectDocument()
      const cutProjects = exportCutProjectsFromDocument(exportDocument)
      for (const [index, cutProject] of cutProjects.entries()) {
        outputs.push(...await renderSheetImageExports(
          cutProject,
          options.template,
          options.runtimeSourceImageUrls,
          exportOptions,
          {
            cutGroup: {
              activeCutId: exportDocument.cuts[index]?.cutId ?? exportDocument.activeCutId,
              cuts: exportDocument.cuts,
            },
          },
        ))
      }
      const saved = await saveBinaryOutputs(outputs, {
        filterName: imageExportFilterName(exportOptions.format),
        extensions: [exportOptions.format],
        defaultExtension: exportOptions.format,
        initialDirectory: preferredSaveDirectory(options.resolveProject()),
      })
      if (saved) options.setSheetImageExportDraft(null)
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  return {
    resolvedProjectDocument,
    handleSaveProjectFile,
    handleOpenSheetImageExport,
    handleSaveSheetImageExport,
  }
}
