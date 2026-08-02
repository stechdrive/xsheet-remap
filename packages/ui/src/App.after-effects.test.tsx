import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { setSheetRect, templateColumnHeaderPoint } from './App.test-support'
import { uiText } from './i18n'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (originalClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

it('copies Japanese and English AE Keyframe Data from the cell column header menu', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<App />)
  const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
  setSheetRect(sheet, 0, 0)

  const headerPoint = templateColumnHeaderPoint('cell', 'A')
  fireEvent.contextMenu(sheet, { clientX: headerPoint.x, clientY: headerPoint.y })
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    uiText.actions.selectPaperTrackColumn,
    uiText.actions.renamePaperTrack,
    `${uiText.actions.copyAeKeyframeDataMenu}›`,
  ])

  const copySubmenuTrigger = within(menu).getByRole('menuitem', { name: uiText.actions.copyAeKeyframeDataMenu })
  expect(copySubmenuTrigger.getAttribute('aria-haspopup')).toBe('menu')
  expect(copySubmenuTrigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.focus(copySubmenuTrigger)
  expect(copySubmenuTrigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(copySubmenuTrigger)
  expect(copySubmenuTrigger.getAttribute('aria-expanded')).toBe('true')

  const copySubmenu = within(menu).getByRole('menu', { name: uiText.actions.copyAeKeyframeDataMenu })
  expect(within(copySubmenu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    uiText.actions.copyAeKeyframeDataJapanese,
    uiText.actions.copyAeKeyframeDataEnglish,
  ])
  fireEvent.click(within(copySubmenu).getByRole('menuitem', { name: uiText.actions.copyAeKeyframeDataJapanese }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Adobe After Effects .* Keyframe Data/)))
  expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Effects\tブラインド #1\t変換終了 #2\t'))
  expect(await screen.findByText(new RegExp(uiText.afterEffects.copySucceeded('A')))).toBeTruthy()

  fireEvent.contextMenu(sheet, { clientX: headerPoint.x, clientY: headerPoint.y })
  const reopenedMenu = screen.getByRole('menu')
  fireEvent.click(within(reopenedMenu).getByRole('menuitem', { name: uiText.actions.copyAeKeyframeDataMenu }))
  const reopenedCopySubmenu = within(reopenedMenu).getByRole('menu', { name: uiText.actions.copyAeKeyframeDataMenu })
  fireEvent.click(within(reopenedCopySubmenu).getByRole('menuitem', { name: uiText.actions.copyAeKeyframeDataEnglish }))
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Effects\tVenetian Blinds #1\tTransition Completion #2\t')))
})
