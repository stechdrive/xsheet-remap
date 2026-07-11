import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { assignSheetSourceToPage, cellRectForHit, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, registerAsset, registerAssetRoot, registerSheetSource, timingHitForFrame, upsertBinding, standardA3SheetTemplate, type SheetTemplateGridRole, type SheetTimingRole } from '@xsheet-remap/core'
import { App } from './App'
import { APP_VERSION } from './appVersion'
import { uiText } from './i18n'
import { ASSET_DRAG_MIME, ASSET_TEXT_DRAG_PREFIX, REGISTERED_CELL_DRAG_MIME, REGISTERED_CELL_TEXT_DRAG_PREFIX, STACK_GUIDE_DRAG_MIME } from './sheetConstants'
import { defaultCalibrationPoints } from './sheetImages'

const tauriMockState = vi.hoisted(() => ({
  missingPathKeys: new Set<string>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path.replace(/\\/g, '/')}`,
  invoke: async (command: string, args?: { paths?: string[] }) => {
    if (command === 'stat_native_paths') {
      return (args?.paths ?? []).map(path => {
        const missing = tauriMockState.missingPathKeys.has(path.replace(/\\/g, '/').toLocaleLowerCase())
        const isFilePath = /\.[a-z0-9]+$/i.test(path)
        return {
          path,
          exists: !missing,
          isDirectory: !missing && !isFilePath,
          isFile: !missing && isFilePath,
        }
      })
    }
    if (command === 'open_asset_preview_window') throw new Error('native preview unavailable in tests')
    return null
  },
}))

const originalCreateObjectUrl = URL.createObjectURL

afterEach(() => {
  cleanup()
  document.querySelectorAll('.assetDragImageShell').forEach(element => element.remove())
  document.querySelectorAll('.registeredCellDragImageShell').forEach(element => element.remove())
  Reflect.deleteProperty(window, '__xsheetRemapAssetDragIds')
  Reflect.deleteProperty(window, '__xsheetRemapRegisteredCellDragKeyId')
  URL.createObjectURL = originalCreateObjectUrl
  window.localStorage.clear()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  document.body.classList.remove('sheetInteractionActive')
  tauriMockState.missingPathKeys.clear()
  vi.restoreAllMocks()
})

function clickSheet(sheet: HTMLElement, clientX: number, clientY: number) {
  fireEvent.pointerDown(sheet, { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 1, clientX, clientY })
  fireEvent.pointerUp(sheet, { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 0, clientX, clientY })
}

function clickTemplateFrame(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frame: number) {
  const point = templateFramePoint(role, paperTrack, frame)
  clickSheet(sheet, point.x, point.y)
}

function templateFramePoint(role: SheetTimingRole, paperTrack: string, frame: number): { x: number; y: number } {
  return templateDisplayFramePoint(role, paperTrack, frame, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
}

function templateDisplayFramePoint(role: SheetTimingRole, paperTrack: string, frame: number, durationFrames: number, frameOrigin: number): { x: number; y: number } {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, paperTrack, frame, durationFrames, frameOrigin)
  if (!hit) throw new Error(`template hit not found: ${role} ${paperTrack} ${frame}F`)
  const rect = cellRectForHit(standardA3SheetTemplate, hit, durationFrames, frameOrigin)
  if (!rect) throw new Error(`template rect not found: ${role} ${paperTrack} ${frame}F`)
  return {
    x: (rect.x + rect.w / 2) * 1000,
    y: (rect.y + rect.h / 2) * 1000,
  }
}

function templateColumnHeaderPoint(role: SheetTimingRole, paperTrack: string): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnIndex = region.grid.columns.findIndex(column => column.paperTrack === paperTrack)
  if (columnIndex < 0) throw new Error(`template column not found: ${role} ${paperTrack}`)
  return {
    x: (region.rect.x + (region.rect.w * (columnIndex + 0.5)) / region.grid.columns.length) * 1000,
    y: (region.rect.y - 0.004) * 1000,
  }
}

function templateStackGuideHeaderPoint(role: SheetTimingRole, gapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  return {
    x: (region.rect.x + (region.rect.w * gapIndex) / region.grid.columns.length) * 1000,
    y: (region.rect.y - 0.018) * 1000,
  }
}

function templateStackGuideHeaderSnapPoint(role: SheetTimingRole, snapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnWidth = region.rect.w / region.grid.columns.length
  return {
    x: (region.rect.x - columnWidth + columnWidth * snapIndex) * 1000,
    y: (region.rect.y - 0.018) * 1000,
  }
}

function templateStackGuideBodySnapPoint(role: SheetTimingRole, snapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnWidth = region.rect.w / region.grid.columns.length
  return {
    x: (region.rect.x - columnWidth + columnWidth * snapIndex) * 1000,
    y: (region.rect.y + region.rect.h * 0.48) * 1000,
  }
}

function stackGuideConnectorAnchorX(labelText: string): number {
  const label = Array.from(document.querySelectorAll<SVGGElement>('.stackGuideSvgLabel'))
    .find(item => item.textContent === labelText)
  if (!label) throw new Error(`stack guide label not found: ${labelText}`)
  const connector = label.querySelector<SVGPathElement>('.stackGuideSvgConnector')
  const match = /^M\s+(-?\d+(?:\.\d+)?)/.exec(connector?.getAttribute('d') ?? '')
  if (!match) throw new Error(`stack guide connector path not found: ${labelText}`)
  return Number(match[1])
}

function openStackGuideInsertMenu(sheet: HTMLElement, role: SheetTimingRole, gapIndex: number) {
  const point = templateStackGuideHeaderPoint(role, gapIndex)
  fireEvent.contextMenu(sheet, { clientX: point.x, clientY: point.y })
}

async function clickActiveStackGuideInsertHandle(point: { x: number; y: number }) {
  await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
  const activeHandle = document.querySelector<HTMLButtonElement>('.stackGuideGap.insertToolActive .stackGuideInsertHandle')
  if (!activeHandle) throw new Error('active stack guide insert handle not found')
  fireEvent.click(activeHandle, { clientX: point.x, clientY: point.y })
}

function dragStackGuideSvgLabel(labelText: string, targetRole: SheetTimingRole, targetGapIndex: number) {
  const source = Array.from(document.querySelectorAll<SVGGElement>('.stackGuideSvgLabel'))
    .find(label => label.textContent === labelText)
  if (!source) throw new Error(`stack guide SVG label not found: ${labelText}`)
  source.setPointerCapture = vi.fn()
  source.releasePointerCapture = vi.fn()
  source.hasPointerCapture = () => true
  const target = templateStackGuideHeaderPoint(targetRole, targetGapIndex)
  fireEvent.pointerDown(source, { pointerId: 41, pointerType: 'mouse', button: 0, buttons: 1, clientX: target.x - 80, clientY: target.y - 80 })
  fireEvent.pointerMove(source, { pointerId: 41, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
  fireEvent.pointerUp(source, { pointerId: 41, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })
}

function switchSharedCutByLabel(label: string) {
  const select = document.querySelector<HTMLSelectElement>('.cutSwitchControl select')
  if (!select) throw new Error('cut switch select not found')
  const option = Array.from(select.options).find(item => item.textContent?.trim() === label)
  if (!option) throw new Error(`cut switch option not found: ${label}`)
  fireEvent.change(select, { target: { value: option.value } })
}

function clickTemplateDisplayFrame(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frame: number, durationFrames: number, frameOrigin: number) {
  const point = templateDisplayFramePoint(role, paperTrack, frame, durationFrames, frameOrigin)
  clickSheet(sheet, point.x, point.y)
}

function dragTemplateDisplayFrames(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number, durationFrames: number, frameOrigin: number) {
  const start = templateDisplayFramePoint(role, paperTrack, frameStart, durationFrames, frameOrigin)
  const end = templateDisplayFramePoint(role, paperTrack, frameEnd, durationFrames, frameOrigin)
  dragSheet(sheet, start.x, start.y, end.x, end.y)
}

function dragSheet(sheet: HTMLElement, startX: number, startY: number, endX: number, endY: number) {
  fireEvent.pointerDown(sheet, { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY })
  fireEvent.pointerMove(sheet, { pointerId: 11, pointerType: 'mouse', buttons: 1, clientX: endX, clientY: endY })
  fireEvent.pointerUp(sheet, { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 0, clientX: endX, clientY: endY })
}

function setSheetRect(sheet: HTMLElement, left: number, top: number, width = 1000, height = 1000) {
  sheet.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  })
}

function setStackGuideOverlayRect(left = 0, top = 0, width = 1000, height = 1000): HTMLElement {
  const overlay = document.querySelector<HTMLElement>('.stackGuideOverlay')
  if (!overlay) throw new Error('stack guide overlay not found')
  overlay.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  })
  return overlay
}

function formatTestSignedPaddedNumber(value: number, digits: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${String(Math.abs(value)).padStart(digits, '0')}`
}

function formatTestFrameTimecode(frame: number, frameOrigin = standardA3SheetTemplate.defaults.frameOrigin, fps = standardA3SheetTemplate.defaults.fps): string {
  const offset = Math.round(frame) - Math.round(frameOrigin)
  const safeFps = Math.max(1, Math.round(fps))
  if (offset >= 0) {
    const seconds = Math.floor(offset / safeFps)
    const koma = (offset % safeFps) + 1
    return `${String(seconds).padStart(2, '0')}+${String(koma).padStart(2, '0')}`
  }

  const framesBefore = Math.abs(offset)
  const seconds = Math.floor((framesBefore - 1) / safeFps)
  const koma = ((framesBefore - 1) % safeFps) + 1
  return `-${String(seconds).padStart(2, '0')}+${String(koma).padStart(2, '0')}`
}

function formatTestDurationTimecode(frameCount: number, fps = standardA3SheetTemplate.defaults.fps): string {
  const safeFps = Math.max(1, Math.round(fps))
  const totalFrames = Math.max(0, Math.round(frameCount))
  const seconds = Math.floor(totalFrames / safeFps)
  const koma = totalFrames % safeFps
  return `${String(seconds).padStart(2, '0')}+${String(koma).padStart(2, '0')}`
}

function formatTestFramePosition(frame: number): string {
  return `${formatTestSignedPaddedNumber(frame, 3)} (${formatTestFrameTimecode(frame)})`
}

function expectCurrentFrame(frame: number) {
  expect(document.querySelector('.currentFrameBadge')?.textContent).toBe(formatTestFramePosition(frame))
}

function expectSelectionStatus(...parts: string[]) {
  const text = document.querySelector('.statusBar span')?.textContent ?? ''
  for (const part of parts) expect(text).toContain(part)
}

function expectStatusHint(...parts: string[]) {
  const text = document.querySelector('.statusHint')?.textContent ?? ''
  for (const part of parts) expect(text).toContain(part)
}

function expectSelectedHit(role: SheetTemplateGridRole, paperTrack: string, frame: number) {
  expectCurrentFrame(frame)
  expectSelectionStatus(role.toUpperCase(), paperTrack, formatTestFramePosition(frame))
}

function expectSelectedRange(role: SheetTemplateGridRole, paperTrack: string, frameStart: number, frameEnd: number) {
  expectSelectionStatus(role.toUpperCase(), paperTrack)
  expect(document.querySelector('.rangeFrameInspector')?.classList.contains('empty')).toBe(false)
  const values = Array.from(document.querySelectorAll('.rangeFrameInspectorValue')).map(element => element.textContent)
  expect(values).toEqual([
    formatTestFrameTimecode(frameStart),
    formatTestFrameTimecode(frameEnd),
    formatTestDurationTimecode(frameEnd - frameStart + 1),
  ])
}

type MockFileSystemEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (file: File) => void) => void
  createReader?: () => {
    readEntries: (success: (entries: MockFileSystemEntry[]) => void) => void
  }
}

