import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  activeCutProjectFromDocument,
  activeSheetRevisionFromDocument,
  addSheetRevisionToProjectDocument,
  createProjectHistory,
  defaultCorrectionLayerId,
  deleteSheetRevisionInProjectDocument,
  renameSheetRevisionInProjectDocument,
  setSheetRevisionProtectedInProjectDocument,
  setSheetRevisionReferenceInProjectDocument,
  switchActiveSheetRevisionInProjectDocument,
  type CutGroupProjectDocument,
  type CutProject,
  type ProjectHistory,
  type SheetRevisionDocument,
} from '@xsheet-remap/core'

export function createAppSheetHistoryActions(input: {
  projectDocument: CutGroupProjectDocument
  project: CutProject
  activeRevisionId: string
  revisions: SheetRevisionDocument[]
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
    input.setRuntimeSourceImageUrls({})
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
    handleSwitchSheetRevision(revisionId: string) {
      if (!revisionId || revisionId === input.activeRevisionId) return
      run(() => activateDocument(switchActiveSheetRevisionInProjectDocument(input.projectDocument, input.project, revisionId)))
    },
    handleAddSheetRevision(options: { name: string; mode: 'duplicate' | 'blank'; showSourceReference: boolean }) {
      run(() => activateDocument(addSheetRevisionToProjectDocument(input.projectDocument, input.project, options)))
    },
    handleRenameSheetRevision(revisionId: string, name: string | undefined) {
      run(() => input.setProjectDocument(renameSheetRevisionInProjectDocument(input.projectDocument, revisionId, name)))
    },
    handleToggleSheetRevisionProtected(revisionId: string, protectedState: boolean) {
      run(() => input.setProjectDocument(setSheetRevisionProtectedInProjectDocument(input.projectDocument, revisionId, protectedState)))
    },
    handleToggleSheetRevisionSourceReference(revisionId: string, enabled: boolean) {
      run(() => {
        const revision = input.revisions.find(candidate => candidate.revisionId === revisionId)
        const reference = enabled && revision?.sourceRevisionId ? { revisionId: revision.sourceRevisionId } : undefined
        input.setProjectDocument(setSheetRevisionReferenceInProjectDocument(input.projectDocument, revisionId, reference))
      })
    },
    handleDeleteSheetRevision(revisionId: string) {
      run(() => activateDocument(deleteSheetRevisionInProjectDocument(input.projectDocument, revisionId)))
    },
  }
}

export function useAppSheetHistoryController(input: Omit<Parameters<typeof createAppSheetHistoryActions>[0], 'activeRevisionId' | 'revisions'>) {
  const activeSheetRevision = useMemo(() => activeSheetRevisionFromDocument(input.projectDocument), [input.projectDocument])
  const sheetRevisions = useMemo(() => {
    const cut = input.projectDocument.cuts.find(candidate => candidate.cutId === input.projectDocument.activeCutId)
      ?? input.projectDocument.cuts[0]
    return cut?.revisions ?? []
  }, [input.projectDocument])
  const referenceProject = useMemo(() => {
    const referenceId = activeSheetRevision.reference?.revisionId
    if (!referenceId) return null
    try {
      return activeCutProjectFromDocument(switchActiveSheetRevisionInProjectDocument(input.projectDocument, input.project, referenceId))
    } catch {
      return null
    }
  }, [activeSheetRevision.reference?.revisionId, input.projectDocument, input.project])
  return {
    activeSheetRevision,
    sheetRevisions,
    referenceProject,
    ...createAppSheetHistoryActions({ ...input, activeRevisionId: activeSheetRevision.revisionId, revisions: sheetRevisions }),
  }
}
