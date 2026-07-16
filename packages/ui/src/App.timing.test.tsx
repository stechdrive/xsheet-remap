import { describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cellRectForHit, timingHitForFrame, standardA3SheetTemplate } from '@xsheet-remap/core';
import { App } from './App';
import { uiText } from './i18n';
import { dispatchInternalDrag } from './internalDrag';
import { clickSheet, clickTemplateDisplayFrame, clickTemplateFrame, dragInternalPointer, dragSheet, dragTemplateDisplayFrames, enterTimingValue, expectCurrentFrame, expectSelectedHit, expectSelectedRange, expectSelectionStatus, expectStatusHint, formatTestFramePosition, getAssetCardByName, openCutMetadataMenu, openStackGuideInsertMenu, openTimingExportDialog, registeredCellIdentityText, setSheetRect, setStackGuideOverlayRect, stackGuideConnectorAnchorX, templateColumnHeaderPoint, templateFramePoint, templateStackGuideBodySnapPoint, templateStackGuideHeaderPoint, templateStackGuideHeaderSnapPoint } from './App.test-support'

describe('App: sheet timing interactions', () => {
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
    expect(registeredCell.classList.contains('internalPointerDragSource')).toBe(true)
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

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.deleteOverlayPaperTrack }))

    await waitFor(() => expect(Array.from(document.querySelectorAll('.overlayPaperTrackLabelText')).some(label => label.textContent === 'J')).toBe(false))
    expect(confirmSpy).toHaveBeenCalled()
  })

