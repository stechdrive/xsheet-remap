import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cellRectForHit, timingHitForFrame, standardA3SheetTemplate } from '@xsheet-remap/core';
import { App } from './App';
import { uiText } from './i18n';
import { dispatchInternalDrag } from './internalDrag';
import { SHEET_TOUCH_CONTEXT_MENU_LONG_PRESS_MS } from './sheetTouchNavigation'
import { clickSheet, clickTemplateDisplayFrame, clickTemplateFrame, dragInternalPointer, dragSheet, dragTemplateDisplayFrames, enterTimingValue, expectCurrentFrame, expectSelectedHit, expectSelectedRange, expectSelectionStatus, expectStatusHint, formatTestFramePosition, getAssetCardByName, openCutMetadataMenu, openDisplaySettingsMenu, openStackGuideInsertMenu, openTimingExportDialog, openTimingTextSettingsMenu, registeredCellIdentityText, selectCspCorrectionLayer, setSheetRect, setStackGuideOverlayRect, stackGuideConnectorAnchorX, templateColumnHeaderPoint, templateFramePoint, templateStackGuideBodySnapPoint, templateStackGuideHeaderPoint, templateTimelineLaneHeaderPoint } from './App.test-support'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function dispatchBatchedPointerClick(target: Element, pointerId: number, clientX: number, clientY: number, releaseTarget: EventTarget = target) {
  const pointerDown = createEvent.pointerDown(target, { pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX, clientY })
  const pointerUp = createEvent.pointerUp(target, { pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX, clientY })
  act(() => {
    target.dispatchEvent(pointerDown)
    releaseTarget.dispatchEvent(pointerUp)
  })
}

describe('App: sheet timing interactions', () => {
it('uses the floating memo palette as the single ink/text entry and locks a selected frame target', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    expect(document.querySelector('.sheetToolbar')).toBeNull()
    expect(within(openTimingTextSettingsMenu()).getByRole('spinbutton', { name: uiText.sheet.timingTextFontSize })).toBeTruthy()
    clickTemplateFrame(sheet, 'action', 'A', 1)
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('ACTION A 1F')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
    await waitFor(() => expect(document.querySelector('.timelineMemoSegment.selected')).toBeTruthy())
    expect(document.querySelector('.annotationFloatingPalette')?.classList.contains('timelineMemoTarget')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.textTool }))
    await waitFor(() => expect(document.querySelector('.timelineMemoTextSurface')).toBeTruthy())
    const editor = await screen.findByRole('textbox', { name: 'メモ文字' })
    expect(document.activeElement).toBe(editor)
    expect(sheet.classList.contains('textAnnotationPlacementMode')).toBe(false)
    expect(document.querySelector('.textCursorBadge')).toBeNull()
    fireEvent.change(editor, { target: { value: '確認メモ' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(document.querySelector('.timelineMemoText')?.textContent).toBe('確認メモ'))
  })

  it('selects TITLE and MEMO form regions as floating annotation targets', () => {
    render(<App />)
    const title = screen.getByRole('button', { name: 'タイトルを編集' })
    const memo = screen.getByRole('button', { name: 'MEMOを編集' })

    fireEvent.click(title)
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind')).toBe('template-region')
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('対象: タイトル')
    expect(title.getAttribute('data-annotation-target-selected')).toBe('true')

    fireEvent.click(memo)
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('対象: MEMO')
    expect(memo.getAttribute('data-annotation-target-selected')).toBe('true')
    expect(title.hasAttribute('data-annotation-target-selected')).toBe(false)
  })

  it('keeps a memo-input session open, previews the active stroke above the sheet, and exits explicitly', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'MEMOを編集' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))

    const palette = document.querySelector<HTMLElement>('.annotationFloatingPalette')!
    await waitFor(() => expect(palette.getAttribute('data-annotation-session')).toBe('active'))
    expect(palette.classList.contains('open')).toBe(true)
    expect(palette.getAttribute('data-annotation-tool')).toBe('pen')

    const surface = document.querySelector<SVGSVGElement>('.pageAnnotationInputSurface[data-annotation-tool="pen"]')!
    setSheetRect(surface as unknown as HTMLElement, 0, 0)
    surface.setPointerCapture = vi.fn()
    fireEvent.pointerDown(surface, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(window, { pointerId: 31, pointerType: 'mouse', buttons: 1, clientX: 420, clientY: 360 })

    const preview = surface.closest('.pageAnnotationInteractionLayer')?.querySelector<HTMLCanvasElement>('.pageAnnotationInkCanvas')
    await waitFor(() => expect(preview?.dataset.inkActive).toBe('true'))
    expect(Number(preview?.dataset.inkSampleCount)).toBeGreaterThanOrEqual(2)
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('対象: MEMO')
    expect(palette.getAttribute('data-annotation-target-kind')).toBe('template-region')
    expect(screen.getByRole('button', { name: 'MEMOを編集' }).getAttribute('data-annotation-target-selected')).toBe('true')
    expect(document.querySelector('.sheetSvg .annotationDraftStroke')).toBeNull()

    fireEvent.pointerUp(window, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 0, clientX: 440, clientY: 370 })
    await waitFor(() => expect(preview?.dataset.inkActive).toBe('false'))
    const committedInk = document.querySelector<HTMLCanvasElement>('.committedAnnotationCanvas')
    expect(committedInk?.dataset.annotationStrokeCount).toBe('1')
    expect(committedInk?.dataset.annotationRegionIds?.split(/\s+/)).toContain('top_memo_area')
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('対象: MEMO')

    fireEvent.pointerDown(document.body)
    expect(palette.classList.contains('open')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.eraserTool }))
    await waitFor(() => expect(palette.getAttribute('data-annotation-tool')).toBe('eraser'))
    expect(screen.getByRole('slider', { name: uiText.sheet.eraserWidth })).toBeTruthy()
    expect(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="eraser"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.annotationSessionDone }))
    await waitFor(() => expect(document.querySelector('.pageAnnotationInputSurface')).toBeNull())
    expect(palette.getAttribute('data-annotation-session')).toBe('idle')
    expect(palette.classList.contains('open')).toBe(false)
  })

  it('closes an unused pen session explicitly and does not reopen it on later pointer movement', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    const penButton = screen.getByRole('button', { name: uiText.sheet.penTool })
    fireEvent.click(penButton)

    const palette = document.querySelector<HTMLElement>('.annotationFloatingPalette')!
    await waitFor(() => expect(palette.getAttribute('data-annotation-session')).toBe('active'))
    expect(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="pen"]')).toBeTruthy()

    penButton.focus()
    expect(document.activeElement).toBe(penButton)
    fireEvent.click(penButton)

    await waitFor(() => expect(palette.getAttribute('data-annotation-session')).toBe('idle'))
    expect(document.activeElement).not.toBe(penButton)
    expect(palette.classList.contains('open')).toBe(false)
    expect(document.querySelector('.pageAnnotationInputSurface')).toBeNull()

    fireEvent.pointerMove(document.body, { pointerId: 41, pointerType: 'pen', clientX: 20, clientY: 20 })
    expect(palette.getAttribute('data-annotation-session')).toBe('idle')
    expect(palette.classList.contains('open')).toBe(false)
  })

it('shows a dedicated cell cue for asset and CSP card drop targets', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const target = templateFramePoint('cell', 'A', 1)
    clickTemplateFrame(sheet, 'cell', 'A', 1)

    act(() => dispatchInternalDrag({
      sessionId: 'asset-preview',
      phase: 'move',
      payload: { kind: 'asset', assetIds: ['asset_0001'] },
      clientX: target.x,
      clientY: target.y,
    }))
    const assetCue = document.querySelector('.sheetDropTargetCue')
    expect(assetCue?.getAttribute('data-drop-validity')).toBe('valid')
    expect(document.querySelector('.sheetDropTargetFill')).toBeTruthy()
    expect(document.querySelector('.selectedCellCorners')).toBeTruthy()
    expect(document.querySelector('.hoverCellRect')).toBeNull()

    act(() => dispatchInternalDrag({
      sessionId: 'asset-preview',
      phase: 'cancel',
      payload: { kind: 'asset', assetIds: ['asset_0001'] },
      clientX: target.x,
      clientY: target.y,
    }))
    expect(document.querySelector('.sheetDropTargetCue')).toBeNull()

    act(() => dispatchInternalDrag({
      sessionId: 'card-preview',
      phase: 'move',
      payload: { kind: 'registered-cell', keyId: 'key_0001' },
      clientX: target.x,
      clientY: target.y,
    }))
    expect(document.querySelector('.sheetDropTargetCue')?.getAttribute('data-drop-validity')).toBe('valid')

    act(() => dispatchInternalDrag({
      sessionId: 'card-preview',
      phase: 'cancel',
      payload: { kind: 'registered-cell', keyId: 'key_0001' },
      clientX: target.x,
      clientY: target.y,
    }))

    act(() => dispatchInternalDrag({
      sessionId: 'multi-asset-preview',
      phase: 'move',
      payload: { kind: 'asset', assetIds: ['asset_0001', 'asset_0002'] },
      clientX: target.x,
      clientY: target.y,
    }))
    expect(document.querySelector('.sheetDropTargetCue')?.getAttribute('data-drop-validity')).toBe('invalid')

    act(() => dispatchInternalDrag({
      sessionId: 'multi-asset-preview',
      phase: 'cancel',
      payload: { kind: 'asset', assetIds: ['asset_0001', 'asset_0002'] },
      clientX: target.x,
      clientY: target.y,
    }))
    expect(document.querySelector('.sheetDropTargetCue')).toBeNull()
  })

