import { describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { standardA3SheetTemplate } from '@xsheet-remap/core';
import { App } from './App';
import { uiText } from './i18n';
import { defaultCalibrationPoints } from './sheetImages';
import { clickActiveStackGuideInsertHandle, clickSheet, dragInternalPointer, dragStackGuideSvgLabel, enterTimingValue, expectSelectedHit, findAssetCardByName, getAssetCardByName, getSheetOpacitySlider, getZoomSlider, levelCorrectionFilterTableValues, mockDirectoryEntry, mockFileEntry, mockFileTransferItem, openAppNavigationMenu, openStackGuideInsertMenu, openTimingExportDialog, registeredCellIdentityText, setSheetRect, sheetImageHrefs, switchSharedCutByLabel, templateFramePoint, templateStackGuideHeaderPoint } from './App.test-support'

describe('App: viewport and assets', () => {
it('zooms the sheet with Ctrl+wheel and viewport controls', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement
    const zoom = getZoomSlider()
    expect(sheet.style.width).toBe('1754px')
    expect(zoom.max).toBe('300')

    fireEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 200 })
    expect(sheet.style.width).toBe('1754px')

    fireEvent.wheel(viewport, { deltaY: -120, ctrlKey: true, clientX: 200, clientY: 200 })
    expect(Number.parseFloat(sheet.style.width)).toBeGreaterThan(1754)

    fireEvent.change(zoom, { target: { value: '500' } })
    expect(sheet.style.width).toBe('5262px')
    expect(document.querySelector('.sheetZoomFloatingPalette')?.textContent).toContain('300%')

    fireEvent.click(screen.getByRole('button', { name: uiText.actions.zoomReset }))
    expect(sheet.style.width).toBe('1754px')

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 420 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 640 })
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.zoomFit }))
    expect(Number.parseFloat(sheet.style.width)).toBeLessThan(1754)
  })

it('fits the initial sheet zoom to the central viewport while keeping 100% as source pixels', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sheetViewport') ? 920 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sheetViewport') ? 2000 : 0
      },
    })
    try {
      render(<App />)
      const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
      await waitFor(() => expect(sheet.style.width).toBe('896px'))
      expect(document.querySelector('.sheetZoomFloatingPalette')?.textContent).toContain('51%')

      fireEvent.click(screen.getByRole('button', { name: uiText.actions.zoomReset }))
      expect(sheet.style.width).toBe('1754px')
      expect(document.querySelector('.sheetZoomFloatingPalette')?.textContent).toContain('100%')
    } finally {
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
    }
  })

it('syncs the auto-fit sheet zoom with viewport size down to a readable minimum without overriding manual zoom', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    let viewportWidth = 920
    let viewportHeight = 2000
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sheetViewport') ? viewportWidth : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sheetViewport') ? viewportHeight : 0
      },
    })
    try {
      render(<App />)
      const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
      await waitFor(() => expect(sheet.style.width).toBe('896px'))

      viewportWidth = 1224
      fireEvent.resize(window)
      await waitFor(() => expect(sheet.style.width).toBe('1200px'))

      viewportWidth = 1000
      fireEvent.resize(window)
      await waitFor(() => expect(sheet.style.width).toBe('976px'))

      viewportWidth = 700
      fireEvent.resize(window)
      await waitFor(() => expect(sheet.style.width).toBe('877px'))

      fireEvent.click(screen.getByRole('button', { name: uiText.actions.zoomReset }))
      expect(sheet.style.width).toBe('1754px')

      viewportWidth = 3000
      viewportHeight = 4000
      fireEvent.resize(window)
      await act(async () => {
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      })
      expect(sheet.style.width).toBe('1754px')
    } finally {
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
    }
  })

