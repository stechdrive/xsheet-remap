import { expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from './App'
import { selectAppPanel } from './App.test-support'
import { uiText } from './i18n'

async function createDigitalTemplateDraft() {
  fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
  fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
  const dialog = screen.getByRole('dialog', { name: '新しいテンプレート' })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'デジタルタイムシート' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '作成' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())
}

it('undoes and redoes an applied template with the synchronized project history', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    await createDigitalTemplateDraft()
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトへ反映' }))
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)

    // Project history remains available on the sheet; the template panel owns its draft history.
    selectAppPanel(uiText.nav.sheet)
    const undo = screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    fireEvent.click(undo)
    selectAppPanel(uiText.nav.template)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(0)

    selectAppPanel(uiText.nav.sheet)
    expect(redo.disabled).toBe(false)
    fireEvent.click(redo)
    selectAppPanel(uiText.nav.template)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox')).toHaveLength(14)
  })
