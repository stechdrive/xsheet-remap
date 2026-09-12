/** Keep only current visible groups, sharing arrays when their immutable items match. */
export function createSheetRenderGroups<T>() {
  let previous = new Map<string, T[]>()
  return (items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> => {
    const next = new Map<string, T[]>()
    for (const item of items) {
      const key = keyFor(item), group = next.get(key)
      if (group) group.push(item)
      else next.set(key, [item])
    }
    for (const [key, group] of next) {
      const old = previous.get(key)
      if (old?.length === group.length && old.every((item, index) => item === group[index])) next.set(key, old)
    }
    previous = next
    return next
  }
}