function mockFileEntry(file: File): MockFileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: success => success(file),
  }
}

function mockDirectoryEntry(name: string, entries: MockFileSystemEntry[]): MockFileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let didRead = false
      return {
        readEntries: success => {
          success(didRead ? [] : entries)
          didRead = true
        },
      }
    },
  }
}

function mockFileTransferItem(entry: MockFileSystemEntry, file: File | null = null) {
  return {
    kind: 'file',
    type: file?.type ?? '',
    getAsFile: () => file,
    webkitGetAsEntry: () => entry,
  }
}

function registeredCellIdentityText(card: Element) {
  const sectionTitle = card.closest('.registeredCellSection')?.getAttribute('data-section-title') ?? ''
  return [sectionTitle, ...Array.from(card.querySelectorAll('.registeredCellRoleBadge, .registeredCellTrackBadge'))
    .map(item => item.textContent ?? '')
  ]
    .filter(Boolean)
    .join(' ')
}

function getAssetCardByName(name: string): HTMLElement {
  const card = Array.from(document.querySelectorAll<HTMLElement>('.assetCard'))
    .find(item => Array.from(item.querySelectorAll('strong')).some(label => label.textContent === name))
  if (!card) throw new Error(`asset card not found: ${name}`)
  return card
}

async function findAssetCardByName(name: string): Promise<HTMLElement> {
  await screen.findByText(name)
  return getAssetCardByName(name)
}

function openAppNavigationMenu(): HTMLElement {
  const trigger = screen.getByLabelText(uiText.nav.menu)
  fireEvent.click(trigger)
  const menu = trigger.closest('details')
  if (!(menu instanceof HTMLElement)) throw new Error('app navigation menu not found')
  expect((menu as HTMLDetailsElement).open).toBe(true)
  const content = document.querySelector('.actionMenuPortalContent.appNavMenu')
  if (!(content instanceof HTMLElement)) throw new Error('app navigation menu content not found')
  return content
}

function selectAppPanel(label: string) {
  const menu = openAppNavigationMenu()
  fireEvent.click(within(menu).getByRole('button', { name: label }))
}

function getZoomSlider(): HTMLInputElement {
  const zoom = document.querySelector('.zoomSliderControl input[type="range"]') as HTMLInputElement | null
  if (!zoom) throw new Error('zoom control not found')
  return zoom
}

function getSheetOpacitySlider(): HTMLInputElement {
  const opacity = document.querySelector('.topOpacityControl input[type="range"]') as HTMLInputElement | null
  if (!opacity) throw new Error('sheet opacity control not found')
  return opacity
}

function sheetImageHrefs(): string[] {
  return Array.from(document.querySelectorAll('.sheetSvg image'))
    .map(image => image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '')
    .filter(Boolean)
}

function levelCorrectionFilterTableValues(): string {
  const sheet = document.querySelector('.sheetSvg')
  const channel = Array.from(sheet?.querySelectorAll('*') ?? [])
    .find(element => element.tagName.toLowerCase() === 'fefuncr')
  return channel?.getAttribute('tableValues') ?? channel?.getAttribute('tablevalues') ?? ''
}

