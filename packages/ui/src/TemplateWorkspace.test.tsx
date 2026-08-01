import { createDefaultProject, digitalStandardSheetTemplate, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateWorkspace } from './TemplateWorkspace'
import { createTemplateDraft } from './templateDrafts'

afterEach(() => cleanup())

describe('TemplateWorkspace project integration', () => {
  it('keeps an imported JSON as a draft until the user applies it to the project', async () => {
    const imported = createTemplateDraft('paper-standard', standardA3SheetTemplate)
    const onApplyTemplate = vi.fn()
    const { container } = render(
      <TemplateWorkspace
        project={createDefaultProject()}
        template={standardA3SheetTemplate}
        onLoadTemplate={async () => imported}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={onApplyTemplate}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
        onUpdateCorrectionLayers={() => true}
      />,
    )

    const input = container.querySelector<HTMLInputElement>('label.fileButton input[accept=".json,application/json"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: asFileList(new File(['{}'], 'import.template.json')) } })

    await waitFor(() => expect(screen.getByText('未適用の変更')).toBeTruthy())
    const apply = screen.getByRole('button', { name: 'プロジェクトへ反映' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)
    expect(onApplyTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: imported.templateId }))
  })

  it('preserves a dirty draft when the applied project template changes externally', () => {
    const commonProps = {
      project: createDefaultProject(),
      onLoadTemplate: async () => null,
      onSaveTemplate: async () => ({ saved: true }),
      onApplyTemplate: vi.fn(),
      onCreateTemplateDraft: (kind: Parameters<typeof createTemplateDraft>[0]): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate),
      onUpdateCorrectionLayers: () => true,
    }
    const view = render(<TemplateWorkspace {...commonProps} template={standardA3SheetTemplate} />)

    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '保持する未適用下書き' } })
    expect(screen.getByText('未適用の変更')).toBeTruthy()
    view.rerender(<TemplateWorkspace {...commonProps} template={digitalStandardSheetTemplate} />)

    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('保持する未適用下書き')
    fireEvent.click(screen.getByRole('button', { name: '変更を取り消す' }))
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe(digitalStandardSheetTemplate.name)
  })
})

function asFileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
  } as unknown as FileList
}
