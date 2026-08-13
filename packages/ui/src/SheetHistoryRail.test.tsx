import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProjectDocument } from '@xsheet-remap/core'
import { SheetHistoryRail } from './SheetHistoryRail'

afterEach(cleanup)

describe('SheetHistoryRail', () => {
  it('shows the unnamed first sheet as an accessible tab and switches directly', () => {
    const document = createDefaultProjectDocument()
    const revision = document.cuts[0]!.revisions[0]!
    const onSwitch = vi.fn()
    render(
      <SheetHistoryRail
        revisions={[revision, { ...revision, revisionId: 'sheet_revision_2', order: 1, name: '演出' }]}
        activeRevisionId={revision.revisionId}
        processSuggestions={['作画', '演出']}
        onSwitch={onSwitch}
        onAdd={vi.fn()}
        onRename={vi.fn()}
        onToggleProtected={vi.fn()}
        onToggleSourceReference={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'シート1（名前なし）' })).toBeTruthy()
    expect(tabs.every(tab => tab.closest('.appTooltipTrigger') === null)).toBe(true)
    expect(screen.getByRole('tablist', { name: 'シート履歴' }).getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getByRole('button', { name: '修正用シートを追加' }).closest('[role="tablist"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '演出' }))
    expect(onSwitch).toHaveBeenCalledWith('sheet_revision_2')
  })

  it('requires a name, submits the selected options, and restores modal focus ownership', async () => {
    const revision = createDefaultProjectDocument().cuts[0]!.revisions[0]!
    const onAdd = vi.fn()
    render(
      <SheetHistoryRail
        revisions={[revision]}
        activeRevisionId={revision.revisionId}
        processSuggestions={[]}
        onSwitch={vi.fn()}
        onAdd={onAdd}
        onRename={vi.fn()}
        onToggleProtected={vi.fn()}
        onToggleSourceReference={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: '修正用シートを追加' })
    trigger.focus()
    fireEvent.click(trigger)
    const addButton = screen.getByRole('button', { name: '追加' })
    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '名前' }), { target: { value: '監督修正' } })
    fireEvent.click(screen.getByRole('button', { name: '空のシートを追加' }))
    fireEvent.click(addButton)
    expect(onAdd).toHaveBeenCalledWith({ name: '監督修正', mode: 'blank', showSourceReference: true })
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    const name = screen.getByRole('combobox', { name: '名前' })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'シートを追加' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
