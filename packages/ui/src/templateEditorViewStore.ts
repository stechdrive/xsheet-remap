import { TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'

export const DEFAULT_TEMPLATE_REFERENCE_OPACITY = 0.8

export type TemplateEditorViewSnapshot = Readonly<{
  zoom: number
  referenceOpacity: number
}>

export interface TemplateEditorViewStore {
  getSnapshot: () => TemplateEditorViewSnapshot
  subscribe: (listener: () => void) => () => void
  setZoom: (zoom: number) => void
  setReferenceOpacity: (opacity: number) => void
}

export function createTemplateEditorViewStore(
  initial: Partial<TemplateEditorViewSnapshot> = {},
): TemplateEditorViewStore {
  let snapshot: TemplateEditorViewSnapshot = {
    zoom: clampZoom(initial.zoom ?? 1),
    referenceOpacity: clampUnit(initial.referenceOpacity ?? DEFAULT_TEMPLATE_REFERENCE_OPACITY),
  }
  const listeners = new Set<() => void>()

  function update(next: TemplateEditorViewSnapshot) {
    if (next.zoom === snapshot.zoom && next.referenceOpacity === snapshot.referenceOpacity) return
    snapshot = next
    listeners.forEach(listener => listener())
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setZoom(zoom) {
      update({ ...snapshot, zoom: clampZoom(zoom) })
    },
    setReferenceOpacity(referenceOpacity) {
      update({ ...snapshot, referenceOpacity: clampUnit(referenceOpacity) })
    },
  }
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(TEMPLATE_ZOOM_MAX, Math.max(TEMPLATE_ZOOM_MIN, value))
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEMPLATE_REFERENCE_OPACITY
  return Math.min(1, Math.max(0, value))
}
