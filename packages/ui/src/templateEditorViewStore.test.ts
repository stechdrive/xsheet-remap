import { describe, expect, it, vi } from 'vitest'
import { TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'
import { createTemplateEditorViewStore, DEFAULT_TEMPLATE_REFERENCE_OPACITY } from './templateEditorViewStore'

describe('template editor view store', () => {
  it('keeps zoom and reference appearance outside the template model and clamps display values', () => {
    const store = createTemplateEditorViewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    expect(store.getSnapshot()).toEqual({ zoom: 1, referenceOpacity: DEFAULT_TEMPLATE_REFERENCE_OPACITY })
    store.setZoom(TEMPLATE_ZOOM_MAX * 2)
    expect(store.getSnapshot().zoom).toBe(TEMPLATE_ZOOM_MAX)
    store.setZoom(TEMPLATE_ZOOM_MIN / 2)
    expect(store.getSnapshot().zoom).toBe(TEMPLATE_ZOOM_MIN)
    store.setReferenceOpacity(2)
    expect(store.getSnapshot().referenceOpacity).toBe(1)
    store.setReferenceOpacity(-1)
    expect(store.getSnapshot().referenceOpacity).toBe(0)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('does not notify subscribers when a display value is unchanged', () => {
    const store = createTemplateEditorViewStore({ zoom: 4, referenceOpacity: 0.35 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setZoom(4)
    store.setReferenceOpacity(0.35)

    expect(listener).not.toHaveBeenCalled()
  })
})
