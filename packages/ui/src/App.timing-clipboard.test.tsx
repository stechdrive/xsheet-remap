import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { addOverlayPaperTrackAtCspTop, createDefaultProject, createSheetPages, standardA3SheetTemplate } from '@xsheet-remap/core'
import { App, RemapApp } from './App'
import { canvasContextPrototype } from './canvas-context.test-support'
import { clickSheet, clickTemplateFrame, dragTemplateDisplayFrames, enterTimingValue, expectSelectedHit, expectSelectedRange, setSheetRect, templateFramePoint } from './App.test-support'
import { overlayColumnRectForPage } from './sheet-layers-hit-geometry'
import { uiText } from './i18n'

beforeEach(() => { vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue(null) })
afterEach(() => vi.restoreAllMocks())

function text(role: 'action' | 'cell', track: string, frame: number) {
  return document.querySelector(`[data-timeline-event-role="${role}"][data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"] .eventText`)?.textContent
}

it.each(['action', 'cell'] as const)('pastes a copied %s range into the other role, renumbers independently and supports undo', sourceRole => {
  render(<App />)
  const targetRole = sourceRole === 'action' ? 'cell' : 'action'
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  clickTemplateFrame(sheet, sourceRole, 'A', 1)
  enterTimingValue('1')
  clickTemplateFrame(sheet, sourceRole, 'A', 3)
  enterTimingValue('2')
  dragTemplateDisplayFrames(sheet, sourceRole, 'A', 1, 3, 144, 1)
  expectSelectedRange(sourceRole, 'A', 1, 3)
  fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
  clickTemplateFrame(sheet, targetRole, 'A', 8)
  fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
  expectSelectedRange(targetRole, 'A', 8, 10)
  expect(text(targetRole, 'A', 8)).toBe('1')
  expect(text(targetRole, 'A', 10)).toBe('2')
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
  expect(text(targetRole, 'A', 8)).toBeUndefined()
  fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
  expect(text(targetRole, 'A', 8)).toBe('1')
  clickTemplateFrame(sheet, targetRole, 'A', 8)
  enterTimingValue('5')
  expect(text(targetRole, 'A', 8)).toBe('5')
  expect(text(sourceRole, 'A', 1)).toBe('1')
  expect(text(sourceRole, 'A', 3)).toBe('2')
})

it('enables cross-role paste and explicit content choices in the context menu', () => {
  render(<App />)
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  clickTemplateFrame(sheet, 'action', 'A', 1)
  enterTimingValue('2')
  dragTemplateDisplayFrames(sheet, 'action', 'A', 1, 3, 144, 1)
  fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
  const point = templateFramePoint('cell', 'A', 8)
  fireEvent.contextMenu(sheet, { clientX: point.x, clientY: point.y })
  for (const name of [uiText.actions.pasteOverwrite, uiText.actions.pasteNotation, uiText.actions.pasteWithBindings]) {
    expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(false)
  }
  fireEvent.click(screen.getByRole('menuitem', { name: uiText.actions.pasteNotation }))
  expect(text('cell', 'A', 8)).toBe('2')
  expectSelectedRange('cell', 'A', 8, 10)
})

it('creates an ACTION column from the CSP plus menu and keeps input and arrow navigation on it', async () => {
  render(<RemapApp />)
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)
  fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
  fireEvent.click(screen.getByRole('button', { name: '追加セル列' }))
  fireEvent.click(screen.getByRole('button', { name: '追加セル列を作成' }))
  await waitFor(() => expect(screen.getByRole('button', { name: uiText.actions.overlayPaperTrackInputActive('J') })).toBeTruthy())
  const added = addOverlayPaperTrackAtCspTop(createDefaultProject(), { paperTrack: 'J' })
  const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]
  const column = overlayColumnRectForPage(standardA3SheetTemplate, added.project, added.paperTrack, page)!
  const x = (column.rect.x + column.rect.w / 2) * 1000
  const y = (column.rect.y + column.rect.h / column.frames.rowCount / 2) * 1000
  clickSheet(sheet, x, y)
  expectSelectedHit('action', 'J', 1)
  enterTimingValue('7')
  expectSelectedHit('action', 'J', 2)
  fireEvent.keyDown(window, { key: 'ArrowDown' })
  expectSelectedHit('action', 'J', 3)
  expect(text('action', 'J', 1)).toBe('7')
  expect(text('cell', 'J', 1)).toBeUndefined()
})
