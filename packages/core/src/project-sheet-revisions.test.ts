import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  activeSheetRevisionFromDocument,
  addSheetRevisionToProjectDocument,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  deleteSheetRevisionInProjectDocument,
  parseProjectDocument,
  setSheetRevisionReferenceInProjectDocument,
  switchActiveSheetRevisionInProjectDocument,
  updateActiveCutProjectInDocument,
  updateLogicalSheetSettings,
  updateSheetFormField,
} from './index'

describe('project sheet history', () => {
  it('keeps content and duration independent while sharing registered cells', () => {
    const original = createOrSetEvent(createDefaultProject(), 'A', 1).project
    let document = createProjectDocumentFromCutProject(original)
    document = addSheetRevisionToProjectDocument(document, original, { name: '演出', mode: 'duplicate', showSourceReference: true })
    const copied = activeCutProjectFromDocument(document)
    const editedCopy = updateLogicalSheetSettings(createOrSetEvent(copied, 'B', 24).project, { durationFrames: 144 })
    document = updateActiveCutProjectInDocument(document, editedCopy)
    expect(activeSheetRevisionFromDocument(document)).toMatchObject({ name: '演出', reference: { revisionId: 'sheet_revision_1' } })
    expect(activeCutProjectFromDocument(document).logicalSheet.durationFrames).toBe(144)

    document = switchActiveSheetRevisionInProjectDocument(document, editedCopy, 'sheet_revision_1')
    const restoredOriginal = activeCutProjectFromDocument(document)
    expect(restoredOriginal.logicalSheet.durationFrames).toBe(original.logicalSheet.durationFrames)
    expect(restoredOriginal.logicalSheet.events.some(event => event.frame === 24)).toBe(false)
    expect(restoredOriginal.logicalSheet.keys).toEqual(editedCopy.logicalSheet.keys)
  })

  it('creates blank history and removes references to deleted sheets', () => {
    const original = createOrSetEvent(createDefaultProject(), 'A', 1).project
    let document = createProjectDocumentFromCutProject(original)
    document = addSheetRevisionToProjectDocument(document, original, { name: '監督', mode: 'blank', showSourceReference: true })
    expect(activeCutProjectFromDocument(document).logicalSheet.events).toEqual([])
    document = setSheetRevisionReferenceInProjectDocument(document, 'sheet_revision_2', { revisionId: 'sheet_revision_1', opacity: 2 })
    expect(activeSheetRevisionFromDocument(document).reference?.opacity).toBe(0.7)
    document = deleteSheetRevisionInProjectDocument(document, 'sheet_revision_1')
    expect(activeSheetRevisionFromDocument(document).reference).toBeUndefined()
    expect(() => deleteSheetRevisionInProjectDocument(document, 'sheet_revision_2')).toThrow('最後のシート')
  })

  it('copies revision fields on duplicate and clears only revision fields on blank history', () => {
    let original = updateSheetFormField(createDefaultProject(), { fieldId: 'production.code', scope: 'production', valueType: 'text' }, 'P')
    original = updateSheetFormField(original, { fieldId: 'output.sizeX', scope: 'cut', valueType: 'number' }, 1920)
    original = updateSheetFormField(original, { fieldId: 'process.check', scope: 'revision', valueType: 'text' }, '作画')
    let document = createProjectDocumentFromCutProject(original)

    document = addSheetRevisionToProjectDocument(document, original, { name: '演出', mode: 'duplicate' })
    expect(activeCutProjectFromDocument(document).sheetFormData).toEqual(original.sheetFormData)

    const duplicate = activeCutProjectFromDocument(document)
    document = addSheetRevisionToProjectDocument(document, duplicate, { name: '監督', mode: 'blank' })
    expect(activeCutProjectFromDocument(document).sheetFormData).toEqual({
      production: original.sheetFormData.production,
      cut: original.sheetFormData.cut,
      revision: {},
    })
  })

  it('migrates schema 6 single-sheet documents into unnamed history', () => {
    const source = createOrSetEvent(createDefaultProject(), 'A', 12).project
    const current = createProjectDocumentFromCutProject(source)
    const cut = current.cuts[0]!
    const revision = cut.revisions[0]!
    const legacy = {
      ...current,
      schemaVersion: 6,
      cuts: [{ cutId: cut.cutId, order: cut.order, metadata: { ...cut.metadata, ...revision.metadata },
        sheetView: revision.sheetView, logicalSheet: revision.logicalSheet, cspTrackSlots: revision.cspTrackSlots,
        stackGuideLabelPlacements: revision.stackGuideLabelPlacements, annotations: revision.annotations,
        timelineMemos: revision.timelineMemos, timedRangeCues: revision.timedRangeCues }],
    }
    const migrated = parseProjectDocument(legacy)
    expect(migrated).toMatchObject({ schemaVersion: 8, cuts: [{ activeRevisionId: 'sheet_revision_1', revisions: [{ name: undefined }] }] })
    expect(activeCutProjectFromDocument(migrated).logicalSheet.events).toEqual(source.logicalSheet.events)
  })
})
