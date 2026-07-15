import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { assignSheetSourceToPage, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, digitalStandardSheetTemplate, registerAsset, registerAssetRoot, registerSheetSource, upsertBinding, standardA3SheetTemplate, updateLogicalSheetSettings } from '@xsheet-remap/core';
import { App, EditorApp, RemapApp } from './App';
import { APP_VERSION } from './appVersion';
import { uiText } from './i18n';
import { ASSET_DRAG_MIME } from './sheetConstants';
import { clickActiveStackGuideInsertHandle, clickSheet, clickTemplateFrame, dragInternalPointer, expectSelectedHit, expectStatusHint, formatTestFramePosition, getAssetCardByName, getZoomSlider, markMissingTauriPath, openAppNavigationMenu, openCutMetadataMenu, openTimingExportDialog, registeredCellIdentityText, selectAppPanel, setSheetRect, sheetImageHrefs, stackGuideConnectorAnchorX, templateFramePoint, templateStackGuideHeaderPoint, templateStackGuideHeaderSnapPoint } from './App.test-support'

describe('App: workspace and template', () => {
it('renders the main workspace shell', () => {
    render(<App />)
    expect(screen.getByText('xsheet-editor')).toBeTruthy()
    const appNavigationMenu = openAppNavigationMenu()
    expect(within(appNavigationMenu).getByText(`xsheet-editor v${APP_VERSION}`)).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.sheet })).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.actions.xdts })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: '認識' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.sources })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.assets })).toBeNull()
    expect(screen.getByRole('button', { name: uiText.sheet.imageCorrection })).toBeTruthy()
    expect(screen.getByLabelText(uiText.recognition.menu)).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.template })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル対応' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル重ね順' })).toBeNull()
    expect(screen.queryByText('詳細スロット一覧')).toBeNull()
    expect(screen.getByLabelText('紙シート')).toBeTruthy()
    expect(screen.getByLabelText(uiText.actions.loadSheetSourceFiles)).toBeTruthy()
    expect(screen.getByLabelText(uiText.sheet.viewModeMenu)).toBeTruthy()
    expect(document.querySelector('.sheetWorkspace')).toBeTruthy()
    expect(document.querySelector('.sheetDockLeft .cspLayerTreeHeader strong')?.textContent).toBe('CSPレイヤー構成')
    expect(document.querySelector('.sheetDockRight h2')?.textContent).toBe(uiText.assets.title)
    expect(screen.queryByRole('tablist', { name: uiText.sheet.sideDock })).toBeNull()
  })

it('provides a focused CSP remap shell without template authoring navigation', () => {
    render(<RemapApp />)
    expect(screen.getByText('xsheet-remap')).toBeTruthy()
    expect(document.querySelector('.cspLayerTree')).toBeTruthy()
    expect(screen.getByText('CSPレイヤー構成')).toBeTruthy()
    expect(screen.queryByText('パレット表示順')).toBeNull()
    expect(screen.queryByText('CSPパレット上端')).toBeNull()
    expect(screen.queryByText('CSPパレット下端')).toBeNull()
    const appNavigationMenu = openAppNavigationMenu()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.sheet })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル対応' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル重ね順' })).toBeNull()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.actions.xdts })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.template })).toBeNull()
  })

it('adds an empty paper track and a material-unassigned card from the CSP layer pane', async () => {
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByRole('button', { name: 'セル列を追加' }))
    await clickActiveStackGuideInsertHandle(templateStackGuideHeaderPoint('action', 3))
    fireEvent.change(screen.getByLabelText(uiText.sheet.addOverlayTrackName), { target: { value: 'J' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeTrackNameInput')).map(input => input.value))
        .toContain('J')
    })
    const emptyTrack = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrack'))
      .find(track => track.querySelector<HTMLInputElement>('.cspTreeTrackNameInput')?.value === 'J')
    expect(emptyTrack?.querySelector('.cspTreeNoCels')?.textContent).toBe('カードなし')

    fireEvent.click(screen.getByRole('button', { name: 'J（作画）にセルを追加' }))
    const cspNameInput = screen.getByLabelText('J（作画）に追加するCSPセル名') as HTMLInputElement
    expect(cspNameInput.value).toBe('J_01')
    fireEvent.click(screen.getByRole('button', { name: 'セルを追加' }))

    await waitFor(() => {
      const card = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
      expect(card?.querySelector<HTMLInputElement>('.cspTreeCelNameInput')?.value).toBe('J_01')
      expect(card?.classList.contains('assigned')).toBe(false)
      expect(card?.querySelector<HTMLInputElement>('.cspTreeSheetNameField input')?.value).toBe('')
    })
  })

