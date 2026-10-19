import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { App } from './App'
import { canvasContextPrototype } from './canvas-context.test-support'
import { uiText } from './i18n'
import { openDisplaySettingsMenu, setColumnInsertionRect, setSheetRect } from './App.test-support'
import { sheetGridHeaderGeometry } from './sheetGridHeaderGeometry'

beforeEach(() => vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue(null))

function paper() {
  render(<App />)
  fireEvent.click(within(openDisplaySettingsMenu()).getByRole('button', { name: 'A3標準' }))
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  return sheet
}

it.each(['action', 'cell', 'sound', 'camera'] as const)('offers the same %s additions from the title, column name and body', role => {
  const sheet = paper()
  const region = standardA3SheetTemplate.regions.find(item => item.regionId === `left_${role}_grid`)!
  const rect = region.rect
  const header = sheetGridHeaderGeometry(standardA3SheetTemplate, region, rect, standardA3SheetTemplate.page.heightPx)
  const expected = role === 'action' || role === 'cell'
    ? [uiText.stackGuides.add, uiText.stackGuides.addOverlayTrack] : [`${role.toUpperCase()}列を追加`]
  for (const y of [header.title.y + header.title.h / 2, header.columns.y + header.columns.h / 2, rect.y + rect.h / 10]) {
    fireEvent.contextMenu(sheet, { clientX: (rect.x + rect.w / 8) * 1000, clientY: y * 1000 })
    for (const name of expected) expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    if (role === 'sound' || role === 'camera') expect(screen.queryByRole('menuitem', { name: uiText.stackGuides.add })).toBeNull()
  }
})

it.each(['sound', 'camera'] as const)('adds %s at the first boundary with no naming step, and undoes exactly once', role => {
  const sheet = paper()
  const region = standardA3SheetTemplate.regions.find(item => item.regionId === `left_${role}_grid`)!
  const x = region.rect.x * 1000, y = (region.rect.y + 0.05) * 1000
  fireEvent.contextMenu(sheet, { clientX: x + 1, clientY: y })
  fireEvent.click(screen.getByRole('menuitem', { name: `${role.toUpperCase()}列を追加` }))
  const surface = setColumnInsertionRect()
  // A different role has no insertion target and cannot commit.
  fireEvent.pointerMove(surface, { clientX: 0, clientY: 0 })
  expect(document.querySelector('.columnInsertionMarker')).toBeNull()
  fireEvent.click(surface, { clientX: 0, clientY: 0 })
  expect(document.querySelector('.columnInsertionSurface')).toBeTruthy()
  expect(document.querySelector('.sheetHiddenColumnsNotice')).toBeNull()
  fireEvent.pointerMove(surface, { clientX: x, clientY: y })
  expect(document.querySelector('.columnInsertionCaption')?.textContent).toContain('先頭')
  expect(document.querySelector('.columnInsertionCaption')?.textContent).toContain('非表示')
  fireEvent.click(surface, { clientX: x, clientY: y })
  expect(document.querySelector('.columnInsertionSurface')).toBeNull()
  expect(document.querySelector('.timelineLaneEditorPopover')).toBeNull()
  expect(screen.getByLabelText('このテンプレートでは1列が非表示')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
  expect(document.querySelector('.sheetHiddenColumnsNotice')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
  expect(screen.getByLabelText('このテンプレートでは1列が非表示')).toBeTruthy()
  const header = sheetGridHeaderGeometry(standardA3SheetTemplate, region, region.rect, standardA3SheetTemplate.page.heightPx)
  fireEvent.contextMenu(sheet, { clientX: x + 1, clientY: (header.columns.y + header.columns.h / 2) * 1000 })
  fireEvent.click(screen.getByRole('menuitem', { name: '列名を変更' }))
  expect((screen.getByLabelText(`${role.toUpperCase()}列名`) as HTMLInputElement).value).toBe(role === 'sound' ? 'S5' : '7')
})

it.each(['escape', 'outside', 'pointercancel', 'blur'] as const)('cancels a column insertion on %s without creating history', cancellation => {
  paper()
  fireEvent.click(screen.getByLabelText('列を追加'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'CAMERA列を追加' }))
  expect(document.querySelector('.sheetColumnAddMenu[open]')).toBeNull()
  const surface = setColumnInsertionRect()
  if (cancellation === 'escape') fireEvent.keyDown(surface, { key: 'Escape' })
  else if (cancellation === 'outside') fireEvent.pointerDown(document.body)
  else if (cancellation === 'pointercancel') fireEvent.pointerCancel(surface)
  else fireEvent.blur(window)
  expect(document.querySelector('.columnInsertionSurface')).toBeNull()
  expect(document.querySelector('.sheetHiddenColumnsNotice')).toBeNull()
  // The template selection before starting this session is the only history entry.
  fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
  expect((screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement).disabled).toBe(true)
})
