import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  activeSheetRevisionFromDocument,
  addSheetRevisionToProjectDocument,
  assignSheetSourceToPage,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  deleteSheetRevisionInProjectDocument,
  parseProjectDocument,
  registerSheetSource,
  setSheetRevisionReferenceInProjectDocument,
  sheetAnnotations,
  switchActiveSheetRevisionInProjectDocument,
  timelineMemos,
  updateActiveCutProjectInDocument,
  updateLogicalSheetSettings,
  updateSheetFormField,
  type SheetSource,
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
    original = updateSheetFormField(original, { fieldId: 'memo.body', scope: 'page', valueType: 'multiline' }, 'ページメモ', 'page_1')
    let document = createProjectDocumentFromCutProject(original)

    document = addSheetRevisionToProjectDocument(document, original, { name: '演出', mode: 'duplicate' })
    expect(activeCutProjectFromDocument(document).sheetFormData).toEqual(original.sheetFormData)

    const duplicate = activeCutProjectFromDocument(document)
    document = addSheetRevisionToProjectDocument(document, duplicate, { name: '監督', mode: 'blank' })
    expect(activeCutProjectFromDocument(document).sheetFormData).toEqual({
      production: original.sheetFormData.production,
      cut: original.sheetFormData.cut,
      revision: {},
      pages: {},
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
        stackGuideLabelPlacements: revision.stackGuideLabelPlacements, annotations: sheetAnnotations(revision),
        timelineMemos: timelineMemos(revision).map(memo => ({
          memoId: memo.memoId,
          anchor: memo.anchor,
          placement: memo.placement,
          strokes: memo.strokes,
          order: memo.order,
        })), timedRangeCues: revision.timedRangeCues }],
    }
    const migrated = parseProjectDocument(legacy)
    expect(migrated).toMatchObject({ schemaVersion: 11, cuts: [{ activeRevisionId: 'sheet_revision_1', revisions: [{ name: undefined, pageFields: {} }] }] })
    expect(activeCutProjectFromDocument(migrated).logicalSheet.events).toEqual(source.logicalSheet.events)
  })

  it('migrates paper source alignment and duplicate assignments in inactive revisions', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'legacy-paper.png' })
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    let document = createProjectDocumentFromCutProject(assigned)
    document = addSheetRevisionToProjectDocument(document, assigned, { name: 'active copy', mode: 'duplicate' })
    const inactiveView = document.cuts[0]!.revisions[0]!.sheetView
    delete (inactiveView.sources[0] as Partial<SheetSource>).alignment
    inactiveView.sources[0]!.assignedPageId = 'page_3'
    inactiveView.pages.push({ ...inactiveView.pages[0]!, pageId: 'page_3' })

    const migrated = parseProjectDocument(document)
    const migratedInactive = migrated.cuts[0]!.revisions[0]!.sheetView
    const migratedPage3 = migratedInactive.pages.find(page => page.pageId === 'page_3')

    expect(migratedInactive.sources[0]?.alignment).toEqual(migratedPage3?.alignment)
    expect(migratedInactive.sources[0]?.assignedPageId).toBe('page_3')
    expect(migratedInactive.pages.find(page => page.pageId === 'page_1')?.sourceId).toBeTruthy()
    expect(migratedInactive.pages.find(page => page.pageId === 'page_1')?.sourceId).not.toBe(registered.source.sourceId)
    expect(migratedPage3?.sourceId).toBe(registered.source.sourceId)
    expect(migratedInactive.sources).toHaveLength(2)
  })
})