it('keeps the selected correction layer when placing a BG or BOOK track from the CSP pane', async () => {
    URL.createObjectURL = () => 'blob:csp-stack-guide-asset'
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByLabelText('演出にトラックを追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
    const activeTarget = document.querySelector<HTMLElement>('.stackGuideGap.insertToolActive')
    expect(activeTarget?.dataset.stackGuideSnapIndex).toBe('0')
    const reservePoint = templateStackGuideHeaderSnapPoint('action', 0)
    await clickActiveStackGuideInsertHandle(reservePoint)
    fireEvent.change(screen.getByLabelText(uiText.stackGuides.inputLabel), { target: { value: 'BG1' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.confirm }))

    await waitFor(() => {
      const bgTrack = Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeTrackNameInput'))
        .find(track => track.value === 'BG1')
      expect(bgTrack?.closest('.cspTreeLayer')?.querySelector(':scope > summary')?.textContent).toBe('演出')
    })
    const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === 'action')
    if (!region?.grid) throw new Error('action region not found')
    expect(stackGuideConnectorAnchorX('BG1')).toBeCloseTo(region.rect.x - region.rect.w / region.grid.columns.length, 4)

    const assetFile = new File(['bg'], 'BG1.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [assetFile] } })
    expect(await screen.findByText('BG1.png')).toBeTruthy()
    const bgTrack = screen.getByLabelText('BG1（演出）へ画像素材を割り当て')
    dragInternalPointer(getAssetCardByName('BG1.png'), bgTrack)

    await waitFor(() => {
      const assignedTrack = screen.getByLabelText('BG1（演出）へ画像素材を割り当て').closest('.cspTreeTrack')
      expect(assignedTrack?.querySelector('.cspTreeCel.assigned')).toBeTruthy()
    })
  })

it('creates unplaced CSP cards by dropping multiple selected assets into a correction layer and avoids duplicates', async () => {
    URL.createObjectURL = file => `blob:csp-multi-${(file as File).name}`
    render(<RemapApp />)

    const firstFile = new File(['a1'], 'A1.png', { type: 'image/png', lastModified: 1 })
    const secondFile = new File(['a2'], 'A2.png', { type: 'image/png', lastModified: 2 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [firstFile, secondFile] } })
    expect(await screen.findByText('A1.png')).toBeTruthy()
    expect(await screen.findByText('A2.png')).toBeTruthy()

    const firstCard = getAssetCardByName('A1.png')
    const secondCard = getAssetCardByName('A2.png')
    fireEvent.click(firstCard)
    fireEvent.click(secondCard, { ctrlKey: true })

    const gap = screen.getByLabelText('作画のセル列挿入位置1')
    dragInternalPointer(firstCard, gap)
    expect((screen.getByLabelText('作画に追加するセル列名') as HTMLInputElement).value).toBe('A')
    fireEvent.click(screen.getByRole('button', { name: 'セル列を作成して素材を登録' }))

    await waitFor(() => {
      const track = screen.getByLabelText('A（作画）にカードを追加').closest('.cspTreeTrack')
      expect(track?.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(track?.querySelector('.cspTreeCelFrame')).toBeNull()
      expect(Array.from(track?.querySelectorAll<HTMLInputElement>('.cspTreeCel input') ?? []).map(input => input.value)).toEqual(['A2', 'A1'])
    })

    const addToTrack = screen.getByLabelText('A（作画）にカードを追加')
    const track = addToTrack.closest('.cspTreeTrack')
    if (!track) throw new Error('CSP track not found')
    const existingCard = track.querySelector<HTMLElement>('.cspTreeCel')
    if (!existingCard) throw new Error('registered CSP card not found')
    dragInternalPointer(firstCard, existingCard)
    await waitFor(() => {
      expect(track.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(screen.getByRole('status').textContent).toBe('複数素材はセル列の「カードを追加」へドロップしてください。')
    })

    dragInternalPointer(firstCard, addToTrack)
    await waitFor(() => {
      expect(track.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(screen.getByRole('status').textContent).toBe('0件追加 / 2件は登録済み')
    })

  })

it('binds a sheet-first key from the unregistered tree to the active CSP destination', async () => {
    URL.createObjectURL = file => `blob:csp-unregistered-${(file as File).name}`
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.change(screen.getByLabelText(uiText.sheet.registrationProcess), { target: { value: 'layer_enshutsu' } })
    clickTemplateFrame(sheet, 'action', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })

    const unregisteredCard = document.querySelector<HTMLElement>('.cspTreeCel.unregistered')
    if (!unregisteredCard) throw new Error('unregistered CSP card not found')
    expect(unregisteredCard.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    expect(unregisteredCard.querySelector('.cspTreeCelFrame')).toBeNull()

    const file = new File(['fix'], 'scan_001.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [file] } })
    expect(await screen.findByText('scan_001.png')).toBeTruthy()

    dragInternalPointer(getAssetCardByName('scan_001.png'), unregisteredCard)

    await waitFor(() => {
      expect(document.querySelector('.cspTreeCel.unregistered')).toBeNull()
      const track = screen.getByLabelText('A（演出）にカードを追加').closest('.cspTreeTrack')
      expect(track?.querySelector('.cspTreeCel.assigned')).toBeTruthy()
      expect((track?.querySelector('.cspTreeCel input') as HTMLInputElement | null)?.value).toBe('A1')
    })

    fireEvent.click(screen.getByRole('button', { name: uiText.nameNormalization.open }))
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect((screen.getByLabelText(uiText.nameNormalization.process) as HTMLSelectElement).value).toBe('layer_enshutsu')
    fireEvent.click(screen.getAllByRole('button', { name: uiText.nameNormalization.cancel })[0])
  })

it('keeps CSP track order and names synchronized with the paper sheet', async () => {
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'action', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })
    clickTemplateFrame(sheet, 'action', 'B', 4)
    fireEvent.keyDown(window, { key: '2' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeTrackNameInput')).map(input => input.value))
        .toEqual(['B', 'A'])
    })

    const columnX = (label: string) => {
      const element = Array.from(document.querySelectorAll<SVGTextElement>('.templateColumnText'))
        .find(item => item.textContent === label)
      if (!element) throw new Error(`template column not found: ${label}`)
      return Number(element.getAttribute('x'))
    }
    expect(columnX('A')).toBeLessThan(columnX('B'))

    fireEvent.click(screen.getByRole('button', { name: '全工程のAをCSPで上へ（シートで右へ）' }))
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeTrackNameInput')).map(input => input.value))
        .toEqual(['A', 'B'])
      expect(columnX('B')).toBeLessThan(columnX('A'))
    })

    const trackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(trackName, { target: { value: 'LO' } })
    fireEvent.blur(trackName)
    await waitFor(() => {
      expect(screen.getByLabelText('LOのセル列名')).toBeTruthy()
      expect(Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)).toContain('LO')
      expect(Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)).not.toContain('A')
    })
  })

