import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSizeNumberInput } from './TextSizeNumberInput'
import { SheetTextSizeControl, type SheetTextSizeControlModel } from './SheetTextSizeControl'

afterEach(cleanup)
describe('text size gesture ownership', () => {
  it('commits typing once on Enter, and discards Escape and empty input', () => {
    const commit = vi.fn()
    render(<TextSizeNumberInput value={18} label="size" onChange={commit} />)
    const input = screen.getByRole('spinbutton')
    input.focus()
    fireEvent.change(input, { target: { value: '32' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(commit).toHaveBeenCalledExactlyOnceWith(32)
    input.focus()
    fireEvent.change(input, { target: { value: '48' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    input.focus()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('previews a scrub and commits only its final pointer, cancelling on Escape or window blur', () => {
    const commit = vi.fn()
    render(<TextSizeNumberInput value={18} label="size" onChange={commit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    const down = () => fireEvent.pointerDown(input, { pointerId: 2, button: 0, buttons: 1, clientX: 100 })
    down()
    fireEvent.pointerMove(window, { pointerId: 2, buttons: 1, clientX: 124 })
    expect(input.value).toBe('24')
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 9, buttons: 0, clientX: 148 })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 2, buttons: 0, clientX: 148 })
    expect(commit).toHaveBeenCalledExactlyOnceWith(30)
    for (const cancel of [() => fireEvent.keyDown(window, { key: 'Escape' }), () => fireEvent.blur(window)]) {
      down()
      fireEvent.pointerMove(window, { pointerId: 2, buttons: 1, clientX: 180 })
      cancel()
      fireEvent.pointerUp(window, { pointerId: 2, buttons: 0, clientX: 180 })
    }
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('discards drafts on selection or revision changes, and exposes mixed sizes', () => {
    const onApply = vi.fn()
    const model: SheetTextSizeControlModel = { targetKey: 'cut-1:event-1', label: 'CELL 2件', value: null, mode: '混在', primaryLabel: '', secondaryLabel: '', disabled: false, count: 2, onApply }
    const { rerender } = render(<SheetTextSizeControl model={model} />)
    const input = screen.getByRole('spinbutton')
    expect(input.getAttribute('placeholder')).toBe('混在')
    fireEvent.change(input, { target: { value: '64' } })
    rerender(<SheetTextSizeControl model={{ ...model, targetKey: 'cut-2:event-1', value: 18 }} />)
    fireEvent.blur(screen.getByRole('spinbutton'))
    expect(onApply).not.toHaveBeenCalled()
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('18')
  })
})
