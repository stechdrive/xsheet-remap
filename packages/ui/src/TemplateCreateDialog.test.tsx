import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateCreateDialog } from './TemplateCreateDialog'

afterEach(() => cleanup())

describe('TemplateCreateDialog', () => {
  it('keeps the dialog modal and prevents duplicate actions while creation is running', async () => {
    let finishCreation: (() => void) | undefined
    const creation = new Promise<void>(resolve => { finishCreation = resolve })
    const onClose = vi.fn()
    const onCreatePaper = vi.fn(() => creation)

    render(
      <TemplateCreateDialog
        onClose={onClose}
        onCreatePaper={onCreatePaper}
        onCreateDigital={vi.fn()}
        onDuplicateCurrent={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '作成' }))
    const dialog = screen.getByRole('dialog', { name: '新しいテンプレート' })
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '作成中…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.pointerDown(dialog)
    fireEvent.click(screen.getByRole('button', { name: '作成中…' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(onCreatePaper).toHaveBeenCalledTimes(1)

    finishCreation?.()
    await waitFor(() => expect(dialog.getAttribute('aria-busy')).toBe('false'))
  })

  it('offers the current template as a duplication source', async () => {
    const onDuplicateCurrent = vi.fn()
    render(
      <TemplateCreateDialog
        onClose={vi.fn()}
        onCreatePaper={vi.fn()}
        onCreateDigital={vi.fn()}
        onDuplicateCurrent={onDuplicateCurrent}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '現在から複製' }))

    await waitFor(() => expect(onDuplicateCurrent).toHaveBeenCalledTimes(1))
  })
})