it('starts the editor with optional work panes collapsed and can reopen them', () => {
    render(<EditorApp />)
    const leftDock = document.querySelector<HTMLElement>('.sheetDockLeft')
    const rightDock = document.querySelector<HTMLElement>('.sheetDockRight')
    expect(leftDock?.hidden).toBe(true)
    expect(rightDock?.hidden).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'CSPレイヤー構成' }))
    fireEvent.click(screen.getByRole('button', { name: '画像素材' }))
    expect(leftDock?.hidden).toBe(false)
    expect(rightDock?.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'CSPレイヤー構成' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: '画像素材' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.sheetPaneVisibilityControls')).toBeNull()
    expect(document.querySelectorAll('.sheetPaneEdgeToggle')).toHaveLength(0)
    expect(document.querySelectorAll('.panelResizeRail')).toHaveLength(2)
    expect(document.querySelectorAll('.panelResizeRail > .panelResizeToggle')).toHaveLength(2)
  })

it('persists side-pane widths and resets a resized pane to its default width', async () => {
    window.localStorage.setItem('xsheet:remap:sheet-pane-layout', JSON.stringify({
      left: false,
      right: true,
      leftWidth: 318,
      rightWidth: 444,
    }))
    const firstRender = render(<RemapApp />)
    const workspace = document.querySelector<HTMLElement>('.sheetWorkspace')
    if (!workspace) throw new Error('sheet workspace not found')

    expect(document.querySelector<HTMLElement>('.sheetDockLeft')?.hidden).toBe(true)
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('0px')
    expect(workspace.style.getPropertyValue('--sheet-right-dock-width')).toBe('444px')

    fireEvent.click(screen.getByRole('button', { name: 'CSPレイヤー構成' }))
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('318px')
    const leftResizeHandle = screen.getByRole('separator', { name: uiText.layout.resizeCspLayerTreePane })
    fireEvent.doubleClick(leftResizeHandle)
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('240px')

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('xsheet:remap:sheet-pane-layout') ?? '{}') as Record<string, unknown>
      expect(stored).toMatchObject({ left: true, right: true, leftWidth: 240, rightWidth: 444 })
    })

    firstRender.unmount()
    render(<RemapApp />)
    const restoredWorkspace = document.querySelector<HTMLElement>('.sheetWorkspace')
    expect(restoredWorkspace?.style.getPropertyValue('--sheet-left-dock-width')).toBe('240px')
    expect(restoredWorkspace?.style.getPropertyValue('--sheet-right-dock-width')).toBe('444px')
  })

it('opens remap XDTS export options from the export menu without adding a workspace tab', () => {
    render(<RemapApp />)
    const dialog = openTimingExportDialog()
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('読込開始')).toBeNull()
    expect(screen.queryByText('読込終了')).toBeNull()
  })

it('keeps only one top action menu open at a time', () => {
    render(<App />)
    const projectSummary = screen.getByLabelText(uiText.nav.menu)
    const viewModeSummary = screen.getByLabelText(uiText.sheet.viewModeMenu)
    const projectMenu = projectSummary.closest('details')
    const viewModeMenu = viewModeSummary.closest('details')
    if (!projectMenu || !viewModeMenu) throw new Error('action menus not found')

    fireEvent.click(projectSummary)
    expect(projectMenu.open).toBe(true)
    expect(viewModeMenu.open).toBe(false)

    fireEvent.click(viewModeSummary)
    expect(viewModeMenu.open).toBe(true)
    expect(projectMenu.open).toBe(false)
  })

it('defaults OCR to the template-defined ACTION target', () => {
    render(<App />)
    const menu = screen.getByLabelText(uiText.recognition.menu)
    expect(menu.textContent).toContain('OCR')
    fireEvent.click(menu)

    const roleGroup = screen.getByRole('group', { name: uiText.recognition.targetField })
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.action }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.cell }).getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByRole('button', { name: uiText.actions.runOcrAllPages }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('濃さ')).toBeNull()
    expect(screen.queryByText('記入率')).toBeNull()
  })

