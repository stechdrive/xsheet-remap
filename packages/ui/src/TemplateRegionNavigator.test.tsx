import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateRegionNavigator } from './TemplateRegionNavigator'

afterEach(() => cleanup())

describe('TemplateRegionNavigator', () => {
  it('exposes selection and authoring actions with shared application tooltips', async () => {
    const onSelect = vi.fn()
    const onToggleHidden = vi.fn()
    const onTogglePositionLocked = vi.fn()
    const onDuplicate = vi.fn()
    const onDelete = vi.fn()
    const onMove = vi.fn()
    const props = {
      items: [
        { regionId: 'a', label: 'ACTION', kind: 'ACTION / 9列' },
        { regionId: 'b', label: 'メモ', kind: '入力表' },
      ],
      hiddenRegionIds: new Set(['b']),
      positionLockedRegionIds: new Set(['a']),
      onSelect,
      onToggleHidden,
      onTogglePositionLocked,
      onDuplicate,
      onDelete,
      onMove,
    }
    const { rerender } = render(
      <TemplateRegionNavigator
        {...props}
        selectedRegionId="a"
      />,
    )

    const actionGroup = screen.getByRole('group', { name: 'ACTIONの操作' })
    expect(actionGroup.querySelectorAll('button')).toHaveLength(2)
    const actionSelector = screen.getByRole('button', { name: 'ACTION' })
    expect(actionSelector.getAttribute('aria-describedby')).toBe('template-region-kind-0 template-region-state-0')
    expect(document.getElementById('template-region-state-0')?.textContent).toContain('一時固定')
    await expectSharedTooltip(screen.getByRole('button', { name: 'ACTIONを編集画面で非表示' }), '保存内容は変えず')
    await expectSharedTooltip(screen.getByRole('button', { name: 'ACTIONの位置を一時的に固定解除' }), '編集中だけ')
    fireEvent.click(screen.getByLabelText('ACTIONのその他の操作'))
    await expectSharedTooltip(screen.getByRole('button', { name: 'ACTIONを複製' }), 'データ割当は元の領域と共有')
    const backButton = screen.getByRole('button', { name: 'ACTIONを背面へ' })
    expect(backButton.getAttribute('aria-disabled')).toBe('true')
    await expectSharedTooltip(backButton, 'すでに最背面です')
    fireEvent.focus(backButton)
    expect((await screen.findByRole('tooltip')).textContent).toContain('すでに最背面です')
    fireEvent.blur(backButton)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    expect(actionGroup.querySelector('[title]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ACTIONの位置を一時的に固定解除' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモ' }))
    rerender(<TemplateRegionNavigator {...props} selectedRegionId="b" />)
    expect(document.getElementById('template-region-state-1')?.textContent).toContain('編集時非表示')
    fireEvent.click(screen.getByRole('button', { name: 'メモを編集画面で表示' }))
    fireEvent.click(screen.getByLabelText('メモのその他の操作'))
    fireEvent.click(screen.getByRole('button', { name: 'メモを複製' }))
    fireEvent.click(screen.getByLabelText('メモのその他の操作'))
    fireEvent.click(screen.getByRole('button', { name: 'メモを背面へ' }))
    fireEvent.click(screen.getByLabelText('メモのその他の操作'))
    fireEvent.click(screen.getByRole('button', { name: 'メモを削除' }))

    expect(onSelect).toHaveBeenCalledWith('b')
    expect(onToggleHidden).toHaveBeenCalledWith('b')
    expect(onTogglePositionLocked).toHaveBeenCalledWith('a')
    expect(onDuplicate).toHaveBeenCalledWith('b')
    expect(onMove).toHaveBeenCalledWith('b', -1)
    expect(onDelete).toHaveBeenCalledWith('b')
  })
})

async function expectSharedTooltip(button: HTMLElement, expectedText: string) {
  const trigger = button.closest<HTMLElement>('.appTooltipTrigger') ?? button
  expect(button.hasAttribute('title')).toBe(false)
  fireEvent.pointerEnter(trigger)
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip.textContent).toContain(expectedText)
  expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id)
  fireEvent.pointerLeave(trigger)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
}