it('assigns a registered cell card to a frame through pointer drag fallback', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    const registeredCellName = registeredCell.querySelector<HTMLElement>('.cspTreeCelName')
    if (!registeredCellName) throw new Error('registered cell name not found')

    const target = templateFramePoint('cell', 'B', 1)
    fireEvent.pointerDown(registeredCellName, { pointerId: 71, pointerType: 'mouse', button: 0, buttons: 1, clientX: 120, clientY: 180 })
    fireEvent.pointerMove(window, { pointerId: 71, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeTruthy()
    expect(document.querySelector('.internalDragPreview')?.textContent).toContain('A1')
    expect(registeredCell.dataset.internalDragSource).toBe('true')
    expect(document.body.dataset.internalDragValidity).toBe('valid')
    expectStatusHint(uiText.statusHints.dropRegisteredCell(`CELL B ${formatTestFramePosition(1)}`))
    fireEvent.pointerUp(window, { pointerId: 71, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

    await waitFor(() => expectSelectedHit('cell', 'B', 1))
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeNull()
    expect(document.body.classList.contains('internalPointerDragActive')).toBe(false)
    expect(Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).map(registeredCellIdentityText)).toEqual(['CELL B', 'CELL A'])
  })

it('cancels BG/BOOK insertion mode before creating a label', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    openStackGuideInsertMenu(sheet, 'action', 3)
    expect(screen.getByRole('menu', { name: uiText.stackGuides.insertMenuLabel })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.add }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
    expect(screen.queryByLabelText(uiText.stackGuides.inputLabel)).toBeNull()

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(document.querySelector('.stackGuideGap.insertToolActive')).toBeNull())
    expect(screen.queryByLabelText(uiText.stackGuides.inputLabel)).toBeNull()
    expect(document.querySelector('.stackGuideSvgLabel')).toBeNull()
  })

it('creates an overlay paper track from the insertion handle menu', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    openStackGuideInsertMenu(sheet, 'action', 3)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.addOverlayTrack }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
    const activeHandle = document.querySelector<HTMLButtonElement>('.stackGuideGap.insertToolActive .stackGuideInsertHandle')
    if (!activeHandle) throw new Error('active stack guide insert handle not found')
    fireEvent.click(activeHandle, templateStackGuideHeaderPoint('action', 3))
    fireEvent.change(screen.getByLabelText(uiText.sheet.addOverlayTrackName), { target: { value: 'J' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => expect(Array.from(document.querySelectorAll('.overlayPaperTrackLabelText')).some(label => label.textContent === 'J')).toBe(true))
    const overlayLabelText = Array.from(document.querySelectorAll('.overlayPaperTrackLabelText')).find(label => label.textContent === 'J')
    expect(overlayLabelText?.getAttribute('transform')).toBe(`scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`)
    const overlayHandle = document.querySelector<HTMLButtonElement>('.overlayPaperTrackDragHandle')
    if (!overlayHandle) throw new Error('overlay paper track handle not found')
    expect(overlayHandle.getAttribute('aria-label')).toBe(uiText.actions.overlayPaperTrackInputActive('J'))
    expect(overlayHandle.dataset.sheetTouchInteraction).toBe('direct')
    fireEvent.pointerEnter(overlayHandle)
    expectStatusHint('J追加セル列', 'ドラッグで位置移動')
    fireEvent.pointerLeave(overlayHandle)
    fireEvent.contextMenu(overlayHandle, { clientX: 500, clientY: 80 })
    expect(screen.getByRole('menuitem', { name: uiText.actions.renamePaperTrack })).toBeTruthy()
    fireEvent.pointerDown(overlayHandle, { pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, clientX: 500, clientY: 80 })
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: uiText.actions.renamePaperTrack })).toBeNull())
    fireEvent.pointerUp(window, { pointerId: 91, pointerType: 'mouse', button: 0, buttons: 0, clientX: 500, clientY: 80 })

    const currentOverlayHandle = document.querySelector<HTMLButtonElement>('.overlayPaperTrackDragHandle')
    if (!currentOverlayHandle) throw new Error('current overlay paper track handle not found')
    fireEvent.contextMenu(currentOverlayHandle, { clientX: 500, clientY: 80 })
    expect(screen.getByRole('menuitem', { name: uiText.actions.renamePaperTrack })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.deleteOverlayPaperTrack }))

    await waitFor(() => expect(Array.from(document.querySelectorAll('.overlayPaperTrackLabelText')).some(label => label.textContent === 'J')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    await waitFor(() => expect(Array.from(document.querySelectorAll('.overlayPaperTrackLabelText')).some(label => label.textContent === 'J')).toBe(true))
  })

it('adds a BG/BOOK label from the registered-cell plus menu and places it in the reserve slot before A', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByText('作画', { selector: '.cspTreeSummaryLabel' }))
    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'BG／BOOK名' }), { target: { value: 'BG' } })
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOKを作成' }))

    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BG'))
    const reserve = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_reserve_grid')
    if (!reserve) throw new Error('action reserve region not found')
    expect(stackGuideConnectorAnchorX('BG')).toBeCloseTo(reserve.rect.x, 6)
  })

it('moves the BG/BOOK insertion preview from the sheet body after starting from a header context menu', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    openStackGuideInsertMenu(sheet, 'action', 3)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.stackGuides.add }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))

    const overlay = setStackGuideOverlayRect()
    const reservePoint = templateStackGuideBodySnapPoint('action', 0)
    fireEvent.pointerMove(overlay, { pointerId: 1, pointerType: 'mouse', clientX: reservePoint.x, clientY: reservePoint.y })
    fireEvent.click(overlay, { clientX: reservePoint.x, clientY: reservePoint.y })
    fireEvent.change(await screen.findByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BOOK' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BOOK'))
    const reserve = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_reserve_grid')
    if (!reserve) throw new Error('action reserve region not found')
    expect(stackGuideConnectorAnchorX('BOOK')).toBeCloseTo(reserve.rect.x, 6)
  })

it('edits registered cell CSP names and assigns image assets by dropping onto the cell card', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
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

    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCell.querySelector('.cspTreeSheetLabel')?.textContent).toBe('シート: 1')
    expect(registeredCell.querySelectorAll('input')).toHaveLength(0)
    expect(registeredCell.querySelector('.cspTreeCelName')?.textContent).toBe('A1')

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['asset'], 'A1_ref.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('A1_ref.png')).toBeTruthy()

    dragInternalPointer(getAssetCardByName('A1_ref.png'), registeredCell)
    const assignedCell = await waitFor(() => {
      const cell = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id].assigned')
      if (!cell) throw new Error('assigned CSP cell card not found')
      return cell
    })
    fireEvent.doubleClick(assignedCell.querySelector('.cspTreeCelName')!)
    const cspNameInput = assignedCell.querySelector<HTMLInputElement>('.cspTreeCelNameInput')
    if (!cspNameInput) throw new Error('CSP cell name input not found')
    fireEvent.change(cspNameInput, { target: { value: 'A1_custom' } })
    fireEvent.keyDown(cspNameInput, { key: 'Enter' })
    expect(assignedCell.querySelector('.cspTreeAssetState')?.getAttribute('aria-label')).toBe('素材: A1_ref.png')

    const dialog = openTimingExportDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'CELL' }))
    expect(within(dialog).getByRole('button', { name: 'CELL' }).getAttribute('aria-pressed')).toBe('true')
  })

it('removes one process card before deleting its shared logical cell', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickSheet(sheet, 255, 290)
    enterTimingValue('1')

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    fireEvent.change(assetInput, { target: { files: [new File(['asset'], 'A1_ref.png', { type: 'image/png', lastModified: 1 })] } })
    expect(await screen.findByText('A1_ref.png')).toBeTruthy()

    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    dragInternalPointer(getAssetCardByName('A1_ref.png'), registeredCell)
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id].assigned')).toBeTruthy())

    const assignedProcessCard = document.querySelector<HTMLElement>('.cspTreeCel.assigned')
    if (!assignedProcessCard) throw new Error('assigned process card not found')
    fireEvent.click(assignedProcessCard)
    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id].assigned')).toBeNull())
    expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeTruthy()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeNull())
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
  })

