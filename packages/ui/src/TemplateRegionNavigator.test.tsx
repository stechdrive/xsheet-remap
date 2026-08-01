import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateRegionNavigator } from './TemplateRegionNavigator'

afterEach(() => cleanup())

describe('TemplateRegionNavigator', () => {
  it('exposes selection and authoring actions with clear labels', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'ACTIONの位置をロック解除' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモ' }))
    rerender(<TemplateRegionNavigator {...props} selectedRegionId="b" />)
    fireEvent.click(screen.getByRole('button', { name: 'メモを表示' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモを複製' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモを背面へ' }))
    fireEvent.click(screen.getByRole('button', { name: 'メモを削除' }))

    expect(onSelect).toHaveBeenCalledWith('b')
    expect(onToggleHidden).toHaveBeenCalledWith('b')
    expect(onTogglePositionLocked).toHaveBeenCalledWith('a')
    expect(onDuplicate).toHaveBeenCalledWith('b')
    expect(onMove).toHaveBeenCalledWith('b', -1)
    expect(onDelete).toHaveBeenCalledWith('b')
  })
})
