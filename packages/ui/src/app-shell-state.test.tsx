import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, commitHistory, createOrSetEvent, redoHistory, undoHistory, updateActiveCutProjectInDocument } from '@xsheet-remap/core'
import { useAppShellState } from './app-shell-state'

afterEach(cleanup)
it('replaces a CLIP workspace with an empty Undo/Redo history and the new shared layer document', () => {
  const { result } = renderHook(() => useAppShellState('remap'))
  act(() => result.current.setHistory(history => commitHistory(history, createOrSetEvent(history.present, 'A', 1, 'action').project)))
  const replacement = { ...result.current.projectDocument, projectId: 'another-clip' }
  act(() => { result.current.replaceProjectDocument(replacement) })
  expect(result.current.history.past).toEqual([])
  expect(result.current.history.future).toEqual([])
  expect(result.current.projectDocument).toBe(replacement)
  expect(result.current.project.clipDocument).toBe(replacement.clipDocument)
  act(() => result.current.setHistory(undoHistory))
  expect(result.current.project.projectId).toBe('another-clip')
})
it('undoes and redoes a complete multi-cut import with adjacent edits and template history intact', () => {
  const { result } = renderHook(() => useAppShellState('remap'))
  const before = result.current.projectDocument
  const edited = createOrSetEvent(result.current.project, 'A', 1, 'action').project
  act(() => result.current.setHistory(history => commitHistory(history, edited)))
  const snapshot = updateActiveCutProjectInDocument(before, result.current.project)
  const imported = addBlankSharedCutToProjectDocument(snapshot, result.current.project, { cut: { cut: 'C002' } })
  act(() => { result.current.commitProjectDocument(imported) })
  expect(result.current.projectDocument.cuts).toHaveLength(2)
  act(() => result.current.setHistory(undoHistory))
  expect(result.current.projectDocument.cuts).toHaveLength(1)
  expect(result.current.project.logicalSheet.events).toEqual(edited.logicalSheet.events)
  act(() => result.current.setHistory(undoHistory))
  expect(result.current.project.logicalSheet.events).toHaveLength(0)
  act(() => result.current.setHistory(redoHistory))
  act(() => result.current.setHistory(redoHistory))
  expect(result.current.projectDocument.cuts).toHaveLength(2)
  expect(result.current.project).toEqual(activeCutProjectFromDocument(imported))
  expect(result.current.template).toEqual(imported.sheetTemplate)
})