it('separates template lines and labels in the display menu', () => {
    render(<App />)
    expect(document.querySelectorAll('.gridLine').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.templateHeaderText').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByLabelText(uiText.sheet.viewModeMenu))
    const menu = document.querySelector('.actionMenuPortalContent.sheetLayerMenu')
    if (!(menu instanceof HTMLElement)) throw new Error('sheet layer menu not found')
    const lines = within(menu).getByLabelText(uiText.sheet.templateGuides)
    const labels = within(menu).getByLabelText(uiText.sheet.templateLabels)

    fireEvent.click(lines)
    expect(document.querySelectorAll('.gridLine')).toHaveLength(0)
    expect(document.querySelectorAll('.templateHeaderText').length).toBeGreaterThan(0)

    fireEvent.click(labels)
    expect(document.querySelectorAll('.templateHeaderText')).toHaveLength(0)
  })

it('edits cut metadata from a template-defined sheet region', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })
    expect(editButton.childElementCount).toBe(0)
    expect(editButton.getAttribute('title')).toContain('ダブルクリック')
    fireEvent.click(editButton)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()

    fireEvent.doubleClick(editButton)
    const dialog = screen.getByRole('dialog', { name: 'カットを編集' })
    expect(within(dialog).getAllByText('カット')).toHaveLength(1)
    const input = within(dialog).getByLabelText('カット')
    fireEvent.change(input, { target: { value: 'C042' } })

    expect(screen.getByLabelText(uiText.sheet.cutMetadata).textContent).toContain('C042')
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toContain('C042')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
    expect(document.activeElement).toBe(editButton)
  })

  it('light-dismisses template-defined metadata editing', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })

    fireEvent.doubleClick(editButton)
    expect(screen.getByRole('dialog', { name: 'カットを編集' })).not.toBeNull()
    const outsideTarget = screen.getByLabelText(uiText.sheet.cutMetadata)
    fireEvent.pointerDown(outsideTarget)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()

    fireEvent.doubleClick(editButton)
    fireEvent.focusIn(outsideTarget)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
  })

  it('opens template-defined metadata editing from the keyboard', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })

    editButton.focus()
    fireEvent.keyDown(editButton, { key: 'F2' })
    const dialog = screen.getByRole('dialog', { name: 'カットを編集' })
    fireEvent.keyDown(within(dialog).getByLabelText('カット'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
    expect(document.activeElement).toBe(editButton)

    fireEvent.keyDown(editButton, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'カットを編集' })).not.toBeNull()
  })

  it('shows one duration label and focuses the seconds input in inline editing', () => {
    render(<App />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '尺を編集' }))

    const dialog = screen.getByRole('dialog', { name: '尺を編集' })
    expect(within(dialog).getAllByText('尺')).toHaveLength(1)
    expect(within(dialog).getByRole('group', { name: '尺' })).not.toBeNull()
    expect(document.activeElement).toBe(within(dialog).getByLabelText(uiText.sheet.durationSeconds))
  })

it('uses one page grid and one selected-page source editor for multipage sheets', async () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 300 })
    const file = new File([JSON.stringify(createProjectDocumentFromCutProject(project))], 'multipage.json', { type: 'application/json' })
    render(<App />)
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('project input not found')
    fireEvent.change(input, { target: { files: [file] } })

    const pageMenuTrigger = await screen.findByLabelText(uiText.sheet.activePage)
    fireEvent.click(pageMenuTrigger)
    const pageMenu = document.querySelector('.actionMenuPortalContent.pageJumpMenu')
    if (!(pageMenu instanceof HTMLElement)) throw new Error('page menu not found')
    expect(pageMenu.querySelectorAll('.pageJumpPageButton')).toHaveLength(3)
    expect(pageMenu.querySelectorAll('.pageJumpSourceSelect select')).toHaveLength(1)
  })

it('closes the app navigation menu when a file picker item is selected', async () => {
    render(<App />)
    const trigger = screen.getByLabelText(uiText.nav.menu)
    const menu = openAppNavigationMenu()
    const details = trigger.closest('details')
    if (!details) throw new Error('app navigation details not found')

    const loadProjectLabel = within(menu).getByText(uiText.actions.loadProject).closest('label')
    if (!loadProjectLabel) throw new Error('load project file label not found')
    const loadProjectInput = loadProjectLabel.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.click(loadProjectLabel)
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(details.open).toBe(true)

    const file = new File([JSON.stringify(createProjectDocumentFromCutProject(createDefaultProject()))], 'project.json', { type: 'application/json' })
    fireEvent.change(loadProjectInput, { target: { files: [file] } })
    await waitFor(() => expect(details.open).toBe(false))
    expect(document.querySelector('.actionMenuPortalContent.appNavMenu')).toBeNull()
  })