it('scrolls the zoomed sheet horizontally with horizontal wheel input', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement
    const zoom = getZoomSlider()

    fireEvent.change(zoom, { target: { value: '150' } })
    expect(sheet.style.width).toBe('2631px')

    viewport.scrollLeft = 100
    fireEvent.wheel(viewport, { deltaX: 80, deltaY: 0, clientX: 200, clientY: 200 })
    expect(viewport.scrollLeft).toBe(180)
    expect(sheet.style.width).toBe('2631px')

    fireEvent.wheel(viewport, { deltaX: 30, deltaY: -120, clientX: 200, clientY: 200 })
    expect(viewport.scrollLeft).toBe(210)
    expect(sheet.style.width).toBe('2631px')

    const legacyHorizontalWheel = createEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 200 })
    Object.defineProperty(legacyHorizontalWheel, 'wheelDeltaX', { value: -40 })
    fireEvent(viewport, legacyHorizontalWheel)
    expect(viewport.scrollLeft).toBe(250)
    expect(sheet.style.width).toBe('2631px')

    fireEvent.wheel(viewport, { deltaY: 40, shiftKey: true, clientX: 200, clientY: 200 })
    expect(viewport.scrollLeft).toBe(290)
    expect(sheet.style.width).toBe('2631px')

    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 0, clientX: 200, clientY: 200 })
    expect(viewport.scrollLeft).toBe(290)
    expect(sheet.style.width).toBe('2631px')
  })

it('zooms around the cursor position with Ctrl+wheel without allowing native wheel scroll', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement
    viewport.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      toJSON: () => ({}),
    })

    viewport.scrollLeft = 100
    viewport.scrollTop = 80
    const normalWheelEvent = createEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 200 })
    fireEvent(viewport, normalWheelEvent)
    expect(normalWheelEvent.defaultPrevented).toBe(false)
    expect(sheet.style.width).toBe('1754px')

    const zoomEvent = createEvent.wheel(viewport, { deltaY: -120, ctrlKey: true, clientX: 200, clientY: 200 })
    fireEvent(viewport, zoomEvent)
    expect(zoomEvent.defaultPrevented).toBe(true)
    await waitFor(() => expect(Number.parseFloat(sheet.style.width)).toBeGreaterThan(1754))
    await waitFor(() => expect(viewport.scrollLeft).toBeCloseTo(136))
    expect(viewport.scrollTop).toBeCloseTo(113.6)
  })

it('pans the sheet with Space drag and middle mouse drag', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement

    viewport.scrollLeft = 100
    viewport.scrollTop = 50
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(viewport.classList.contains('spacePanReady')).toBe(true)
    fireEvent.pointerDown(sheet, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 260, clientY: 280 })
    expect(viewport.scrollLeft).toBe(140)
    expect(viewport.scrollTop).toBe(70)
    expect(document.querySelector('.selectedCellRect')).toBeNull()
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 260, clientY: 280 })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })

    viewport.scrollLeft = 100
    viewport.scrollTop = 100
    fireEvent.pointerDown(sheet, { pointerId: 2, pointerType: 'mouse', button: 1, buttons: 4, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: 'mouse', clientX: 130, clientY: 90 })
    expect(viewport.scrollLeft).toBe(70)
    expect(viewport.scrollTop).toBe(110)
    fireEvent.pointerUp(window, { pointerId: 2, pointerType: 'mouse', clientX: 130, clientY: 90 })
  })

it('renders the paper template image at full opacity before a sheet scan is assigned', () => {
    render(<App />)
    const opacity = getSheetOpacitySlider()
    const image = document.querySelector('.sheetSvg image') as SVGImageElement | null
    const pageLabel = uiText.sheet.pageCaption(1, 1, 144)

    expect(opacity.value).toBe('100')
    expect(opacity.disabled).toBe(true)
    expect(image?.getAttribute('href')).toContain('timesheet.png')
    expect(image?.getAttribute('opacity')).toBe('1')
    expect(screen.getByRole('figure', { name: pageLabel })).toBeTruthy()
    expect(screen.queryByText(pageLabel)).toBeNull()
  })

