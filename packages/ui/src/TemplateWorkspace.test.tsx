import { createAlphabeticTrackLabels, createDefaultProject, digitalStandardSheetTemplate, resolveSheetTemplatePageSize, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateWorkspace } from './TemplateWorkspace'
import { createTemplateDraft } from './templateDrafts'

afterEach(() => cleanup())

describe('TemplateWorkspace project integration', () => {
  it('keeps reference opacity as an editor-only display setting', () => {
    const onApplyTemplate = vi.fn()
    const before = JSON.stringify(standardA3SheetTemplate)
    const { container } = render(
      <TemplateWorkspace
        project={createDefaultProject()}
        template={standardA3SheetTemplate}
        onLoadTemplate={async () => null}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={onApplyTemplate}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
        onUpdateCorrectionLayers={() => true}
      />,
    )
    const statusBefore = container.querySelector('.templateDraftStatus')?.textContent

    fireEvent.change(screen.getByRole('slider', { name: '下絵の不透明度' }), { target: { value: '24' } })

    expect(container.querySelector('.templateReferenceImageLayer')?.getAttribute('opacity')).toBe('0.24')
    expect(container.querySelector('.templateDraftStatus')?.textContent).toBe(statusBefore)
    expect(screen.queryByText('未適用の変更')).toBeNull()
    expect(onApplyTemplate).not.toHaveBeenCalled()
    expect(JSON.stringify(standardA3SheetTemplate)).toBe(before)
  })

  it('guides image-based reconstruction without changing the template model', () => {
    const before = JSON.stringify(standardA3SheetTemplate)
    const onDraftStateChange = vi.fn()
    render(
      <TemplateWorkspace
        project={createDefaultProject()}
        template={standardA3SheetTemplate}
        initialWorkflow="image"
        onLoadTemplate={async () => null}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={vi.fn()}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
        onUpdateCorrectionLayers={() => true}
        onDraftStateChange={onDraftStateChange}
      />,
    )

    const guide = screen.getByRole('region', { name: '下絵から再構築' })
    expect(within(guide).getByRole('button', { name: /1\. 下絵/ }).getAttribute('aria-current')).toBe('step')
    expect(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).getByRole('button', { name: '下絵', pressed: true })).toBeTruthy()

    fireEvent.click(within(guide).getByRole('button', { name: /2\. 6秒表/ }))
    expect(screen.getByRole('button', { name: '6秒タイムライン表', pressed: true })).toBeTruthy()
    expect(within(guide).getByRole('button', { name: /2\. 6秒表/ }).getAttribute('aria-current')).toBe('step')

    fireEvent.click(within(guide).getByRole('button', { name: /3\. 列境界/ }))
    expect(within(guide).getByRole('button', { name: /3\. 列境界/ }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(within(guide).getByRole('button', { name: /4\. シート情報/ }))
    expect(document.querySelector('.templateRegionNavigatorItem.selected')?.classList.contains('root')).toBe(false)
    fireEvent.click(within(guide).getByRole('button', { name: /5\. 保存/ }))
    expect(within(screen.getByRole('complementary', { name: 'テンプレート設定' })).getByRole('heading', { name: '検証結果' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '選択項目へ戻る' }))
    expect(screen.queryByText('未適用の変更')).toBeNull()
    expect(onDraftStateChange.mock.calls.at(-1)?.[0].dirty).toBe(false)
    expect(JSON.stringify(standardA3SheetTemplate)).toBe(before)
  })

  it('keeps an imported JSON as a draft until the user applies it to the project', async () => {
    const imported = createTemplateDraft('paper-standard', standardA3SheetTemplate)
    const onApplyTemplate = vi.fn()
    render(
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

    fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
    const input = document.querySelector<HTMLInputElement>('label.fileButton input[accept=".json,application/json"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: asFileList(new File(['{}'], 'import.template.json')) } })

    await waitFor(() => expect(screen.getByText('未適用の変更')).toBeTruthy())
    const apply = screen.getByRole('button', { name: 'プロジェクトへ反映' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)
    expect(onApplyTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: imported.templateId }))
  })

  it('opens validation results when an invalid draft is applied', () => {
    const onApplyTemplate = vi.fn()
    render(
      <TemplateWorkspace
        project={createDefaultProject()}
        template={standardA3SheetTemplate}
        onLoadTemplate={async () => null}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={onApplyTemplate}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
        onUpdateCorrectionLayers={() => true}
      />,
    )

    fireEvent.click(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).getByRole('button', { name: '用紙と見た目' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '' } })
    const apply = screen.getByRole('button', { name: 'プロジェクトへ反映' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    fireEvent.click(apply)

    expect(within(screen.getByRole('complementary', { name: 'テンプレート設定' })).getByRole('heading', { name: '検証結果' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/反映前に\d+件のエラー/)
    expect(onApplyTemplate).not.toHaveBeenCalled()
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

    fireEvent.click(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).getByRole('button', { name: '用紙と見た目' }))
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '保持する未適用下書き' } })
    expect(screen.getByText('未適用の変更')).toBeTruthy()
    view.rerender(<TemplateWorkspace {...commonProps} template={digitalStandardSheetTemplate} />)

    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe('保持する未適用下書き')
    fireEvent.click(screen.getByRole('button', { name: '変更を取り消す' }))
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe(digitalStandardSheetTemplate.name)
  })

  it('returns to basic settings when a clean paper template is replaced by a digital template', async () => {
    const commonProps = {
      project: createDefaultProject(),
      onLoadTemplate: async () => null,
      onSaveTemplate: async () => ({ saved: true }),
      onApplyTemplate: vi.fn(),
      onCreateTemplateDraft: (kind: Parameters<typeof createTemplateDraft>[0]): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate),
      onUpdateCorrectionLayers: () => true,
    }
    const view = render(<TemplateWorkspace {...commonProps} template={standardA3SheetTemplate} />)
    const structure = screen.getByRole('complementary', { name: 'テンプレート構成' })
    const referenceButton = within(structure).getByRole('button', { name: '下絵' })

    fireEvent.click(referenceButton)
    expect(referenceButton.getAttribute('aria-pressed')).toBe('true')
    view.rerender(<TemplateWorkspace {...commonProps} template={digitalStandardSheetTemplate} />)

    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).getByRole('button', { name: 'テンプレートと見た目' }).getAttribute('aria-pressed')).toBe('true'))
    expect((screen.getByLabelText('名前') as HTMLInputElement).value).toBe(digitalStandardSheetTemplate.name)
    expect(screen.getByLabelText('FPS')).toBeTruthy()
    expect(screen.getByText(/現在開いているシートの尺やトラックは変更しません/)).toBeTruthy()
    expect(screen.getByText('新規プロジェクトの初期FPS')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).queryByRole('button', { name: '下絵' })).toBeNull()
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeNull()
  })

  it('previews authored digital defaults instead of replacing them with the current project tracks', () => {
    const project = createDefaultProject()
    project.logicalSheet.paperTracks = project.logicalSheet.paperTracks.slice(0, 2)
    render(
      <TemplateWorkspace
        project={project}
        template={digitalStandardSheetTemplate}
        onLoadTemplate={async () => null}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={vi.fn()}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, digitalStandardSheetTemplate)}
        onUpdateCorrectionLayers={() => true}
      />,
    )

    fireEvent.change(screen.getByLabelText('セル列数（ACTION/CELL共通）'), { target: { value: '22' } })

    const tracks = createAlphabeticTrackLabels(22)
    const authored = {
      ...digitalStandardSheetTemplate,
      defaults: { ...digitalStandardSheetTemplate.defaults, paperTracks: tracks },
    }
    const expectedPage = resolveSheetTemplatePageSize(authored, authored.defaults.durationFrames, { paperTracks: tracks })
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.width).toBe(`${expectedPage.widthPx}px`)
    expect(Array.from(document.querySelectorAll('.templateColumnText')).some(element => element.textContent === 'V')).toBe(true)
    expect(project.logicalSheet.paperTracks).toHaveLength(2)
  })

  it('stores custom field defaults using the selected value type and can return to unset', async () => {
    const { currentTemplate, onSaveTemplate } = renderDefaultValueWorkspace()

    expect(screen.getByText('未入力欄の初期値')).toBeTruthy()
    expect(screen.getByText(/既存の入力値は変更しません/)).toBeTruthy()
    const enabled = screen.getByLabelText('初期値テストの初期値を設定') as HTMLInputElement
    expect(enabled.checked).toBe(false)

    fireEvent.click(enabled)
    expect(enabled.checked).toBe(true)
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe(''))
    fireEvent.change(screen.getByLabelText('初期値テストの未入力欄の初期値'), { target: { value: '絵コンテ' } })
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe('絵コンテ'))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(1))
    expect(defaultValueField(onSaveTemplate.mock.calls[0]![0])).toMatchObject({ valueType: 'text', defaultValue: '絵コンテ' })

    const valueType = screen.getByLabelText('初期値テストの値の種類')
    fireEvent.change(valueType, { target: { value: 'number' } })
    expect(enabled.checked).toBe(false)
    await waitFor(() => expect(Object.hasOwn(defaultValueField(currentTemplate()), 'defaultValue')).toBe(false))
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('初期値テストの未入力欄の初期値'), { target: { value: '12.5' } })
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe(12.5))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(2))
    expect(defaultValueField(onSaveTemplate.mock.calls[1]![0])).toMatchObject({ valueType: 'number', defaultValue: 12.5 })

    fireEvent.change(valueType, { target: { value: 'duration' } })
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('初期値テストの未入力欄の初期値'), { target: { value: '48.6' } })
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe(49))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(3))
    expect(defaultValueField(onSaveTemplate.mock.calls[2]![0])).toMatchObject({ valueType: 'duration', defaultValue: 49 })

    fireEvent.change(valueType, { target: { value: 'boolean' } })
    fireEvent.click(enabled)
    const booleanDefault = screen.getByLabelText('初期値テストの未入力欄の初期値') as HTMLInputElement
    expect(booleanDefault.checked).toBe(false)
    fireEvent.click(booleanDefault)
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(4))
    expect(defaultValueField(onSaveTemplate.mock.calls[3]![0])).toMatchObject({ valueType: 'boolean', defaultValue: true })

    fireEvent.click(enabled)
    await waitFor(() => expect(Object.hasOwn(defaultValueField(currentTemplate()), 'defaultValue')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(5))
    expect(Object.hasOwn(defaultValueField(onSaveTemplate.mock.calls[4]![0]), 'defaultValue')).toBe(false)
  })

  it('stores a choice default and clears it when the option is removed', async () => {
    const { currentTemplate, onSaveTemplate } = renderDefaultValueWorkspace()
    const valueType = screen.getByLabelText('初期値テストの値の種類')
    fireEvent.change(valueType, { target: { value: 'choice' } })

    const enabled = screen.getByLabelText('初期値テストの初期値を設定') as HTMLInputElement
    expect(enabled.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('初期値テストの選択肢'), { target: { value: '原画\n動画' } })
    expect(enabled.disabled).toBe(false)
    fireEvent.click(enabled)
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe('原画'))
    fireEvent.change(screen.getByLabelText('初期値テストの未入力欄の初期値'), { target: { value: '動画' } })
    await waitFor(() => expect(defaultValueField(currentTemplate()).defaultValue).toBe('動画'))

    fireEvent.change(screen.getByLabelText('初期値テストの選択肢'), { target: { value: '原画' } })
    await waitFor(() => expect(Object.hasOwn(defaultValueField(currentTemplate()), 'defaultValue')).toBe(false))
    expect(enabled.checked).toBe(false)

    fireEvent.change(screen.getByLabelText('初期値テストの選択肢'), { target: { value: '原画\n動画' } })
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('初期値テストの未入力欄の初期値'), { target: { value: '動画' } })
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートJSONを保存' }))
    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(1))
    expect(defaultValueField(onSaveTemplate.mock.calls[0]![0])).toMatchObject({
      valueType: 'choice',
      choices: ['原画', '動画'],
      defaultValue: '動画',
    })
  })

  it('uses shared tooltips for disabled field semantics and placement controls', async () => {
    const template = createTemplateDraft('paper-standard', standardA3SheetTemplate)
    const field = defaultValueField(template)
    field.label = '連動項目'
    field.builtinBinding = { target: 'cut-metadata', field: 'title' }

    render(
      <TemplateWorkspace
        project={createDefaultProject()}
        template={template}
        onLoadTemplate={async () => null}
        onSaveTemplate={async () => ({ saved: true })}
        onApplyTemplate={vi.fn()}
        onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
        onUpdateCorrectionLayers={() => true}
      />,
    )

    const navigator = screen.getByRole('complementary', { name: 'テンプレート構成' })
    fireEvent.click(within(navigator).getByRole('button', { name: 'MEMO' }))
    const valueType = screen.getByLabelText('連動項目の値の種類') as HTMLSelectElement
    expect(valueType.disabled).toBe(true)
    expect(valueType.hasAttribute('title')).toBe(false)
    expect(document.getElementById(valueType.getAttribute('aria-describedby')!)?.textContent).toContain('標準のカット情報と連動する項目')
    await expectTooltipOn(valueType.closest('label'), '標準のカット情報と連動する項目')

    fireEvent.click(screen.getByRole('button', { name: 'MEMOの位置を一時的に固定' }))
    const xInput = screen.getByLabelText(/x px$/) as HTMLInputElement
    expect(xInput.disabled).toBe(true)
    expect(xInput.hasAttribute('title')).toBe(false)
    expect(document.getElementById(xInput.getAttribute('aria-describedby')!)?.textContent).toContain('固定を解除すると編集できます')
    await expectTooltipOn(xInput.closest('label'), '位置の一時固定を解除すると編集できます')
    expect(document.querySelector('[title]')).toBeNull()
  })
})