it('restores paper sheet images from saved project file paths', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const sourcePath = 'D:\\cuts\\C001\\sheet_001.png'
    const registered = registerSheetSource(createDefaultProject(), {
      name: 'sheet_001.png',
      path: sourcePath,
      size: 1024,
      lastModified: 1,
    })
    const projectWithSheet = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const file = new File([JSON.stringify(createProjectDocumentFromCutProject(projectWithSheet))], 'project.json', { type: 'application/json' })

    render(<App />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(sheetImageHrefs()).toContain('asset://D:/cuts/C001/sheet_001.png'))
  })

it('warns on project load when registered material files are missing on disk', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const rootPath = 'D:\\cuts\\C001'
    const materialPath = 'D:\\cuts\\C001\\A_01.png'
    markMissingTauriPath(materialPath)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const rooted = registerAssetRoot(created.project, {
      label: 'C001',
      path: rootPath,
      handleKind: 'directory',
    })
    const asset = registerAsset(rooted.project, {
      name: 'A_01.png',
      path: materialPath,
      relativePath: 'A_01.png',
      size: 100,
      lastModified: 1,
    }, {
      role: 'cell-material',
      relativePath: 'A_01.png',
    })
    const bound = upsertBinding(asset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: asset.asset.assetId,
    })
    const file = new File([JSON.stringify(createProjectDocumentFromCutProject(bound))], 'project.json', { type: 'application/json' })

    render(<App />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('登録素材: 1件')))
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining(materialPath))
  })

it('edits sheet template metadata and embeds a template reference image', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    const nameInput = screen.getByDisplayValue('A3標準') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'スタジオA3' } })
    expect(nameInput.value).toBe('スタジオA3')

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.reference }))
    const referenceLabel = screen.getByText(uiText.actions.loadTemplateReferenceImage).closest('label')
    const referenceInput = referenceLabel?.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!referenceInput) throw new Error('template reference image input not found')

    const referenceImage = new File(['reference'], 'studio_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(referenceInput, { target: { files: [referenceImage] } })

    await waitFor(() => expect(screen.getByText('studio_sheet.png')).toBeTruthy())
    expect(screen.getByText(uiText.template.referenceImageEmbedded)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.json }))
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('スタジオA3')
    expect(json?.value).toContain('studio_sheet.png')
    expect(json?.value).toContain('data:image/png')
  })

it('edits template grid header labels from the display tab', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.display }))

    const secondCounter = screen.getByLabelText(uiText.template.secondCounter) as HTMLInputElement
    expect(secondCounter.checked).toBe(true)
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    fireEvent.click(secondCounter)
    expect(document.querySelectorAll('.gridSecondCounter')).toHaveLength(0)
    fireEvent.click(secondCounter)

    const bottomTrackLabels = screen.getByLabelText(uiText.template.bottomTrackLabels) as HTMLInputElement
    expect(bottomTrackLabels.checked).toBe(true)
    expect(document.querySelectorAll('.gridBottomTrackLabel')).toHaveLength(36)
    fireEvent.click(bottomTrackLabels)
    expect(document.querySelectorAll('.gridBottomTrackLabel')).toHaveLength(0)
    fireEvent.click(bottomTrackLabels)

    const soundInput = screen.getByLabelText(uiText.template.gridHeaderLabelInput('SOUND')) as HTMLInputElement
    expect(soundInput.value).toBe('')

    fireEvent.change(soundInput, { target: { value: '台詞' } })
    expect(soundInput.value).toBe('台詞')
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toContain('台詞')

    fireEvent.change(soundInput, { target: { value: '' } })
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).not.toContain('SOUND')
  })

it('uses the template header label for the OCR target name', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.display }))
    fireEvent.change(screen.getByLabelText(uiText.template.gridHeaderLabelInput('ACTION')), { target: { value: '演技指示' } })
    fireEvent.click(screen.getByRole('button', { name: uiText.template.applyDraft }))

    selectAppPanel(uiText.nav.sheet)
    fireEvent.click(screen.getByLabelText(uiText.recognition.menu))
    const roleGroup = screen.getByRole('group', { name: uiText.recognition.targetField })
    expect(within(roleGroup).getByRole('button', { name: '演技指示' }).getAttribute('aria-pressed')).toBe('true')
  })

it('edits the cut duration as seconds and frames with stepper buttons', () => {
    render(<App />)
    const menu = openCutMetadataMenu()
    const secondsInput = screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement
    const framesInput = screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement
    expect(within(menu).getByText(uiText.sheet.duration)).toBeTruthy()
    expect(within(menu).getByRole('group', { name: uiText.sheet.duration })).toBeTruthy()
    expect(screen.queryByText('シート設定')).toBeNull()
    expect(screen.queryByText('ページ画像')).toBeNull()
    expect(screen.queryByLabelText(uiText.sheet.fps)).toBeNull()
    expect(screen.queryByText('24fps')).toBeNull()
    expect(secondsInput.value).toBe('06')
    expect(framesInput.value).toBe('00')

    fireEvent.change(secondsInput, { target: { value: '7' } })
    fireEvent.change(framesInput, { target: { value: '12' } })
    expect(screen.getByText('180F / 7.5s')).toBeTruthy()
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('07')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('12')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.durationFramesUp }))
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('07')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('13')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.durationSecondsDown }))
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('06')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('13')
  })

