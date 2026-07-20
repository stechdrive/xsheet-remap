import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  createProjectHistory,
  defaultCorrectionLayerId,
  deleteSharedCutFromProjectDocument,
  switchActiveCutInProjectDocument,
  type CutGroupProjectDocument,
  type CutProject,
  type ProjectHistory,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { confirmUserAction } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { projectRuntimeSourceImageUrls } from './projectFileModel'

export function createAppSharedCutActions(input: {
  projectDocument: CutGroupProjectDocument
  project: CutProject
  template: SheetTemplate
  setProjectDocument: Dispatch<SetStateAction<CutGroupProjectDocument>>
  setHistory: Dispatch<SetStateAction<ProjectHistory>>
  projectRef: MutableRefObject<CutProject>
  setActiveCorrectionLayerId: (value: string) => void
  setRuntimeSourceImageUrls: Dispatch<SetStateAction<Record<string, string>>>
  clearSelection: () => void
  alertError: (error: unknown) => void
}) {
  const activateDocument = (nextDocument: CutGroupProjectDocument) => {
    const nextProject = activeCutProjectFromDocument(nextDocument)
    input.setProjectDocument(nextDocument)
    input.projectRef.current = nextProject
    input.setHistory(createProjectHistory(nextProject))
    input.setActiveCorrectionLayerId(defaultCorrectionLayerId(nextProject) ?? '')
    input.setRuntimeSourceImageUrls(projectRuntimeSourceImageUrls(nextDocument))
    input.clearSelection()
  }

  const run = (action: () => void) => {
    try {
      action()
    } catch (error) {
      input.alertError(error)
    }
  }

  return {
    handleSwitchProjectCut(cutId: string) {
      if (!cutId || cutId === input.projectDocument.activeCutId) return
      run(() => activateDocument(switchActiveCutInProjectDocument(input.projectDocument, input.project, cutId, { sheetTemplate: input.template })))
    },
    handleAddSharedCut(label: string) {
      const normalizedLabel = label.trim()
      run(() => {
        if (!normalizedLabel) throw new Error(uiText.sheet.sharedCutNameRequired)
        if (input.projectDocument.cuts.some(cut => cut.metadata.cut?.trim() === normalizedLabel)) {
          throw new Error(uiText.sheet.sharedCutNameDuplicate(normalizedLabel))
        }
        activateDocument(addBlankSharedCutToProjectDocument(input.projectDocument, input.project, {
          cut: { cut: normalizedLabel },
        }))
      })
    },
    async handleDeleteSharedCut() {
      if (input.projectDocument.cuts.length <= 1) return
      const activeCut = input.projectDocument.cuts.find(cut => cut.cutId === input.projectDocument.activeCutId)
      if (!activeCut) return
      const label = activeCut.metadata.cut?.trim() || `カット${activeCut.order + 1}`
      const confirmed = await confirmUserAction(uiText.sheet.deleteSharedCutConfirm(label, activeCut.revisions.length), {
        title: uiText.sheet.deleteSharedCutDialogTitle,
        okLabel: uiText.actions.remove,
        cancelLabel: uiText.actions.cancel,
      })
      if (!confirmed) return
      run(() => activateDocument(deleteSharedCutFromProjectDocument(
        input.projectDocument,
        input.project,
        activeCut.cutId,
        { sheetTemplate: input.template },
      )))
    },
  }
}
