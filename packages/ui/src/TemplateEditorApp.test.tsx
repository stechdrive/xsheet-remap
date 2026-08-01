import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditorApp } from './TemplateEditorApp'
import { uiText } from './i18n'

const adapterMocks = vi.hoisted(() => ({
  saveJsonFile: vi.fn(),
  confirmUserAction: vi.fn(),
}))
const imageMetadataMocks = vi.hoisted(() => ({
  readTemplateImageMetadata: vi.fn(),
}))

vi.mock('@xsheet-remap/adapters', async () => {
  const actual = await vi.importActual<typeof import('@xsheet-remap/adapters')>('@xsheet-remap/adapters')
  return {
    ...actual,
    saveJsonFile: adapterMocks.saveJsonFile,
    confirmUserAction: adapterMocks.confirmUserAction,
  }
})

vi.mock('./templateImageMetadata', async () => {
  const actual = await vi.importActual<typeof import('./templateImageMetadata')>('./templateImageMetadata')
  return { ...actual, readTemplateImageMetadata: imageMetadataMocks.readTemplateImageMetadata }
})

beforeEach(() => {
  adapterMocks.saveJsonFile.mockReset().mockResolvedValue({ saved: true, path: 'C:\\Templates\\sample.template.json' })
  adapterMocks.confirmUserAction.mockReset().mockResolvedValue(true)
  imageMetadataMocks.readTemplateImageMetadata.mockReset().mockResolvedValue(null)
})

afterEach(() => cleanup())