it('chooses a process when an image asset is dropped onto an already registered frame', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
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

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['asset'], 'A1_enshutsu.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('A1_enshutsu.png')).toBeTruthy()

    const viewport = sheet.closest('.sheetViewport')
    if (!viewport) throw new Error('sheet viewport not found')
    dragInternalPointer(getAssetCardByName('A1_enshutsu.png'), sheet, { toX: 255, toY: 290 })

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain(uiText.assetDrop.title)
    expect(menu.textContent).toContain('A1_enshutsu.png')
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('演出')) }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('1')

    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    const previewPanel = await waitFor(() => {
      const panel = document.querySelector('.cellAssetPreviewPanel') as HTMLElement | null
      expect(panel).toBeTruthy()
      return panel
    })
    expect(previewPanel?.textContent).toContain('演出')
    expect(previewPanel?.textContent).toContain('A1')
    expect(previewPanel?.textContent).not.toContain('A1_enshutsu.png')
  })

it('chooses a process when an external image file is dropped onto an already registered frame', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
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
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    const file = new File(['asset'], 'A1_direct.png', { type: 'image/png', lastModified: 1 })
    const dataTransfer = {
      files: [file],
      items: [],
      types: ['Files'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      getData: () => '',
    }
    fireEvent.drop(sheet, {
      clientX: 255,
      clientY: 290,
      dataTransfer,
    })

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain(uiText.assetDrop.title)
    expect(menu.textContent).toContain('A1_direct.png')
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('演出')) }))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    const previewPanel = await waitFor(() => {
      const panel = document.querySelector('.cellAssetPreviewPanel') as HTMLElement | null
      expect(panel).toBeTruthy()
      return panel
    })
    expect(previewPanel?.textContent).toContain('演出')
    expect(previewPanel?.textContent).toContain('A1')

    const assignedProcessCard = document.querySelector<HTMLElement>('.cspTreeCel.assigned')
    if (!assignedProcessCard) throw new Error('assigned process card not found')
    fireEvent.click(assignedProcessCard)
    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel.assigned')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel.assigned')).toBeTruthy())
  })

it('drops image assets onto the first frame when dropped inside an active range', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    dragTemplateDisplayFrames(sheet, 'cell', 'A', 1, 5, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()

    const target = templateFramePoint('cell', 'A', 5)
    const file = new File(['asset'], 'A1_range_drop.png', { type: 'image/png', lastModified: 1 })
    const dataTransfer = {
      files: [file],
      items: [],
      types: ['Files'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      getData: () => '',
    }
    const dropEvent = createEvent.drop(sheet)
    Object.defineProperty(dropEvent, 'clientX', { value: target.x })
    Object.defineProperty(dropEvent, 'clientY', { value: target.y })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
    fireEvent(sheet, dropEvent)

    await waitFor(() => expectSelectedHit('cell', 'A', 1))
    expectCurrentFrame(1)
    const previewPoint = templateFramePoint('cell', 'A', 1)
    fireEvent.pointerMove(sheet, { clientX: previewPoint.x, clientY: previewPoint.y })
    const previewPanel = await waitFor(() => {
      const panel = document.querySelector('.cellAssetPreviewPanel') as HTMLElement | null
      expect(panel).toBeTruthy()
      return panel
    })
    expect(previewPanel?.textContent).toContain('A1_range_drop')
  })

it('moves a registered timeline event by Alt-dragging it to another frame', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    expectSelectedHit('cell', 'A', 2)

    const source = templateFramePoint('cell', 'A', 1)
    const target = templateFramePoint('cell', 'A', 4)
    const eventHandle = document.querySelector('.timelineEventHandle') as SVGGElement | null
    if (!eventHandle) throw new Error('timeline event handle not found')
    fireEvent.pointerDown(eventHandle, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, altKey: true, clientX: source.x, clientY: source.y })
    fireEvent.pointerMove(eventHandle, { pointerId: 31, pointerType: 'mouse', buttons: 1, altKey: true, clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(eventHandle, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 0, altKey: true, clientX: target.x, clientY: target.y })

    expectSelectedHit('cell', 'A', 4)
    const targetHit = timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 4, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    if (!targetHit) throw new Error('target hit not found')
    const targetRect = cellRectForHit(standardA3SheetTemplate, targetHit, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    if (!targetRect) throw new Error('target rect not found')
    const eventRects = Array.from(document.querySelectorAll('.eventRect')) as SVGRectElement[]
    expect(eventRects).toHaveLength(1)
    expect(Number(eventRects[0].getAttribute('y'))).toBeCloseTo(targetRect.y, 6)
  })

it('selects a range when dragging from a registered timeline event without Alt', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    expectSelectedHit('cell', 'A', 2)

    const source = templateFramePoint('cell', 'A', 1)
    const target = templateFramePoint('cell', 'A', 4)
    const eventHandle = document.querySelector('.timelineEventHandle') as SVGGElement | null
    if (!eventHandle) throw new Error('timeline event handle not found')
    fireEvent.pointerDown(eventHandle, { pointerId: 32, pointerType: 'mouse', button: 0, buttons: 1, clientX: source.x, clientY: source.y })
    fireEvent.pointerMove(eventHandle, { pointerId: 32, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(eventHandle, { pointerId: 32, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

    await waitFor(() => expectSelectedRange('cell', 'A', 1, 4))
    const sourceHit = timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 1, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    if (!sourceHit) throw new Error('source hit not found')
    const sourceRect = cellRectForHit(standardA3SheetTemplate, sourceHit, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    if (!sourceRect) throw new Error('source rect not found')
    const eventRects = Array.from(document.querySelectorAll('.eventRect')) as SVGRectElement[]
    expect(eventRects).toHaveLength(1)
    expect(Number(eventRects[0].getAttribute('y'))).toBeCloseTo(sourceRect.y, 6)
  })

it('moves a registered timeline event after a long press', async () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
      setSheetRect(sheet, 0, 0)

      clickTemplateFrame(sheet, 'cell', 'A', 1)
      enterTimingValue('1')
      expectSelectedHit('cell', 'A', 2)

      const source = templateFramePoint('cell', 'A', 1)
      const target = templateFramePoint('cell', 'A', 4)
      const eventHandle = document.querySelector('.timelineEventHandle') as SVGGElement | null
      if (!eventHandle) throw new Error('timeline event handle not found')
      fireEvent.pointerDown(eventHandle, { pointerId: 33, pointerType: 'touch', button: 0, buttons: 1, clientX: source.x, clientY: source.y })
      await act(async () => {
        vi.advanceTimersByTime(SHEET_TOUCH_CONTEXT_MENU_LONG_PRESS_MS)
      })
      fireEvent.pointerMove(sheet, { pointerId: 33, pointerType: 'touch', buttons: 1, clientX: target.x, clientY: target.y })
      fireEvent.pointerUp(sheet, { pointerId: 33, pointerType: 'touch', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

      expectSelectedHit('cell', 'A', 4)
      const targetHit = timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 4, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
      if (!targetHit) throw new Error('target hit not found')
      const targetRect = cellRectForHit(standardA3SheetTemplate, targetHit, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
      if (!targetRect) throw new Error('target rect not found')
      const eventRects = Array.from(document.querySelectorAll('.eventRect')) as SVGRectElement[]
      expect(eventRects).toHaveLength(1)
      expect(Number(eventRects[0].getAttribute('y'))).toBeCloseTo(targetRect.y, 6)
    } finally {
      vi.useRealTimers()
    }
  })

it.each(['action', 'cell'] as const)('moves every %s event in an existing multi-frame selection once and ends the drag on pointer release', async role => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, role, 'A', 1)
    enterTimingValue('1')
    clickTemplateFrame(sheet, role, 'A', 3)
    enterTimingValue('2')
    dragTemplateDisplayFrames(sheet, role, 'A', 1, 3, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    await waitFor(() => expectSelectedRange(role, 'A', 1, 3))

    const source = templateFramePoint(role, 'A', 1)
    const target = templateFramePoint(role, 'A', 5)
    const sourceHit = timingHitForFrame(standardA3SheetTemplate, role, 'A', 1, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
    const sourceRect = sourceHit
      ? cellRectForHit(standardA3SheetTemplate, sourceHit, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
      : null
    const eventHandle = Array.from(document.querySelectorAll<SVGGElement>('.timelineEventHandle')).find(handle => {
      const rect = handle.querySelector<SVGRectElement>('.eventRect')
      return rect && sourceRect && Math.abs(Number(rect.getAttribute('y')) - sourceRect.y) < 0.000001
    })
    if (!eventHandle) throw new Error('selected-range timeline event handle not found')

    fireEvent.pointerDown(eventHandle, { pointerId: 34, pointerType: 'mouse', button: 0, buttons: 1, clientX: source.x, clientY: source.y })
    fireEvent.pointerMove(window, { pointerId: 34, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
    fireEvent.pointerUp(window, { pointerId: 34, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

    await waitFor(() => expectSelectedRange(role, 'A', 5, 7))
    const eventFrames = () => Array.from(document.querySelectorAll<SVGRectElement>('.eventRect'))
      .map(rect => Number(rect.getAttribute('y')))
      .sort((a, b) => a - b)
    const targetFrames = [5, 7].map(frame => {
      const hit = timingHitForFrame(standardA3SheetTemplate, role, 'A', frame, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
      const rect = hit ? cellRectForHit(standardA3SheetTemplate, hit, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin) : null
      if (!rect) throw new Error(`target rect not found for ${frame}`)
      return rect.y
    }).sort((a, b) => a - b)
    expect(eventFrames()).toEqual(targetFrames)

    const staleTarget = templateFramePoint(role, 'A', 10)
    fireEvent.pointerMove(window, { pointerId: 34, pointerType: 'mouse', buttons: 1, clientX: staleTarget.x, clientY: staleTarget.y })
    fireEvent.pointerUp(window, { pointerId: 34, pointerType: 'mouse', button: 0, buttons: 0, clientX: staleTarget.x, clientY: staleTarget.y })
    expect(eventFrames()).toEqual(targetFrames)
    expect(document.body.classList.contains('sheetInteractionActive')).toBe(false)
  })

it('opens the sheet context menu on right click and prevents the browser menu', () => {
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

    const menuEvent = createEvent.contextMenu(sheet, { clientX: 255, clientY: 290 })
    fireEvent(sheet, menuEvent)
    expect(menuEvent.defaultPrevented).toBe(true)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: uiText.actions.renamePaperTrack })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'カラセルを入力 ([X])' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '中割記号を入力 ([/])' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '逆シート記号を入力 ([.])' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'キーを削除 ([Del])' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.setNullCell }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.querySelector('.eventBlankSymbol')).toBeTruthy()
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(0)
  })

it('selects and renames a paper track from the grid column header menu', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    const headerPoint = templateColumnHeaderPoint('cell', 'A')
    clickSheet(sheet, headerPoint.x, headerPoint.y)
    expectSelectedRange('cell', 'A', 1, 144)

    fireEvent.contextMenu(sheet, { clientX: headerPoint.x, clientY: headerPoint.y })
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.selectPaperTrackColumn }))
    expect(screen.queryByRole('menu')).toBeNull()
    expectSelectedRange('cell', 'A', 1, 144)

    fireEvent.contextMenu(sheet, { clientX: headerPoint.x, clientY: headerPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.renamePaperTrack }))
    const nameInput = screen.getByLabelText(uiText.sheet.renameTrackName) as HTMLInputElement
    expect(nameInput.value).toBe('A')

    fireEvent.change(nameInput, { target: { value: 'AA' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => {
      const columnLabels = Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)
      expect(columnLabels).toContain('AA')
      expect(columnLabels).not.toContain('A')
    })
  })

it('clears frame hover previews and closes the paper track header menu on outside click', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    const framePoint = templateFramePoint('cell', 'A', 1)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    fireEvent.pointerMove(sheet, { clientX: framePoint.x, clientY: framePoint.y })
    const file = new File(['asset'], 'A1_preview.png', { type: 'image/png', lastModified: 1 })
    fireEvent.drop(sheet, {
      clientX: framePoint.x,
      clientY: framePoint.y,
      dataTransfer: {
        files: [file],
        items: [],
        types: ['Files'],
        effectAllowed: 'copy',
        dropEffect: 'none',
        getData: () => '',
      },
    })
    const processMenu = await screen.findByRole('menu')
    expect(processMenu.textContent).toContain(uiText.assetDrop.title)
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('作画')) }))
    await waitFor(() => expectSelectedHit('cell', 'A', 1))

    fireEvent.pointerMove(sheet, { clientX: framePoint.x, clientY: framePoint.y })
    await waitFor(() => expect(document.querySelector('.cellAssetPreviewPanel')).toBeTruthy())

    const headerPoint = templateColumnHeaderPoint('cell', 'A')
    fireEvent.contextMenu(sheet, { clientX: headerPoint.x, clientY: headerPoint.y })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.querySelector('.cellAssetPreviewPanel')).toBeNull()
    expect(document.querySelector('.appTooltip')).toBeNull()

    fireEvent.pointerDown(document.body, { pointerId: 98, pointerType: 'mouse', button: 0, buttons: 1, clientX: 8, clientY: 8 })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