function renderDefaultValueWorkspace() {
  const template = createTemplateDraft('paper-standard', standardA3SheetTemplate)
  const field = defaultValueField(template)
  field.label = '初期値テスト'
  field.valueType = 'text'
  delete field.choices
  delete field.defaultValue
  let latestTemplate = template
  const onSaveTemplate = vi.fn(async (savedTemplate: SheetTemplate) => {
    void savedTemplate
    return { saved: true }
  })

  render(
    <TemplateWorkspace
      project={createDefaultProject()}
      template={template}
      onLoadTemplate={async () => null}
      onSaveTemplate={onSaveTemplate}
      onApplyTemplate={vi.fn()}
      onCreateTemplateDraft={(kind): SheetTemplate => createTemplateDraft(kind, standardA3SheetTemplate)}
      onUpdateCorrectionLayers={() => true}
      onDraftStateChange={state => { latestTemplate = state.template }}
    />,
  )
  const navigator = screen.getByRole('complementary', { name: 'テンプレート構成' })
  fireEvent.click(within(navigator).getByRole('button', { name: 'MEMO' }))

  return { currentTemplate: () => latestTemplate, onSaveTemplate }
}

function defaultValueField(template: SheetTemplate) {
  const field = template.fields?.find(candidate => candidate.fieldId === 'memo.body')
  if (!field) throw new Error('memo.body field not found')
  return field
}

function asFileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => index === 0 ? file : null,
  } as unknown as FileList
}

async function expectTooltipOn(target: Element | null, expectedText: string) {
  expect(target).toBeTruthy()
  fireEvent.pointerEnter(target!)
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip.textContent).toContain(expectedText)
  expect(target!.getAttribute('aria-describedby')).toBe(tooltip.id)
  fireEvent.pointerLeave(target!)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
}
