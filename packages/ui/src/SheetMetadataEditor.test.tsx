import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, updateSheetFormField } from '@xsheet-remap/core'
import { SheetMetadataEditor } from './SheetMetadataEditor'

afterEach(cleanup)

describe('SheetMetadataEditor page fields', () => {
  it('opens the A3 memo as an inline multiline editor and writes to the active page', () => {
    const project = createDefaultProject()
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)
    const onFormFieldChange = vi.fn()

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={onFormFieldChange}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'MEMOを編集' }))
    const editor = screen.getByRole('textbox', { name: 'MEMO' })
    expect(editor.classList.contains('sheetInlineMultilineTextarea')).toBe(true)
    expect(Number.parseFloat(editor.style.fontSize)).toBeCloseTo(8, 1)
    expect(Number.parseFloat(editor.style.lineHeight)).toBeCloseTo(10, 1)
    expect(Number.parseFloat(editor.style.padding)).toBeCloseTo(4, 1)

    fireEvent.change(editor, { target: { value: 'ページ固有のメモ' } })
    expect(onFormFieldChange).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onFormFieldChange).toHaveBeenCalledWith(
      expect.objectContaining({ fieldId: 'memo.body', scope: 'page', valueType: 'multiline' }),
      'ページ固有のメモ',
      'page_1',
    )

    expect(screen.queryByRole('dialog', { name: 'MEMOを編集' })).toBeNull()
  })

  it('marks text that cannot fit at the template minimum size', () => {
    const definition = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const project = updateSheetFormField(createDefaultProject(), definition, 'メ'.repeat(4000), 'page_1')
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'MEMOを編集' }).dataset.textOverflow).toBe('true')
  })

  it('uses a popover when the template cell selects that presentation', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const memo = template.regions.find(region => region.regionId === 'top_memo_area')!
    memo.form!.cells!.find(cell => cell.cellId === 'memo_body')!.editPresentation = 'popover'
    const project = createDefaultProject()
    const [page] = createSheetPages(template, project.logicalSheet.durationFrames)

    render(
      <SheetMetadataEditor
        project={project}
        template={template}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={template.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'MEMOを編集' }))
    const editor = screen.getByRole('textbox', { name: 'MEMO' })
    expect(editor.classList.contains('sheetInlineMultilineTextarea')).toBe(false)
    expect(screen.getByRole('dialog', { name: 'MEMOを編集' }).classList.contains('sheetMetadataEditorPopover')).toBe(true)
  })
})