it('renders direct x input as a grid-scaled SVG null-cell symbol', () => {
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
    enterTimingValue('x')

    const symbol = document.querySelector('.eventBlankSymbol')
    expect(symbol?.querySelectorAll('line')).toHaveLength(2)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(0)
  })

it('enters inbetween and reverse-sheet symbols without creating registered-cell cards', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('/')
    expect(document.querySelector('.eventInbetweenSymbol')).toBeTruthy()

    clickTemplateFrame(sheet, 'cell', 'A', 2)
    enterTimingValue('.')
    expect(document.querySelector('.eventReverseSymbol')).toBeTruthy()
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(0)
  })

it('moves a cell selection with arrows and adjusts or translates a range predictably', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expectSelectedHit('cell', 'A', 2)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expectSelectedHit('cell', 'B', 2)

    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true })
    expectSelectedRange('cell', 'B', 2, 3)
    fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true })
    expectSelectedRange('cell', 'B', 2, 4)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expectSelectedRange('cell', 'B', 3, 5)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expectSelectedRange('cell', 'A', 3, 5)
  })

it('clears the current sheet cell selection with Escape', () => {
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
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.selectedCellRect')).toBeNull()
    expect(screen.getByText(new RegExp(uiText.app.noCellSelected))).toBeTruthy()
  })

it('creates independent keys in ACTION and CELL grid positions', () => {
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

    clickSheet(sheet, 45, 290)
    enterTimingValue('1')
    expectSelectedHit('action', 'A', 2)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(1)
    expect(registeredCellIdentityText(document.querySelector('.cspTreeCel[data-csp-key-id]') as Element)).toBe('ACTION A')

    clickSheet(sheet, 255, 290)
    enterTimingValue('1')
    expectSelectedHit('cell', 'A', 2)
    const registeredCells = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'))
    expect(registeredCells).toHaveLength(2)
    expect(registeredCells.map(registeredCellIdentityText)).toEqual(['CELL A', 'ACTION A'])
    expect(registeredCells.map(card => card.querySelector('.cspTreeCelName')?.textContent)).toEqual(['A1_2', 'A1'])
    expect(document.querySelector('.cspTreeUnregisteredStage')).toBeNull()
  })

it('adds and restores a leading blank atomically for the first later ACTION and CELL keys', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'action', 'A', 5)
    enterTimingValue('1')
    expect(document.querySelectorAll('.eventBlankSymbol')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1'])

    clickTemplateFrame(sheet, 'cell', 'A', 8)
    enterTimingValue('2')
    expect(document.querySelectorAll('.eventBlankSymbol')).toHaveLength(2)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2'])

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(document.querySelectorAll('.eventBlankSymbol')).toHaveLength(1))
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1'])

    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(document.querySelectorAll('.eventBlankSymbol')).toHaveLength(2))
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2'])
  })

it('groups CSP cells by column and keeps CSP top-to-bottom stacking order', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'action', 'B', 3)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'action', 'A', 20)
    enterTimingValue('2')
    clickTemplateFrame(sheet, 'action', 'A', 5)
    enterTimingValue('3')
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('4')

    const cards = Array.from(document.querySelectorAll('.cspTreeCel[data-csp-key-id]'))
    expect(cards.map(registeredCellIdentityText)).toEqual(['ACTION B', 'CELL A', 'ACTION A', 'ACTION A'])
    expect(cards.map(card => card.querySelector('.cspTreeSheetLabel')?.textContent)).toEqual([
      'シート: 1',
      'シート: 4',
      'シート: 2',
      'シート: 3',
    ])
    expect(document.querySelector('.registeredCellSection')).toBeNull()
    expect(screen.queryByRole('button', { name: uiText.keys.view.list })).toBeNull()
  })

it('defaults XDTS export to the ACTION timeline and keeps protocol separators internal', () => {
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

    clickSheet(sheet, 45, 290)
    enterTimingValue('1')
    const dialog = openTimingExportDialog()
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('読込開始')).toBeNull()
    expect(screen.queryByLabelText('読込終了')).toBeNull()
  })

