import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SheetRenderWindowContext, type SheetRenderWindow } from './useSheetRenderWindow'
import { useVisibleSheetItems } from './useVisibleSheetItems'

const items = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), start: index / 10_000, end: (index + .5) / 10_000 }))
const bounds = (item: typeof items[number]) => item
const key = (item: typeof items[number]) => item.id
function Contents({ pinned }: { pinned: string }) {
  const visible = useVisibleSheetItems(items, bounds, key, pinned)
  return <>{visible.map(item => <input key={item.id} aria-label={item.id} defaultValue={item.id} />)}</>
}
function View({ window, pinned }: { window: SheetRenderWindow; pinned: string }) {
  return <SheetRenderWindowContext.Provider value={window}><Contents pinned={pinned} /></SheetRenderWindowContext.Provider>
}

describe('visible content ownership', () => {
  it('bounds mounted targets, keeps the editing input through scrolling, and materializes all for print', () => {
    const { rerender } = render(<View window={{ top: .5, bottom: .501 }} pinned="10" />)
    expect(screen.getAllByRole('textbox').length).toBeLessThan(15)
    const editing = screen.getByLabelText('10')
    ;(editing as HTMLInputElement).value = 'pending composition'
    rerender(<View window={{ top: .8, bottom: .801 }} pinned="10" />)
    expect(screen.getByLabelText('10')).toBe(editing)
    expect((editing as HTMLInputElement).value).toBe('pending composition')
    expect(screen.queryByLabelText('5000')).toBeNull()
    rerender(<View window={null} pinned="10" />)
    expect(screen.getAllByRole('textbox')).toHaveLength(10_000)
    expect(screen.getByLabelText('10')).toBe(editing)
    rerender(<View window={{ top: .8, bottom: .801 }} pinned="10" />)
    expect(screen.getAllByRole('textbox').length).toBeLessThan(15)
  })
})
