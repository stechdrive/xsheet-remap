import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { canvasContextPrototype } from './canvas-context.test-support'
import { App } from './App'
import { uiText, viewModeLabels } from './i18n'
import { clickTemplateDisplayFrame, enterTimingValue, openCutMetadataMenu, openDisplaySettingsMenu, setSheetRect } from './App.test-support'

beforeEach(() => { vi.spyOn(canvasContextPrototype(), 'getContext').mockReturnValue(null) })
afterEach(() => { vi.restoreAllMocks() })

function toggle(label: string) {
  const checkbox = within(openDisplaySettingsMenu()).getByRole('checkbox', { name: label }) as HTMLInputElement
  fireEvent.click(checkbox)
  return checkbox.checked
}
function eventText(frame: number) {
  return document.querySelector(`[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"] .eventText`)?.textContent
}
function selectPage(page: number) {
  const trigger = screen.getByLabelText(uiText.sheet.activePage)
  if (!trigger.closest('details')?.open) fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: uiText.sheet.pageTab(page) }))
}

describe('App dummy frame display', () => {
  it('edits beyond the cut, toggles both sides independently, and retains hidden keys', () => {
    render(<App />)
    openCutMetadataMenu()
    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '3' } })
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    expect((within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.postRoll) as HTMLInputElement).checked).toBe(false)
    expect(toggle(uiText.sheet.postRoll)).toBe(true)
    clickTemplateDisplayFrame(sheet, 'cell', 'A', 72, 96, 1)
    enterTimingValue('7')
    clickTemplateDisplayFrame(sheet, 'cell', 'A', 80, 96, 1)
    enterTimingValue('8')
    expect(eventText(72)).toBe('7')
    expect(eventText(80)).toBe('8')

    expect(toggle(uiText.sheet.preRoll)).toBe(true)
    clickTemplateDisplayFrame(sheet, 'cell', 'A', -23, 120, -23)
    enterTimingValue('6')
    expect(eventText(-23)).toBe('6')
    expect(toggle(uiText.sheet.postRoll)).toBe(false)
    expect(eventText(80)).toBeUndefined()
    expect(eventText(-23)).toBe('6')
    expect(toggle(uiText.sheet.preRoll)).toBe(false)
    expect(eventText(-23)).toBeUndefined()
    expect((within(openDisplaySettingsMenu()).getByLabelText(uiText.sheet.postRoll) as HTMLInputElement).checked).toBe(false)
    expect(toggle(uiText.sheet.postRoll)).toBe(true)
    expect(eventText(80)).toBe('8')
    expect(eventText(-23)).toBeUndefined()
    expect(toggle(uiText.sheet.preRoll)).toBe(true)
    expect(eventText(-23)).toBe('6')
    openCutMetadataMenu()
    expect(Number((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value)).toBe(3)
  })

  it('adds a page past a full cut and restores its timing through hide, undo and redo', async () => {
    render(<App />)
    fireEvent.click(within(openDisplaySettingsMenu()).getByRole('button', { name: viewModeLabels['single-page'] }))
    toggle(uiText.sheet.postRoll)
    selectPage(2)
    const tail = await screen.findByLabelText(uiText.sheet.canvasPageLabel(2))
    expect(tail.getAttribute('data-page-id')).toBe('page_2')
    setSheetRect(tail, 0, 0)
    clickTemplateDisplayFrame(tail, 'cell', 'A', 145, 168, 1)
    enterTimingValue('9')
    expect(eventText(145)).toBe('9')
    toggle(uiText.sheet.postRoll)
    expect(screen.getByLabelText(uiText.sheet.activePage).textContent).toContain('1P')
    expect(eventText(145)).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    await waitFor(() => expect(eventText(145)).toBe('9'))
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.redo }))
    expect(eventText(145)).toBeUndefined()
    toggle(uiText.sheet.postRoll)
    selectPage(2)
    await waitFor(() => expect(eventText(145)).toBe('9'))
  })
})
