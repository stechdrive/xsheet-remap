/** Static interval tree for immutable render inputs. Queries retain painter order. */
export function createSheetIntervalIndex<T>(items: readonly T[], bounds: (item: T) => { start: number; end: number }) {
  type Entry = { item: T; order: number; start: number; end: number; maxEnd: number; left?: Entry; right?: Entry }
  const entries = items.map((item, order) => ({ item, order, ...bounds(item), maxEnd: -Infinity }) as Entry)
    .sort((a, b) => a.start - b.start || a.order - b.order)
  function build(first: number, after: number): Entry | undefined {
    if (first >= after) return undefined
    const middle = (first + after) >>> 1, node = entries[middle]!
    node.left = build(first, middle); node.right = build(middle + 1, after)
    node.maxEnd = Math.max(node.end, node.left?.maxEnd ?? -Infinity, node.right?.maxEnd ?? -Infinity)
    return node
  }
  const root = build(0, entries.length)
  return {
    visited: 0,
    query(start: number, end: number): T[] {
      this.visited = 0
      const found: Entry[] = []
      const visit = (node: Entry | undefined) => {
        if (!node || node.maxEnd < start) return
        this.visited++
        visit(node.left)
        if (node.start > end) return
        if (node.end >= start) found.push(node)
        visit(node.right)
      }
      if (start <= end) visit(root)
      return found.sort((a, b) => a.order - b.order).map(entry => entry.item)
    },
  }
}

export function createSheetIntervalCache<T>(bounds: (item: T) => { start: number; end: number }) {
  const indexes = new WeakMap<readonly T[], ReturnType<typeof createSheetIntervalIndex<T>>>()
  return (items: readonly T[]) => {
    let index = indexes.get(items)
    if (!index) { index = createSheetIntervalIndex(items, bounds); indexes.set(items, index) }
    return index
  }
}
