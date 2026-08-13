import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createAlphabeticTrackLabels, digitalStandardSheetTemplate, resolveSheetTemplatePageSize } from '@xsheet-remap/core'
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
    const sectionNavigation = screen.getByRole('navigation', { name: '編集する内容' })
    expect(within(sectionNavigation).getByRole('button', { name: '基本設定' }).getAttribute('aria-current')).toBe('page')
    expect(within(sectionNavigation).getByRole('button', { name: '領域' })).toBeTruthy()
    expect(within(sectionNavigation).getByRole('button', { name: '見た目' })).toBeTruthy()
    expect(within(sectionNavigation).getByRole('button', { name: '確認・保存' })).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.cutNumberPrefix)).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.pageFormat)).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.widthPx)).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.heightPx)).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.dpi)).toBeTruthy()
    expect(screen.getByLabelText(uiText.template.physicalPage)).toBeTruthy()
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
    fireEvent.change(screen.getByRole('combobox', { name: 'ズーム倍率' }), { target: { value: '3200' } })
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.transform).toBe('scale(32)')
    expect(document.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${1754 * 32}px`)
    expect(document.querySelector('.templateEditorCanvas')?.classList.contains('showPixelGrid')).toBe(true)
  })

  it('creates a digital template with shared ACTION and CELL columns and no paper controls', async () => {
    render(<TemplateEditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'デジタルテンプレート' }))

    expect(screen.getByText('現在の表示キャンバス')).toBeTruthy()
    expect(screen.getAllByText('1920 × 3600px')).toHaveLength(2)
    expect(screen.getByText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(screen.getByLabelText('FPS')).toBeTruthy()
    expect(screen.getByLabelText('初期フレーム数')).toBeTruthy()
    expect(screen.getByLabelText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: '編集する内容' })).queryByRole('button', { name: uiText.template.detailTabs.reference })).toBeNull()

    selectInspectorSection('table')
    expect(screen.getByRole('region', { name: 'すべての領域' })).toBeTruthy()
    expect(document.querySelector('.bindingTable')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ACTIONを編集' }))
    const actionColumnCount = screen.getByLabelText('ACTIONの共有セル列数') as HTMLInputElement
    fireEvent.change(actionColumnCount, { target: { value: '22' } })
    expect(actionColumnCount.value).toBe('22')
    fireEvent.click(screen.getByRole('button', { name: 'CELL' }))
    const cellColumnCount = screen.getByLabelText('CELLの共有セル列数') as HTMLInputElement
    expect(cellColumnCount.value).toBe('22')

    const tracks = createAlphabeticTrackLabels(22)
    const expectedPage = resolveSheetTemplatePageSize(
      { ...digitalStandardSheetTemplate, defaults: { ...digitalStandardSheetTemplate.defaults, paperTracks: tracks } },
      digitalStandardSheetTemplate.defaults.durationFrames,
      { paperTracks: tracks },
    )
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.width).toBe(`${expectedPage.widthPx}px`)
    expect(Array.from(document.querySelectorAll('.templateColumnText')).some(element => element.textContent === 'V')).toBe(true)
    await waitFor(() => expect(document.querySelector('.statusIssueSummary')?.textContent).toBe(`${expectedPage.widthPx} x ${expectedPage.heightPx}px`))

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420)
    fireEvent.click(screen.getByRole('button', { name: '全体表示' }))
    const fittedZoom = Number.parseFloat(document.querySelector<HTMLElement>('.templateEditorCanvas')!.style.transform.match(/scale\(([^)]+)\)/)![1]!)
    expect(fittedZoom).toBeCloseTo(Math.min((600 - 24) / expectedPage.widthPx, (420 - 24) / expectedPage.heightPx))
  })

  it('opens a region from the collection, keeps management and printed names independent, and returns to the collection', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()
    selectInspectorSection('table')
    fireEvent.click(within(screen.getByRole('region', { name: 'すべての領域' })).getByRole('button', { name: 'カット情報見出しを編集' }))

    expect(screen.getAllByRole('heading', { name: 'カット情報見出し' })).toHaveLength(2)
    const managementName = screen.getByLabelText('カット情報見出しの編集画面での名前') as HTMLInputElement
    const printedTitle = screen.getByLabelText('TITLEの表示文字') as HTMLInputElement
    fireEvent.change(managementName, { target: { value: '上部のカット欄' } })
    expect(printedTitle.value).toBe('TITLE')
    fireEvent.change(printedTitle, { target: { value: '作品名' } })
    expect((screen.getByLabelText('上部のカット欄の編集画面での名前') as HTMLInputElement).value).toBe('上部のカット欄')

    fireEvent.click(screen.getByText('詳細設定'))
    expect((screen.getByLabelText('機能上の領域ラベル') as HTMLInputElement).value).toBe('カット情報見出し')
    fireEvent.click(screen.getByRole('button', { name: '← 領域一覧へ' }))

    const collection = screen.getByRole('region', { name: 'すべての領域' })
    expect(within(collection).getByRole('button', { name: '上部のカット欄を編集' }).textContent).toContain('シート上の表示文字: 作品名 / NO. / CUT')

    fireEvent.click(within(collection).getByRole('button', { name: 'タイトルを編集' }))
    const titleX = screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement
    const titleFont = screen.getByLabelText('文字 pt') as HTMLInputElement
    fireEvent.change(titleX, { target: { value: '120' } })
    fireEvent.change(titleFont, { target: { value: '18' } })
    expect(titleX.value).toBe('120')
    expect(titleFont.value).toBe('18')
  })

  it('keeps grid frame start, row count, end frame, and per-region header synchronized', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()
    selectInspectorSection('table')
    fireEvent.click(within(screen.getByRole('region', { name: 'すべての領域' })).getByRole('button', { name: 'ACTION 1-72を編集' }))

    const frameStart = screen.getByLabelText(`ACTION 1-72の${uiText.template.headers.frameStart}`) as HTMLInputElement
    const rows = screen.getByLabelText(`ACTION 1-72の${uiText.template.headers.rows}`) as HTMLInputElement
    const header = screen.getByLabelText('ACTION 1-72の見出し文字') as HTMLInputElement
    fireEvent.change(frameStart, { target: { value: '10' } })
    fireEvent.change(rows, { target: { value: '12' } })
    fireEvent.change(header, { target: { value: '第一原画' } })
    expect(frameStart.value).toBe('10')
    expect(rows.value).toBe('12')
    expect(screen.getByText('終了F: 21')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toContain('第一原画')

    selectInspectorSection('json')
    const json = JSON.parse((document.querySelector('.jsonPreview') as HTMLTextAreaElement).value)
    const action = json.regions.find((region: { regionId: string }) => region.regionId === 'left_action_grid')
    expect(action.grid).toMatchObject({ frameStart: 10, rowCount: 12, frameEnd: 21, header: { label: '第一原画' } })
  })

  it('adds and manages a region from the compact menu and left navigator', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    const initialRegionCount = document.querySelectorAll('.templateRegionNavigatorItem').length
    fireEvent.click(screen.getByLabelText('領域を追加'))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.addDecorativeGridRegion }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 1)

    let added = screen.getByRole('button', { name: /補助罫線 \d+$/ })
    const addedName = added.getAttribute('aria-label')!
    selectInspectorSection('json')
    const jsonBeforeViewOnlyChanges = (document.querySelector('.jsonPreview') as HTMLTextAreaElement).value
    added = screen.getByRole('button', { name: addedName })
    fireEvent.click(added)
    fireEvent.click(screen.getByRole('button', { name: /補助罫線 \d+を編集画面で非表示/ }))
    fireEvent.click(screen.getByRole('button', { name: /補助罫線 \d+の位置を一時的に固定/ }))
    const selectedState = document.querySelector('.templateRegionNavigatorItem.selected .templateRegionNavigatorState')
    expect(selectedState?.textContent).toContain('編集時非表示')
    expect(selectedState?.textContent).toContain('一時固定')
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement).disabled).toBe(true)
    selectInspectorSection('json')
    expect((document.querySelector('.jsonPreview') as HTMLTextAreaElement).value).toBe(jsonBeforeViewOnlyChanges)
    fireEvent.click(screen.getByRole('button', { name: addedName }))
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
    selectInspectorSection('reference')
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
    selectInspectorSection('reference')
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

  it('opens the quick guide first and switches to the chapter-based help', async () => {
    render(<TemplateEditorApp />)
    const helpButton = screen.getByRole('button', { name: 'ヘルプ' })
    const tooltipTrigger = helpButton.closest<HTMLElement>('.appTooltipTrigger')
    expect(tooltipTrigger).toBeTruthy()
    expect(helpButton.hasAttribute('title')).toBe(false)
    fireEvent.pointerEnter(tooltipTrigger!)
    expect((await screen.findByRole('tooltip')).textContent).toContain('xsheet-templateの使い方を開く')
    fireEvent.pointerLeave(tooltipTrigger!)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())

    fireEvent.click(helpButton)
    expect(screen.getByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeTruthy()
    const quickTab = screen.getByRole('tab', { name: 'クイックガイド' })
    const detailedTab = screen.getByRole('tab', { name: '詳しい使い方' })
    expect(quickTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '最短でテンプレートを完成させる' })).toBeTruthy()
    expect(screen.getByText(/保存したJSONをEditorまたはRemapで読み込み/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '作り方を選ぶ' })).toBeNull()

    fireEvent.click(detailedTab)
    expect(detailedTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '作り方を選ぶ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /補助罫線と表示設定/ }))
    expect(screen.getByRole('heading', { name: '用紙全体の配色' })).toBeTruthy()
    expect(screen.getByText(/奇数列と偶数列の背景、線、文字/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeNull()

    startA3Authoring()
    expect(document.querySelector('[title]')).toBeNull()
  })
})

function startA3Authoring() {
  fireEvent.click(screen.getByRole('button', { name: 'A3標準を調整（おすすめ）' }))
}

function selectInspectorSection(sectionId: string) {
  if (sectionId === 'region') {
    const selectedRegion = document.querySelector<HTMLButtonElement>('.templateRegionNavigatorSelect[aria-pressed="true"]')
    if (!selectedRegion) throw new Error('selected template region not found')
    fireEvent.click(selectedRegion)
    return
  }
  const labels: Record<string, string> = {
    template: '基本設定',
    table: '領域',
    display: '見た目',
    reference: '参照画像',
    review: '確認・保存',
    json: 'JSON',
  }
  const label = labels[sectionId]
  if (!label) throw new Error(`unknown template inspector section: ${sectionId}`)
  const navigation = screen.getByRole('navigation', { name: '編集する内容' })
  fireEvent.click(within(navigation).getByRole('button', { name: label }))
}