it('keeps range input as a draft until Enter and then steps by the selected range length', () => {
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

    dragSheet(sheet, 255, 290, 255, 310)
    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()
    expect(document.querySelector('.selectedRangeOutline')).toBeTruthy()
    expect(document.querySelector('.selectedRangeCorners')).toBeTruthy()
    expect(document.querySelector('.selectedCellCorners')).toBeTruthy()
    expectSelectedRange('cell', 'A', 1, 3)
    expect((within(openTimingTextSettingsMenu()).getByRole('spinbutton', { name: uiText.sheet.timingTextFontSize }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(0)
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('1')
    expectSelectedRange('cell', 'A', 1, 3)

    fireEvent.keyDown(window, { key: '2' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('12')
    expectSelectedRange('cell', 'A', 1, 3)

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['12'])
    expectSelectedRange('cell', 'A', 4, 6)

    enterTimingValue('2')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['12', '2'])
    expectSelectedRange('cell', 'A', 7, 9)
  })

it('edits a timing draft with Backspace, commits it on cell change, and cancels it with Escape', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('1')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)

    clickTemplateFrame(sheet, 'cell', 'A', 3)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1'])
    expectSelectedHit('cell', 'A', 3)

    fireEvent.keyDown(window, { key: '9' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('9')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    expectSelectedHit('cell', 'A', 3)
  })

it('selects a CELL range across the left and right six-second sheet blocks', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    dragSheet(sheet, 255, 947, 744, 290)

    expectSelectedRange('cell', 'A', 70, 73)
    expect(document.querySelectorAll('.selectedRangeRect')).toHaveLength(2)
  })

it('keeps the starting CELL column locked while dragging a range across neighboring columns', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    dragSheet(sheet, 255, 290, 285, 310)

    expectSelectedRange('cell', 'A', 1, 3)
    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()
  })

it('selects a CELL range across visible sheet pages', async () => {
    render(<App />)
    openCutMetadataMenu()
    fireEvent.change(screen.getByLabelText(uiText.sheet.durationFrames), { target: { value: '6' } })

    const firstSheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const secondSheet = await screen.findByLabelText(uiText.sheet.canvasPageLabel(2))
    setSheetRect(firstSheet, 0, 0)
    setSheetRect(secondSheet, 0, 1100)

    fireEvent.pointerDown(firstSheet, { pointerId: 13, pointerType: 'mouse', button: 0, buttons: 1, clientX: 744, clientY: 966 })
    fireEvent.pointerMove(firstSheet, { pointerId: 13, pointerType: 'mouse', buttons: 1, clientX: 255, clientY: 1390 })
    fireEvent.pointerUp(firstSheet, { pointerId: 13, pointerType: 'mouse', button: 0, buttons: 0, clientX: 255, clientY: 1390 })

    expectSelectedRange('cell', 'A', 144, 145)
    expect(document.querySelectorAll('.selectedRangeRect')).toHaveLength(2)
  })

it('suppresses native text selection while dragging a sheet range', async () => {
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

    const pointerDown = createEvent.pointerDown(sheet, { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 1, clientX: 255, clientY: 290 })
    fireEvent(sheet, pointerDown)
    expect(pointerDown.defaultPrevented).toBe(true)
    await waitFor(() => expect(document.body.classList.contains('sheetInteractionActive')).toBe(true))

    fireEvent.pointerMove(sheet, { pointerId: 12, pointerType: 'mouse', buttons: 1, clientX: 255, clientY: 310 })
    fireEvent.pointerUp(sheet, { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 0, clientX: 255, clientY: 310 })

    await waitFor(() => expect(document.body.classList.contains('sheetInteractionActive')).toBe(false))
    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()
  })

it('clears selections that become hidden when pre-roll display is disabled', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    let preRoll = within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(true)

    clickSheet(sheet, 255, 290)
    enterTimingValue('9')
    expectSelectedHit('cell', 'A', -22)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('9')

    preRoll = within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(false)
    await waitFor(() => expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).not.toContain('9'))

    enterTimingValue('5')
    preRoll = within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['9'])
  })

it('selects SOUND ranges while rendering only the template-defined dotted columns', () => {
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

    expect(document.querySelectorAll('.gridOverlay-sound .gridLineCustom')).toHaveLength(4)
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineRow')).toHaveLength(2)
    dragSheet(sheet, 190, 290, 190, 310)

    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()
  expectSelectedRange('sound', 'sound_1', 1, 3)
})

it('clears primary sheet selection from gray viewport space while preserving pan and context gestures', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const viewport = sheet.closest('.sheetViewport') as HTMLElement
    const pageStack = viewport.querySelector('.sheetPageStack') as HTMLElement

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()
    fireEvent.pointerDown(viewport, { pointerId: 81, pointerType: 'mouse', button: 2, buttons: 2 })
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()

    fireEvent.pointerDown(viewport, { pointerId: 82, pointerType: 'mouse', button: 1, buttons: 4 })
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 82, pointerType: 'mouse', button: 1, buttons: 0 })

    fireEvent.pointerDown(pageStack, { pointerId: 83, pointerType: 'mouse', button: 0, buttons: 1 })
    expect(document.querySelector('.selectedCellRect')).toBeNull()
  })

it('adds and renames a logical SOUND lane from paper, then expands it as a digital column', async () => {
  render(<App />)
  const displayMenu = openDisplaySettingsMenu()
  fireEvent.click(within(displayMenu).getByRole('button', { name: 'A3標準' }))
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  const lanePoint = templateTimelineLaneHeaderPoint('sound', 'sound_lane_1')

  fireEvent.contextMenu(sheet, { clientX: lanePoint.x, clientY: lanePoint.y })
  const laneMenu = screen.getByRole('menu', { name: 'SOUND列の操作' })
  expect(within(laneMenu).getByRole('menuitem', { name: 'SOUND列を追加' })).toBeTruthy()
  expect(within(laneMenu).getByRole('menuitem', { name: '列名を変更' })).toBeTruthy()
  expect(within(laneMenu).getByRole('menuitem', { name: '列を削除' })).toBeTruthy()
  fireEvent.click(within(laneMenu).getByRole('menuitem', { name: 'SOUND列を追加' }))

  const addEditor = screen.getByRole('form', { name: 'SOUND列追加' })
  const addName = within(addEditor).getByLabelText('SOUND列名')
  expect((addName as HTMLInputElement).value).toBe('S5')
  fireEvent.change(addName, { target: { value: 'SE' } })
  fireEvent.click(within(addEditor).getByRole('button', { name: '確定' }))
  await waitFor(() => expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toContain('SOUND（欄外 +1）'))

  const insertedLanePoint = templateTimelineLaneHeaderPoint('sound', 'sound_lane_2')
  fireEvent.contextMenu(sheet, { clientX: insertedLanePoint.x, clientY: insertedLanePoint.y })
  fireEvent.click(screen.getByRole('menuitem', { name: '列名を変更' }))
  const renameEditor = screen.getByRole('form', { name: 'SOUND列名前変更' })
  const renameName = within(renameEditor).getByLabelText('SOUND列名')
  fireEvent.change(renameName, { target: { value: 'FOLEY' } })
  fireEvent.click(within(renameEditor).getByRole('button', { name: '確定' }))

  const digitalMenu = openDisplaySettingsMenu()
  fireEvent.click(within(digitalMenu).getByRole('button', { name: 'デジタル標準' }))
  await waitFor(() => {
    const labels = Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)
    expect(labels).not.toContain('FOLEY')
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])
  })

  const paperMenu = openDisplaySettingsMenu()
  fireEvent.click(within(paperMenu).getByRole('button', { name: 'A3標準' }))
  fireEvent.contextMenu(sheet, { clientX: insertedLanePoint.x, clientY: insertedLanePoint.y })
  fireEvent.click(screen.getByRole('menuitem', { name: '列名を変更' }))
  expect((within(screen.getByRole('form', { name: 'SOUND列名前変更' })).getByLabelText('SOUND列名') as HTMLInputElement).value).toBe('FOLEY')
})