describe('TemplateEditorApp authoring workflow', () => {
  it('starts with four clear creation routes and no heavy editor canvas', () => {
    render(<TemplateEditorApp />)

    expect(screen.getByText('xsheet-template')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'A3標準を調整（おすすめ）' })).toBeTruthy()
    expect(screen.getByLabelText('参照画像から紙テンプレート')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'デジタルテンプレート' })).toBeTruthy()
    expect(screen.getByLabelText('既存JSONを開く')).toBeTruthy()
    expect(document.querySelector('.templateEditorSvg')).toBeNull()
  })

  it('opens A3 authoring with clear progress, region navigation, and split preview layers', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    expect(screen.getByText('未保存の変更')).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '領域一覧' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'テンプレート' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '選択領域' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '確認' })).toBeTruthy()
    expect(document.querySelector(`.templateEditorSvg[aria-label="${uiText.template.editorLabel}"]`)).toBeTruthy()
    const staticPreview = document.querySelector('.templateStaticPreviewSvg')
    const interactionOverlay = document.querySelector('.templateEditorSvg')
    expect(staticPreview).toBeTruthy()
    expect(interactionOverlay).toBeTruthy()
    expect(staticPreview).not.toBe(interactionOverlay)
    expect(staticPreview?.querySelector('.templateStaticLayer')).toBeTruthy()
    expect(interactionOverlay?.querySelector('.templateStaticLayer')).toBeNull()
    expect(document.querySelector('.sheetWorkspace')).toBeNull()
  })

  it('creates a paper template from physical page settings with 3200% authoring zoom', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    expect(screen.getByText('1754 × 2480px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())

    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.aspectRatio).toBe('1754 / 2480')
    const zoom = document.querySelector<HTMLInputElement>('.templateToolbar input[type="range"]')
    expect(zoom?.max).toBe('3200')
    fireEvent.click(screen.getByRole('button', { name: '3200%' }))
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.transform).toBe('scale(32)')
    expect(document.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${1754 * 32}px`)
    expect(document.querySelector('.templateEditorCanvas')?.classList.contains('showPixelGrid')).toBe(true)
  })

  it('creates a digital template with shared ACTION and CELL columns and no paper controls', () => {
    render(<TemplateEditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'デジタルテンプレート' }))

    expect(screen.getByText('1920 × 3600px / 連続キャンバス')).toBeTruthy()
    expect(screen.getByText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: uiText.template.detailTabs.reference })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '全領域' }))
    const actionColumnCount = screen.getByLabelText('ACTIONの共有セル列数') as HTMLInputElement
    const cellColumnCount = screen.getByLabelText('CELLの共有セル列数') as HTMLInputElement
    fireEvent.change(actionColumnCount, { target: { value: '4' } })
    expect(actionColumnCount.value).toBe('4')
    expect(cellColumnCount.value).toBe('4')
  })

  it('adds and manages a region from the compact menu and left navigator', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    const initialRegionCount = document.querySelectorAll('.templateRegionNavigatorItem').length
    fireEvent.click(screen.getByLabelText('領域を追加'))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.addDecorativeGridRegion }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 1)

    const added = screen.getByRole('button', { name: /補助罫線 \d+$/ })
    fireEvent.click(added)
    fireEvent.click(screen.getByRole('button', { name: /補助罫線 \d+の位置をロック/ }))
    fireEvent.click(screen.getByRole('tab', { name: '選択領域' }))
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /補助罫線 \d+を複製/ }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 2)
    fireEvent.click(screen.getByRole('button', { name: /補助罫線 \d+ コピーを削除/ }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 1)
  })

  it('duplicates the current edited draft without losing its changes', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: '作業用テンプレート' } })
    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    fireEvent.click(screen.getByRole('button', { name: '現在から複製' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())
    expect((screen.getByLabelText(uiText.template.name) as HTMLInputElement).value).toBe('作業用テンプレート コピー')
    expect(adapterMocks.confirmUserAction).not.toHaveBeenCalled()
  })

  it('validates, saves, marks clean, and protects later unsaved changes', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.click(screen.getByRole('button', { name: '確認して保存' }))
    await waitFor(() => expect(adapterMocks.saveJsonFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('保存済み')).toBeTruthy())

    const nameInput = screen.getByLabelText(uiText.template.name)
    fireEvent.change(nameInput, { target: { value: '保存後の変更' } })
    expect(screen.getByText('未保存の変更')).toBeTruthy()

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)

    adapterMocks.confirmUserAction.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '作り方へ戻る' }))
    await waitFor(() => expect(adapterMocks.confirmUserAction).toHaveBeenCalled())
    expect(document.querySelector('.templateWorkspace')).toBeTruthy()

    adapterMocks.confirmUserAction.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '作り方へ戻る' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeTruthy())
  })

  it('keeps late reference-image metadata dirty when it arrives after a save', async () => {
    let resolveMetadata: ((value: { width: number; height: number; ppiX: number; ppiY: number }) => void) | undefined
    imageMetadataMocks.readTemplateImageMetadata.mockReturnValueOnce(new Promise(resolve => { resolveMetadata = resolve }))
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.click(screen.getByRole('button', { name: '確認して保存' }))
    await waitFor(() => expect(screen.getByText('保存済み')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.reference }))
    const imageInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')
    expect(imageInput).toBeTruthy()
    fireEvent.change(imageInput!, { target: { files: [new File(['image'], 'late-reference.png', { type: 'image/png' })] } })

    await waitFor(() => expect(screen.getByText('late-reference.png')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '確認して保存' }))
    await waitFor(() => expect(adapterMocks.saveJsonFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('保存済み')).toBeTruthy())

    resolveMetadata?.({ width: 123, height: 456, ppiX: 150, ppiY: 150 })
    await waitFor(() => expect(screen.getByText('123 × 456px')).toBeTruthy())
    expect(screen.getByText('未保存の変更')).toBeTruthy()
  })

  it('ignores stale metadata from a reference image that has already been replaced', async () => {
    let resolveFirst: ((value: { width: number; height: number; ppiX: number; ppiY: number }) => void) | undefined
    let resolveSecond: ((value: { width: number; height: number; ppiX: number; ppiY: number }) => void) | undefined
    imageMetadataMocks.readTemplateImageMetadata
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
    render(<TemplateEditorApp />)
    startA3Authoring()
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.reference }))
    const imageInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!

    fireEvent.change(imageInput, { target: { files: [new File(['first'], 'first.png', { type: 'image/png', lastModified: 1 })] } })
    await waitFor(() => expect(screen.getByText('first.png')).toBeTruthy())
    fireEvent.change(imageInput, { target: { files: [new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 })] } })
    await waitFor(() => expect(screen.getByText('second.png')).toBeTruthy())

    resolveSecond?.({ width: 222, height: 333, ppiX: 150, ppiY: 150 })
    await waitFor(() => expect(screen.getByText('222 × 333px')).toBeTruthy())
    resolveFirst?.({ width: 111, height: 111, ppiX: 72, ppiY: 72 })
    await waitFor(() => expect(screen.queryByText('111 × 111px')).toBeNull())
    expect(screen.getByText('222 × 333px')).toBeTruthy()
  })

  it('does not discard edits made while a save dialog is still pending', async () => {
    let finishSave: ((result: { saved: boolean; path?: string }) => void) | undefined
    adapterMocks.saveJsonFile.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve }))
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.click(screen.getByRole('button', { name: '確認して保存' }))
    await waitFor(() => expect(adapterMocks.saveJsonFile).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: '保存処理中の変更' } })
    finishSave?.({ saved: true, path: 'C:\\Templates\\pending.template.json' })

    await waitFor(() => expect(screen.getByText(/保存後に変更があります/)).toBeTruthy())
    expect((screen.getByLabelText(uiText.template.name) as HTMLInputElement).value).toBe('保存処理中の変更')
    expect(screen.getByText('未保存の変更')).toBeTruthy()
  })

  it('opens the chapter-based help from both start and authoring views', () => {
    render(<TemplateEditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))
    expect(screen.getByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '完成までの手順' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeNull()
  })
})

function startA3Authoring() {
  fireEvent.click(screen.getByRole('button', { name: 'A3標準を調整（おすすめ）' }))
}
