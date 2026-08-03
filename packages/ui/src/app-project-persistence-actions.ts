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
  correctedSheetImageExportPlan,
  renderCorrectedSheetImageExport,
  type CorrectedSheetImageExportFormat,
} from './correctedSheetImageExport'
import {
  errorMessage,
  exportCutProjectsFromDocument,
  preferredSaveDirectory,
  saveBinaryOutputs,
  saveGeneratedBinaryOutputs,
} from './app-foundation'
import { imageExportFilterName } from './app-navigation'
import { uiText } from './i18n'
import { correctedSheetImageFileName, projectFileName } from './outputFileNames'
import { getSheetPageImage, loadImage } from './sheetImages'

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

  async function handleSaveCorrectedSheetImages(format: CorrectedSheetImageExportFormat) {
    try {
      const sourceProject = options.resolveProject()
      const { pages, totalPages } = correctedSheetImageExportPlan(sourceProject, options.template)
      if (pages.length === 0) return
      const resolvedPages = pages.map(page => ({
        ...page,
        image: getSheetPageImage(sourceProject.sheetView, options.runtimeSourceImageUrls, page.pageId, options.template),
      }))
      const unreadablePages: number[] = []
      for (const page of resolvedPages) {
        if (!page.image.imageUrl) {
          unreadablePages.push(page.pageIndex + 1)
          continue
        }
        try {
          await loadImage(page.image.imageUrl)
        } catch {
          unreadablePages.push(page.pageIndex + 1)
        }
      }
      if (unreadablePages.length > 0) {
        throw new Error(uiText.export.correctedSheetImagesUnreadable(unreadablePages.join('、')))
      }
      const factories = resolvedPages.map(page => async () => {
        const output = await renderCorrectedSheetImageExport({
          sourceName: page.source.imageRef.name,
          imageUrl: page.image.imageUrl!,
          imageSettings: page.image.settings,
          template: options.template,
          format,
        })
        return {
          ...output,
          fileName: correctedSheetImageFileName(sourceProject, format, page.pageIndex, totalPages),
        }
      })
      await saveGeneratedBinaryOutputs(factories, {
        filterName: uiText.actions.correctedSheetImageExportFilter(format.toUpperCase()),
        extensions: [format],
        defaultExtension: format,
        initialDirectory: parentDirectory(pages[0].source.imageRef.path) ?? preferredSaveDirectory(sourceProject),
      })
    } catch (error) {
      window.alert(uiText.export.saveFailed(errorMessage(error)))
    }
  }

  return {
    resolvedProjectDocument,
    handleSaveProjectFile,
    handleOpenSheetImageExport,
    handleSaveSheetImageExport,
    handleSaveCorrectedSheetImages,
  }
}

function parentDirectory(path: string | undefined): string | undefined {
  if (!path) return undefined
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : undefined
}
