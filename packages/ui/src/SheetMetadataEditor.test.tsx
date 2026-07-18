import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate } from '@xsheet-remap/core'
import { SheetMetadataEditor } from './SheetMetadataEditor'

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
})
