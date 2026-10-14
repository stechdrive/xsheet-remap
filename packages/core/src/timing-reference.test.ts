import { describe, expect, it } from 'vitest'
import {
  createDefaultProject, createKey, setEvent, setTimingSpecialEvent, setTimingReferenceAt, setTimingReferenceRange,
  createProjectDocumentFromCutProject, parseProjectDocument, activeCutProjectFromDocument, addSheetRevisionToProjectDocument,
  applyCutTimelineFrameEdit, createProjectHistory, commitHistory, undoHistory, redoHistory,
} from './index'

describe('reference notation', () => {
  it('marks occurrences without changing registered cels, event holds or bindings; survives typing and removes independently', () => {
    const created = createKey(createDefaultProject(), 'A', '123', 'manual', undefined, 'cell')
    const source = setEvent(setEvent(created.project, 'A', 1, created.key.keyId, 'cell'), 'A', 5, created.key.keyId, 'cell')
    let marked = setTimingReferenceAt(source, 'A', 1, 'cell', true)
    marked = setTimingReferenceAt(marked, 'A', 3, 'cell', true)
    expect(marked.logicalSheet.events).toBe(source.logicalSheet.events)
    expect(marked.logicalSheet.keys).toBe(source.logicalSheet.keys)
    expect(marked.bindings).toBe(source.bindings)
    expect(marked.logicalSheet.referenceMarks?.map(mark => mark.frame)).toEqual([1, 3])
    expect(setTimingReferenceAt(marked, 'A', 1, 'cell', true)).toBe(marked)
    const typed = setEvent(marked, 'A', 3, created.key.keyId, 'cell')
    expect(typed.logicalSheet.referenceMarks).toEqual(marked.logicalSheet.referenceMarks)
    const cleared = setTimingReferenceAt(typed, 'A', 3, 'cell', false)
    expect(cleared.logicalSheet.events).toBe(typed.logicalSheet.events)
    const special = setTimingSpecialEvent(marked, 'A', 3, 'inbetween', 'cell')
    expect(special.logicalSheet.referenceMarks?.map(mark => mark.frame)).toEqual([1])
    expect(setTimingReferenceAt(special, 'A', 3, 'cell', true)).toBe(special)
  })
  it('roundtrips through documents and revisions and undoes an entire range atomically', () => {
    const original = createDefaultProject()
    const marked = setTimingReferenceRange(original, { role: 'action', paperTracks: ['A', 'B'], frameStart: 2, frameEnd: 4 }, true)
    const history = commitHistory(createProjectHistory(original), marked)
    expect(undoHistory(history).present.logicalSheet.referenceMarks).toEqual([])
    expect(redoHistory(undoHistory(history)).present.logicalSheet.referenceMarks).toHaveLength(6)
    const document = createProjectDocumentFromCutProject(marked)
    const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(document))))
    expect(restored.logicalSheet.referenceMarks).toEqual(marked.logicalSheet.referenceMarks)
    const duplicate = addSheetRevisionToProjectDocument(document, marked, { name: '複製', mode: 'duplicate' })
    expect(activeCutProjectFromDocument(duplicate).logicalSheet.referenceMarks).toEqual(marked.logicalSheet.referenceMarks)
    const blank = addSheetRevisionToProjectDocument(document, marked, { name: '新規', mode: 'blank' })
    expect(activeCutProjectFromDocument(blank).logicalSheet.referenceMarks).toEqual([])
  })
  it('shifts reference-only cells and removes deleted frames during cut ripple edits', () => {
    const source = setTimingReferenceRange(createDefaultProject(), { role: 'cell', paperTracks: ['A'], frameStart: 5, frameEnd: 7 }, true)
    const inserted = applyCutTimelineFrameEdit(source, { kind: 'insert', atFrame: 6, frameCount: 3 })
    expect(inserted.logicalSheet.referenceMarks?.map(mark => mark.frame)).toEqual([5, 9, 10])
    expect(applyCutTimelineFrameEdit(inserted, { kind: 'delete', frameStart: 6, frameCount: 3 })).toEqual(source)
    const removed = applyCutTimelineFrameEdit(source, { kind: 'delete', frameStart: 5, frameCount: 2 })
    expect(removed.logicalSheet.referenceMarks?.map(mark => mark.frame)).toEqual([5])
  })
})
