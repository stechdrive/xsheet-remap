import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  commitHistory,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  createProjectHistory,
  updateActiveCutProjectInDocument,
} from './index'

describe('project performance contracts', () => {
  it('commits an already-normalized project without cloning it again', () => {
    const initial = createProjectHistory(createDefaultProject())
    const created = createOrSetEvent(initial.present, 'A', 1)

    const committed = commitHistory(initial, created.project)

    expect(committed.present).toBe(created.project)
  })

  it('preserves structurally shared document data while updating the active cut', () => {
    const first = createDefaultProject()
    let document = createProjectDocumentFromCutProject(first, { cutId: 'cut_1' })
    document = addBlankSharedCutToProjectDocument(document, first, { cut: { cut: '2' } })
    const inactiveCut = document.cuts.find(cut => cut.cutId !== document.activeCutId)!
    const updatedActive = createOrSetEvent(activeCutProjectFromDocument(document), 'A', 12).project

    const updatedDocument = updateActiveCutProjectInDocument(document, updatedActive)

    expect(updatedDocument.cuts.find(cut => cut.cutId === inactiveCut.cutId)).toBe(inactiveCut)
    expect(updatedDocument.sheetTemplate).toBe(document.sheetTemplate)
    expect(updatedDocument.assets).toBe(updatedActive.assets)
  })
})
