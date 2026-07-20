import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TemplateEditorApp } from './TemplateEditorApp'
import { uiText } from './i18n'

afterEach(() => cleanup())

describe('TemplateEditorApp', () => {
  it('mounts template authoring without the project sheet workspace', () => {
    render(<TemplateEditorApp />)

    expect(screen.getByText('xsheet-template')).toBeTruthy()
    expect(screen.getByText(uiText.actions.loadTemplateJson)).toBeTruthy()
    expect(screen.getByRole('button', { name: uiText.actions.downloadTemplateJson })).toBeTruthy()
    expect(document.querySelector(`.templateEditorSvg[aria-label="${uiText.template.editorLabel}"]`)).toBeTruthy()
    const staticPreview = document.querySelector('.templateStaticPreviewSvg')
    const interactionOverlay = document.querySelector('.templateEditorSvg')
    expect(staticPreview).toBeTruthy()
    expect(interactionOverlay).toBeTruthy()
    expect(staticPreview).not.toBe(interactionOverlay)
    expect(staticPreview?.querySelector('.templateStaticLayer')).toBeTruthy()
    expect(interactionOverlay?.querySelector('.templateStaticLayer')).toBeNull()
    expect(document.querySelector('.templateWorkspace')).toBeTruthy()
    expect(document.querySelector('.sheetWorkspace')).toBeNull()
  })

  it('creates a paper template from physical page settings with 3200% authoring zoom', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    expect(screen.getByText('1754 × 2480px')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.aspectRatio).toBe('1754 / 2480')
    const zoom = document.querySelector<HTMLInputElement>('.templateToolbar input[type="range"]')
    expect(zoom).toBeTruthy()
    expect(zoom?.max).toBe('3200')
    fireEvent.click(screen.getByRole('button', { name: '3200%' }))
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.transform).toBe('scale(32)')
    expect(document.querySelector<HTMLElement>('.templateEditorCanvas')?.style.width).toBe('1754px')
    expect(document.querySelector<HTMLElement>('.templateEditorZoomSurface')?.style.width).toBe(`${1754 * 32}px`)
    expect(document.querySelector('.templateEditorCanvas')?.classList.contains('showPixelGrid')).toBe(true)
    expect(document.querySelector<HTMLElement>('.templateDomEdgeGuide.vertical')?.style.width).toBe(`${18 / 32}px`)
    expect(document.querySelector<HTMLElement>('.templateEdgeGuides')?.style.getPropertyValue('--template-guide-line-width')).toBe(`${1.25 / 32}px`)
    expect(document.querySelector('.templateHandleSvg')).toBeTruthy()
  })

  it('creates a digital template with shared ACTION and CELL columns and without paper reference controls', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
    fireEvent.click(screen.getByRole('tab', { name: 'デジタルタイムシート' }))
    fireEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(screen.getByText('1920 × 3600px / 連続キャンバス')).toBeTruthy()
    expect(screen.getByText('セル列数（ACTION/CELL共通）')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: uiText.template.detailTabs.reference })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.table }))
    const actionColumnCount = screen.getByLabelText('ACTIONの共有セル列数') as HTMLInputElement
    const cellColumnCount = screen.getByLabelText('CELLの共有セル列数') as HTMLInputElement
    expect(actionColumnCount.value).toBe('9')
    expect(cellColumnCount.value).toBe('9')

    fireEvent.change(actionColumnCount, { target: { value: '4' } })
    expect(actionColumnCount.value).toBe('4')
    expect(cellColumnCount.value).toBe('4')

    fireEvent.change(cellColumnCount, { target: { value: '6' } })
    expect(actionColumnCount.value).toBe('6')
    expect(cellColumnCount.value).toBe('6')
  })

  it('edits shared SOUND and CAMERA initial names separately from their visibility', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.display }))
    const soundVisible = screen.getByLabelText('SOUND列名を表示') as HTMLInputElement
    const cameraVisible = screen.getByLabelText('CAMERA列名を表示') as HTMLInputElement
    expect(soundVisible.checked).toBe(false)
    expect(cameraVisible.checked).toBe(false)

    const soundName = screen.getByLabelText('SOUND初期列名1') as HTMLInputElement
    const cameraName = screen.getByLabelText('CAMERA初期列名1') as HTMLInputElement
    expect(soundName.value).toBe('S1')
    expect(cameraName.value).toBe('1')

    fireEvent.change(soundName, { target: { value: '台詞' } })
    fireEvent.click(soundVisible)
    expect(Array.from(document.querySelectorAll('.templateColumnText')).filter(element => element.textContent === '台詞')).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.table }))
    const firstSoundCount = screen.getByLabelText('SOUND 1-72の列数') as HTMLInputElement
    const secondSoundCount = screen.getByLabelText('SOUND 73-144の列数') as HTMLInputElement
    fireEvent.change(firstSoundCount, { target: { value: '5' } })
    expect(firstSoundCount.value).toBe('5')
    expect(secondSoundCount.value).toBe('5')

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.display }))
    expect((screen.getByLabelText('SOUND初期列名5') as HTMLInputElement).value).toBe('S5')
  })

  it('deletes individual regions from both the overview and region table as draft changes', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.table }))
    const initialRegionCount = document.querySelectorAll('.bindingTable tbody tr').length
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.addDecorativeGridRegion }))
    expect(document.querySelectorAll('.bindingTable tbody tr')).toHaveLength(initialRegionCount + 1)
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.region }))
    fireEvent.click(screen.getByRole('button', { name: uiText.template.deleteSelectedRegion }))
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.table }))
    expect(document.querySelectorAll('.bindingTable tbody tr')).toHaveLength(initialRegionCount)

    fireEvent.click(screen.getByRole('button', { name: '入力表を追加' }))
    const addedFormDeleteButton = screen.getByRole('button', { name: /「入力表 \d+」を削除/ })
    fireEvent.click(addedFormDeleteButton)

    expect(screen.queryByRole('button', { name: /「入力表 \d+」を削除/ })).toBeNull()
    expect(document.querySelectorAll('.bindingTable tbody tr')).toHaveLength(initialRegionCount)
    expect((screen.getByRole('button', { name: uiText.template.cancelDraft }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens the chapter-based template authoring help from the app header', () => {
    render(<TemplateEditorApp />)

    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    expect(screen.getByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '完成までの手順' })).toBeTruthy()
    expect(screen.getByText('上から順番に進める')).toBeTruthy()
    expect(screen.getByText('用途を決める')).toBeTruthy()
    expect(screen.getByText('適用・保存・実機確認')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '06ACTION・SOUND・CELL・CAMERA' }))
    expect(screen.getByText(/原画工程でタイミング指示を記入する欄です。CELLと同じ論理セル列/)).toBeTruthy()
    expect(screen.getByText(/動画工程で動画番号とタイミングを記入する欄です。ACTIONと同じ論理セル列/)).toBeTruthy()
    expect(screen.getByText(/実際のプロジェクトではEditor・Remapの列見出しを右クリック/)).toBeTruthy()
    expect(screen.getByText(/デジタルは予備列を確保せず/)).toBeTruthy()
    expect(screen.queryByText(/期間/)).toBeNull()
    expect(screen.queryByText(/カウンター/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '08参照画像と補正基準枠' }))
    expect(screen.getByRole('heading', { name: '参照画像と補正基準枠' })).toBeTruthy()
    expect(screen.getByText('グリッド外接に合わせる', { selector: '.templateHelpChapter dt' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'xsheet-templateの使い方' })).toBeNull()
  })
})