it('opens level correction with initial correction values and updates the sheet preview filter', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    const sourceInput = screen.getByLabelText(uiText.actions.loadSheetSourceFiles)
    const page = new File(['page'], 'level_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(sourceInput, { target: { files: [page] } })
    await waitFor(() => expect(sheetImageHrefs()).toContain('blob:level_sheet.png'))

    const checkbox = screen.getByLabelText('レベル補正') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'レベル補正' }))
    const dialog = screen.getByRole('dialog', { name: '紙シートのレベル補正' })
    expect(dialog.getAttribute('aria-modal')).toBeNull()

    const gammaInput = within(dialog).getAllByLabelText('ガンマ')
      .find((element): element is HTMLInputElement => element instanceof HTMLInputElement)
    const whiteInput = within(dialog).getAllByLabelText('白点')
      .find((element): element is HTMLInputElement => element instanceof HTMLInputElement)
    if (!gammaInput || !whiteInput) throw new Error('level correction inputs not found')

    expect(gammaInput.value).toBe('0.50')
    expect(whiteInput.value).toBe('250')

    const initialTable = levelCorrectionFilterTableValues()
    expect(initialTable).toBeTruthy()
    expect(document.querySelector('.sheetSvg image')?.getAttribute('filter')).toContain('url(#')
    fireEvent.change(gammaInput, { target: { value: '0.75' } })

    await waitFor(() => {
      const updatedTable = levelCorrectionFilterTableValues()
      expect(updatedTable).toBeTruthy()
      expect(updatedTable).not.toBe(initialTable)
    })
  })

it('sets imported sheet images to 50% opacity and allows manual adjustment from the sheet toolbar', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    const sourceInput = screen.getByLabelText(uiText.actions.loadSheetSourceFiles)
    const page = new File(['page'], 'opacity_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(sourceInput, { target: { files: [page] } })

    await waitFor(() => expect(sheetImageHrefs()).toContain('blob:opacity_sheet.png'))
    const opacity = getSheetOpacitySlider()
    expect(opacity.value).toBe('50')
    expect(opacity.disabled).toBe(false)
    expect(document.querySelector('.sheetSvg image')?.getAttribute('opacity')).toBe('0.5')

    fireEvent.pointerDown(opacity, { pointerId: 21, pointerType: 'mouse', button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { pointerId: 21, pointerType: 'mouse', buttons: 1, clientX: 120 })
    fireEvent.pointerUp(window, { pointerId: 21, pointerType: 'mouse', button: 0, clientX: 120 })
    expect(document.querySelector('.sheetSvg image')?.getAttribute('opacity')).toBe('0.6')

    fireEvent.change(opacity, { target: { value: '40' } })
    const image = document.querySelector('.sheetSvg image') as SVGImageElement | null
    expect(image?.getAttribute('opacity')).toBe('0.4')
  })

it('registers sheet scan images in filename order and sets duration from the scan count', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    expect(screen.queryByText('timesheet.png')).toBeNull()

    const sourceInput = screen.getByLabelText(uiText.actions.loadSheetSourceFiles)
    const page2 = new File(['page2'], 'sheet_02.png', { type: 'image/png', lastModified: 2 })
    const page1 = new File(['page1'], 'sheet_01.png', { type: 'image/png', lastModified: 1 })
    const extensionlessPage = new File(['page133'], '_133_sheet_e.jpg', { type: 'image/jpeg', lastModified: 3 })
    const suffixedPage = new File(['page133-2'], '_133_sheet_e_2.jpg', { type: 'image/jpeg', lastModified: 4 })
    fireEvent.change(sourceInput, { target: { files: [suffixedPage, page2, extensionlessPage, page1] } })

    await waitFor(() => expect(screen.getByLabelText(uiText.sheet.activePage)).toBeTruthy())
    const pageMenuTrigger = screen.getByLabelText(uiText.sheet.activePage)
    fireEvent.click(pageMenuTrigger)
    const pageJumpMenu = document.querySelector('.actionMenuPortalContent.pageJumpMenu') as HTMLElement | null
    if (!pageJumpMenu) throw new Error('page jump menu not found')
    expect(within(pageJumpMenu).getByRole('button', { name: uiText.sheet.pageTab(4) })).toBeTruthy()
    expect(pageJumpMenu.querySelectorAll('.pageJumpSourceSelect select')).toHaveLength(1)
    const assignedSourceLabels = Array.from({ length: 4 }, (_, index) => {
      fireEvent.click(within(pageJumpMenu).getByRole('button', { name: uiText.sheet.pageTab(index + 1) }))
      const select = pageJumpMenu.querySelector<HTMLSelectElement>('.pageJumpSourceSelect select')
      if (!select) throw new Error('selected-page source select not found')
      return select.selectedOptions[0]?.textContent ?? ''
    })
    expect(assignedSourceLabels).toEqual([
      expect.stringContaining('_133_sheet_e.jpg'),
      expect.stringContaining('_133_sheet_e_2.jpg'),
      expect.stringContaining('sheet_01.png'),
      expect.stringContaining('sheet_02.png'),
    ])
    fireEvent.click(within(pageJumpMenu).getByRole('button', { name: uiText.sheet.pageTab(1) }))
    const sourceSelect = pageJumpMenu.querySelector<HTMLSelectElement>('.pageJumpSourceSelect select')
    const replacement = Array.from(sourceSelect?.options ?? []).find(option => option.textContent?.includes('_133_sheet_e_2.jpg'))
    if (!sourceSelect || !replacement) throw new Error('replacement source option not found')
    fireEvent.change(sourceSelect, { target: { value: replacement.value } })
    expect(sourceSelect.selectedOptions[0]?.textContent).toContain('_133_sheet_e_2.jpg')
  })

