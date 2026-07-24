import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from './App'
import { uiText } from './i18n'
import {
  clickTemplateFrame,
  openAppNavigationMenu,
  openCutMetadataMenu,
  openSharedCutMenu,
  openTimingExportDialog,
  setSheetRect,
  switchSharedCutByLabel,
} from './App.test-support'

describe('App: timing edit operation boundaries', () => {
  it('commits an out-of-range timing draft before shortening the cut duration', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 80)
    fireEvent.keyDown(window, { key: '9' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('9')

    openCutMetadataMenu()
    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '3' } })
    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')).toBeNull()

    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '6' } })
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('9')
  })

  it('commits a timing draft when pointer focus leaves the sheet editor', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '7' })
    fireEvent.pointerDown(screen.getByLabelText(uiText.sheet.displaySettingsMenu))

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('7')
  })

  it('cancels the active timing draft before traversing project undo history', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '4' })
    const undo = screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)

    fireEvent.pointerDown(undo)
    fireEvent.focusIn(undo)
    fireEvent.click(undo)

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')).toBeNull()
    expect((screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('commits the active timing draft before saving the project', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '5' })
    const menu = openAppNavigationMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.actions.saveProject }))

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('5')
  })

  it('commits the active timing draft before preparing timing exports', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '3' })
    openTimingExportDialog()

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('3')
  })

  it('commits a timing draft to its source cut before switching shared cuts', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const menu = openSharedCutMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutTitle }))
    fireEvent.change(within(menu).getByLabelText(uiText.sheet.addSharedCutName), { target: { value: 'BOOK別案' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '8' })
    switchSharedCutByLabel('001')
    expect(document.querySelector('.eventText')).toBeNull()

    switchSharedCutByLabel('BOOK別案')
    expect(document.querySelector('.eventText')?.textContent).toBe('8')
  })

  it('treats an active timing edit as unsaved window state', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '6' })

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
  })
})
