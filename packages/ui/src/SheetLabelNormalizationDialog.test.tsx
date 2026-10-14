import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDefaultProject, createKey, setEvent } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NameNormalizationDialog } from './registered-cells-dialogs'
import { uiText } from './i18n'

afterEach(cleanup)
function setup(conflict = false) {
  const created = createKey(createDefaultProject(), 'A', '0001', 'import', '0001', 'action')
  let project = setEvent(created.project, 'A', 1, created.key.keyId, 'action')
  if (conflict) project = createKey(project, 'A', '1', 'manual', '1', 'action').project
  const onApply = vi.fn(async () => undefined)
  const onClose = vi.fn()
  render(<NameNormalizationDialog project={project} selectedKeyId={null} selectedHit={null} rangeSelection={null} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}
describe('sheet label mode in bulk rename', () => {
  it('preserves the CSP mode and previews sheet changes separately from file operations', async () => {
    const { onApply } = setup()
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect(screen.getByLabelText(uiText.nameNormalization.includeAssetFiles)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('変更する名前'), { target: { value: 'sheet' } })
    expect(screen.getByRole('dialog', { name: 'シート記載を一括変更' })).toBeTruthy()
    expect(screen.queryByLabelText(uiText.nameNormalization.includeAssetFiles)).toBeNull()
    expect(screen.getByText('0001')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'この内容でシート記載を変更' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply.mock.calls[0]).toEqual([expect.objectContaining({ kind: 'sheet-labels', conflicts: [], items: [expect.objectContaining({ currentLabel: '0001', nextLabel: '1' })] })])
  })
  it('blocks a conflicting zero-strip plan and allows a collision-free simultaneous renumber', () => {
    const { onApply, onClose } = setup(true)
    fireEvent.change(screen.getByLabelText('変更する名前'), { target: { value: 'sheet' } })
    expect(screen.getByRole('alert').textContent).toContain('重複')
    expect((screen.getByRole('button', { name: 'この内容でシート記載を変更' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('変更方法'), { target: { value: 'sequence' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: 'この内容でシート記載を変更' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(onApply).not.toHaveBeenCalled()
  })
})
