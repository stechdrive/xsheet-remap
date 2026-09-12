import type { SheetTemplate } from '@xsheet-remap/core'

export interface TemplateDraftHistorySnapshot {
  readonly past: readonly SheetTemplate[]
  readonly template: SheetTemplate
  readonly future: readonly SheetTemplate[]
  readonly saved: SheetTemplate | null
  readonly dirty: boolean
}

/** Immutable authoring values share their unchanged regions and image data across history. */
export function createTemplateDraftHistory(template: SheetTemplate, dirty = false,
  restored?: TemplateDraftHistorySnapshot, limit = 100) {
  let state: TemplateDraftHistorySnapshot = restored && (restored.dirty || sameTemplateValue(restored.saved, template))
    ? restored : { past: [], template, future: [], saved: dirty ? null : template, dirty }
  let previousGroup: unknown
  const listeners = new Set<() => void>()
  const publish = (next: Omit<TemplateDraftHistorySnapshot, 'dirty'>) => {
    state = { ...next, dirty: !sameTemplateValue(next.template, next.saved) }
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    matchesSaved: (template: SheetTemplate) => sameTemplateValue(template, state.saved),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    endGroup() { previousGroup = undefined },
    setTemplate(update: SheetTemplate | ((current: SheetTemplate) => SheetTemplate), group?: unknown) {
      const next = typeof update === 'function' ? update(state.template) : update
      if (sameTemplateValue(next, state.template)) return false
      const coalescing = group !== undefined && group === previousGroup && state.future.length === 0
      previousGroup = group
      publish({ ...state, template: next, future: [],
        past: coalescing ? state.past : [...state.past, state.template].slice(-limit) })
      return true
    },
    undo() {
      previousGroup = undefined
      const template = state.past.at(-1)
      if (!template) return false
      publish({ ...state, template, past: state.past.slice(0, -1), future: [state.template, ...state.future] })
      return true
    },
    redo() {
      previousGroup = undefined
      const template = state.future[0]
      if (!template) return false
      publish({ ...state, template, past: [...state.past, state.template].slice(-limit), future: state.future.slice(1) })
      return true
    },
    reset(template: SheetTemplate, dirty = false) {
      previousGroup = undefined
      publish({ template, past: [], future: [], saved: dirty ? null : template })
    },
    markSaved(template = state.template) {
      previousGroup = undefined
      publish({ ...state, template, saved: template })
    },
  }
}

// Reference equality skips untouched branches. Unlike serialization this never copies image payloads.
function sameTemplateValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameTemplateValue(left[key], right[key]))
}
