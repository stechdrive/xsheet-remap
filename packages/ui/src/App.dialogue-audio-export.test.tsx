import { describe, expect, it } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { App, RemapApp } from './App'
import { openAppNavigationMenu } from './App.test-support'
import { uiText } from './i18n'

describe('App: dialogue audio export menu', () => {
  it('offers WAV first and MP3 for separate audio-track export in Editor', () => {
    render(<App />)
    const menu = openAppNavigationMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.actions.exportMenu }))
    const group = within(menu).getByRole('group', { name: uiText.actions.dialogueAudioExport })

    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['WAV', 'MP3'])
    expect(group.querySelector('.appNavCorrectedSheetExportHint')).toBeNull()
    expect(within(group).getByRole('button', {
      name: uiText.actions.dialogueAudioExportFormatTitle('WAV'),
    })).toBeTruthy()
    expect(within(group).getByRole('button', {
      name: uiText.actions.dialogueAudioExportFormatTitle('MP3'),
    })).toBeTruthy()
  })

  it('keeps audio-track export out of Remap', () => {
    render(<RemapApp />)
    const menu = openAppNavigationMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.actions.exportMenu }))

    expect(within(menu).queryByRole('group', { name: uiText.actions.dialogueAudioExport })).toBeNull()
  })
})
