import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProjectDocument } from '@xsheet-remap/core'
import { SheetHistoryBar } from './SheetHistoryBar'

afterEach(cleanup)

describe('SheetHistoryBar', () => {
  it('shows the unnamed first sheet as an accessible tab and switches directly', () => {
    const document = createDefaultProjectDocument()
    const revision = document.cuts[0]!.revisions[0]!
    const onSwitch = vi.fn()
    render(
      <SheetHistoryBar
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
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: '演出' }))
    expect(onSwitch).toHaveBeenCalledWith('sheet_revision_2')
  })

  it('requires a name and submits the selected creation mode and underlay option', () => {
    const revision = createDefaultProjectDocument().cuts[0]!.revisions[0]!
    const onAdd = vi.fn()
    render(
      <SheetHistoryBar
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
    fireEvent.click(screen.getByRole('button', { name: 'シートを追加' }))
    const addButton = screen.getByRole('button', { name: '追加' })
    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '名前' }), { target: { value: '監督修正' } })
    fireEvent.click(screen.getByRole('button', { name: '空のシートを追加' }))
    fireEvent.click(addButton)
    expect(onAdd).toHaveBeenCalledWith({ name: '監督修正', mode: 'blank', showSourceReference: true })
  })
})