it('dims visible paper rows outside the cut duration without creating post-roll state', () => {
    render(<App />)
    openCutMetadataMenu()

    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '3' } })

    expect(screen.queryByText(uiText.sheet.postRollFrames(72))).toBeNull()
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(4)

    const preRoll = screen.getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(true)
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(8)

    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(false)
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(4)
  })

it('renders the default paper template chrome and grid lines', () => {
    render(<App />)
    const paperTextTransform = `scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`
    expect(screen.getByLabelText(uiText.sheet.canvasLabel).getAttribute('preserveAspectRatio')).toBe('none')
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(1)
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toHaveLength(6)
    expect(headerLabels).not.toContain('SOUND')
    expect(document.querySelector('.templateHeaderBox')?.getAttribute('height')).toBe(String(48 / 2481))
    expect((document.querySelector('.templateHeaderBox') as SVGRectElement | null)?.style.fill).toBe('none')
    expect(document.querySelectorAll('.templateReferenceText')).toHaveLength(0)
    expect(document.querySelectorAll('.gridLine, .gridLineMajor').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-action, .gridOverlay-cell, .gridOverlay-camera').length).toBeGreaterThan(0)
    expect(document.querySelector('.gridOverlay-sound')).toBeNull()
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toEqual(['001', '06+00', '1/1'])
    expect(document.querySelector('.templateHeaderText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.templateColumnText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.gridActionFrameNumber')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.metadataFieldText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(Array.from(document.querySelectorAll('.sheetSvg text')).every(element => element.getAttribute('transform') === paperTextTransform)).toBe(true)
  })

it('toggles shared cut numbers beside the cut switch even before another cut exists', () => {
    render(<App />)

    const initialToggle = screen.getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(initialToggle.disabled).toBe(false)
    expect(initialToggle.checked).toBe(true)
    fireEvent.click(initialToggle)
    expect(initialToggle.checked).toBe(false)
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).not.toContain('[]')

    fireEvent.click(document.querySelector('.cutSwitchAddButton') as HTMLButtonElement)
    const toggle = screen.getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(true)
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toContain('[001]')
  })

it('keeps template creation as a draft until apply or cancel', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect((screen.getByRole('button', { name: uiText.template.applyDraft }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(uiText.actions.newTemplate))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.createDigitalTemplate }))

    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.json }))
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('"templateKind": "digital-native"')
    expect(json?.value).toContain(uiText.template.draftNames.digital)
    expect(json?.value).toMatch(/"templateId": "digital-template-[a-z0-9]+"/)

    fireEvent.click(screen.getByRole('button', { name: uiText.template.cancelDraft }))
    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(1)
    expect(document.querySelector('.gridOverlay-sound')).toBeNull()

    fireEvent.click(screen.getByLabelText(uiText.actions.newTemplate))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.createDigitalTemplate }))
    fireEvent.click(screen.getByRole('button', { name: uiText.template.applyDraft }))
    expect(screen.getByText(uiText.template.draftApplied)).toBeTruthy()
    expect((screen.getByRole('button', { name: uiText.template.applyDraft }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
  })

it('undoes and redoes an applied template with the synchronized project history', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    fireEvent.click(screen.getByLabelText(uiText.actions.newTemplate))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.createDigitalTemplate }))
    fireEvent.click(screen.getByRole('button', { name: uiText.template.applyDraft }))
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)

    const undo = screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    fireEvent.click(undo)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(1)

    expect(redo.disabled).toBe(false)
    fireEvent.click(redo)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
  })

it('edits selected template rectangles in source-image pixels', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    const xInput = screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement
    const yInput = screen.getByLabelText(`${uiText.template.selectedRegion} y px`) as HTMLInputElement
    const widthInput = screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement
    const heightInput = screen.getByLabelText(`${uiText.template.selectedRegion} h px`) as HTMLInputElement

    expect([xInput.value, yInput.value, widthInput.value, heightInput.value]).toEqual(['35', '47', '1598', '71'])
    fireEvent.change(xInput, { target: { value: '36' } })

    expect(Number(document.querySelector('.templateSelectedRegion')?.getAttribute('x')) * standardA3SheetTemplate.page.widthPx).toBeCloseTo(36)
    expect(screen.getByText(/X 36 \/ Y 47 \/ W 1598 \/ H 71/)).toBeTruthy()
  })

it('previews template edge drags locally and commits once on pointer up', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    const editor = document.querySelector<SVGSVGElement>('.templateEditorSvg')
    if (!editor) throw new Error('template editor not found')
    const getEditorRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    }))
    editor.getBoundingClientRect = getEditorRect
    const verticalEdges = document.querySelectorAll<HTMLDivElement>('.templateDomEdgeGuide.vertical')
    expect(verticalEdges).toHaveLength(2)
    const rightEdge = verticalEdges[1]
    Object.defineProperty(rightEdge, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(rightEdge, 'releasePointerCapture', { configurable: true, value: vi.fn() })

    fireEvent.pointerDown(rightEdge, { pointerId: 41, pointerType: 'mouse', button: 0, clientX: 931, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 41, pointerType: 'mouse', buttons: 1, clientX: 800, clientY: 100 })
    expect(getEditorRect).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      const previewWidth = Number(document.querySelector('.templateSelectedRegion')?.getAttribute('width')) * standardA3SheetTemplate.page.widthPx
      expect(previewWidth).toBeCloseTo(1368)
    })
    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement).value).toBe('1598')

    fireEvent.pointerUp(window, { pointerId: 41, pointerType: 'mouse', button: 0, clientX: 800, clientY: 100 })

    await waitFor(() => expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy())
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement).value).toBe('1368')
    expect(rightEdge.releasePointerCapture).toHaveBeenCalledWith(41)
  })

