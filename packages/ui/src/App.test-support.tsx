import { afterEach, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { cellRectForHit, timingHitForFrame, standardA3SheetTemplate, type SheetTemplateGridRole, type SheetTimingRole } from '@xsheet-remap/core';
import { uiText } from './i18n';

const tauriMockState = vi.hoisted(() => ({
  missingPathKeys: new Set<string>(),
}))

export function markMissingTauriPath(path: string) {
  tauriMockState.missingPathKeys.add(path.replace(/\\/g, '/').toLocaleLowerCase())
}

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

export const originalCreateObjectUrl = URL.createObjectURL

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

export function clickSheet(sheet: HTMLElement, clientX: number, clientY: number) {
  fireEvent.pointerDown(sheet, { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 1, clientX, clientY })
  fireEvent.pointerUp(sheet, { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 0, clientX, clientY })
}

export let nextInternalDragPointerId = 200

export function dragInternalPointer(
  source: HTMLElement,
  target: Element,
  options: { fromX?: number; fromY?: number; toX?: number; toY?: number } = {},
) {
  const pointerId = nextInternalDragPointerId++
  const fromX = options.fromX ?? 100
  const fromY = options.fromY ?? 100
  const toX = options.toX ?? 300
  const toY = options.toY ?? 260
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) })
  fireEvent.pointerDown(source, { pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: fromX, clientY: fromY })
  fireEvent.pointerMove(window, { pointerId, pointerType: 'mouse', buttons: 1, clientX: toX, clientY: toY })
  fireEvent.pointerUp(window, { pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: toX, clientY: toY })
  if (original) Object.defineProperty(document, 'elementFromPoint', original)
  else Reflect.deleteProperty(document, 'elementFromPoint')
}

export function clickTemplateFrame(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frame: number) {
  const point = templateFramePoint(role, paperTrack, frame)
  clickSheet(sheet, point.x, point.y)
}

export function templateFramePoint(role: SheetTimingRole, paperTrack: string, frame: number): { x: number; y: number } {
  return templateDisplayFramePoint(role, paperTrack, frame, standardA3SheetTemplate.defaults.durationFrames, standardA3SheetTemplate.defaults.frameOrigin)
}

export function templateDisplayFramePoint(role: SheetTimingRole, paperTrack: string, frame: number, durationFrames: number, frameOrigin: number): { x: number; y: number } {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, paperTrack, frame, durationFrames, frameOrigin)
  if (!hit) throw new Error(`template hit not found: ${role} ${paperTrack} ${frame}F`)
  const rect = cellRectForHit(standardA3SheetTemplate, hit, durationFrames, frameOrigin)
  if (!rect) throw new Error(`template rect not found: ${role} ${paperTrack} ${frame}F`)
  return {
    x: (rect.x + rect.w / 2) * 1000,
    y: (rect.y + rect.h / 2) * 1000,
  }
}

export function templateColumnHeaderPoint(role: SheetTimingRole, paperTrack: string): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnIndex = region.grid.columns.findIndex(column => column.paperTrack === paperTrack)
  if (columnIndex < 0) throw new Error(`template column not found: ${role} ${paperTrack}`)
  return {
    x: (region.rect.x + (region.rect.w * (columnIndex + 0.5)) / region.grid.columns.length) * 1000,
    y: (region.rect.y - 0.004) * 1000,
  }
}

export function templateStackGuideHeaderPoint(role: SheetTimingRole, gapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  return {
    x: (region.rect.x + (region.rect.w * gapIndex) / region.grid.columns.length) * 1000,
    y: (region.rect.y - 0.018) * 1000,
  }
}

export function templateStackGuideHeaderSnapPoint(role: SheetTimingRole, snapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnWidth = region.rect.w / region.grid.columns.length
  return {
    x: (region.rect.x - columnWidth + columnWidth * snapIndex) * 1000,
    y: (region.rect.y - 0.018) * 1000,
  }
}

export function templateStackGuideBodySnapPoint(role: SheetTimingRole, snapIndex: number): { x: number; y: number } {
  const region = standardA3SheetTemplate.regions.find(item => item.type === 'exposure-grid' && item.grid?.role === role)
  if (!region?.grid) throw new Error(`template region not found: ${role}`)
  const columnWidth = region.rect.w / region.grid.columns.length
  return {
    x: (region.rect.x - columnWidth + columnWidth * snapIndex) * 1000,
    y: (region.rect.y + region.rect.h * 0.48) * 1000,
  }
}

