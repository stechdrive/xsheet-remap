import { createDefaultProject, standardA3SheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateWorkspace, type TemplateWorkspaceDraftState } from './TemplateWorkspace'
import { createTemplateDraft } from './templateDrafts'
import { uiText } from './i18n'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup() {
  const initial = createTemplateDraft('paper-standard', standardA3SheetTemplate)
  let state: TemplateWorkspaceDraftState = { template: initial, dirty: false }
  const props = {
    project: createDefaultProject(), template: initial, mode: 'standalone' as const,
    onLoadTemplate: async () => null,
    onSaveTemplate: vi.fn<(template: SheetTemplate) => Promise<{ saved: boolean }>>(async () => ({ saved: true })),
    onApplyTemplate: vi.fn(), onUpdateCorrectionLayers: () => true,
    onCreateTemplateDraft: () => initial,
    onDraftStateChange: (next: TemplateWorkspaceDraftState) => { state = next },
  }
  const view = render(<TemplateWorkspace {...props} />)
  const nameInput = () => {
    fireEvent.click(screen.getByRole('button', { name: '用紙と見た目' }))
    return screen.getByRole('textbox', { name: uiText.template.name })
  }
  return { ...view, initial, props, nameInput, latest: () => state }
}

describe('template history integration', () => {
  it('keeps a number edit and the following focus-preserving canvas drag in separate undo steps', () => {
    const s = setup()
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, s.initial.page.widthPx, s.initial.page.heightPx))
    const field = screen.getByLabelText('6秒タイムライン表 X mm')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '7' } })
    const afterNumber = s.latest().template
    expect(s.latest().history?.past).toHaveLength(1)
    fireEvent.pointerDown(s.container.querySelector('.templateMoveHandle')!, {
      pointerId: 9, pointerType: 'mouse', button: 0, clientX: 500, clientY: 500,
    })
    fireEvent.pointerUp(window, { pointerId: 9, pointerType: 'mouse', clientX: 510, clientY: 507 })
    expect(s.latest().history?.past).toHaveLength(2)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template).toEqual(afterNumber)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template).toEqual(s.initial)
  })

  it('undoes a whole focused text edit and keeps later focus sessions separate', () => {
    const s = setup(), field = s.nameInput()
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '日本語' } })
    fireEvent.change(field, { target: { value: '日本語テンプレート' } })
    expect(s.latest().history?.past).toHaveLength(1)
    fireEvent.blur(field)
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '次の編集' } })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template.name).toBe('日本語テンプレート')
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(s.latest().template.name).toBe(s.initial.name)
    expect(s.latest().dirty).toBe(false)
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    expect(s.latest().template.name).toBe('日本語テンプレート')
  })

  it('undoes added form fields together with their region and does not add view changes to history', () => {
    const s = setup()
    fireEvent.click(screen.getByLabelText('要素を追加'))
    fireEvent.click(screen.getByRole('button', { name: '入力表を追加' }))
    expect(s.latest().template.regions.length).toBe(s.initial.regions.length + 1)
    expect(s.latest().template.fields!.length).toBe((s.initial.fields?.length ?? 0) + 2)
    fireEvent.change(screen.getByRole('slider', { name: '下絵の不透明度' }), { target: { value: '20' } })
    expect(s.latest().history?.past).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template.regions).toEqual(s.initial.regions)
    expect(s.latest().template.fields).toEqual(s.initial.fields)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(s.latest().template.regions.length).toBe(s.initial.regions.length + 1)
  })

  it('retains undo after saving and returns to saved status on redo', async () => {
    const s = setup()
    fireEvent.change(s.nameInput(), { target: { value: '保存する名前' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' })) })
    expect(s.latest().dirty).toBe(false)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template.name).toBe(s.initial.name)
    expect(s.latest().dirty).toBe(true)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(s.latest().template.name).toBe('保存する名前')
    expect(s.latest().dirty).toBe(false)
  })

  it('keeps the newest edit when a save finishes later', async () => {
    const s = setup()
    let finish!: (value: { saved: boolean }) => void
    s.props.onSaveTemplate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const field = s.nameInput()
    fireEvent.change(field, { target: { value: '保存中' } })
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' }))
    fireEvent.change(field, { target: { value: '新しい編集' } })
    await act(async () => finish({ saved: true }))
    expect(s.latest().template.name).toBe('新しい編集')
    expect(s.latest().dirty).toBe(true)
  })

  it('owns template undo keys without affecting project history or IME composition', () => {
    const s = setup(), projectKey = vi.fn()
    window.addEventListener('keydown', projectKey)
    try {
      fireEvent.change(s.nameInput(), { target: { value: '変更' } })
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true, isComposing: true })
      expect(s.latest().template.name).toBe('変更')
      projectKey.mockClear()
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      expect(projectKey).not.toHaveBeenCalled()
      expect(s.latest().template.name).toBe(s.initial.name)
    } finally { window.removeEventListener('keydown', projectKey) }
  })

  it('retains undo when the applied project comes back as a normalized clone', () => {
    const s = setup()
    s.rerender(<TemplateWorkspace {...s.props} mode="project" />)
    fireEvent.change(s.nameInput(), { target: { value: '反映した名前' } })
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトへ反映' }))
    const applied = structuredClone(s.props.onApplyTemplate.mock.calls.at(-1)![0]) as SheetTemplate
    s.rerender(<TemplateWorkspace {...s.props} mode="project" template={applied} />)
    expect(s.latest().dirty).toBe(false)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(s.latest().template.name).toBe(s.initial.name)
    expect(s.latest().dirty).toBe(true)
  })
})