it('loads sheet scan images from the sheet input toolbar', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    expect(screen.queryByText(uiText.sources.dropOnSheet)).toBeNull()
    const sourceInput = screen.getByLabelText(uiText.actions.loadSheetSourceFiles)
    const page = new File(['page'], 'toolbar_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(sourceInput, { target: { files: [page] } })

    await waitFor(() => expect(sheetImageHrefs()).toContain('blob:toolbar_sheet.png'))
  })

it('loads a material asset as the paper sheet from the asset browser context menu only before paper sheets are registered', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const page = new File(['page'], 'asset_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [page] } })

    const assetCard = await findAssetCardByName('asset_sheet.png')
    fireEvent.contextMenu(assetCard, { clientX: 120, clientY: 140 })
    fireEvent.click(await screen.findByRole('menuitem', { name: uiText.assets.useAsPaperSheetSource }))

    await waitFor(() => expect(sheetImageHrefs()).toContain('blob:asset_sheet.png'))

    fireEvent.contextMenu(assetCard, { clientX: 120, clientY: 140 })
    expect(screen.queryByRole('menuitem', { name: uiText.assets.useAsPaperSheetSource })).toBeNull()
  })

it('resets the working project and clears history from the top bar', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    render(<App />)

    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    })
    clickSheet(sheet, 255, 290)
    enterTimingValue('1')
    expect(document.querySelector('.eventText')?.textContent).toBe('1')

    const sourceInput = screen.getByLabelText(uiText.actions.loadSheetSourceFiles)
    const page = new File(['page'], 'reset_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(sourceInput, { target: { files: [page] } })
    await waitFor(() => expect(sheetImageHrefs()).toContain('blob:reset_sheet.png'))

    const appNavigationMenu = openAppNavigationMenu()
    fireEvent.click(within(appNavigationMenu).getByRole('button', { name: uiText.actions.resetApp }))

    expect(document.querySelector('.eventText')).toBeNull()
    expect(sheetImageHrefs()).not.toContain('blob:reset_sheet.png')
    expect(screen.queryByText(uiText.sources.dropOnSheet)).toBeNull()
    expect((screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement).disabled).toBe(true)
  })

