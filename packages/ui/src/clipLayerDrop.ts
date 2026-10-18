import type { ClipDocumentState } from '@xsheet-remap/core'

export interface ClipLayerDropTarget {
  id: string | null
  placement: 'before' | 'after' | 'inside'
  parentId: string | null
  beforeId?: string
}

/** One destination calculation for the preview, pointer move, browser files and native files. */
export function clipLayerDropTarget(document: ClipDocumentState, id: string | null, fraction: number, movingId?: string): ClipLayerDropTarget | null {
  if (id === null) return { id, placement: 'inside', parentId: null }
  const node = document.nodes.find(item => item.id === id)
  if (!node) return null
  const folder = node.kind === 'folder' || node.kind === 'animation'
  const placement = fraction < (folder ? .25 : .5) ? 'before' : folder && fraction < .75 ? 'inside' : 'after'
  const siblings = document.nodes.filter(item => item.parentId === node.parentId && item.id !== movingId)
  return {
    id, placement,
    parentId: placement === 'inside' ? node.id : node.parentId,
    beforeId: placement === 'before' ? node.id : placement === 'after' ? siblings[siblings.findIndex(item => item.id === id) + 1]?.id : undefined,
  }
}

export function clipLayerDropAtElement(document: ClipDocumentState, element: Element | null, clientY: number, movingId?: string): ClipLayerDropTarget | null {
  if (!element?.closest('.clipLayerPanel')) return null
  const row = element.closest<HTMLElement>('[data-clip-layer-id]')
  if (!row) return clipLayerDropTarget(document, null, 0, movingId)
  const rect = row.getBoundingClientRect()
  return clipLayerDropTarget(document, row.dataset.clipLayerId!, rect.height > 0 ? (clientY - rect.top) / rect.height : .5, movingId)
}

export function clipLayerFileDropAllowed(document: ClipDocumentState, target: ClipLayerDropTarget): boolean {
  const parent = document.nodes.find(node => node.id === target.parentId)
  return target.parentId === null || Boolean(parent && !parent.locked && (parent.kind === 'folder' || parent.kind === 'animation'))
}

const NATIVE_LAYER_HOVER = 'xsheet-remap:native-layer-hover'
export function publishNativeLayerHover(target: ClipLayerDropTarget | null): void {
  window.dispatchEvent(new CustomEvent(NATIVE_LAYER_HOVER, { detail: target }))
}
export function subscribeNativeLayerHover(listener: (target: ClipLayerDropTarget | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ClipLayerDropTarget | null>).detail)
  window.addEventListener(NATIVE_LAYER_HOVER, handler)
  return () => window.removeEventListener(NATIVE_LAYER_HOVER, handler)
}
