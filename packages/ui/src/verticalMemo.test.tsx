import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  activeCutProjectFromDocument, addAnnotation, addTimelineMemo, commitHistory, createDefaultProject,
  createProjectDocumentFromCutProject, createProjectHistory, createSheetPages, normalizeMemoAppearance,
  parseProjectDocument, redoHistory, resolveSheetTemplatePageSize, sheetAnnotations, standardA3SheetTemplate,
  timelineMemos, undoHistory, updateTimelineMemoAppearance, type AnnotationText, type TimelineInkMemo,
} from '@xsheet-remap/core'
import { AnnotationTextLayer } from './sheet-panel-annotation'
import { TimelineMemoLayer } from './TimelineMemoLayer'
import { cloneTextAnnotationForPaste, updateTextAnnotation } from './sheet-layers-annotation'
import { layoutVerticalText } from './verticalTextLayout'

afterEach(cleanup)
const annotation: AnnotationText = { kind: 'text', annotationId: 'text', pageId: 'page_1', text: '「コーヒー。」',
  x: .1, y: .1, color: '#000', fontSizePx: 20 }
const memo: TimelineInkMemo = { kind: 'timeline', memoId: 'memo', order: 1, anchor: { role: 'action', paperTrack: 'A', frame: 10 },
  placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 }, strokes: [],
  texts: [{ textId: 'memo-text', text: 'コーヒー', x: 1, y: 1 }] }
const verticalAppearance = { ...normalizeMemoAppearance(), text: { ...normalizeMemoAppearance().text, writingMode: 'vertical' as const } }

it('wraps whole graphemes downward and starts subsequent columns to the left, including blank lines', () => {
  const layout = layoutVerticalText('コー\n\nヒーか\u3099', 20, 100, 50, 40)
  expect(layout.glyphs.map(glyph => glyph.value)).toEqual(['コ', 'ー', 'ヒ', 'ー', 'か\u3099'])
  expect(layout.glyphs[1].yPx - layout.glyphs[0].yPx).toBe(20)
  expect(layout.glyphs[2].xPx).toBe(layout.glyphs[0].xPx - 50)
  expect(layout.glyphs[4].xPx).toBe(layout.glyphs[2].xPx - 25)
})

it('round trips both memo directions and Unicode, restores them through Undo/Redo, and copies page direction', () => {
  const initial = addTimelineMemo(addAnnotation(createDefaultProject(), annotation), memo)
  const pageChanged = updateTextAnnotation(initial, annotation.annotationId, { writingMode: 'vertical' })
  const bothChanged = updateTimelineMemoAppearance(pageChanged, memo.memoId, verticalAppearance)
  const history = commitHistory(commitHistory(createProjectHistory(initial), pageChanged), bothChanged)
  expect(normalizeMemoAppearance(timelineMemos(undoHistory(history).present)[0].appearance).text.writingMode).toBeUndefined()
  expect(sheetAnnotations(undoHistory(undoHistory(history)).present)[0]).not.toHaveProperty('writingMode')
  expect(redoHistory(undoHistory(history)).present).toEqual(bothChanged)
  const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(bothChanged)))))
  const text = sheetAnnotations(restored)[0] as AnnotationText
  expect(text).toMatchObject({ writingMode: 'vertical', text: '「コーヒー。」' })
  expect(timelineMemos(restored)[0]).toMatchObject({ appearance: { text: { writingMode: 'vertical' } }, texts: memo.texts })
  expect(cloneTextAnnotationForPaste(text, { annotationId: 'copy', pageId: 'page_2', templateId: 'test',
    surfaceSize: { widthPx: 1000, heightPx: 1500 } })).toMatchObject({ writingMode: 'vertical', text: annotation.text })
  const horizontal = updateTimelineMemoAppearance(restored, memo.memoId, { ...verticalAppearance,
    text: { ...verticalAppearance.text, writingMode: 'horizontal' } })
  expect(normalizeMemoAppearance(timelineMemos(horizontal)[0].appearance).text.writingMode ?? 'horizontal').toBe('horizontal')
})

it('changes a page editor direction without replacing its composing draft or caret', () => {
  const onCommit = vi.fn()
  const props = { selectedAnnotationId: 'text', editingAnnotationId: 'text', pageSize: { widthPx: 1000, heightPx: 1500 },
    zoom: 1, onSelect: vi.fn(), onEdit: vi.fn(), onUpdate: vi.fn(), onCommit, onCancel: vi.fn() }
  const { rerender, container } = render(<AnnotationTextLayer {...props} annotations={[{ memoId: 'page-memo', target: null, annotation, x: .1, y: .1 }]} />)
  const editor = container.querySelector('textarea')!
  fireEvent.change(editor, { target: { value: 'コーヒーを編集中' } })
  editor.setSelectionRange(3, 3)
  fireEvent.compositionStart(editor)
  rerender(<AnnotationTextLayer {...props} annotations={[{ memoId: 'page-memo', target: null, annotation: { ...annotation, writingMode: 'vertical' }, x: .1, y: .1 }]} />)
  expect(container.querySelector('textarea')).toBe(editor)
  expect(editor.style.writingMode).toBe('vertical-rl')
  expect(editor.value).toBe('コーヒーを編集中')
  expect(editor.selectionStart).toBe(3)
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(editor)
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
  expect(onCommit).toHaveBeenCalledWith('text', 'コーヒーを編集中')
})

it('commits a timeline draft with the latest direction, and can cancel without writing its text', () => {
  const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]
  const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
  const onUpsertText = vi.fn()
  const props = { template: standardA3SheetTemplate, page, pageSize, surface: pageSize, paperTracks: ['A'],
    selectedMemoId: memo.memoId, editMode: 'text' as const, penColor: '#000', penWidth: .002, eraserWidth: .01,
    textFontSizePx: 20, onAppendStroke: vi.fn(), onEraseStroke: vi.fn(), onUpsertText, onUpdatePlacement: vi.fn() }
  const { rerender } = render(<svg><TimelineMemoLayer {...props} memos={[memo]} /></svg>)
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'メモ文字' })
  fireEvent.change(editor, { target: { value: '「コーヒー。」' } })
  editor.setSelectionRange(3, 3)
  rerender(<svg><TimelineMemoLayer {...props} memos={[{ ...memo, appearance: verticalAppearance }]} /></svg>)
  expect(screen.getByRole('textbox', { name: 'メモ文字' })).toBe(editor)
  expect(editor.style.writingMode).toBe('vertical-rl')
  expect(editor.selectionStart).toBe(3)
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
  expect(onUpsertText).toHaveBeenCalledWith('memo', expect.objectContaining({ text: '「コーヒー。」' }), verticalAppearance)
  expect(screen.queryByRole('textbox', { name: 'メモ文字' })).toBeNull()
  rerender(<svg><TimelineMemoLayer {...props} selectedMemoId={null} memos={[memo]} /></svg>)
  rerender(<svg><TimelineMemoLayer {...props} memos={[memo]} /></svg>)
  const cancelled = screen.getByRole('textbox', { name: 'メモ文字' })
  fireEvent.change(cancelled, { target: { value: '保存しない' } })
  fireEvent.keyDown(cancelled, { key: 'Escape' })
  expect(onUpsertText).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('textbox', { name: 'メモ文字' })).toBeNull()
})
