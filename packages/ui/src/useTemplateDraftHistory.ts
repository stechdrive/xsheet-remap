import { isCompositionKey } from './compositionKeyboard'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent } from 'react'
import type { SheetTemplate } from '@xsheet-remap/core'
import { createTemplateDraftHistory, type TemplateDraftHistorySnapshot } from './templateDraftHistory'

export interface TemplateHistoryControls {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export function useTemplateDraftHistory(initial: () => SheetTemplate, dirty: boolean,
  restored: TemplateDraftHistorySnapshot | undefined, onTravel: () => void,
  onControlsChange?: (controls: TemplateHistoryControls | null) => void) {
  const [store] = useState(() => createTemplateDraftHistory(initial(), dirty, restored))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const inputGroup = useRef<object | undefined>(undefined)
  const travelRef = useRef(onTravel)
  useLayoutEffect(() => { travelRef.current = onTravel }, [onTravel])
  const actions = useMemo(() => ({
    undo: () => { inputGroup.current = undefined; if (store.undo()) travelRef.current() },
    redo: () => { inputGroup.current = undefined; if (store.redo()) travelRef.current() },
  }), [store])
  const controls = useMemo(() => ({ ...actions, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }),
    [actions, state.past.length, state.future.length])
  useEffect(() => { onControlsChange?.(controls) }, [controls, onControlsChange])
  useEffect(() => () => { onControlsChange?.(null) }, [onControlsChange])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCompositionKey(event) || event.altKey || !(event.ctrlKey || event.metaKey)) return
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"]')) return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')
        && !event.target.closest('.templatePanel') && !inputGroup.current) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (key === 'y' || event.shiftKey) actions.redo()
      else actions.undo()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [actions])
  return {
    ...state, controls, store,
    setTemplate: (update: SheetTemplate | ((current: SheetTemplate) => SheetTemplate), group = inputGroup.current) => store.setTemplate(update, group),
    onFocusCapture: (event: FocusEvent) => {
      store.endGroup()
      const target = event.target
      inputGroup.current = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement
        && !['checkbox', 'radio', 'button', 'file'].includes(target.type)) ? {} : undefined
    },
    onBlurCapture: () => { inputGroup.current = undefined; store.endGroup() },
  }
}
