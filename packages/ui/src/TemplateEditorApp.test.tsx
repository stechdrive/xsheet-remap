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
    expect(screen.getByRole('button', { name: '標準用紙を調整（おすすめ）' })).toBeTruthy()
    expect(screen.getByLabelText('用紙画像から作成')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'デジタルシートを作成' })).toBeTruthy()
    expect(screen.getByLabelText('既存JSONを開く')).toBeTruthy()
    expect(document.querySelector('.templateEditorSvg')).toBeNull()
  })

  it('opens A3 authoring with clear progress, region navigation, and split preview layers', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    expect(screen.getByText('未保存の変更')).toBeTruthy()
    const structure = screen.getByRole('complementary', { name: 'テンプレート構成' })
    expect(within(structure).getByRole('button', { name: '6秒タイムライン表', pressed: true })).toBeTruthy()
    expect(within(structure).getByRole('button', { name: '用紙と見た目' })).toBeTruthy()
    expect(within(structure).getByRole('button', { name: '下絵' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^確認 / })).toBeNull()
    openDocumentMenu()
    expect(screen.getByRole('button', { name: '検証結果を表示' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
    expect(screen.getAllByRole('heading', { name: '6秒タイムライン表' })).toHaveLength(2)
    expect(screen.getByLabelText('固定された時間構成').textContent).toContain('72行 × 2ブロック')
    selectInspectorSection('template')
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
    const referenceOpacity = screen.getByRole('slider', { name: '下絵の不透明度' }) as HTMLInputElement
    expect(referenceOpacity.value).toBe('80')
    const referenceLayer = staticPreview?.querySelector<SVGGElement>('.templateReferenceImageLayer')
    expect(referenceLayer?.getAttribute('data-tint-color')).toBe('#ff1f12')
    expect(referenceLayer?.getAttribute('filter')).toMatch(/^url\(#templateReferenceTint-/)
    const tintFilter = staticPreview?.querySelector('filter[id^="templateReferenceTint-"]')
    expect(tintFilter?.querySelector('feFuncR')?.getAttribute('tableValues')).toBe('1 1 1')
    expect(tintFilter?.querySelector('feFuncG')?.getAttribute('tableValues')).toBe('0.122 0.54 0.96')
    expect(tintFilter?.querySelector('feFuncB')?.getAttribute('tableValues')).toBe('0.071 0.45 0.95')
    fireEvent.change(referenceOpacity, { target: { value: '35' } })
    expect(referenceLayer?.getAttribute('opacity')).toBe('0.35')
    expect(document.querySelector('.sheetWorkspace')).toBeNull()
  })

  it('nudges paper role widths without rounded millimeter stalls and shows their limits', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    const sharedColumns = screen.getByLabelText('ACTION / CELL共有の列数')
    fireEvent.change(sharedColumns, { target: { value: '5' } })
    expect(screen.getAllByText(/最小 12\.5mm/)).toHaveLength(2)

    const cellWidth = screen.getByLabelText('CELL幅 mm') as HTMLInputElement
    const decrease = screen.getByRole('button', { name: 'CELL幅を狭くする' })
    expect(cellWidth.value).toBe('43.4')
    fireEvent.click(decrease)
    expect(cellWidth.value).toBe('43.2')
    fireEvent.click(decrease)
    expect(cellWidth.value).toBe('43')
    fireEvent.click(decrease)
    expect(cellWidth.value).toBe('42.8')
    fireEvent.keyDown(cellWidth, { key: 'ArrowDown' })
    expect(cellWidth.value).toBe('42.7')

    const cameraWidth = screen.getByLabelText('CAMERA幅 mm') as HTMLInputElement
    const cameraBefore = Number(cameraWidth.value)
    const cellBeforeCameraChange = Number(cellWidth.value)
    expect(cameraWidth.tagName).toBe('INPUT')
    fireEvent.click(screen.getByRole('button', { name: 'CAMERA幅を広くする' }))
    expect(Number(cameraWidth.value)).toBeGreaterThan(cameraBefore)
    expect(Number(cellWidth.value)).toBeLessThan(cellBeforeCameraChange)
    fireEvent.click(screen.getByRole('button', { name: 'CAMERA幅を狭くする' }))
    expect(Number(cameraWidth.value)).toBeLessThanOrEqual(cameraBefore)
  })

  it('keeps 3200% pixel authoring available without compressing it into the slider scale', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    openDocumentMenu()
    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    expect(screen.getByText('1754 × 2480px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())

    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.aspectRatio).toBe('1754 / 2480')
    const zoom = screen.getByRole('slider', { name: uiText.sheet.zoom }) as HTMLInputElement
    expect(zoom?.min).toBe('0')
    expect(zoom?.max).toBe('1000')
    expect(zoom?.getAttribute('aria-valuetext')).toBe('100%')
    fireEvent.change(screen.getByRole('combobox', { name: 'ズーム倍率' }), { target: { value: '3200' } })
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.transform).toBe('scale(32)')
    expect(document.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${1754 * 32}px`)
    expect(document.querySelector('.templateEditorCanvas')?.classList.contains('showPixelGrid')).toBe(true)
  })

  it('creates a digital template with shared ACTION and CELL columns and no paper controls', async () => {
    render(<TemplateEditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'デジタルシートを作成' }))

    expect(screen.getByText('現在の表示キャンバス')).toBeTruthy()
    expect(screen.getAllByText('1920 × 3600px')).toHaveLength(2)
    expect(screen.getByText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(screen.getByLabelText('FPS')).toBeTruthy()
    expect(screen.getByLabelText('初期フレーム数')).toBeTruthy()
    expect(screen.getByLabelText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(within(screen.getByRole('complementary', { name: 'テンプレート構成' })).queryByRole('button', { name: '下絵' })).toBeNull()
    expect(screen.queryByRole('slider', { name: '下絵の不透明度' })).toBeNull()

    expect(document.querySelector('.bindingTable')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ACTION' }))
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

  it('opens regions from the structure list and keeps management and printed names independent', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()
    fireEvent.click(screen.getByRole('button', { name: 'カット情報見出し' }))

    expect(screen.getAllByRole('heading', { name: 'カット情報見出し' })).toHaveLength(2)
    const managementName = screen.getByLabelText('カット情報見出しの編集画面での名前') as HTMLInputElement
    const printedTitle = screen.getByLabelText('TITLEの表示文字') as HTMLInputElement
    fireEvent.change(managementName, { target: { value: '上部のカット欄' } })
    expect(printedTitle.value).toBe('TITLE')
    fireEvent.change(printedTitle, { target: { value: '作品名' } })
    expect((screen.getByLabelText('上部のカット欄の編集画面での名前') as HTMLInputElement).value).toBe('上部のカット欄')

    fireEvent.click(screen.getByText('詳細設定'))
    expect((screen.getByLabelText('機能上の領域ラベル') as HTMLInputElement).value).toBe('カット情報見出し')
    expect(screen.getByRole('button', { name: '上部のカット欄' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'タイトル' }))
    const titleX = screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement
    const titleFont = screen.getByLabelText('文字 pt') as HTMLInputElement
    fireEvent.change(titleX, { target: { value: '120' } })
    fireEvent.change(titleFont, { target: { value: '18' } })
    expect(titleX.value).toBe('120')
    expect(titleFont.value).toBe('18')
  })

  it('keeps paper rows fixed and changes paired columns from the paper layout', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()
    expect(screen.getByRole('button', { name: '6秒タイムライン表', pressed: true })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '6秒タイムライン表の操作' })).toBeNull()
    expect(screen.queryByLabelText(/ACTION 1-72の開始F/)).toBeNull()
    expect(screen.queryByLabelText(/ACTION 1-72の行数/)).toBeNull()
    const sharedColumns = screen.getByLabelText('ACTION / CELL共有の列数') as HTMLInputElement
    fireEvent.change(sharedColumns, { target: { value: '12' } })
    expect(sharedColumns.value).toBe('12')
    const tableHeight = screen.getByLabelText('6秒タイムライン表 高さ mm') as HTMLInputElement
    fireEvent.change(tableHeight, { target: { value: String(Number(tableHeight.value) + 10) } })

    selectInspectorSection('json')
    const json = JSON.parse((document.querySelector('.jsonPreview') as HTMLTextAreaElement).value)
    const rowRects = new Set<string>()
    for (const regionId of ['left_action_grid', 'right_action_grid', 'left_cell_grid', 'right_cell_grid']) {
      const region = json.regions.find((candidate: { regionId: string }) => candidate.regionId === regionId)
      const grid = region.grid
      expect(grid.columns).toHaveLength(12)
      expect(grid.rowCount).toBe(72)
      rowRects.add(`${region.rect.y}:${region.rect.h}`)
    }
    for (const regionId of ['left_sound_grid', 'right_sound_grid', 'left_camera_grid', 'right_camera_grid']) {
      const region = json.regions.find((candidate: { regionId: string }) => candidate.regionId === regionId)
      rowRects.add(`${region.rect.y}:${region.rect.h}`)
    }
    expect(rowRects.size).toBe(1)
  })

  it('adds and manages a region from the compact menu and left navigator', () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    const initialRegionCount = document.querySelectorAll('.templateRegionNavigatorItem').length
    fireEvent.click(screen.getByLabelText('要素を追加'))
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
    fireEvent.click(screen.getByLabelText(new RegExp(`${addedName}のその他の操作`)))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${addedName}を複製`) }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 2)
    const copyName = screen.getByRole('button', { name: /補助罫線 \d+ コピー$/ }).getAttribute('aria-label')!
    fireEvent.click(screen.getByLabelText(new RegExp(`${copyName}のその他の操作`)))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${copyName}を削除`) }))
    expect(document.querySelectorAll('.templateRegionNavigatorItem')).toHaveLength(initialRegionCount + 1)
  })

  it('duplicates the current edited draft without losing its changes', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()
    selectInspectorSection('template')

    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: '作業用テンプレート' } })
    openDocumentMenu()
    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    fireEvent.click(screen.getByRole('button', { name: '現在から複製' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())
    selectInspectorSection('template')
    expect((screen.getByLabelText(uiText.template.name) as HTMLInputElement).value).toBe('作業用テンプレート コピー')
    expect(adapterMocks.confirmUserAction).not.toHaveBeenCalled()
  })

  it('validates, saves, marks clean, and protects later unsaved changes', async () => {
    render(<TemplateEditorApp />)
    startA3Authoring()

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' }))
    await waitFor(() => expect(adapterMocks.saveJsonFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('保存済み')).toBeTruthy())

    selectInspectorSection('template')
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

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' }))
    await waitFor(() => expect(screen.getByText('保存済み')).toBeTruthy())
    selectInspectorSection('reference')
    const imageInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')
    expect(imageInput).toBeTruthy()
    fireEvent.change(imageInput!, { target: { files: [new File(['image'], 'late-reference.png', { type: 'image/png' })] } })

    await waitFor(() => expect(screen.getAllByText('late-reference.png')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' }))
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
    await waitFor(() => expect(screen.getAllByText('first.png')).toHaveLength(2))
    fireEvent.change(imageInput, { target: { files: [new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 })] } })
    await waitFor(() => expect(screen.getAllByText('second.png')).toHaveLength(2))

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

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを保存' }))
    await waitFor(() => expect(adapterMocks.saveJsonFile).toHaveBeenCalledTimes(1))
    selectInspectorSection('template')
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
  fireEvent.click(screen.getByRole('button', { name: '標準用紙を調整（おすすめ）' }))
}

function selectInspectorSection(sectionId: string) {
  if (sectionId === 'region') {
    const selectedRegion = document.querySelector<HTMLButtonElement>('.templateRegionNavigatorSelect[aria-pressed="true"]')
    if (!selectedRegion) throw new Error('selected template region not found')
    fireEvent.click(selectedRegion)
    return
  }
  const labels: Record<string, string> = {
    template: '用紙と見た目',
    display: '用紙と見た目',
    reference: '下絵',
  }
  if (sectionId === 'review') {
    openDocumentMenu()
    fireEvent.click(screen.getByRole('button', { name: '検証結果を表示' }))
    return
  }
  if (sectionId === 'json') {
    openDocumentMenu()
    fireEvent.click(screen.getByRole('button', { name: 'JSONを表示' }))
    return
  }
  const label = labels[sectionId]
  if (!label) throw new Error(`unknown template inspector section: ${sectionId}`)
  const structure = screen.getByRole('complementary', { name: 'テンプレート構成' })
  const button = within(structure).queryByRole('button', { name: label })
    ?? (sectionId === 'template' ? within(structure).queryByRole('button', { name: 'テンプレートと見た目' }) : null)
  if (!button) throw new Error(`template inspector section not found: ${label}`)
  fireEvent.click(button)
}

function openDocumentMenu() {
  fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
}
