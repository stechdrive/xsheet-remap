import { useContext, useMemo } from 'react'
import { createSheetIntervalIndex } from './sheetIntervalIndex'
import { SheetRenderWindowContext } from './useSheetRenderWindow'

/** Cull already-laid-out content without changing text flow or collision layout. */
export function useVisibleSheetItems<T>(items: T[], bounds: (item: T) => { start: number; end: number }, keyFor: (item: T) => string, pinnedId?: string | null): T[] {
  const window = useContext(SheetRenderWindowContext)
  const cache = useMemo(() => {
    const pinned = new Map<string, T[]>(), order = new Map<T, number>()
    items.forEach((item, index) => {
      order.set(item, index)
      const key = keyFor(item), group = pinned.get(key) ?? []
      group.push(item); pinned.set(key, group)
    })
    return { index: createSheetIntervalIndex(items, bounds), pinned, order }
  }, [items, bounds, keyFor])
  return useMemo(() => {
    if (!window) return items
    const visible = cache.index.query(window.top, window.bottom)
    if (!pinnedId) return visible
    return [...new Set([...visible, ...cache.pinned.get(pinnedId) ?? []])].sort((a, b) => cache.order.get(a)! - cache.order.get(b)!)
  }, [items, window, cache, pinnedId])
}
