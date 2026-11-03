import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SheetContextMenu } from './SheetContextMenu'
import { SheetContextSubmenu } from './SheetContextSubmenu'

it('navigates a submenu without invoking sheet shortcuts and returns focus to its trigger', () => {
  const command = vi.fn(), windowKey = vi.fn()
  window.addEventListener('keydown', windowKey)
  render(<SheetContextMenu x={30} y={40} label="シート">
    <button role="menuitem">コピー</button>
    <SheetContextSubmenu label="囲み">
      <button role="menuitem" disabled>変更済み</button>
      <button role="menuitem" onClick={command}>記入に○</button>
      <button role="menuitem">解除</button>
    </SheetContextSubmenu>
  </SheetContextMenu>)
  try {
    const trigger = screen.getByRole('menuitem', { name: '囲み' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '記入に○' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '解除' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '囲み' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(windowKey).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '記入に○' }))
    expect(command).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('keydown', windowKey) }
})