export function stackGuideConnectorAnchorX(labelText: string): number {
  const label = Array.from(document.querySelectorAll<SVGGElement>('.stackGuideSvgLabel'))
    .find(item => item.textContent === labelText)
  if (!label) throw new Error(`stack guide label not found: ${labelText}`)
  const connector = label.querySelector<SVGPathElement>('.stackGuideSvgConnector')
  const match = /^M\s+(-?\d+(?:\.\d+)?)/.exec(connector?.getAttribute('d') ?? '')
  if (!match) throw new Error(`stack guide connector path not found: ${labelText}`)
  return Number(match[1])
}

export function openStackGuideInsertMenu(sheet: HTMLElement, role: SheetTimingRole, gapIndex: number) {
  const point = templateStackGuideHeaderPoint(role, gapIndex)
  fireEvent.contextMenu(sheet, { clientX: point.x, clientY: point.y })
}

export async function clickActiveStackGuideInsertHandle(point: { x: number; y: number }) {
  await waitFor(() => expect(document.querySelectorAll('.stackGuideGap.insertToolActive')).toHaveLength(1))
  const activeHandle = document.querySelector<HTMLButtonElement>('.stackGuideGap.insertToolActive .stackGuideInsertHandle')
  if (!activeHandle) throw new Error('active stack guide insert handle not found')
  fireEvent.click(activeHandle, { clientX: point.x, clientY: point.y })
}