describe('App', () => {
  it('renders the main workspace shell', () => {
    render(<App />)
    expect(screen.getByText('xsheet-remap')).toBeTruthy()
    expect(screen.getByText(`v${APP_VERSION}`)).toBeTruthy()
    const appNavigationMenu = openAppNavigationMenu()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.sheet })).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.export })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: '認識' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.sources })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.assets })).toBeNull()
    expect(screen.getByRole('button', { name: uiText.sheet.imageCorrection })).toBeTruthy()
    expect(screen.getByLabelText(uiText.recognition.menu)).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.template })).toBeTruthy()
    expect(screen.getByLabelText('紙シート')).toBeTruthy()
    expect(screen.getByLabelText(uiText.actions.loadSheetSourceFiles)).toBeTruthy()
    expect(screen.getByLabelText(uiText.sheet.viewModeMenu)).toBeTruthy()
    expect(document.querySelector('.sheetWorkspace')).toBeTruthy()
    expect(document.querySelector('.sheetDockLeft h2')?.textContent).toBe(uiText.keys.title)
    expect(document.querySelector('.sheetDockRight h2')?.textContent).toBe(uiText.assets.title)
    expect(screen.queryByRole('tablist', { name: uiText.sheet.sideDock })).toBeNull()
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

  it('shows a labeled OCR menu with only ACTION and CELL as user choices', () => {
    render(<App />)
    const menu = screen.getByLabelText(uiText.recognition.menu)
    expect(menu.textContent).toContain('OCR')
    fireEvent.click(menu)

    const roleGroup = screen.getByRole('group', { name: uiText.recognition.targetField })
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.action })).toBeTruthy()
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.cell }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('button', { name: uiText.actions.runOcrAllPages }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('濃さ')).toBeNull()
    expect(screen.queryByText('記入率')).toBeNull()
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
    tauriMockState.missingPathKeys.add(materialPath.replace(/\\/g, '/').toLocaleLowerCase())
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
      rootId: rooted.root.rootId,
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

    const soundInput = screen.getByLabelText(uiText.template.gridHeaderLabelInput('SOUND')) as HTMLInputElement
    expect(soundInput.value).toBe('')

    fireEvent.change(soundInput, { target: { value: '台詞' } })
    expect(soundInput.value).toBe('台詞')
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toContain('台詞')

    fireEvent.change(soundInput, { target: { value: '' } })
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).not.toContain('SOUND')
  })

  it('edits the cut duration as seconds and frames with stepper buttons', () => {
    render(<App />)
    const secondsInput = screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement
    const framesInput = screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement
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
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toEqual(['001', '06+00', '1/1'])
  })

  it('toggles shared cut numbers beside the cut switch even before another cut exists', () => {
    render(<App />)

    const initialToggle = screen.getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(initialToggle.disabled).toBe(false)
    fireEvent.click(initialToggle)
    expect(initialToggle.checked).toBe(true)
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).not.toContain('[]')
    fireEvent.click(initialToggle)

    fireEvent.click(document.querySelector('.cutSwitchAddButton') as HTMLButtonElement)
    const toggle = screen.getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(false)

    fireEvent.click(toggle)
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
    expect(Array.from(document.querySelectorAll('.gridRowGuideLabel')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
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
    expectSelectedHit('cell', 'A', 1)
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
    expect(screen.queryByText('1 (key_0001)')).toBeNull()

    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    const registeredCell = document.querySelector('.registeredCellCard')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell.querySelector('.registeredCellFirstUse')?.textContent).toBe('0+1')
    expect(Array.from(registeredCell?.querySelectorAll('input') ?? []).map(input => input.value)).toEqual(['1', 'A1'])
    fireEvent.click(screen.getByRole('button', { name: uiText.nameNormalization.open }))
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect((screen.getByLabelText(uiText.nameNormalization.target) as HTMLSelectElement).value).toBe('action')
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
    expect(document.querySelectorAll('.registeredCellCard')).toHaveLength(1)
    const registeredCell = document.querySelector('.registeredCellCard')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell.querySelector('.registeredCellFirstUse')?.textContent).toBe('0+1')
    expect(Array.from(registeredCell.querySelectorAll('input')).map(input => input.value)).toEqual(['1', 'A1'])
  })

  it('shows registered cell first use as seconds plus koma from 0+1', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 24)
    fireEvent.keyDown(window, { key: '1' })

    const registeredCell = document.querySelector('.registeredCellCard')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expectSelectedHit('cell', 'A', 24)
    expect(registeredCell.querySelector('.registeredCellFirstUse')?.textContent).toBe('0+24')

    clickTemplateFrame(sheet, 'cell', 'B', 1)
    expectSelectedHit('cell', 'B', 1)
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.firstUseJump('0+24') }))
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
    expect(document.querySelector('.registeredCellCard')).toBeTruthy()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.deleteLabel('CELL A 1') }))

    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteConfirm('1', 0, 1))
    await waitFor(() => expect(document.querySelector('.registeredCellCard')).toBeNull())
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
  })

  it('assigns a registered cell card to a frame through pointer drag fallback', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })
    const registeredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')

    const target = templateFramePoint('cell', 'B', 1)
    fireEvent.pointerDown(registeredCell, { pointerId: 71, pointerType: 'mouse', button: 0, buttons: 1, clientX: 120, clientY: 180 })
    fireEvent.pointerMove(window, { pointerId: 71, pointerType: 'mouse', buttons: 1, clientX: target.x, clientY: target.y })
    expect(document.querySelector('.registeredCellDragImageShell.pointerDragGhost')).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 71, pointerType: 'mouse', button: 0, buttons: 0, clientX: target.x, clientY: target.y })

    await waitFor(() => expectSelectedHit('cell', 'B', 1))
    expect(document.querySelector('.registeredCellDragImageShell.pointerDragGhost')).toBeNull()
    expect(Array.from(document.querySelectorAll('.registeredCellCard')).map(registeredCellIdentityText)).toEqual(['CELL A', 'CELL B'])
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

    fireEvent.click(screen.getByLabelText(uiText.stackGuides.addMenu))
    fireEvent.click(screen.getByRole('button', { name: uiText.stackGuides.add }))
    await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
    const defaultTarget = document.querySelector<HTMLElement>('.stackGuideGap.insertToolActive')
    expect(defaultTarget?.dataset.stackGuideRole).toBe('action')
    expect(defaultTarget?.dataset.stackGuideSnapIndex).toBe('1')

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
    fireEvent.keyDown(window, { key: '1' })

    const registeredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    const inputs = registeredCell.querySelectorAll('input')
    expect(Array.from(inputs).map(input => input.value)).toEqual(['1', 'A1'])
    fireEvent.change(inputs[1], { target: { value: 'A1_custom' } })
    expect(registeredCell.querySelector('.cellNameMode')?.textContent).toBe(uiText.keys.manualName)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['asset'], 'A1_ref.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('A1_ref.png')).toBeTruthy()

    const dragData: Record<string, string> = {}
    const dataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        dragData[type] = value
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type)
      },
      getData: (type: string) => dragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('A1_ref.png'), { dataTransfer })
    const dragOver = createEvent.dragOver(registeredCell, { dataTransfer })
    fireEvent(registeredCell, dragOver)
    expect(dragOver.defaultPrevented).toBe(true)
    fireEvent.drop(registeredCell, { clientX: 300, clientY: 260, dataTransfer })
    const dropMenu = await screen.findByRole('menu')
    expect(dropMenu.textContent).toContain(uiText.assetDrop.title)
    expect(dropMenu.textContent).toContain('A1_ref.png')
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('作画')) }))

    expect(registeredCell.textContent).toContain('A1_ref.png')

    selectAppPanel(uiText.nav.export)
    const sourceSelect = screen.getByLabelText(uiText.export.timingSource)
    fireEvent.change(sourceSelect, { target: { value: 'cell' } })
    const preview = document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null
    expect(preview?.value).toContain('A1_custom')
  })

  it('confirms before deleting a registered cell with image assets', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickSheet(sheet, 255, 290)
    fireEvent.keyDown(window, { key: '1' })

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    fireEvent.change(assetInput, { target: { files: [new File(['asset'], 'A1_ref.png', { type: 'image/png', lastModified: 1 })] } })
    expect(await screen.findByText('A1_ref.png')).toBeTruthy()

    const dragData: Record<string, string> = {}
    const dataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        dragData[type] = value
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type)
      },
      getData: (type: string) => dragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('A1_ref.png'), { dataTransfer })
    const registeredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    fireEvent.drop(registeredCell, { clientX: 300, clientY: 260, dataTransfer })
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('作画')) }))

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.deleteLabel('CELL A 1') }))
    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteConfirm('1', 1))
    expect(document.querySelector('.registeredCellCard')).toBeTruthy()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.deleteLabel('CELL A 1') }))
    await waitFor(() => expect(document.querySelector('.registeredCellCard')).toBeNull())
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
    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelector('.eventText')?.textContent).toBe('1')

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['asset'], 'A1_enshutsu.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('A1_enshutsu.png')).toBeTruthy()

    const dragData: Record<string, string> = {}
    const dataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        dragData[type] = value
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type)
      },
      getData: (type: string) => dragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('A1_enshutsu.png'), { dataTransfer })
    expect(dragData['application/x-xsheet-remap-asset']).toBeTruthy()
    expect(dragData['text/plain']).toBeTruthy()
    const sheetDropTransfer = {
      files: [],
      types: ['text/plain'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      setData: () => undefined,
      getData: (type: string) => type === 'text/plain' ? dragData['text/plain'] : '',
    }
    const viewport = sheet.closest('.sheetViewport')
    if (!viewport) throw new Error('sheet viewport not found')
    const viewportDragOver = createEvent.dragOver(viewport, {
      clientX: 255,
      clientY: 290,
      dataTransfer: sheetDropTransfer,
    })
    fireEvent(viewport, viewportDragOver)
    expect(viewportDragOver.defaultPrevented).toBe(true)
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    fireEvent.drop(sheet, {
      clientX: 255,
      clientY: 290,
      dataTransfer: sheetDropTransfer,
    })

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
    fireEvent.keyDown(window, { key: '1' })
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
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.deleteLabel('CELL A 1') }))
    expect(confirmSpy).toHaveBeenCalledWith(uiText.keys.deleteConfirm('1', 1, 1))
    expect(document.querySelector('.registeredCellCard')).toBeTruthy()
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
    fireEvent.keyDown(window, { key: '1' })
    expectSelectedHit('cell', 'A', 1)

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
    fireEvent.keyDown(window, { key: '1' })
    expectSelectedHit('cell', 'A', 1)

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
      fireEvent.keyDown(window, { key: '1' })
      expectSelectedHit('cell', 'A', 1)

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
    expect(document.querySelectorAll('.registeredCellCard')).toHaveLength(0)
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
    fireEvent.keyDown(window, { key: '1' })
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
    fireEvent.keyDown(window, { key: 'x' })

    expect(document.querySelector('.eventText')?.textContent).toBe('x')
    expect(document.querySelectorAll('.registeredCellCard')).toHaveLength(0)
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
    fireEvent.keyDown(window, { key: '1' })
    expectSelectedHit('action', 'A', 1)
    expect(document.querySelectorAll('.registeredCellCard')).toHaveLength(1)
    expect(registeredCellIdentityText(document.querySelector('.registeredCellCard') as Element)).toBe('ACTION A')

    clickSheet(sheet, 255, 290)
    fireEvent.keyDown(window, { key: '1' })
    expectSelectedHit('cell', 'A', 1)
    const registeredCells = Array.from(document.querySelectorAll('.registeredCellCard'))
    expect(registeredCells).toHaveLength(2)
    expect(registeredCells.map(registeredCellIdentityText)).toEqual(['ACTION A', 'CELL A'])
    expect(registeredCells.map(card => Array.from(card.querySelectorAll('input')).map(input => input.value))).toEqual([
      ['1', 'A1'],
      ['1', 'A1'],
    ])
  })

  it('groups registered cells and sorts them by column then first timeline use', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'action', 'B', 3)
    fireEvent.keyDown(window, { key: '1' })
    clickTemplateFrame(sheet, 'action', 'A', 20)
    fireEvent.keyDown(window, { key: '2' })
    clickTemplateFrame(sheet, 'action', 'A', 5)
    fireEvent.keyDown(window, { key: '3' })
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '4' })

    const sectionByTitle = (title: string) => Array.from(document.querySelectorAll('.registeredCellSection'))
      .find(section => section.getAttribute('data-section-title') === title)
    const cardSummaries = (section: Element | undefined) => Array.from(section?.querySelectorAll('.registeredCellCard') ?? [])
      .map(card => `${registeredCellIdentityText(card)} ${card.querySelector('.registeredCellFirstUse')?.textContent ?? ''}`)

    expect(cardSummaries(sectionByTitle(uiText.keys.sections.action))).toEqual([
      'ACTION A 0+5',
      'ACTION A 0+20',
      'ACTION B 0+3',
    ])
    expect(cardSummaries(sectionByTitle(uiText.keys.sections.cell))).toEqual([
      'CELL A 0+1',
    ])

    fireEvent.click(screen.getByRole('button', { name: uiText.keys.sort.toDescending }))
    expect(cardSummaries(sectionByTitle(uiText.keys.sections.action))).toEqual([
      'ACTION B 0+3',
      'ACTION A 0+20',
      'ACTION A 0+5',
    ])
    expect(cardSummaries(sectionByTitle(uiText.keys.sections.cell))).toEqual([
      'CELL A 0+1',
    ])

    fireEvent.click(screen.getByRole('button', { name: uiText.keys.view.list }))
    expect(document.querySelectorAll('.registeredCellCard.compact')).toHaveLength(4)
    expect(document.querySelector('.registeredCellCompactName')).toBeTruthy()
    expect(document.querySelector('.registeredCellCard input')).toBeNull()
  })

  it('defaults XDTS export to an import stack while keeping animation folder names unchanged', () => {
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
    fireEvent.keyDown(window, { key: '1' })
    selectAppPanel(uiText.nav.export)

    const preview = document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null
    expect(preview?.value).toContain('===== XSHEET IMPORT START =====')
    expect(preview?.value).toContain('===== 作画 =====')
    expect(preview?.value).toContain('===== XSHEET IMPORT END =====')
    expect(preview?.value).toContain('"A"')
    expect(preview?.value).not.toContain('LO_作画_A')

    fireEvent.change(screen.getByLabelText(uiText.export.importStart), { target: { value: '===== CUSTOM IMPORT START =====' } })
    expect((document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null)?.value).toContain('===== CUSTOM IMPORT START =====')
  })

  it('steps point-event range input by the selected range length', () => {
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
    expectSelectedRange('cell', 'A', 1, 3)
    expect((screen.getByRole('button', { name: uiText.sheet.textFontSize }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(window, { key: '1' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1'])
    expectSelectedRange('cell', 'A', 4, 6)

    fireEvent.keyDown(window, { key: '2' })
    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2'])
    expectSelectedRange('cell', 'A', 7, 9)
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
    fireEvent.keyDown(window, { key: '9' })
    expectSelectedHit('cell', 'A', -23)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('9')

    preRoll = screen.getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(false)
    await waitFor(() => expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).not.toContain('9'))

    fireEvent.keyDown(window, { key: '5' })
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
    fireEvent.keyDown(window, { key: '1' })
    clickSheet(sheet, 255, 300)
    fireEvent.keyDown(window, { key: '2' })
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
    fireEvent.keyDown(window, { key: '1' })
    clickSheet(sheet, 255, 300)
    fireEvent.keyDown(window, { key: '2' })
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
    fireEvent.keyDown(window, { key: '9' })
    clickTemplateDisplayFrame(sheet, 'cell', 'A', 1, 168, -23)
    fireEvent.keyDown(window, { key: '1' })

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
    fireEvent.keyDown(window, { key: '1' })
    clickTemplateFrame(sheet, 'cell', 'A', 2)
    fireEvent.keyDown(window, { key: '2' })
    clickTemplateFrame(sheet, 'cell', 'A', 4)
    fireEvent.keyDown(window, { key: '4' })
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
    fireEvent.keyDown(window, { key: '7' })
    clickTemplateFrame(sheet, 'cell', 'A', 144)
    fireEvent.keyDown(window, { key: '8' })
    dragTemplateDisplayFrames(sheet, 'cell', 'A', 143, 144, 144, 1)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })

    const menuPoint = templateFramePoint('cell', 'A', 144)
    fireEvent.contextMenu(sheet, { clientX: menuPoint.x, clientY: menuPoint.y })
    fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.pasteInsert }))

    expect(screen.getByText(uiText.sheet.postRollFrames(2))).toBeTruthy()
    expect(document.querySelectorAll('.eventRect').length).toBeGreaterThanOrEqual(4)

    selectAppPanel(uiText.nav.export)
    fireEvent.change(screen.getByLabelText(uiText.export.timingSource), { target: { value: 'cell' } })
    const preview = document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null
    expect(preview?.value).toContain('"duration": 144')
    expect(preview?.value).toContain('"frame": 142')
    expect(preview?.value).toContain('"frame": 143')
    expect(preview?.value).not.toContain('"frame": 144')
    expect(preview?.value).not.toContain('"frame": 145')
  })

  it('opens frame operation commands from the sheet context menu', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '1' })
    clickTemplateFrame(sheet, 'cell', 'A', 3)
    fireEvent.keyDown(window, { key: '3' })

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
    expect(document.querySelectorAll('.registeredCellCard')).toHaveLength(2)
  })

  it('keeps timing visible when the active material registration process changes', () => {
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
    fireEvent.keyDown(window, { key: '1' })
    expect(registeredCellIdentityText(document.querySelector('.registeredCellCard') as Element)).toBe('CELL A')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.processPaletteButtonTitle('演出') }))
    expect(registeredCellIdentityText(document.querySelector('.registeredCellCard') as Element)).toBe('CELL A')
    expectSelectionStatus('演出', 'CELL', 'A', formatTestFramePosition(1))
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.processPaletteButtonTitle('作画') }))
    expectSelectionStatus('作画', 'CELL', 'A', formatTestFramePosition(1))
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
  })

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

    expect(opacity.value).toBe('100')
    expect(opacity.disabled).toBe(true)
    expect(image?.getAttribute('href')).toContain('timesheet.png')
    expect(image?.getAttribute('opacity')).toBe('1')
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
    const sourceSelects = Array.from(pageJumpMenu.querySelectorAll<HTMLSelectElement>('.pageJumpSourceSelect select'))
    expect(sourceSelects).toHaveLength(4)
    expect(sourceSelects.map(select => select.selectedOptions[0]?.textContent ?? '')).toEqual([
      expect.stringContaining('_133_sheet_e.jpg'),
      expect.stringContaining('_133_sheet_e_2.jpg'),
      expect.stringContaining('sheet_01.png'),
      expect.stringContaining('sheet_02.png'),
    ])
    fireEvent.change(sourceSelects[0], { target: { value: sourceSelects[1].value } })
    expect(sourceSelects[0].selectedOptions[0]?.textContent).toContain('_133_sheet_e_2.jpg')
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
    fireEvent.keyDown(window, { key: '1' })
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

  it('registers material assets and assigns a dragged asset to the dropped sheet cell', async () => {
    URL.createObjectURL = () => 'blob:asset-preview'
    render(<App />)

    const assetInput = screen.getByLabelText(uiText.actions.addAssets)
    const file = new File(['asset'], 'BG_A1.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(assetInput, { target: { files: [file] } })
    expect(await screen.findByText('BG_A1.png')).toBeTruthy()
    expect(document.querySelector('.assetRegistrationBadge')).toBeNull()
    const assetPanelCard = getAssetCardByName('BG_A1.png')
    fireEvent.click(assetPanelCard)
    expect(assetPanelCard.classList.contains('selected')).toBe(true)
    const previewButton = assetPanelCard.querySelector('.assetQuickPreviewButton') as HTMLButtonElement | null
    if (!previewButton) throw new Error('asset quick preview button not found')
    fireEvent.click(previewButton)
    const quickPreview = await screen.findByRole('dialog', { name: uiText.assets.previewDialog('BG_A1.png') })
    expect(quickPreview.getAttribute('aria-modal')).toBe('false')
    expect(quickPreview.querySelector('img')?.getAttribute('src')).toBe('blob:asset-preview')
    expect(quickPreview.textContent).toContain('BG_A1.png')
    expect(quickPreview.textContent?.match(/BG_A1\.png/g)).toHaveLength(1)
    const quickPreviewImageFrame = quickPreview.querySelector('.assetFloatingPreviewImageFrame') as HTMLElement | null
    if (!quickPreviewImageFrame) throw new Error('quick preview image frame not found')
    const quickPreviewHeader = quickPreview.querySelector('.assetFloatingPreviewHeader') as HTMLElement | null
    if (!quickPreviewHeader) throw new Error('quick preview header not found')
    fireEvent.pointerDown(quickPreviewHeader, { pointerId: 20, button: 0, clientX: 120, clientY: 120 })
    fireEvent.pointerMove(quickPreviewHeader, { pointerId: 20, clientX: 150, clientY: 145 })
    fireEvent.pointerUp(quickPreviewHeader, { pointerId: 20, clientX: 150, clientY: 145 })
    expect(quickPreview.getAttribute('style')).toContain('left:')
    const quickPreviewResize = quickPreview.querySelector('.assetFloatingPreviewResize') as HTMLElement | null
    if (!quickPreviewResize) throw new Error('quick preview resize handle not found')
    fireEvent.pointerDown(quickPreviewResize, { pointerId: 21, button: 0, clientX: 480, clientY: 380 })
    fireEvent.pointerMove(quickPreviewResize, { pointerId: 21, clientX: 520, clientY: 420 })
    fireEvent.pointerUp(quickPreviewResize, { pointerId: 21, clientX: 520, clientY: 420 })
    expect(quickPreview.getAttribute('style')).toContain('width:')
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.closePreview }))
    expect(screen.queryByRole('dialog', { name: uiText.assets.previewDialog('BG_A1.png') })).toBeNull()
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    fireEvent.click(previewButton)
    const tauriFallbackPreview = await screen.findByRole('dialog', { name: uiText.assets.previewDialog('BG_A1.png') })
    expect(tauriFallbackPreview.querySelector('img')?.getAttribute('src')).toBe('blob:asset-preview')
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.closePreview }))
    expect(screen.queryByRole('dialog', { name: uiText.assets.previewDialog('BG_A1.png') })).toBeNull()
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    expect(screen.queryByText('5 B')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.view.listTitle }))
    expect(document.querySelector('.assetBrowser-list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.size.largeTitle }))
    expect(document.querySelector('.assetThumb-large')).toBeTruthy()

    selectAppPanel(uiText.nav.sheet)
    const dragData: Record<string, string> = {}
    const dragImageCalls: Array<{ element: Element; x: number; y: number }> = []
    const dataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      setData: (type: string, value: string) => {
        dragData[type] = value
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type)
      },
      getData: (type: string) => dragData[type] ?? '',
      setDragImage: (element: Element, x: number, y: number) => {
        dragImageCalls.push({ element, x, y })
      },
    }
    const assetCard = getAssetCardByName('BG_A1.png')
    fireEvent.dragStart(assetCard, { dataTransfer })
    expect(assetCard.classList.contains('dragging')).toBe(true)
    expect(dragData['application/x-xsheet-remap-asset']).toBeTruthy()
    expect(dragData['text/plain']).toBe(`${ASSET_TEXT_DRAG_PREFIX}${dragData['application/x-xsheet-remap-asset']}`)
    const dragImageCall = dragImageCalls[0]
    if (!dragImageCall) throw new Error('drag image was not set')
    expect(dragImageCall.x).toBe(0)
    expect(dragImageCall.y).toBe(0)
    expect((dragImageCall.element as HTMLElement).className).toBe('assetDragImageShell')
    expect((dragImageCall.element as HTMLElement).querySelector('.assetDragImagePreview')).toBeTruthy()
    fireEvent.dragEnd(assetCard)
    expect(assetCard.classList.contains('dragging')).toBe(false)
    expect(document.querySelector('.assetDragImageShell')).toBeNull()
    const webviewDataTransfer = {
      files: [],
      types: ['text/plain'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      setData: () => undefined,
      getData: (type: string) => type === 'text/plain' ? dragData['text/plain'] : '',
    }
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    const viewport = sheet.closest('.sheetViewport')
    if (!viewport) throw new Error('sheet viewport not found')
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
    const viewportDragOver = createEvent.dragOver(viewport, {
      clientX: 255,
      clientY: 290,
      dataTransfer: webviewDataTransfer,
    })
    fireEvent(viewport, viewportDragOver)
    expect(viewportDragOver.defaultPrevented).toBe(true)
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    await waitFor(() => expect(document.querySelector('.hoverCellRect')).toBeTruthy())
    fireEvent.drop(sheet, {
      clientX: 255,
      clientY: 290,
      dataTransfer: webviewDataTransfer,
    })

    await waitFor(() => expectSelectedHit('cell', 'A', 1))
    const registeredAssetBadge = await waitFor(() => {
      const badge = document.querySelector('.sheetDockRight .assetRegistrationBadge') as HTMLElement | null
      if (!badge) throw new Error('asset registration badge not found')
      return badge
    })
    expect(registeredAssetBadge.textContent).toBe(uiText.assets.registered)
    expect(screen.queryByText('1 (key_0001)')).toBeNull()
    expect(document.querySelector('.assetAssignedEventRect')).toBeTruthy()
    expect(document.querySelector('.assetEventDot')).toBeNull()
    expect(document.querySelector('.assetEventBracket')).toBeNull()
    expect(document.querySelector('.eventText')).toBeNull()
    const registeredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCell.textContent).toContain('作画')
    expect(registeredCell.textContent).toContain('BG_A1')
    const registeredCellInputs = () => Array.from(registeredCell.querySelectorAll('input')) as HTMLInputElement[]
    expect(registeredCellInputs().map(input => input.value)).toEqual(['', 'BG_A1'])
    expect(registeredCell.querySelector('.cellNameMode')?.textContent).toBe(uiText.keys.autoName)
    fireEvent.change(registeredCellInputs()[1], { target: { value: 'BG_A1_custom' } })
    await waitFor(() => expect(registeredCell.querySelector('.cellNameMode')?.textContent).toBe(uiText.keys.manualName))
    fireEvent.click(screen.getByRole('button', { name: uiText.keys.resetAutoName }))
    expect(registeredCellInputs().map(input => input.value)).toEqual(['', 'BG_A1'])
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    const previewPanel = await waitFor(() => {
      const panel = document.querySelector('.cellAssetPreviewPanel') as HTMLElement | null
      expect(panel).toBeTruthy()
      return panel
    })
    expect(previewPanel?.textContent).toContain(uiText.sheet.registeredAssets)
    expect(previewPanel?.textContent).toContain('作画')
    expect(previewPanel?.textContent).toContain('BG_A1')
    expect(previewPanel?.textContent).not.toContain('BG_A1.png')
    expect(previewPanel?.querySelector('img')?.getAttribute('src')).toBe('blob:asset-preview')

    const secondFile = new File(['asset-2'], 'BG_A2.png', { type: 'image/png', lastModified: 2 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [secondFile] } })
    expect(await screen.findByText('BG_A2.png')).toBeTruthy()
    const secondDragData: Record<string, string> = {}
    const secondDataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      setData: (type: string, value: string) => {
        secondDragData[type] = value
        if (!secondDataTransfer.types.includes(type)) secondDataTransfer.types.push(type)
      },
      getData: (type: string) => secondDragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('BG_A2.png'), { dataTransfer: secondDataTransfer })
    const secondWebviewDataTransfer = {
      files: [],
      types: ['text/plain'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      setData: () => undefined,
      getData: (type: string) => type === 'text/plain' ? secondDragData['text/plain'] : '',
    }
    fireEvent.drop(sheet, {
      clientX: 255,
      clientY: 290,
      dataTransfer: secondWebviewDataTransfer,
    })
    const dropMenu = await screen.findByRole('menu')
    expect(dropMenu.textContent).toContain(uiText.assetDrop.title)
    expect(dropMenu.textContent).toContain('BG_A2.png')
    expect(document.querySelector('.cellAssetPreviewPanel')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.register('演出')) }))
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    const gridPreviewPanel = await waitFor(() => {
      const panel = document.querySelector('.cellAssetPreviewPanel') as HTMLElement | null
      expect(panel).toBeTruthy()
      return panel
    })
    expect(gridPreviewPanel?.classList.contains('grid')).toBe(true)
    expect(gridPreviewPanel?.textContent).toContain(uiText.sheet.registeredAssetsCount(2))
    expect(gridPreviewPanel?.textContent).toContain('BG_A1')
    expect(gridPreviewPanel?.textContent).toContain('BG_A2')
    expect(gridPreviewPanel?.textContent).not.toContain('BG_A1.png')
    expect(gridPreviewPanel?.textContent).not.toContain('BG_A2.png')
    const updatedRegisteredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!updatedRegisteredCell) throw new Error('registered cell card not found')
    expect(Array.from(updatedRegisteredCell.querySelectorAll('.registeredCellAssetRow strong')).map(item => item.textContent)).toEqual([
      'BG_A1.png',
      'BG_A2.png',
    ])
    const registeredCellPreviewButton = updatedRegisteredCell.querySelector('.registeredCellPreviewButton') as HTMLButtonElement | null
    if (!registeredCellPreviewButton) throw new Error('registered cell preview button not found')
    fireEvent.click(registeredCellPreviewButton)
    const registeredCellPreview = await screen.findByRole('dialog', { name: uiText.assets.previewDialog('CELL A') })
    expect(registeredCellPreview.querySelectorAll('.assetPreviewItem')).toHaveLength(2)
    expect(registeredCellPreview.textContent).toContain('作画')
    expect(registeredCellPreview.textContent).toContain('演出')
    expect(registeredCellPreview.textContent).toContain('BG_A1')
    expect(registeredCellPreview.textContent).toContain('BG_A2')
    expect(Array.from(registeredCellPreview.querySelectorAll('img')).map(image => image.getAttribute('src'))).toEqual([
      'blob:asset-preview',
      'blob:asset-preview',
    ])
    const closeRegisteredCellPreview = registeredCellPreview.querySelector('.assetFloatingPreviewClose') as HTMLButtonElement | null
    if (!closeRegisteredCellPreview) throw new Error('registered cell preview close button not found')
    fireEvent.click(closeRegisteredCellPreview)

    const registeredCellDragData: Record<string, string> = {}
    const registeredCellDataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dragImageCalls: [] as Array<{ element: Element; x: number; y: number }>,
      setData: (type: string, value: string) => {
        registeredCellDragData[type] = value
        if (!registeredCellDataTransfer.types.includes(type)) registeredCellDataTransfer.types.push(type)
      },
      getData: (type: string) => registeredCellDragData[type] ?? '',
      setDragImage: (element: Element, x: number, y: number) => {
        registeredCellDataTransfer.dragImageCalls.push({ element, x, y })
      },
    }
    fireEvent.dragStart(updatedRegisteredCell, { dataTransfer: registeredCellDataTransfer })
    expect(registeredCellDragData[REGISTERED_CELL_DRAG_MIME]).toBeTruthy()
    expect(registeredCellDragData['text/plain']).toBe(`${REGISTERED_CELL_TEXT_DRAG_PREFIX}${registeredCellDragData[REGISTERED_CELL_DRAG_MIME]}`)
    const registeredCellDragImage = registeredCellDataTransfer.dragImageCalls[0]
    if (!registeredCellDragImage) throw new Error('registered cell drag image was not set')
    expect(registeredCellDragImage.x).toBe(0)
    expect(registeredCellDragImage.y).toBe(0)
    expect((registeredCellDragImage.element as HTMLElement).className).toBe('registeredCellDragImageShell')
    const registeredCellDragCard = (registeredCellDragImage.element as HTMLElement).querySelector('.registeredCellDragCardClone')
    expect(registeredCellDragCard).toBeTruthy()
    expect(registeredCellDragCard?.querySelector('.registeredCellTrackBadge')?.textContent).toBe('A')
    expect(registeredCellDragCard?.textContent).toContain('BG_A1.png')
    fireEvent.dragEnd(updatedRegisteredCell)
    const currentSheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    currentSheet.getBoundingClientRect = () => ({
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
    fireEvent.pointerMove(currentSheet, { clientX: 273, clientY: 290 })
    await waitFor(() => expect(document.querySelector('.hoverCellRect')).toBeTruthy())
    const registeredCellWebviewDataTransfer = {
      files: [],
      types: ['text/plain'],
      effectAllowed: 'copy',
      dropEffect: 'none',
      setData: () => undefined,
      getData: (type: string) => type === 'text/plain' ? registeredCellDragData['text/plain'] : '',
    }
    expect(fireEvent.drop(currentSheet, {
      clientX: 273,
      clientY: 290,
      dataTransfer: registeredCellWebviewDataTransfer,
    })).toBe(false)
    const registeredCellsAfterCardDrop = await waitFor(() => {
      const cards = Array.from(document.querySelectorAll('.registeredCellCard'))
      expect(cards.map(registeredCellIdentityText)).toEqual(['CELL A', 'CELL B'])
      return cards
    })
    expect(registeredCellsAfterCardDrop.map(registeredCellIdentityText)).toEqual(['CELL A', 'CELL B'])
    const clonedRegisteredCell = registeredCellsAfterCardDrop.find(card => registeredCellIdentityText(card) === 'CELL B') as HTMLElement | undefined
    if (!clonedRegisteredCell) throw new Error('cloned registered cell card not found')
    expect(Array.from(clonedRegisteredCell.querySelectorAll('.registeredCellAssetRow strong')).map(item => item.textContent)).toEqual([
      'BG_A1.png',
      'BG_A2.png',
    ])

    const thirdFile = new File(['asset-3'], 'BG_A3.png', { type: 'image/png', lastModified: 3 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [thirdFile] } })
    expect(await screen.findByText('BG_A3.png')).toBeTruthy()
    const thirdDragData: Record<string, string> = {}
    const thirdDataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      setData: (type: string, value: string) => {
        thirdDragData[type] = value
        if (!thirdDataTransfer.types.includes(type)) thirdDataTransfer.types.push(type)
      },
      getData: (type: string) => thirdDragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('BG_A3.png'), { dataTransfer: thirdDataTransfer })
    const sourceRegisteredCell = Array.from(document.querySelectorAll('.registeredCellCard'))
      .find(card => registeredCellIdentityText(card) === 'CELL A') as HTMLElement | undefined
    if (!sourceRegisteredCell) throw new Error('source registered cell card not found')
    const firstAssetRow = sourceRegisteredCell.querySelector('.registeredCellAssetRow') as HTMLElement | null
    if (!firstAssetRow) throw new Error('registered cell asset row not found')
    fireEvent.drop(firstAssetRow, { dataTransfer: thirdDataTransfer })
    const registeredCellDropMenu = await screen.findByRole('menu')
    expect(registeredCellDropMenu.textContent).toContain(uiText.assetDrop.title)
    expect(registeredCellDropMenu.textContent).toContain('BG_A3.png')
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(uiText.assetDrop.overwrite('作画')) }))
    const replacedRegisteredCell = document.querySelector('.registeredCellCard') as HTMLElement | null
    if (!replacedRegisteredCell) throw new Error('registered cell card not found')
    expect(Array.from(replacedRegisteredCell.querySelectorAll('.registeredCellAssetRow strong')).map(item => item.textContent)).toEqual([
      'BG_A3.png',
      'BG_A2.png',
    ])
    const currentSourceRegisteredCell = Array.from(document.querySelectorAll('.registeredCellCard'))
      .find(card => registeredCellIdentityText(card) === 'CELL A') as HTMLElement | undefined
    if (!currentSourceRegisteredCell) throw new Error('current source registered cell card not found')
    const sourcePreviewButton = currentSourceRegisteredCell.querySelector('.registeredCellPreviewButton') as HTMLButtonElement | null
    if (!sourcePreviewButton) throw new Error('source registered cell preview button not found')
    fireEvent.click(sourcePreviewButton)
    expect(await screen.findByRole('dialog', { name: uiText.assets.previewDialog('CELL A') })).toBeTruthy()
    clickSheet(currentSheet, 273, 290)
    await waitFor(() => {
      const targetPreview = screen.getByRole('dialog', { name: uiText.assets.previewDialog('CELL B') })
      expect(targetPreview.textContent).toContain('BG_A1')
    })
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.closePreview }))

    selectAppPanel(uiText.nav.export)
    const sourceSelect = screen.getByLabelText(uiText.export.timingSource)
    fireEvent.change(sourceSelect, { target: { value: 'cell' } })
    const preview = document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null
    expect(preview?.value).toContain('BG_A1')
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
    expect(screen.getAllByText(uiText.stackGuides.title).length).toBeGreaterThan(0)

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

    const dragData: Record<string, string> = {}
    const dataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        dragData[type] = value
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type)
      },
      getData: (type: string) => dragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('BOOK2_3.png'), { dataTransfer })
    expect(dragData[ASSET_DRAG_MIME]).toBeTruthy()
    const labelButton = Array.from(document.querySelectorAll('.stackGuideLabel')).find(label => label.textContent === 'BOOK2,3')
    if (!labelButton) throw new Error('stack guide label was not rendered')
    fireEvent.drop(labelButton, { dataTransfer })

    await waitFor(() => expect(document.querySelector('.stackGuideLabel.assigned')).toBeTruthy())
    const stackGuideCard = Array.from(document.querySelectorAll('.stackGuideCard'))
      .find(card => card.textContent?.includes('BOOK2,3')) as HTMLElement | undefined
    if (!stackGuideCard) throw new Error('stack guide card not found')
    expect(stackGuideCard.textContent).toContain('BOOK2_3.png')
    expect(stackGuideCard.textContent).toContain('作画')

    const cardDragData: Record<string, string> = {}
    const stackGuideDataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        cardDragData[type] = value
        if (!stackGuideDataTransfer.types.includes(type)) stackGuideDataTransfer.types.push(type)
      },
      getData: (type: string) => cardDragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(stackGuideCard, { dataTransfer: stackGuideDataTransfer })
    expect(cardDragData[STACK_GUIDE_DRAG_MIME]).toBeTruthy()
    const cellTarget = templateStackGuideHeaderPoint('cell', 4)
    const viewport = document.querySelector('.sheetViewport') as HTMLElement | null
    if (!viewport) throw new Error('sheet viewport not found')
    const stackGuideDragOver = createEvent.dragOver(viewport)
    Object.defineProperty(stackGuideDragOver, 'clientX', { value: cellTarget.x })
    Object.defineProperty(stackGuideDragOver, 'clientY', { value: cellTarget.y })
    Object.defineProperty(stackGuideDragOver, 'dataTransfer', { value: stackGuideDataTransfer })
    fireEvent(viewport, stackGuideDragOver)
    const stackGuideDrop = createEvent.drop(viewport)
    Object.defineProperty(stackGuideDrop, 'clientX', { value: cellTarget.x })
    Object.defineProperty(stackGuideDrop, 'clientY', { value: cellTarget.y })
    Object.defineProperty(stackGuideDrop, 'dataTransfer', { value: stackGuideDataTransfer })
    fireEvent(viewport, stackGuideDrop)
    await waitFor(() => expect(document.querySelectorAll('.stackGuideLabel').length).toBe(2))
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll('.stackGuideLabel')).map(label => `${label.getAttribute('data-stack-guide-role')}:${label.textContent}`).join(', ')
      expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="cell"]')).some(label => label.textContent === 'BOOK2,3'), labels).toBe(true)
    })

    selectAppPanel(uiText.nav.export)
    const preview = document.querySelector('.xdtsPreview') as HTMLTextAreaElement | null
    expect(preview?.value).toContain('BOOK2,3')
    expect(preview?.value).toContain('BG')
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

    const stackGuideCard = Array.from(document.querySelectorAll('.stackGuideCard'))
      .find(card => card.textContent?.includes('BOOK-CUT')) as HTMLElement | undefined
    if (!stackGuideCard) throw new Error('stack guide card not found')
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => stackGuideCard),
    })
    const stackGuideTargetBox = { left: 300, top: 240, width: 120, height: 60 }
    stackGuideCard.getBoundingClientRect = () => ({
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
    expect(document.querySelector('.assetDragImageShell.pointerDragGhost')).toBeTruthy()
    fireEvent.pointerUp(window, { pointerId: 73, pointerType: 'mouse', button: 0, buttons: 0, clientX: 360, clientY: 270 })
    expect(document.querySelector('.assetDragImageShell.pointerDragGhost')).toBeNull()
    const stackGuideDropMenu = await screen.findByRole('menu', { name: uiText.stackGuides.selectCorrectionLayer })
    fireEvent.click(within(stackGuideDropMenu).getByRole('menuitem', { name: /作画/ }))
    if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
    else Reflect.deleteProperty(document, 'elementFromPoint')
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('.stackGuideCard')).find(card => card.textContent?.includes('BOOK-CUT'))?.textContent).toContain('BOOK_CUT.png')
    })

    const assetDragData: Record<string, string> = {}
    const assetDataTransfer = {
      files: [],
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        assetDragData[type] = value
        if (!assetDataTransfer.types.includes(type)) assetDataTransfer.types.push(type)
      },
      getData: (type: string) => assetDragData[type] ?? '',
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(getAssetCardByName('BOOK_CUT.png'), { dataTransfer: assetDataTransfer })
    const firstCutLabel = Array.from(document.querySelectorAll('.stackGuideLabel')).find(label => label.textContent === 'BOOK-CUT')
    if (!firstCutLabel) throw new Error('first cut stack guide label was not rendered')
    fireEvent.drop(firstCutLabel, { dataTransfer: assetDataTransfer })
    await waitFor(() => expect(document.querySelector('.stackGuideLabel.assigned')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll('.stackGuideCard')).find(card => card.textContent?.includes('BOOK-CUT'))?.textContent).toContain('BOOK_CUT.png')

    const addCutButton = document.querySelector<HTMLButtonElement>('.cutSwitchAddButton')
    if (!addCutButton) throw new Error('shared cut add button not found')
    fireEvent.click(addCutButton)
    await waitFor(() => {
      const select = document.querySelector<HTMLSelectElement>('.cutSwitchControl select')
      expect(select?.options.length).toBe(2)
      expect(select?.selectedOptions[0]?.textContent?.trim()).toBe('002')
    })
    expect(Array.from(document.querySelectorAll('.stackGuideCard')).find(card => card.textContent?.includes('BOOK-CUT'))?.textContent).toContain('BOOK_CUT.png')

    dragStackGuideSvgLabel('BOOK-CUT', 'cell', 4)
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="cell"]')?.textContent).toBe('BOOK-CUT'))

    switchSharedCutByLabel('001')
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="action"]')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="cell"]')).some(label => label.textContent === 'BOOK-CUT')).toBe(false)

    switchSharedCutByLabel('002')
    await waitFor(() => expect(document.querySelector('.stackGuideLabel[data-stack-guide-role="cell"]')?.textContent).toBe('BOOK-CUT'))
    expect(Array.from(document.querySelectorAll('.stackGuideLabel[data-stack-guide-role="action"]')).some(label => label.textContent === 'BOOK-CUT')).toBe(false)
    expect(Array.from(document.querySelectorAll('.stackGuideCard')).find(card => card.textContent?.includes('BOOK-CUT'))?.textContent).toContain('BOOK_CUT.png')
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