it('turns built-in standard template edits into a custom draft', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: 'A3標準 改' } })
    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: uiText.template.detailTabs.json }))
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('"name": "A3標準 改"')
    expect(json?.value).not.toContain('"templateId": "standard-a3-timesheet-v2"')
    expect(json?.value).toMatch(/"templateId": "standard-a3-timesheet-v2-custom-[a-z0-9]+"/)
  })

it('shows context operation hints in the bottom status bar', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    expectStatusHint('ホイール', 'Ctrl+ホイール')

    const point = templateFramePoint('cell', 'A', 1)
    fireEvent.pointerMove(sheet, { clientX: point.x, clientY: point.y })
    expectStatusHint('A', formatTestFramePosition(1), '入力・ドロップ')

    fireEvent.pointerLeave(sheet)
    expectStatusHint('ホイール', 'Ctrl+ホイール')
  })

it('omits the fixed paper outer frame for the digital standard template', () => {
    render(<App />)
    const digitalTextTransform = `scale(${1 / digitalStandardSheetTemplate.page.widthPx} ${1 / digitalStandardSheetTemplate.page.heightPx})`
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(1)

    fireEvent.click(screen.getByLabelText(uiText.sheet.displaySettingsMenu))
    fireEvent.click(screen.getByRole('button', { name: 'デジタル標準' }))

    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])
    expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineRow')).toHaveLength(0)
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineColumn').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridLineStrong').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridLineMedium').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridLineRegular').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridRowGuideLabel')).toHaveLength(0)
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(Array.from(document.querySelectorAll('.gridActionFrameNumber')).map(element => element.textContent)).toEqual(
      Array.from({ length: 72 }, (_, index) => String((index + 1) * 2)),
    )
    expect(document.querySelector('.templateHeaderText')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.templateColumnText')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.gridActionFrameNumber')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.gridSecondCounter')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(Array.from(document.querySelectorAll('.sheetSvg text')).every(element => element.getAttribute('transform') === digitalTextTransform)).toBe(true)
  })

it('selects a CELL grid position and creates a key from explicit input', () => {
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
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    expect(document.querySelector('.hoverCellRect')).toBeTruthy()
    expect(document.querySelector('.sheetSvg .hoverCellRect')).toBeNull()
    clickSheet(sheet, 255, 290)
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()
    expect(document.querySelector('.selectedCellCorners')).toBeTruthy()
    expect(document.querySelector('.hoverCellRect')).toBeNull()
    expectSelectedHit('cell', 'A', 1)
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
    expect(screen.queryByText('1 (key_0001)')).toBeNull()

    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(Array.from(registeredCell?.querySelectorAll('input') ?? []).map(input => input.value)).toEqual(['1'])
    expect(registeredCell.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    fireEvent.click(screen.getByRole('button', { name: uiText.nameNormalization.open }))
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect((screen.getByLabelText(uiText.nameNormalization.target) as HTMLSelectElement).value).toBe('selected-key')
    expect(screen.getByText(uiText.nameNormalization.targets.selectedKey)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: uiText.nameNormalization.cancel })[0])
    const eventText = document.querySelector('.eventText')
    const eventRect = document.querySelector('.eventRect')
    if (!eventText || !eventRect) throw new Error('event text not found')
    const textX = Number(eventText.getAttribute('x'))
    const textY = Number(eventText.getAttribute('y'))
    const rectX = Number(eventRect.getAttribute('x'))
    const rectY = Number(eventRect.getAttribute('y'))
    const rectW = Number(eventRect.getAttribute('width'))
    const rectH = Number(eventRect.getAttribute('height'))
    expect(eventText.getAttribute('dominant-baseline')).toBe('central')
    expect(textX).toBeCloseTo((rectX + rectW / 2) * standardA3SheetTemplate.page.widthPx)
    expect(textY).toBeCloseTo((rectY + rectH / 2) * standardA3SheetTemplate.page.heightPx)
    expect(eventText.getAttribute('transform')).toBe(`scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`)
    const textFontSize = Number(eventText.getAttribute('font-size') ?? eventText.getAttribute('fontSize'))
    expect(textFontSize).toBe(18)
    const zoom = getZoomSlider()
    fireEvent.change(zoom, { target: { value: '200' } })
    const zoomedEventText = document.querySelector('.eventText')
    if (!zoomedEventText) throw new Error('event text not found after zoom')
    expect(Number(zoomedEventText.getAttribute('font-size') ?? zoomedEventText.getAttribute('fontSize'))).toBeCloseTo(textFontSize)
  })

