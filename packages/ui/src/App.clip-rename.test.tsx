import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createClipNode, type ClipImportData } from '@xsheet-remap/core'
import { readClipFile } from '@xsheet-remap/adapters'
import { RemapApp } from './App'
import { clickSheet, expectSelectedRange, openAppNavigationMenu, openDisplaySettingsMenu, setSheetRect } from './App.test-support'
import { uiText } from './i18n'

vi.mock('@xsheet-remap/adapters', async importOriginal => ({ ...await importOriginal<typeof import('@xsheet-remap/adapters')>(), readClipFile: vi.fn() }))

it.each([
  ['action', 'デジタル標準'], ['cell', 'デジタル標準'], ['action', 'A3標準'], ['cell', 'A3標準'],
] as const)('selects the right-clicked imported %s column before renaming in %s', async (role, templateName) => {
  const names = ['A_ブランケット', 'B']
  const data: ClipImportData = {
    fileName: 'rename.clip', fileHash: 'fixture', currentTimelineId: 't',
    layers: [createClipNode('原画', 'folder', null, 'g'), ...names.flatMap((name, index) => [createClipNode(name, 'animation', 'g', `a${index}`), createClipNode('001', 'raster', `a${index}`, `c${index}`)])],
    nodes: [{ id: 'g', name: '原画', path: ['原画'], animation: false, visible: true, children: names.map((name, index) => (
      { id: `a${index}`, name, path: ['原画', name], animation: true, visible: true, children: [] }
    )) }],
    timelines: [{ id: 't', name: 'timeline', fps: 24, startFrame: 0, endFrame: 24, tracks: names.map((_, index) => ({ layerId: `a${index}`, frames: [{ frame: 0, value: '001' }] })) }],
  }
  vi.mocked(readClipFile).mockResolvedValue(data)
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
  render(<RemapApp />)
  openAppNavigationMenu()
  fireEvent.click(screen.getByRole('button', { name: '読み込み' }))
  const file = new File(['clip'], 'rename.clip')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
  fireEvent.change(document.querySelector('input[accept=".clip"]')!, { target: { files: [file] } })
  const importButton = await screen.findByRole('button', { name: 'タイムシートに読み込む' })
  fireEvent.click(screen.getByRole('button', { name: role.toUpperCase() }))
  fireEvent.click(importButton)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'CLIPを読み込む' })).toBeNull())
  fireEvent.click(within(openDisplaySettingsMenu()).getByRole('button', { name: templateName }))
  const sheet = screen.getByLabelText(templateName === 'デジタル標準' ? uiText.sheet.canvasSurfaceLabel : uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  const header = Array.from(document.querySelectorAll('.templateHeaderText')).find(element => element.textContent === role.toUpperCase())!.parentElement!
  const labels = () => Array.from(header.querySelectorAll('.templateColumnText'), element => element.textContent)
  const originalLabels = labels()
  const point = (index: number) => {
    const nameText = header.querySelectorAll('.templateColumnText')[index]!
    const scale = nameText.getAttribute('transform')!.match(/scale\(([^ ]+) ([^)]+)\)/)!
    return { clientX: Number(nameText.getAttribute('x')) * Number(scale[1]) * 1000, clientY: Number(nameText.getAttribute('y')) * Number(scale[2]) * 1000 }
  }
  const previous = point(0)
  clickSheet(sheet, previous.clientX, previous.clientY)
  expectSelectedRange(role, 'B', 1, 24)
  fireEvent.contextMenu(sheet, point(1))
  expectSelectedRange(role, 'A_ブランケット', 1, 24)
  fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.renamePaperTrack }))
  const input = screen.getByLabelText(uiText.sheet.renameTrackName)
  expect((input as HTMLInputElement).value).toBe('A_ブランケット')
  fireEvent.change(input, { target: { value: 'A' } })
  const confirm = screen.getByRole('button', { name: uiText.stackGuides.confirm })
  fireEvent.pointerDown(confirm, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 })
  fireEvent.mouseDown(confirm)
  confirm.focus()
  fireEvent.pointerUp(confirm, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 })
  fireEvent.mouseUp(confirm)
  fireEvent.click(confirm)
  expect(alert).not.toHaveBeenCalled()
  expect(labels().slice(0, 2)).toEqual(['B', 'A'])
  expectSelectedRange(role, 'A', 1, 24)
  expect(document.querySelector('.statusBar span')?.textContent).not.toContain('A_ブランケット')
  expect(document.querySelector(`[data-timeline-event-role="${role}"][data-timeline-event-track="A"] .eventText`)?.textContent).toBe('001')
  expect(document.querySelector(`[data-timeline-event-role="${role}"][data-timeline-event-track="B"] .eventText`)?.textContent).toBe('001')
  expect(document.querySelector('[data-clip-layer-id="a0"] .clipLayerName')?.textContent).toBe('A_ブランケット')
  fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
  expect(labels()).toEqual(originalLabels)
})
