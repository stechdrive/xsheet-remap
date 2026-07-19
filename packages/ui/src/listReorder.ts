export type ListReorderEdge = 'before' | 'after'

export interface ListReorderTarget {
  referenceItemId: string
  edge: ListReorderEdge
}

export interface ListReorderRowGeometry {
  itemId: string
  top: number
  bottom: number
}

export function listReorderTargetFromRows(rows: ListReorderRowGeometry[], clientY: number): ListReorderTarget | null {
  const ordered = rows
    .filter(row => row.itemId && Number.isFinite(row.top) && Number.isFinite(row.bottom) && row.bottom >= row.top)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom || a.itemId.localeCompare(b.itemId, 'ja'))
  if (ordered.length === 0) return null
  for (const row of ordered) {
    if (clientY < row.top + (row.bottom - row.top) / 2) return { referenceItemId: row.itemId, edge: 'before' }
  }
  return { referenceItemId: ordered.at(-1)!.itemId, edge: 'after' }
}

export function listReorderTargetFromContainer(container: HTMLElement | null, scope: string, clientX: number, clientY: number): ListReorderTarget | null {
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  if (clientX < containerRect.left || clientX > containerRect.right || clientY < containerRect.top || clientY > containerRect.bottom) return null
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-csp-pane-reorder-id][data-csp-pane-reorder-scope]'))
    .filter(row => row.dataset.cspPaneReorderScope === scope)
    .map(row => {
      const rect = row.getBoundingClientRect()
      return {
        itemId: row.dataset.cspPaneReorderId ?? '',
        top: rect.top,
        bottom: rect.bottom,
      }
    })
  return listReorderTargetFromRows(rows, clientY)
}

export function autoScrollListForPointer(element: HTMLElement | null, clientY: number): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  const edge = Math.min(36, Math.max(18, rect.height * 0.12))
  const before = element.scrollTop
  if (clientY < rect.top + edge) {
    element.scrollTop -= Math.ceil((rect.top + edge - clientY) / 4)
  } else if (clientY > rect.bottom - edge) {
    element.scrollTop += Math.ceil((clientY - (rect.bottom - edge)) / 4)
  }
  return element.scrollTop !== before
}