it('adds a BG/BOOK label from the registered-cell plus menu and places it in the reserve slot before A', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByLabelText('作画にトラックを追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
    const defaultTarget = document.querySelector<HTMLElement>('.stackGuideGap.insertToolActive')
    expect(defaultTarget?.dataset.stackGuideRole).toBe('action')
    expect(defaultTarget?.dataset.stackGuideSnapIndex).toBe('0')

    const overlay = setStackGuideOverlayRect()
    const reservePoint = templateStackGuideHeaderSnapPoint('action', 0)
    fireEvent.pointerMove(overlay, { pointerId: 1, pointerType: 'mouse', clientX: reservePoint.x, clientY: reservePoint.y })
    fireEvent.click(overlay, { clientX: reservePoint.x, clientY: reservePoint.y })
    fireEvent.change(await screen.findByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BG' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BG'))
    const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === 'action')
    if (!region?.grid) throw new Error('action region not found')
    const expectedAnchorX = region.rect.x - region.rect.w / region.grid.columns.length
    expect(stackGuideConnectorAnchorX('BG')).toBeCloseTo(expectedAnchorX, 4)
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
    const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === 'action')
    if (!region?.grid) throw new Error('action region not found')
    const expectedAnchorX = region.rect.x - region.rect.w / region.grid.columns.length
    expect(stackGuideConnectorAnchorX('BOOK')).toBeCloseTo(expectedAnchorX, 4)
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

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const assignedProcessCard = document.querySelector<HTMLElement>('.cspTreeCel.assigned')
    if (!assignedProcessCard) throw new Error('assigned process card not found')
    fireEvent.click(assignedProcessCard)
    fireEvent.click(within(assignedProcessCard).getByRole('button', { name: /1を削除$/ }))
    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteProcessCardConfirm('作画', 'A1'))
    expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeTruthy()

    confirmSpy.mockReturnValue(true)
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

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const assignedProcessCard = document.querySelector<HTMLElement>('.cspTreeCel.assigned')
    if (!assignedProcessCard) throw new Error('assigned process card not found')
    fireEvent.click(within(assignedProcessCard).getByRole('button', { name: /1を削除$/ }))
    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteProcessCardConfirm('演出', 'A1'))
    expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeTruthy()
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
      fireEvent.pointerDown(eventHandle, { pointerId: 33, pointerType: 'mouse', button: 0, buttons: 1, clientX: source.x, clientY: source.y })
      await act(async () => {
        vi.advanceTimersByTime(340)
      })
      expect(eventHandle.classList.contains('timelineEventDragReady')).toBe(true)
      fireEvent.pointerMove(eventHandle, { pointerId: 33, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
      fireEvent.pointerUp(eventHandle, { pointerId: 33, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

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

    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.setNullCell }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('x')
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

it('treats direct x input as a hidden reserved null-cell event', () => {
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

    expect(document.querySelector('.eventText')?.textContent).toBe('x')
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(0)
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
    expect((screen.getByRole('spinbutton', { name: uiText.sheet.textFontSize }) as HTMLInputElement).disabled).toBe(true)

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

    let preRoll = screen.getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(true)

    clickSheet(sheet, 255, 290)
    enterTimingValue('9')
    expectSelectedHit('cell', 'A', -22)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('9')

    preRoll = screen.getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(false)
    await waitFor(() => expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).not.toContain('9'))

    enterTimingValue('5')
    preRoll = screen.getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['9'])
  })

it('selects SOUND ranges without rendering app-drawn SOUND grid lines', () => {
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

    expect(document.querySelector('.gridOverlay-sound')).toBeNull()
    dragSheet(sheet, 190, 290, 190, 310)

    expect(document.querySelector('.selectedRangeRect')).toBeTruthy()
  expectSelectedRange('sound', 'sound_1', 1, 3)
})

it('preserves a selected SOUND range through the click sequence that opens it by double-click', () => {
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
      fireEvent.pointerDown(sheet, { pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(3) })
      fireEvent.pointerUp(sheet, { pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(3) })
      expectSelectedRange('sound', 'sound_1', 1, 6)
    }
    fireEvent.doubleClick(sheet, { button: 0, clientX: x, clientY: frameY(3) })

    expect(screen.getByRole('dialog', { name: 'SOUND区間を追加' })).toBeTruthy()
    expect((screen.getByLabelText('SOUND開始フレーム') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('SOUNDデュレーション秒') as HTMLInputElement).value).toBe('0')
    expect((screen.getByLabelText('SOUNDデュレーションコマ') as HTMLInputElement).value).toBe('6')
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
    expect(screen.getByRole('dialog', { name: 'SOUND区間を追加' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'アキラ' } })
    fireEvent.change(screen.getByLabelText('SOUND内容'), { target: { value: '走れ！' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(document.querySelectorAll('.soundCue')).toHaveLength(1))
    let cue = document.querySelector<SVGGElement>('.soundCue')!
    expect(cue.dataset).toMatchObject({ soundCueId: 'cue_1', soundLaneId: 'sound_lane_1', frameStart: '1', frameEnd: '6' })
    fireEvent.pointerEnter(cue, { clientX: x, clientY: frameY(1) })
    expect(screen.getByRole('tooltip').textContent).toContain('走れ！')
    fireEvent.pointerLeave(cue)

    fireEvent.doubleClick(cue)
    expect((screen.getByLabelText('SOUNDラベル') as HTMLInputElement).value).toBe('アキラ')
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'SE' } })
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(document.querySelector('.soundCueLabel')?.textContent).toBe('SE'))

    cue = document.querySelector<SVGGElement>('.soundCue')!
    const body = cue.querySelector<SVGRectElement>('.soundCueBody')!
    fireEvent.pointerDown(body, { pointerId: 81, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerMove(cue, { pointerId: 81, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(11) })
    cue = document.querySelector<SVGGElement>('.soundCue')!
    fireEvent.pointerUp(cue, { pointerId: 81, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(11) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.soundCue')?.dataset).toMatchObject({ frameStart: '10', frameEnd: '15' }))

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
      fireEvent.pointerDown(sheet, { pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(5) })
      fireEvent.pointerUp(sheet, { pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(5) })
      expectSelectedRange('camera', 'camera_1', 1, 12)
    }
    fireEvent.doubleClick(sheet, { button: 0, clientX: x, clientY: frameY(5) })
    expect(screen.getByRole('dialog', { name: 'CAMERA指示を追加' })).toBeTruthy()
    expect((screen.getByLabelText('CAMERA開始フレーム') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('CAMERAデュレーションコマ') as HTMLInputElement).value).toBe('12')
    fireEvent.change(screen.getByLabelText('CAMERA描画種別'), { target: { value: 'overlap' } })
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    fireEvent.change(screen.getByLabelText('CAMERA開始キュー'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了キュー'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('CAMERA交差フレーム'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    await waitFor(() => expect(document.querySelectorAll('.cameraCue')).toHaveLength(1))
    let cue = document.querySelector<SVGGElement>('.cameraCue')!
    expect(cue.dataset).toMatchObject({ cameraCueId: 'cue_1', cameraLaneId: 'camera_lane_1', frameStart: '1', frameEnd: '12' })
    expect(cue.classList.contains('overlap')).toBe(true)
    expect(cue.querySelectorAll('.cameraCueStroke')).toHaveLength(2)
    expect(cue.querySelector('.cameraCuePivotHandle')).toBeTruthy()
    expect(Array.from(cue.querySelectorAll('.cameraCueEndpointLabel')).map(item => item.textContent)).toEqual(['A', 'B'])
    expect(screen.queryByRole('dialog', { name: 'CAMERA指示を追加' })).toBeNull()

    clickTemplateFrame(sheet, 'action', 'A', 20)
    await waitFor(() => expectSelectedHit('action', 'A', 20))
    cue = document.querySelector<SVGGElement>('.cameraCue')!
    let shapeHit = cue.querySelector<SVGPolylineElement>('.cameraCueShapeHit')!
    fireEvent.pointerDown(shapeHit, { pointerId: 103, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerUp(cue, { pointerId: 103, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(2) })
    await waitFor(() => expect(document.querySelector('.cameraCuePivotHandle')).toBeTruthy())

    cue = document.querySelector<SVGGElement>('.cameraCue')!
    shapeHit = cue.querySelector<SVGPolylineElement>('.cameraCueShapeHit')!
    fireEvent.pointerDown(shapeHit, { pointerId: 104, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(2) })
    fireEvent.pointerMove(cue, { pointerId: 104, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(20) })
    cue = document.querySelector<SVGGElement>('.cameraCue')!
    fireEvent.pointerUp(cue, { pointerId: 104, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(20) })
    await waitFor(() => expect(document.querySelector<SVGGElement>('.cameraCue')?.dataset).toMatchObject({ frameStart: '19', frameEnd: '30' }))

    cue = document.querySelector<SVGGElement>('.cameraCue')!
    const pivot = cue.querySelector<SVGEllipseElement>('.cameraCuePivotHandle')!
    fireEvent.pointerDown(pivot, { pointerId: 105, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(24) })
    fireEvent.pointerMove(cue, { pointerId: 105, pointerType: 'mouse', buttons: 1, clientX: x, clientY: frameY(28) })
    cue = document.querySelector<SVGGElement>('.cameraCue')!
    fireEvent.pointerUp(cue, { pointerId: 105, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: frameY(28) })

    const labelGroup = document.querySelector<SVGGElement>('.cameraCueLabel')!
    const labelHit = labelGroup.querySelector<SVGRectElement>('.cameraCueLabelHit')!
    fireEvent.pointerDown(labelHit, { pointerId: 106, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: frameY(24) })
    fireEvent.pointerMove(labelGroup, { pointerId: 106, pointerType: 'mouse', buttons: 1, clientX: x + laneWidth * 2000, clientY: frameY(27) })
    const movedLabelGroup = document.querySelector<SVGGElement>('.cameraCueLabel')!
    fireEvent.pointerUp(movedLabelGroup, { pointerId: 106, pointerType: 'mouse', button: 0, buttons: 0, clientX: x + laneWidth * 2000, clientY: frameY(27) })
    await waitFor(() => expect(document.querySelector('.cameraCueLabel')?.classList.contains('manual')).toBe(true))

    fireEvent.doubleClick(document.querySelector<SVGGElement>('.cameraCue')!)
    expect((screen.getByLabelText('CAMERA交差フレーム') as HTMLInputElement).value).toBe('28')
    expect(screen.getByRole('button', { name: '自動配置に戻す' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('CAMERA描画種別'), { target: { value: 'fade-in' } })
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

    fireEvent.click(screen.getByLabelText(uiText.sheet.preRoll))
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

    expect(screen.getByText(uiText.sheet.postRollFrames(2))).toBeTruthy()
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
    expect((within(insertDialog).getByLabelText(uiText.frameOperation.extendDuration) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(insertDialog).getByRole('button', { name: uiText.frameOperation.submitInsert }))

    expect(screen.queryByRole('dialog', { name: uiText.frameOperation.dialogTitleInsert })).toBeNull()
    expect(screen.getAllByText(/145F/).length).toBeGreaterThan(0)

    dragTemplateDisplayFrames(sheet, 'cell', 'A', 1, 2, 145, 1)
    const deletePoint = templateFramePoint('cell', 'A', 1)
    fireEvent.contextMenu(sheet, { clientX: deletePoint.x, clientY: deletePoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.frameOperation.delete }))
    const deleteDialog = screen.getByRole('dialog', { name: uiText.frameOperation.dialogTitleDelete })
    expect((within(deleteDialog).getByLabelText(uiText.frameOperation.frameCount) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(within(deleteDialog).getByRole('button', { name: uiText.frameOperation.submitDelete }))

    expect(screen.queryByRole('dialog', { name: uiText.frameOperation.dialogTitleDelete })).toBeNull()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(2)
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

    fireEvent.change(screen.getByLabelText(uiText.sheet.registrationProcess), { target: { value: 'layer_enshutsu' } })
    clickSheet(sheet, 255, 290)
    enterTimingValue('1')
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]') as Element
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell.closest('.cspTreeLayer')?.querySelector('.cspTreeSummaryLabel')?.textContent).toBe('演出')
    expect(document.querySelector('.cspTreeUnregisteredStage')).toBeNull()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText(uiText.sheet.registrationProcess), { target: { value: 'layer_sakuga' } })
    expect(registeredCell.closest('.cspTreeLayer')?.querySelector('.cspTreeSummaryLabel')?.textContent).toBe('演出')
    expectSelectionStatus('作画', 'CELL', 'A', formatTestFramePosition(2))
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
  })
})
