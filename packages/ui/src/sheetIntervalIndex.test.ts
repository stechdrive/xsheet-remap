import { describe, expect, it } from 'vitest'
import { createSheetIntervalIndex } from './sheetIntervalIndex'
import { createSheetRenderGroups } from './sheetRenderGroups'

describe('visible interval lookup', () => {
  it('keeps crossing intervals, boundaries and painter order while bounding a narrow query', () => {
    const items = [{ start: -100, end: 100_001 }, ...Array.from({ length: 100_000 }, (_, index) => ({ start: index, end: index + .5 }))]
    const index = createSheetIntervalIndex(items, item => item)
    for (const [start, end] of [[-20, -10], [50_000, 50_005], [99_999.5, 100_000], [1, 0]]) {
      expect(index.query(start!, end!)).toEqual(start! > end! ? [] : items.filter(item => item.start <= end! && item.end >= start!))
      expect(index.visited).toBeLessThan(70)
    }
  })

  it('retains unrelated column blocks across an edit and drops invisible groups', () => {
    const group = createSheetRenderGroups<{ track: string; frame: number }>()
    const key = (item: { track: string; frame: number }) => `${item.track}:${Math.floor(item.frame / 128)}`
    const items = [{ track: 'A', frame: 1 }, { track: 'A', frame: 144 }, { track: 'B', frame: 1 }]
    const before = group(items, key)
    const after = group([items[0]!, { track: 'A', frame: 2 }, ...items.slice(1)], key)
    expect(after.get('A:0')).not.toBe(before.get('A:0'))
    expect(after.get('A:1')).toBe(before.get('A:1'))
    expect(after.get('B:0')).toBe(before.get('B:0'))
    expect([...group([items[2]!], key).keys()]).toEqual(['B:0'])
  })
})