it('edits sheet warp quadrilateral handles and applies template targets', async () => {
    render(<App />)
    expect(document.querySelector('.templateChrome')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.imageCorrection }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: uiText.sheet.calibrationLoupeTitle })).toBeTruthy())
    expect(document.querySelectorAll('.calibrationLoupeView')).toHaveLength(4)
    expect(document.querySelector('.templateChrome')).toBeNull()

    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    })
    const sourceHandle = document.querySelector('.calibrationHandle.source')
    if (!sourceHandle) throw new Error('source calibration handle not found')
    const expectedPoints = defaultCalibrationPoints(standardA3SheetTemplate)
    expect(Number(sourceHandle.getAttribute('cx'))).toBeCloseTo(expectedPoints[0].source.x)
    expect(Number(sourceHandle.getAttribute('cy'))).toBeCloseTo(expectedPoints[0].source.y)
    expect(document.querySelectorAll('.calibrationTrimMark.source')).toHaveLength(4)
    expect(document.querySelectorAll('.calibrationHandleMark.source')).toHaveLength(4)
    fireEvent.pointerDown(sourceHandle, { pointerId: 1, clientX: 80, clientY: 80 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 95, clientY: 90 })
    expect(sheet.classList.contains('calibrationDragging')).toBe(true)
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 95, clientY: 90 })
    expect(sheet.classList.contains('calibrationDragging')).toBe(false)
    expect(document.querySelectorAll('.calibrationHandle.source')).toHaveLength(4)

    fireEvent.click(screen.getAllByRole('button', { name: uiText.actions.applyWarp })[0])
    expect(screen.queryByRole('dialog', { name: uiText.sheet.calibrationLoupeTitle })).toBeNull()
    expect(document.querySelector('.calibrationTrimMark.source')).toBeNull()
    expect(document.querySelector('.calibrationHandle.source')).toBeNull()
  })

it('registers material assets in the CSP layer tree and reuses its cards on the sheet', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    fireEvent.change(assetInput, { target: { files: [new File(['asset'], 'BG_A1.png', { type: 'image/png', lastModified: 1 })] } })
    expect(await screen.findByText('BG_A1.png')).toBeTruthy()

    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    dragInternalPointer(getAssetCardByName('BG_A1.png'), sheet, { toX: 255, toY: 290 })

    await waitFor(() => expectSelectedHit('cell', 'A', 1))
    expect(document.querySelector('.assetAssignedEventRect')).toBeTruthy()
    expect(document.querySelector('.assetAssignedEventMarker')).toBeTruthy()
    expect(document.querySelector('.selectedCellCorners')).toBeTruthy()
    const drawingCell = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeCel[data-csp-key-id]'))
      .find(cell => cell.closest('.cspTreeLayer')?.querySelector(':scope > summary')?.textContent === '作画')
    if (!drawingCell) throw new Error('drawing CSP cell was not rendered')
    expect(drawingCell.querySelector('.cspTreeAssetState')?.getAttribute('title')).toBe('素材: BG_A1.png')
    expect(drawingCell.dataset.cspSheetRole).toBe('cell')
    fireEvent.doubleClick(drawingCell.querySelector('.cspTreeCelName')!)
    const cspNameInput = drawingCell.querySelector<HTMLInputElement>('.cspTreeCelNameInput')
    if (!cspNameInput) throw new Error('CSP cell name input was not rendered')
    expect(cspNameInput.value).toBe('BG_A1')
    fireEvent.change(cspNameInput, { target: { value: 'BG_A1_custom' } })
    fireEvent.keyDown(cspNameInput, { key: 'Enter' })

    fireEvent.change(assetInput, { target: { files: [new File(['asset-2'], 'BG_A2.png', { type: 'image/png', lastModified: 2 })] } })
    expect(await screen.findByText('BG_A2.png')).toBeTruthy()
    dragInternalPointer(getAssetCardByName('BG_A2.png'), sheet, { toX: 255, toY: 290 })
    const dropMenu = await screen.findByRole('menu')
    expect(dropMenu.textContent).toContain(uiText.assetDrop.title)
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('演出')) }))

    await waitFor(() => {
      const layerNames = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeCel[data-csp-key-id]'))
        .map(cell => cell.closest('.cspTreeLayer')?.querySelector(':scope > summary')?.textContent)
      expect(layerNames).toEqual(['演出', '作画'])
    })
    expect(Array.from(document.querySelectorAll('.cspTreeAssetState')).map(item => item.getAttribute('title'))).toEqual(['素材: BG_A2.png', '素材: BG_A1.png'])

    const target = templateFramePoint('cell', 'B', 1)
    dragInternalPointer(drawingCell, sheet, { toX: target.x, toY: target.y })
    await waitFor(() => expectSelectedHit('cell', 'B', 1))
    expect(Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).map(registeredCellIdentityText)).toEqual([
      'CELL B',
      'CELL A',
      'CELL B',
      'CELL A',
    ])

    const dialog = openTimingExportDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'CELL' }))
    expect(within(dialog).getByRole('button', { name: 'CELL' }).getAttribute('aria-pressed')).toBe('true')
  })
