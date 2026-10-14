import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate, updateSheetFormField } from '@xsheet-remap/core'
import { SheetImageExportDialog } from './registered-cells-dialogs'

afterEach(cleanup)

describe('SheetImageExportDialog form overflow warning', () => {
  it('includes omitted shared-cut names in the image-export warning', () => {
    render(<SheetImageExportDialog project={createDefaultProject()} template={standardA3SheetTemplate}
      cutGroup={{ activeCutId: '0', cuts: Array.from({ length: 100 }, (_, index) => ({ cutId: String(index), order: index, metadata: { cut: String(index + 1).padStart(3, '0') } })) }}
      initialOptions={{ format: 'png', includePaperSheet: false, includeTemplateImage: true, includeTemplateDrawing: true }}
      onClose={vi.fn()} onExport={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('画面と同じ省略・切り取り')
  })
  it('warns before exporting text that cannot fit its form field', () => {
    const project = updateSheetFormField(
      createDefaultProject(),
      { fieldId: 'memo.body', scope: 'page', valueType: 'multiline' },
      'メ'.repeat(4000),
      'page_1',
    )

    render(
      <SheetImageExportDialog
        project={project}
        template={standardA3SheetTemplate}
        initialOptions={{ format: 'png', includePaperSheet: false, includeTemplateImage: true, includeTemplateDrawing: true }}
        onClose={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('1件の入力文字が欄内に収まっていません')
  })

  it('does not show the warning while all form text fits', () => {
    render(
      <SheetImageExportDialog
        project={createDefaultProject()}
        template={standardA3SheetTemplate}
        initialOptions={{ format: 'png', includePaperSheet: false, includeTemplateImage: true, includeTemplateDrawing: true }}
        onClose={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).toBeNull()
  })
})