it('preserves a selected SOUND range through double-click and releases native pointer state after closing', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const soundRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_sound_grid')
    if (!soundRegion?.grid) throw new Error('SOUND region not found')
    const x = (soundRegion.rect.x + soundRegion.rect.w / soundRegion.grid.columns.length / 2) * 1000
    const frameY = (frame: number) => (soundRegion.rect.y + soundRegion.rect.h * ((frame - 1 + 0.5) / soundRegion.grid!.rowCount)) * 1000

    dragSheet(sheet, x, frameY(1), x, frameY(6))
    expectSelectedRange('sound', 'sound_1', 1, 6)

    for (const pointerId of [91, 92]) {
      dispatchBatchedPointerClick(sheet, pointerId, x, frameY(3))
      expectSelectedRange('sound', 'sound_1', 1, 6)
    }
    fireEvent.doubleClick(sheet, { button: 0, clientX: x, clientY: frameY(3) })

    expect(screen.getByRole('dialog', { name: 'SOUND指示' })).toBeTruthy()
    expect(screen.queryByLabelText('SOUND開始フレーム')).toBeNull()
    expect((screen.getByLabelText('長さ 秒') as HTMLInputElement).value).toBe('00')
    expect((screen.getByLabelText('長さ コマ') as HTMLInputElement).value).toBe('06')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    const cellFrame = templateFramePoint('cell', 'A', 20)
    dispatchBatchedPointerClick(sheet, 93, cellFrame.x, cellFrame.y, window)
    await waitFor(() => expectSelectedHit('cell', 'A', 20))
    expect(document.querySelector('.draftRangeRect')).toBeNull()
    expect(document.body.classList.contains('sheetInteractionActive')).toBe(false)
})

it('creates, edits, moves, resizes, copies, and undoes SOUND interval cues', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const soundRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_sound_grid')
    if (!soundRegion?.grid) throw new Error('SOUND region not found')
    const x = (soundRegion.rect.x + soundRegion.rect.w / soundRegion.grid.columns.length / 2) * 1000
    const frameY = (frame: number) => (soundRegion.rect.y + soundRegion.rect.h * ((frame - 1 + 0.5) / soundRegion.grid!.rowCount)) * 1000

    dragSheet(sheet, x, frameY(1), x, frameY(6))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'SOUND指示' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'アキラ' } })
    fireEvent.change(screen.getByLabelText('SOUND内容'), { target: { value: '走れ！' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(document.querySelectorAll('.soundCue')).toHaveLength(1))
    let cue = document.querySelector<SVGGElement>('.soundCue')!
    expect(cue.dataset).toMatchObject({ soundCueId: 'cue_1', soundLaneId: 'sound_lane_1', frameStart: '1', frameEnd: '6' })
    expect(cue.querySelector('.soundCueText.outside')).toBeTruthy()
    const horizontalClip = document.querySelector<SVGRectElement>('.soundCueHorizontalClip[data-region-id="left_sound_grid"]')!
    expect(Number(horizontalClip.getAttribute('x'))).toBeCloseTo(soundRegion.rect.x)
    expect(Number(horizontalClip.getAttribute('width'))).toBeCloseTo(soundRegion.rect.w)
    expect(Number(horizontalClip.getAttribute('y'))).toBeLessThan(soundRegion.rect.y)
    fireEvent.pointerEnter(cue, { clientX: x, clientY: frameY(1) })
    expect(screen.getByRole('tooltip').textContent).toContain('走れ！')
    fireEvent.pointerLeave(cue)

    const selectedSoundBody = cue.querySelector<SVGRectElement>('.soundCueBody')!
    fireEvent.pointerDown(selectedSoundBody, { pointerId: 79, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerUp(cue, { pointerId: 79, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(2) })
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind')).toBe('timed-cue')
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('SOUND「アキラ」 1-6F')
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.textTool }))
    await waitFor(() => expect(document.querySelector('.timelineMemoAnchorCue.selected')?.getAttribute('data-timeline-memo-anchor-cue-ids')).toBe('cue_1'))
    const cueMemoEditor = await screen.findByRole('textbox', { name: 'メモ文字' })
    expect(document.activeElement).toBe(cueMemoEditor)
    expect(sheet.classList.contains('textAnnotationPlacementMode')).toBe(false)
    expect(document.querySelector('.pageAnnotationInputSurface[data-annotation-tool="text"]')).toBeNull()
    fireEvent.change(cueMemoEditor, { target: { value: 'セリフ注釈' } })
    fireEvent.keyDown(cueMemoEditor, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(document.querySelector('.timelineMemoText')?.textContent).toBe('セリフ注釈'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.timelineMemoSegment.selected')).toBeNull())

    const cellFrame = templateFramePoint('cell', 'A', 20)
    fireEvent.pointerDown(sheet, { pointerId: 80, pointerType: 'mouse', button: 0, buttons: 1, clientX: cellFrame.x, clientY: cellFrame.y })
    await waitFor(() => expectSelectedHit('cell', 'A', 20))
    enterTimingValue('2')
    await waitFor(() => expectSelectedHit('cell', 'A', 21))
    expect(Array.from(document.querySelectorAll('.eventText')).some(item => item.textContent === '2')).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'SOUND指示' })).toBeNull()
    expect(document.querySelector('.draftRangeRect')).toBeNull()

    cue = document.querySelector<SVGGElement>('.soundCue')!
    const soundBody = cue.querySelector<SVGRectElement>('.soundCueBody')!
    fireEvent.doubleClick(soundBody, { button: 0, clientX: x, clientY: frameY(2) })
    expect((screen.getByLabelText('SOUNDラベル') as HTMLInputElement).value).toBe('アキラ')
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'SE' } })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(document.querySelector('.soundCueLabel')?.textContent).toBe('SE'))

    cue = document.querySelector<SVGGElement>('.soundCue')!
    const body = cue.querySelector<SVGRectElement>('.soundCueBody')!
    vi.useFakeTimers()
    fireEvent.pointerDown(body, { pointerId: 81, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    await act(async () => {
      vi.advanceTimersByTime(SHEET_TOUCH_CONTEXT_MENU_LONG_PRESS_MS)
    })
    vi.useRealTimers()
    fireEvent.pointerMove(sheet, { pointerId: 81, pointerType: 'touch', buttons: 1, clientX: x, clientY: frameY(11) })
    fireEvent.pointerUp(sheet, { pointerId: 81, pointerType: 'touch', button: 0, buttons: 0, clientX: x, clientY: frameY(11) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '10', frameEnd: '15' }))
    expect(document.querySelector('.soundCueText.outside')).toBeTruthy()
    fireEvent.pointerMove(window, { pointerId: 81, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(30) })
    expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '10', frameEnd: '15' })

    cue = document.querySelector<SVGGElement>('.soundCue')!
    const endHandle = cue.querySelector<SVGRectElement>('.soundCueEdgeHandle.end')!
    fireEvent.pointerDown(endHandle, { pointerId: 82, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(15) })
    fireEvent.pointerMove(cue, { pointerId: 82, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(20) })
    cue = document.querySelector<SVGGElement>('.soundCue')!
    fireEvent.pointerUp(cue, { pointerId: 82, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(20) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset.frameEnd).toBe('20'))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset.frameEnd).toBe('15'))

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    dragSheet(sheet, x, frameY(30), x, frameY(35))
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    await waitFor(() => expect(document.querySelectorAll('.soundCue')).toHaveLength(2))
    expect(Array.from(document.querySelectorAll<SVGGElement>('.soundCue')).map(item => [item.dataset.frameStart, item.dataset.frameEnd])).toEqual([
      ['10', '15'],
      ['30', '35'],
    ])
  })