it('updates an open material preview when the asset browser selection changes', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    fireEvent.change(assetInput, {
      target: {
        files: [
          new File(['asset-1'], 'A1_preview.png', { type: 'image/png', lastModified: 1 }),
          new File(['asset-2'], 'A2_preview.png', { type: 'image/png', lastModified: 2 }),
        ],
      },
    })
    const firstAssetCard = await findAssetCardByName('A1_preview.png')
    const secondAssetCard = await findAssetCardByName('A2_preview.png')
    fireEvent.click(firstAssetCard)
    const firstPreviewButton = firstAssetCard.querySelector('.assetQuickPreviewButton') as HTMLButtonElement | null
    if (!firstPreviewButton) throw new Error('asset quick preview button not found')
    fireEvent.click(firstPreviewButton)
    expect(await screen.findByRole('dialog', { name: uiText.assets.previewDialog('A1_preview.png') })).toBeTruthy()

    fireEvent.click(secondAssetCard)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: uiText.assets.previewDialog('A2_preview.png') })).toBeTruthy()
    })
    expect(screen.queryByRole('dialog', { name: uiText.assets.previewDialog('A1_preview.png') })).toBeNull()
  })

it('adds stack guide labels, assigns image assets, and includes them in XDTS export', async () => {
    URL.createObjectURL = () => 'blob:stack-guide-preview'
    render(<App />)

    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    openStackGuideInsertMenu(sheet, 'action', 3)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.add }))
    await clickActiveStackGuideInsertHandle(templateStackGuideHeaderPoint('action', 3))
    fireEvent.change(await screen.findByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BOOK2,3' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideLabel')).not.toHaveLength(0))
    expect(screen.queryByLabelText(uiText.stackGuides.inputLabel)).toBeNull()
    expect(Array.from(document.querySelectorAll('.stackGuideLabel')).some(label => label.textContent === 'BOOK2,3')).toBe(true)
    expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BOOK2,3')
    expect(document.querySelector('.stackGuideSvgLabelText')?.getAttribute('transform')).toBe(`scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).some(label => label.textContent === 'BOOK2,3')).toBe(true)
    const bookGuideBeforeMove = Array.from(document.querySelectorAll<SVGGElement>('.stackGuideSvgLabel'))
      .find(label => label.textContent === 'BOOK2,3')
    const connectorBeforeMove = bookGuideBeforeMove?.querySelector('.stackGuideSvgConnector')?.getAttribute('d')
    fireEvent.click(screen.getByRole('button', { name: '全工程のBOOK2,3をCSPで上へ（シートで右へ）' }))
    await waitFor(() => {
      const movedGuide = Array.from(document.querySelectorAll<SVGGElement>('.stackGuideSvgLabel'))
        .find(label => label.textContent === 'BOOK2,3')
      expect(movedGuide?.querySelector('.stackGuideSvgConnector')?.getAttribute('d')).not.toBe(connectorBeforeMove)
    })

    openStackGuideInsertMenu(sheet, 'cell', 2)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.add }))
    await clickActiveStackGuideInsertHandle(templateStackGuideHeaderPoint('cell', 2))
    fireEvent.change(await screen.findByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BG' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="cell"]')?.textContent).toBe('BG'))

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['book'], 'BOOK2_3.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('BOOK2_3.png')).toBeTruthy()

    const labelButton = Array.from(document.querySelectorAll('.stackGuideLabel')).find(label => label.textContent === 'BOOK2,3')
    if (!labelButton) throw new Error('stack guide label was not rendered')
    dragInternalPointer(getAssetCardByName('BOOK2_3.png'), labelButton)

    await waitFor(() => expect(document.querySelector('.stackGuideLabel.assigned')).toBeTruthy())
    const stackGuideCard = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
      .find(label => label.textContent === 'BOOK2,3')?.closest<HTMLElement>('.cspTreeTrack')
    if (!stackGuideCard) throw new Error('stack guide track not found')
    expect(stackGuideCard.textContent).toContain('BOOK2_3.png')
    expect(stackGuideCard.closest('.cspTreeLayer')?.querySelector(':scope > summary')?.textContent).toBe('作画')

    const cellTarget = templateStackGuideHeaderPoint('cell', 4)
    dragInternalPointer(stackGuideCard, sheet, { toX: cellTarget.x, toY: cellTarget.y })
    await waitFor(() => expect(document.querySelectorAll('.stackGuideLabel').length).toBe(2))
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideLabel')).map(label => `${label.getAttribute('data-stack-guide-role')}:${label.textContent}`).join(', ')
      expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="cell"]')).some(label => label.textContent === 'BOOK2,3'), labels).toBe(true)
    })

    const dialog = openTimingExportDialog()
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
  })

it('keeps shared stack guide registrations while storing placement per shared cut', async () => {
    URL.createObjectURL = () => 'blob:stack-guide-cut-preview'
    render(<App />)

    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    openStackGuideInsertMenu(sheet, 'action', 2)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.add }))
    await clickActiveStackGuideInsertHandle(templateStackGuideHeaderPoint('action', 2))
    fireEvent.change(await screen.findByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BOOK-CUT' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BOOK-CUT'))

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['book-cut'], 'BOOK_CUT.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('BOOK_CUT.png')).toBeTruthy()

    const stackGuideCard = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
      .find(label => label.textContent === 'BOOK-CUT')?.closest<HTMLElement>('.cspTreeTrack')
    if (!stackGuideCard) throw new Error('stack guide track not found')
    const stackGuideDropZone = stackGuideCard.querySelector<HTMLElement>('.cspTreeAssetDropZone')
    if (!stackGuideDropZone) throw new Error('stack guide asset drop zone not found')
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => stackGuideDropZone),
    })
    const stackGuideTargetBox = { left: 300, top: 240, width: 120, height: 60 }
    stackGuideDropZone.getBoundingClientRect = () => ({
      x: stackGuideTargetBox.left,
      y: stackGuideTargetBox.top,
      left: stackGuideTargetBox.left,
      top: stackGuideTargetBox.top,
      right: stackGuideTargetBox.left + stackGuideTargetBox.width,
      bottom: stackGuideTargetBox.top + stackGuideTargetBox.height,
      width: stackGuideTargetBox.width,
      height: stackGuideTargetBox.height,
      toJSON: () => ({}),
    })
    const stackGuideAssetCard = getAssetCardByName('BOOK_CUT.png')
    fireEvent.pointerDown(stackGuideAssetCard, { pointerId: 73, pointerType: 'mouse', button: 0, buttons: 1, clientX: 120, clientY: 180 })
    fireEvent.pointerMove(window, { pointerId: 73, pointerType: 'mouse', buttons: 1, clientX: 360, clientY: 270 })
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 73, pointerType: 'mouse', button: 0, buttons: 0, clientX: 360, clientY: 270 })
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeNull()
    if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
    else Reflect.deleteProperty(document, 'elementFromPoint')
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
        .find(label => label.textContent === 'BOOK-CUT')?.closest('.cspTreeTrack')?.textContent).toContain('BOOK_CUT.png')
    })

    const firstCutLabel = Array.from(document.querySelectorAll('.stackGuideLabel')).find(label => label.textContent === 'BOOK-CUT')
    if (!firstCutLabel) throw new Error('first cut stack guide label was not rendered')
    dragInternalPointer(getAssetCardByName('BOOK_CUT.png'), firstCutLabel)
    await waitFor(() => expect(document.querySelector('.stackGuideLabel.assigned')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
      .find(label => label.textContent === 'BOOK-CUT')?.closest('.cspTreeTrack')?.textContent).toContain('BOOK_CUT.png')

    const addCutButton = document.querySelector<HTMLButtonElement>('.cutSwitchAddButton')
    if (!addCutButton) throw new Error('shared cut add button not found')
    fireEvent.click(addCutButton)
    await waitFor(() => {
      const select = document.querySelector<HTMLSelectElement>('.cutSwitchControl select')
      expect(select?.options.length).toBe(2)
      expect(select?.selectedOptions[0]?.textContent?.trim()).toBe('002')
    })
    expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
      .find(label => label.textContent === 'BOOK-CUT')?.closest('.cspTreeTrack')?.textContent).toContain('BOOK_CUT.png')

    dragStackGuideSvgLabel('BOOK-CUT', 'cell', 4)
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="cell"]')?.textContent).toBe('BOOK-CUT'))

    switchSharedCutByLabel('001')
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="cell"]')).some(label => label.textContent === 'BOOK-CUT')).toBe(false)

    switchSharedCutByLabel('002')
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="cell"]')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="action"]')).some(label => label.textContent === 'BOOK-CUT')).toBe(false)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
      .find(label => label.textContent === 'BOOK-CUT')?.closest('.cspTreeTrack')?.textContent).toContain('BOOK_CUT.png')
  })

it('sorts image assets by natural filename order', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const files = [
      new File(['asset-10'], 'A10.png', { type: 'image/png', lastModified: 1 }),
      new File(['asset-9e'], 'A9_e.jpg', { type: 'image/jpeg', lastModified: 2 }),
      new File(['asset-9'], 'A9.jpg', { type: 'image/jpeg', lastModified: 3 }),
      new File(['asset-2'], 'A2.png', { type: 'image/png', lastModified: 2 }),
      new File(['asset-1'], 'A1.png', { type: 'image/png', lastModified: 3 }),
    ]
    fireEvent.change(assetInput, { target: { files } })

    await waitFor(() => expect(document.querySelectorAll('.sheetDockRight .assetCard')).toHaveLength(5))
    const rightDockAssetNames = () => Array.from(document.querySelectorAll('.sheetDockRight .assetCard strong')).map(item => item.textContent)
    expect(rightDockAssetNames()).toEqual([
      'A1.png',
      'A2.png',
      'A9.jpg',
      'A9_e.jpg',
      'A10.png',
    ])
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.sort.toDescending }))
    expect(rightDockAssetNames()).toEqual([
      'A10.png',
      'A9_e.jpg',
      'A9.jpg',
      'A2.png',
      'A1.png',
    ])
  })

it('registers dropped folder contents without recursing into subfolders', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)

    const panel = document.querySelector('.sheetDockRight .assetBrowser')
    if (!panel) throw new Error('right asset browser not found')

    const looseFile = new File(['loose'], 'Loose_B1.png', { type: 'image/png', lastModified: 1 })
    const directFile = new File(['direct'], 'Direct_A1.png', { type: 'image/png', lastModified: 2 })
    const nestedFile = new File(['nested'], 'Nested_C1.png', { type: 'image/png', lastModified: 3 })
    const noteFile = new File(['note'], 'notes.txt', { type: 'text/plain', lastModified: 4 })
    const folderEntry = mockDirectoryEntry('materials', [
      mockFileEntry(directFile),
      mockDirectoryEntry('nested', [mockFileEntry(nestedFile)]),
      mockFileEntry(noteFile),
    ])
    const dataTransfer = {
      files: [],
      items: [
        mockFileTransferItem(mockFileEntry(looseFile), looseFile),
        mockFileTransferItem(folderEntry),
      ],
      types: ['Files'],
      getData: () => '',
    }

    const dragOver = createEvent.dragOver(panel, { dataTransfer })
    fireEvent(panel, dragOver)
    expect(dragOver.defaultPrevented).toBe(true)
    fireEvent.drop(panel, { dataTransfer })

    expect(await screen.findByText('Loose_B1.png')).toBeTruthy()
    expect(await screen.findByText('Direct_A1.png')).toBeTruthy()
    expect(screen.queryByText('Nested_C1.png')).toBeNull()
    expect(screen.queryByText('notes.txt')).toBeNull()
  })
})