it('commits an active text annotation on outside click without creating another editor', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const textTool = screen.getByRole('button', { name: uiText.sheet.textTool })

    fireEvent.click(textTool)
    expect(textTool.getAttribute('aria-pressed')).toBe('true')
    expect(sheet.classList.contains('textAnnotationMode')).toBe(true)
    expect(sheet.classList.contains('textAnnotationPlacementMode')).toBe(true)
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 })
    expect(document.querySelector('.textCursorBadge')?.textContent).toBe('T+')

    clickSheet(sheet, 320, 320)
    const editor = document.querySelector<HTMLTextAreaElement>('.annotationTextEditor')
    expect(editor).toBeTruthy()
    if (!editor) throw new Error('text annotation editor not found')
    expect(document.querySelector('.textCursorBadge')).toBeNull()

    fireEvent.change(editor, { target: { value: 'memo' } })
    clickSheet(sheet, 420, 420)

    expect(document.querySelector('.annotationTextEditor')).toBeNull()
    const displays = document.querySelectorAll('.annotationTextDisplay')
    expect(displays).toHaveLength(1)
    expect(displays[0]?.textContent).toBe('memo')
    expect(displays[0]?.classList.contains('selected')).toBe(true)

    const display = displays[0] as HTMLButtonElement
    display.setPointerCapture = vi.fn()
    display.releasePointerCapture = vi.fn()
    const initialMaxWidth = display.style.maxWidth
    const initialFontSize = display.style.fontSize
    expect(initialFontSize).toBe('18px')
    const zoom = getZoomSlider()
    fireEvent.change(zoom, { target: { value: '200' } })
    const zoomedDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(zoomedDisplay).toBeTruthy()
    if (!zoomedDisplay) throw new Error('zoomed text annotation not found')
    expect(zoomedDisplay.style.fontSize).toBe('36px')
    expect(parseFloat(zoomedDisplay.style.maxWidth)).toBeCloseTo(parseFloat(initialMaxWidth) * 2)
    fireEvent.change(zoom, { target: { value: '100' } })
    const resetDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(resetDisplay).toBeTruthy()
    if (!resetDisplay) throw new Error('reset text annotation not found')
    resetDisplay.setPointerCapture = vi.fn()
    resetDisplay.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(resetDisplay, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, clientX: 320, clientY: 320 })
    fireEvent.pointerMove(resetDisplay, { pointerId: 31, pointerType: 'mouse', buttons: 1, clientX: 930, clientY: 320 })
    fireEvent.pointerUp(resetDisplay, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 0, clientX: 930, clientY: 320 })
    expect(document.querySelector('.annotationTextEditor')).toBeNull()
    const movedDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(movedDisplay).toBeTruthy()
    if (!movedDisplay) throw new Error('moved text annotation not found')
    expect(movedDisplay.style.maxWidth).toBe(initialMaxWidth)

    fireEvent.doubleClick(movedDisplay)
    expect(document.querySelectorAll('.annotationTextEditor')).toHaveLength(1)
    clickSheet(sheet, 430, 430)
    expect(document.querySelector('.annotationTextEditor')).toBeNull()

    clickSheet(sheet, 520, 520)
    expect(document.querySelectorAll('.annotationTextEditor')).toHaveLength(1)
    expect(document.querySelectorAll('.annotationTextDisplay')).toHaveLength(1)
  })

it('reuses a registered cell when typing the same value in the same CELL column', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })
    clickTemplateFrame(sheet, 'cell', 'A', 5)
    fireEvent.keyDown(window, { key: '1' })

    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(1)
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(Array.from(registeredCell.querySelectorAll('input')).map(input => input.value)).toEqual(['1'])
    expect(registeredCell.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
  })

it('jumps to the first timeline use by double-clicking a CSP cell card', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 24)
    fireEvent.keyDown(window, { key: '1' })

    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expectSelectedHit('cell', 'A', 24)
    clickTemplateFrame(sheet, 'cell', 'B', 1)
    expectSelectedHit('cell', 'B', 1)
    fireEvent.doubleClick(registeredCell)
    expectSelectedHit('cell', 'A', 24)
  })

it('auto-scrolls the sheet viewport while dragging a registered asset near the edge', () => {
    render(<App />)
    const viewport = document.querySelector('.sheetViewport') as HTMLElement | null
    if (!viewport) throw new Error('sheet viewport not found')
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1000 })
    viewport.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    })
    viewport.scrollTop = 100
    const dataTransfer = {
      types: [ASSET_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => type === ASSET_DRAG_MIME ? 'asset_0001' : '',
    }

    const dragOver = createEvent.dragOver(viewport)
    Object.defineProperty(dragOver, 'clientX', { value: 200 })
    Object.defineProperty(dragOver, 'clientY', { value: 196 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(viewport, dragOver)

    expect(viewport.scrollTop).toBeGreaterThan(100)
  })

it('deletes a registered cell from the registered cell pane', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickSheet(sheet, 255, 290)
    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeTruthy()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))

    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteConfirm('1', 0, 1))
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeNull())
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
  })
})