it('creates and edits semantic CAMERA instructions while preserving selected ranges on double-click', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const cameraRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_camera_grid')
    if (!cameraRegion?.grid) throw new Error('CAMERA region not found')
    const laneWidth = cameraRegion.rect.w / cameraRegion.grid.columns.length
    const x = (cameraRegion.rect.x + laneWidth / 2) * 1000
    const frameY = (frame: number) => (cameraRegion.rect.y + cameraRegion.rect.h * ((frame - 1 + 0.5) / cameraRegion.grid!.rowCount)) * 1000

    dragSheet(sheet, x, frameY(1), x, frameY(12))
    expectSelectedRange('camera', 'camera_1', 1, 12)
    for (const pointerId of [101, 102]) {
      dispatchBatchedPointerClick(sheet, pointerId, x, frameY(5))
      expectSelectedRange('camera', 'camera_1', 1, 12)
    }
    fireEvent.doubleClick(sheet, { button: 0, clientX: x, clientY: frameY(5) })
    expect(screen.getByRole('dialog', { name: '撮影指示' })).toBeTruthy()
    expect(screen.queryByLabelText('CAMERA開始フレーム')).toBeNull()
    expect((screen.getByLabelText('長さ コマ') as HTMLInputElement).value).toBe('12')
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    fireEvent.change(screen.getByLabelText('CAMERA開始ラベル'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了ラベル'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    fireEvent.change(screen.getByLabelText('CAMERA中間ラベル1'), { target: { value: 'MID' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(document.querySelectorAll('.cameraCue')).toHaveLength(1))
    let cue = document.querySelector<SVGGElement>('.cameraCue')!
    expect(cue.dataset).toMatchObject({ cameraCueId: 'cue_1', cameraLaneId: 'camera_lane_1', frameStart: '1', frameEnd: '12' })
    expect(cue.classList.contains('overlap')).toBe(true)
    expect(cue.querySelectorAll('.cameraCueStroke')).toHaveLength(4)
    expect(cue.querySelectorAll('.cameraCuePivotHandle')).toHaveLength(2)
    const endpointLabels = Array.from(document.querySelectorAll<SVGGElement>('.cameraCueEndpointLabel'))
    expect(endpointLabels.map(item => item.textContent)).toEqual(['A', 'MID', 'B'])
    expect(endpointLabels.every(item =>
      item.hasAttribute('clip-path')
      && !item.hasAttribute('transform')
      && item.querySelector(':scope > g[transform] > text'),
    )).toBe(true)
    expect(screen.queryByRole('dialog', { name: '撮影指示' })).toBeNull()

    const selectedCameraShape = cue.querySelector<SVGPolylineElement>('.cameraCueShapeHit')!
    fireEvent.pointerDown(selectedCameraShape, { pointerId: 100, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerUp(cue, { pointerId: 100, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(2) })
    fireEvent.click(screen.getByRole('button', { name: 'メモツールを開く' }))
    expect(document.querySelector('.annotationFloatingPalette')?.getAttribute('data-annotation-target-kind')).toBe('timed-cue')
    expect(document.querySelector('.annotationTargetLabel')?.textContent).toContain('CAMERA「OL」 1-12F')
    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
    await waitFor(() => expect(document.querySelector('.timelineMemoAnchorCue.selected')?.getAttribute('data-timeline-memo-anchor-cue-ids')).toBe('cue_1'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.timelineMemoSegment.selected')).toBeNull())

    const actionFrame = templateFramePoint('action', 'A', 20)
    fireEvent.pointerDown(sheet, { pointerId: 103, pointerType: 'mouse', button: 0, buttons: 1, clientX: actionFrame.x, clientY: actionFrame.y })
    await waitFor(() => expectSelectedHit('action', 'A', 20))
    expect(document.querySelector('.draftRangeRect')).toBeTruthy()
    enterTimingValue('1')
    await waitFor(() => expectSelectedHit('action', 'A', 21))
    expect(Array.from(document.querySelectorAll('.eventText')).some(item => item.textContent === '1')).toBe(true)
    expect(screen.queryByRole('dialog', { name: '撮影指示' })).toBeNull()
    expect(document.querySelector('.draftRangeRect')).toBeNull()
    expect(document.body.classList.contains('sheetInteractionActive')).toBe(false)
    cue = document.querySelector<SVGGElement>('.cameraCue')!
    let shapeHit = cue.querySelector<SVGPolylineElement>('.cameraCueShapeHit')!
    fireEvent.pointerDown(shapeHit, { pointerId: 104, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerUp(cue, { pointerId: 104, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(2) })
    await waitFor(() => expect(document.querySelector('.cameraCuePivotHandle')).toBeTruthy())

    cue = document.querySelector<SVGGElement>('.cameraCue')!
    shapeHit = cue.querySelector<SVGPolylineElement>('.cameraCueShapeHit')!
    vi.useFakeTimers()
    fireEvent.pointerDown(shapeHit, { pointerId: 105, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    await act(async () => {
      vi.advanceTimersByTime(SHEET_TOUCH_CONTEXT_MENU_LONG_PRESS_MS)
    })
    vi.useRealTimers()
    fireEvent.pointerMove(sheet, { pointerId: 105, pointerType: 'touch', buttons: 1, clientX: x, clientY: frameY(12) })
    fireEvent.pointerMove(sheet, { pointerId: 105, pointerType: 'touch', buttons: 1, clientX: x, clientY: frameY(20) })
    fireEvent.pointerUp(sheet, { pointerId: 105, pointerType: 'touch', button: 0, buttons: 0, clientX: x, clientY: frameY(20) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '19', frameEnd: '30' }))
    expect(document.querySelector('.cameraCue.transforming')).toBeNull()
    expect(document.body.classList.contains('sheetInteractionActive')).toBe(false)
    fireEvent.pointerMove(window, { pointerId: 105, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(35) })
    expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '19', frameEnd: '30' })

    let intermediatePoint = document.querySelector<SVGGElement>('.cameraCuePoint.intermediate')!
    expect(intermediatePoint.dataset.cameraPointFrame).toBe('24')
    const intermediateHit = intermediatePoint.querySelector<SVGRectElement>('.cameraCuePointHit')!
    fireEvent.pointerDown(intermediateHit, { pointerId: 108, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(24) })
    intermediatePoint = document.querySelector<SVGGElement>('.cameraCuePoint.intermediate')!
    fireEvent.pointerMove(intermediatePoint, { pointerId: 108, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(26) })
    intermediatePoint = document.querySelector<SVGGElement>('.cameraCuePoint.intermediate')!
    fireEvent.pointerUp(intermediatePoint, { pointerId: 108, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(26) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCuePoint.intermediate')?.dataset.cameraPointFrame).toBe('26'))

    cue = document.querySelector<SVGGElement>('.cameraCue')!
    const pivot = cue.querySelectorAll<SVGEllipseElement>('.cameraCuePivotHandle')[1]!
    fireEvent.pointerDown(pivot, { pointerId: 106, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(24) })
    fireEvent.pointerMove(cue, { pointerId: 106, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(28) })
    cue = document.querySelector<SVGGElement>('.cameraCue')!
    fireEvent.pointerUp(cue, { pointerId: 106, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(28) })

    const labelGroup = document.querySelector<SVGGElement>('.cameraCueLabel')!
    const labelHit = labelGroup.querySelector<SVGRectElement>('.cameraCueLabelHit')!
    fireEvent.pointerDown(labelHit, { pointerId: 107, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(24) })
    fireEvent.pointerMove(labelGroup, { pointerId: 107, pointerType: 'mouse', buttons: 1, clientX: x + laneWidth * 2000, clientY: frameY(27) })
    const movedLabelGroup = document.querySelector<SVGGElement>('.cameraCueLabel')!
    fireEvent.pointerUp(movedLabelGroup, { pointerId: 107, pointerType: 'mouse', button: 0, buttons: 0, clientX: x + laneWidth * 2000, clientY: frameY(27) })
    await waitFor(() => expect(document.querySelector('.cameraCueLabel')?.classList.contains('manual')).toBe(true))

    const cameraEditHit = document.querySelector<SVGRectElement>('.cameraCueLabelHit')!
    fireEvent.doubleClick(cameraEditHit, { button: 0, clientX: x, clientY: frameY(28) })
    expect((screen.getByLabelText('中間ラベル1から次の点までの交差フレーム') as HTMLInputElement).value).toBe('28')
    expect(screen.getByRole('button', { name: '自動配置に戻す' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '開始から次の点までをフェードイン・ワイプイン' }))
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(document.querySelector('.cameraCue')?.classList.contains('fade-in')).toBe(true))
    expect(document.querySelector('.cameraCueFade')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(document.querySelector('.cameraCue')?.classList.contains('overlap')).toBe(true))
  })

it('copies a selected timing range and repeats it across another range', () => {
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
    clickSheet(sheet, 255, 300)
    enterTimingValue('2')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)

    dragSheet(sheet, 255, 290, 255, 300)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    dragSheet(sheet, 255, 328, 255, 357)
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true, shiftKey: true })

    expect(document.querySelectorAll('.eventRect')).toHaveLength(6)
  })

it('requires a target range for range repeat paste', () => {
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
    clickSheet(sheet, 255, 300)
    enterTimingValue('2')
    dragSheet(sheet, 255, 290, 255, 300)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    fireEvent.contextMenu(sheet, { clientX: 255, clientY: 380 })
    const pasteMenuItem = screen.getByRole('menuitem', { name: uiText.actions.pasteOverwrite }) as HTMLButtonElement
    expect(pasteMenuItem.disabled).toBe(false)
    const repeatMenuItem = screen.getByRole('menuitem', { name: uiText.actions.repeatPaste }) as HTMLButtonElement
    expect(repeatMenuItem.disabled).toBe(true)

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true, shiftKey: true })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)
  })

it('copies a pre-roll range into the official cut while pre-roll is visible', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.preRoll))
    clickTemplateDisplayFrame(sheet, 'cell', 'A', -23, 168, -23)
    enterTimingValue('9')
    clickTemplateDisplayFrame(sheet, 'cell', 'A', 1, 168, -23)
    enterTimingValue('1')

    dragTemplateDisplayFrames(sheet, 'cell', 'A', -23, 1, 168, -23)
    expectSelectedRange('cell', 'A', -23, 1)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    clickTemplateDisplayFrame(sheet, 'cell', 'A', 2, 168, -23)
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    expectSelectedRange('cell', 'A', 2, 26)
    expect(document.querySelectorAll('.eventRect').length).toBeGreaterThanOrEqual(3)
  })