export function dragStackGuideSvgLabel(labelText: string, targetRole: SheetTimingRole, targetGapIndex: number) {
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

export function switchSharedCutByLabel(label: string) {
  const select = document.querySelector<HTMLSelectElement>('.cutSwitchControl select')
  if (!select) throw new Error('cut switch select not found')
  const option = Array.from(select.options).find(item => item.textContent?.trim() === label)
  if (!option) throw new Error(`cut switch option not found: ${label}`)
  fireEvent.change(select, { target: { value: option.value } })
}

export function clickTemplateDisplayFrame(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frame: number, durationFrames: number, frameOrigin: number) {
  const point = templateDisplayFramePoint(role, paperTrack, frame, durationFrames, frameOrigin)
  clickSheet(sheet, point.x, point.y)
}

export function dragTemplateDisplayFrames(sheet: HTMLElement, role: SheetTimingRole, paperTrack: string, frameStart: number, frameEnd: number, durationFrames: number, frameOrigin: number) {
  const start = templateDisplayFramePoint(role, paperTrack, frameStart, durationFrames, frameOrigin)
  const end = templateDisplayFramePoint(role, paperTrack, frameEnd, durationFrames, frameOrigin)
  dragSheet(sheet, start.x, start.y, end.x, end.y)
}

export function dragSheet(sheet: HTMLElement, startX: number, startY: number, endX: number, endY: number) {
  fireEvent.pointerDown(sheet, { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY })
  fireEvent.pointerMove(sheet, { pointerId: 11, pointerType: 'mouse', buttons: 1, clientX: endX, clientY: endY })
  fireEvent.pointerUp(sheet, { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 0, clientX: endX, clientY: endY })
}

export function setSheetRect(sheet: HTMLElement, left: number, top: number, width = 1000, height = 1000) {
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

export function setStackGuideOverlayRect(left = 0, top = 0, width = 1000, height = 1000): HTMLElement {
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

export function formatTestSignedPaddedNumber(value: number, digits: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${String(Math.abs(value)).padStart(digits, '0')}`
}

export function formatTestFrameTimecode(frame: number, frameOrigin = standardA3SheetTemplate.defaults.frameOrigin, fps = standardA3SheetTemplate.defaults.fps): string {
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

export function formatTestDurationTimecode(frameCount: number, fps = standardA3SheetTemplate.defaults.fps): string {
  const safeFps = Math.max(1, Math.round(fps))
  const totalFrames = Math.max(0, Math.round(frameCount))
  const seconds = Math.floor(totalFrames / safeFps)
  const koma = totalFrames % safeFps
  return `${String(seconds).padStart(2, '0')}+${String(koma).padStart(2, '0')}`
}

export function formatTestFramePosition(frame: number): string {
  return `${formatTestSignedPaddedNumber(frame, 3)} (${formatTestFrameTimecode(frame)})`
}

export function expectCurrentFrame(frame: number) {
  expect(document.querySelector('.currentFrameBadge')?.textContent).toBe(formatTestFramePosition(frame))
}

export function expectSelectionStatus(...parts: string[]) {
  const text = document.querySelector('.statusBar span')?.textContent ?? ''
  for (const part of parts) expect(text).toContain(part)
}

export function expectStatusHint(...parts: string[]) {
  const text = document.querySelector('.statusHint')?.textContent ?? ''
  for (const part of parts) expect(text).toContain(part)
}

export function expectSelectedHit(role: SheetTemplateGridRole, paperTrack: string, frame: number) {
  expectCurrentFrame(frame)
  expectSelectionStatus(role.toUpperCase(), paperTrack, formatTestFramePosition(frame))
}

export function expectSelectedRange(role: SheetTemplateGridRole, paperTrack: string, frameStart: number, frameEnd: number) {
  expectSelectionStatus(role.toUpperCase(), paperTrack)
  expect(document.querySelector('.rangeFrameInspector')?.classList.contains('empty')).toBe(false)
  const values = Array.from(document.querySelectorAll('.rangeFrameInspectorValue')).map(element => element.textContent)
  expect(values).toEqual([
    formatTestFrameTimecode(frameStart),
    formatTestFrameTimecode(frameEnd),
    formatTestDurationTimecode(frameEnd - frameStart + 1),
  ])
}

export type MockFileSystemEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (file: File) => void) => void
  createReader?: () => {
    readEntries: (success: (entries: MockFileSystemEntry[]) => void) => void
  }
}

export function mockFileEntry(file: File): MockFileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: success => success(file),
  }
}

export function mockDirectoryEntry(name: string, entries: MockFileSystemEntry[]): MockFileSystemEntry {
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

export function mockFileTransferItem(entry: MockFileSystemEntry, file: File | null = null) {
  return {
    kind: 'file',
    type: file?.type ?? '',
    getAsFile: () => file,
    webkitGetAsEntry: () => entry,
  }
}

export function registeredCellIdentityText(card: Element) {
  const sectionTitle = card.closest('.registeredCellSection')?.getAttribute('data-section-title') ?? ''
  return [sectionTitle, ...Array.from(card.querySelectorAll('.registeredCellRoleBadge, .registeredCellTrackBadge'))
    .map(item => item.textContent ?? '')
  ]
    .filter(Boolean)
    .join(' ')
}

export function getAssetCardByName(name: string): HTMLElement {
  const card = Array.from(document.querySelectorAll<HTMLElement>('.assetCard'))
    .find(item => Array.from(item.querySelectorAll('strong')).some(label => label.textContent === name))
  if (!card) throw new Error(`asset card not found: ${name}`)
  return card
}

export async function findAssetCardByName(name: string): Promise<HTMLElement> {
  await screen.findByText(name)
  return getAssetCardByName(name)
}

export function openAppNavigationMenu(): HTMLElement {
  const trigger = screen.getByLabelText(uiText.nav.menu)
  fireEvent.click(trigger)
  const menu = trigger.closest('details')
  if (!(menu instanceof HTMLElement)) throw new Error('app navigation menu not found')
  expect((menu as HTMLDetailsElement).open).toBe(true)
  const content = document.querySelector('.actionMenuPortalContent.appNavMenu')
  if (!(content instanceof HTMLElement)) throw new Error('app navigation menu content not found')
  return content
}

export function selectAppPanel(label: string) {
  const menu = openAppNavigationMenu()
  fireEvent.click(within(menu).getByRole('button', { name: label }))
}

export function getZoomSlider(): HTMLInputElement {
  const zoom = document.querySelector('.zoomSliderControl input[type="range"]') as HTMLInputElement | null
  if (!zoom) throw new Error('zoom control not found')
  return zoom
}

export function getSheetOpacitySlider(): HTMLInputElement {
  const opacity = document.querySelector('.topOpacityControl input[type="range"]') as HTMLInputElement | null
  if (!opacity) throw new Error('sheet opacity control not found')
  return opacity
}

export function sheetImageHrefs(): string[] {
  return Array.from(document.querySelectorAll('.sheetSvg image'))
    .map(image => image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '')
    .filter(Boolean)
}

export function levelCorrectionFilterTableValues(): string {
  const sheet = document.querySelector('.sheetSvg')
  const channel = Array.from(sheet?.querySelectorAll('*') ?? [])
    .find(element => element.tagName.toLowerCase() === 'fefuncr')
  return channel?.getAttribute('tableValues') ?? channel?.getAttribute('tablevalues') ?? ''
}
