import { describe, expect, it } from 'vitest'
import { autoScrollListForPointer, listReorderTargetFromContainer, listReorderTargetFromRows } from './listReorder'

describe('listReorder', () => {
  it('resolves before and after edges from row midpoints independent of DOM input order', () => {
    const rows = [
      { itemId: 'bottom', top: 80, bottom: 110 },
      { itemId: 'top', top: 10, bottom: 40 },
    ]
    expect(listReorderTargetFromRows(rows, 12)).toEqual({ referenceItemId: 'top', edge: 'before' })
    expect(listReorderTargetFromRows(rows, 36)).toEqual({ referenceItemId: 'bottom', edge: 'before' })
    expect(listReorderTargetFromRows(rows, 108)).toEqual({ referenceItemId: 'bottom', edge: 'after' })
  })

  it('only considers rows in the requested sibling scope', () => {
    const container = document.createElement('div')
    const first = document.createElement('div')
    const unrelated = document.createElement('div')
    first.dataset.cspPaneReorderId = 'first'
    first.dataset.cspPaneReorderScope = 'scope-a'
    unrelated.dataset.cspPaneReorderId = 'other'
    unrelated.dataset.cspPaneReorderScope = 'scope-b'
    container.append(first, unrelated)
    setRect(container, 0, 0, 200, 200)
    setRect(first, 0, 20, 200, 30)
    setRect(unrelated, 0, 80, 200, 30)
    expect(listReorderTargetFromContainer(container, 'scope-a', 100, 120)).toEqual({ referenceItemId: 'first', edge: 'after' })
    expect(listReorderTargetFromContainer(container, 'scope-a', 250, 120)).toBeNull()
  })

  it('auto-scrolls only when the pointer enters an edge zone', () => {
    const container = document.createElement('div')
    setRect(container, 0, 100, 200, 200)
    container.scrollTop = 100
    expect(autoScrollListForPointer(container, 200)).toBe(false)
    expect(container.scrollTop).toBe(100)
    expect(autoScrollListForPointer(container, 295)).toBe(true)
    expect(container.scrollTop).toBeGreaterThan(100)
  })
})

function setRect(element: HTMLElement, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  })
}