it('overwrites, cuts, and inserts timing ranges from the sheet context menu', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'cell', 'A', 2)
    enterTimingValue('2')
    clickTemplateFrame(sheet, 'cell', 'A', 4)
    enterTimingValue('4')
    dragSheet(sheet, 255, 290, 255, 300)
    let menuPoint = templateFramePoint('cell', 'A', 1)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.copyRange }))

    clickTemplateFrame(sheet, 'cell', 'A', 4)
    menuPoint = templateFramePoint('cell', 'A', 4)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.pasteOverwrite }))
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2', '1', '2'])

    dragSheet(sheet, 255, 290, 255, 300)
    menuPoint = templateFramePoint('cell', 'A', 1)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.cutRange }))
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2'])

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    menuPoint = templateFramePoint('cell', 'A', 1)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.pasteInsert }))
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2', '1', '2'])
  })

it('shows post-roll after insert paste beyond the cut end and clips XDTS output to the official duration', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 143)
    enterTimingValue('7')
    clickTemplateFrame(sheet, 'cell', 'A', 144)
    enterTimingValue('8')
    dragTemplateDisplayFrames(sheet, 'cell', 'A', 143, 144, 144, 1)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    const menuPoint = templateFramePoint('cell', 'A', 144)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.pasteInsert }))

    expect(within(openDisplaySettingsMenu()).getByText(uiText.sheet.postRollFrames(2))).toBeTruthy()
    expect(document.querySelectorAll('.eventRect').length).toBeGreaterThanOrEqual(4)

    const dialog = openTimingExportDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'CELL' }))
    expect(within(dialog).getByRole('button', { name: 'CELL' }).getAttribute('aria-pressed')).toBe('true')
  })

it('opens frame operation commands from the sheet context menu', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'cell', 'A', 3)
    enterTimingValue('3')

    const insertPoint = templateFramePoint('cell', 'A', 2)
    fireEvent.contextMenu(sheet, { clientX: insertPoint.x, clientY: insertPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.frameOperation.insert }))
    const insertDialog = screen.getByRole('dialog', { name: uiText.frameOperation.dialogTitleInsert })
    fireEvent.click(within(insertDialog).getByLabelText(uiText.frameOperation.targetCut))
    expect(within(insertDialog).queryByText('尺を延ばす')).toBeNull()
    fireEvent.click(within(insertDialog).getByRole('button', { name: uiText.frameOperation.submitInsert }))

    expect(screen.queryByRole('dialog', { name: uiText.frameOperation.dialogTitleInsert })).toBeNull()
    expect(screen.getAllByText(/145F/).length).toBeGreaterThan(0)

    dragTemplateDisplayFrames(sheet, 'cell', 'A', 1, 2, 145, 1)
    const deletePoint = templateFramePoint('cell', 'A', 1)
    fireEvent.contextMenu(sheet, { clientX: deletePoint.x, clientY: deletePoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.frameOperation.delete }))
    const deleteDialog = screen.getByRole('dialog', { name: uiText.frameOperation.dialogTitleDelete })
    expect((within(deleteDialog).getByLabelText(uiText.frameOperation.frameCount) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(within(deleteDialog).getByLabelText(uiText.frameOperation.targetCut))
    fireEvent.click(within(deleteDialog).getByRole('button', { name: uiText.frameOperation.submitDelete }))

    expect(screen.queryByRole('dialog', { name: uiText.frameOperation.dialogTitleDelete })).toBeNull()
    expect(screen.getAllByText(/143F/).length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(2)
  })

it('ripples ACTION, CELL, SOUND, and CAMERA together from every frame-bearing context menu', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const soundRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_sound_grid')
    const cameraRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_camera_grid')
    if (!soundRegion?.grid || !cameraRegion?.grid) throw new Error('timed range regions not found')
    const timedPoint = (region: typeof soundRegion, frame: number) => ({
      x: (region.rect.x + region.rect.w / region.grid!.columns.length / 2) * 1000,
      y: (region.rect.y + region.rect.h * ((frame - 1 + 0.5) / region.grid!.rowCount)) * 1000,
    })

    const soundStart = timedPoint(soundRegion, 4)
    const soundEnd = timedPoint(soundRegion, 8)
    dragSheet(sheet, soundStart.x, soundStart.y, soundEnd.x, soundEnd.y)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'RIPPLE SOUND' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    const cameraStart = timedPoint(cameraRegion, 6)
    const cameraEnd = timedPoint(cameraRegion, 10)
    dragSheet(sheet, cameraStart.x, cameraStart.y, cameraEnd.x, cameraEnd.y)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.click(screen.getByRole('radio', { name: '開始から次の点までをオーバーラップ' }))
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'RIPPLE CAMERA' } })
    fireEvent.change(screen.getByLabelText('開始から次の点までの交差フレーム'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    clickTemplateFrame(sheet, 'action', 'A', 2)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'cell', 'B', 8)
    enterTimingValue('2')

    const insertPoint = timedPoint(soundRegion, 6)
    fireEvent.contextMenu(sheet, { clientX: insertPoint.x, clientY: insertPoint.y })
    expect(screen.getByRole('menuitem', { name: uiText.frameOperation.insert })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.frameOperation.insert }))
    const insertDialog = screen.getByRole('dialog', { name: uiText.frameOperation.dialogTitleInsert })
    expect(within(insertDialog).queryByLabelText(uiText.frameOperation.targetCut)).toBeNull()
    fireEvent.change(within(insertDialog).getByLabelText(uiText.frameOperation.frameCount), { target: { value: '3' } })
    fireEvent.click(within(insertDialog).getByRole('button', { name: uiText.frameOperation.submitInsert }))

    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '4', frameEnd: '11' }))
    expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '9', frameEnd: '13' })
    expect(Array.from(document.querySelectorAll('.eventText')).map(item => item.textContent)).toEqual(['1', '2'])
    expect(screen.getAllByText(/147F/).length).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '4', frameEnd: '8' }))
    expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '6', frameEnd: '10' })
    expect(screen.getAllByText(/144F/).length).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '9', frameEnd: '13' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '6', frameEnd: '10' }))
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '9', frameEnd: '13' }))

    const deleteStart = timedPoint(cameraRegion, 9)
    const deleteEnd = timedPoint(cameraRegion, 13)
    dragSheet(sheet, deleteStart.x, deleteStart.y, deleteEnd.x, deleteEnd.y)
    expectSelectedRange('camera', 'camera_1', 9, 13)
    const cameraCueHit = document.querySelector('.cameraCueShapeHit')
    if (!cameraCueHit) throw new Error('camera cue hit target not found')
    fireEvent.contextMenu(cameraCueHit, { clientX: deleteStart.x, clientY: deleteStart.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.frameOperation.delete }))
    const deleteDialog = screen.getByRole('dialog', { name: uiText.frameOperation.dialogTitleDelete })
    expect((within(deleteDialog).getByLabelText(uiText.frameOperation.frameCount) as HTMLInputElement).value).toBe('5')
    expect((within(deleteDialog).getByLabelText(uiText.frameOperation.frameCount) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(within(deleteDialog).getByRole('button', { name: uiText.frameOperation.submitDelete }))

    await waitFor(() => expect(document.querySelector('.cameraCue')).toBeNull())
    expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '4', frameEnd: '8' })
    expect(Array.from(document.querySelectorAll('.eventText')).map(item => item.textContent)).toEqual(['1'])
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(2)
    expect(screen.getAllByText(/142F/).length).toBeGreaterThan(0)

    const actionPoint = templateFramePoint('action', 'A', 20)
    fireEvent.pointerDown(sheet, { pointerId: 120, pointerType: 'mouse', button: 0, buttons: 1, clientX: actionPoint.x, clientY: actionPoint.y })
    enterTimingValue('3')
    await waitFor(() => expect(Array.from(document.querySelectorAll('.eventText')).map(item => item.textContent)).toContain('3'))
  })

it('registers new timing at the active process without moving it when the destination later changes', () => {
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

    selectCspCorrectionLayer('演出')
    clickSheet(sheet, 255, 290)
    enterTimingValue('1')
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]') as Element
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell.closest('.cspTreeLayer')?.querySelector('.cspTreeSummaryLabel')?.textContent).toBe('演出')
    expect(document.querySelector('.cspTreeUnregisteredStage')).toBeNull()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    selectCspCorrectionLayer('作画')
    expect(registeredCell.closest('.cspTreeLayer')?.querySelector('.cspTreeSummaryLabel')?.textContent).toBe('演出')
    expectSelectionStatus('作画', 'CELL', 'A', formatTestFramePosition(2))
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
  })
})
