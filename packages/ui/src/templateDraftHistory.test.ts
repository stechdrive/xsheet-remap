import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { createTemplateDraftHistory } from './templateDraftHistory'

describe('template authoring history', () => {
  it('coalesces a field edit, tracks the saved point, and discards the redo branch after a new edit', () => {
    const history = createTemplateDraftHistory(standardA3SheetTemplate)
    const field = {}
    history.setTemplate(t => ({ ...t, name: 'a' }), field)
    history.setTemplate(t => ({ ...t, name: 'ab' }), field)
    expect(history.getSnapshot().past).toHaveLength(1)
    history.markSaved()
    expect(history.getSnapshot().dirty).toBe(false)
    history.undo()
    expect(history.getSnapshot().template).toBe(standardA3SheetTemplate)
    expect(history.getSnapshot().dirty).toBe(true)
    history.redo()
    expect(history.getSnapshot().template.name).toBe('ab')
    expect(history.getSnapshot().dirty).toBe(false)
    history.undo()
    history.setTemplate(t => ({ ...t, name: 'new' }))
    expect(history.redo()).toBe(false)
  })

  it('skips equivalent edits, retains shared image/region values and restores clean status on undo', () => {
    const history = createTemplateDraftHistory(standardA3SheetTemplate)
    expect(history.setTemplate(t => ({ ...t, name: t.name }))).toBe(false)
    history.setTemplate(t => ({ ...t, name: 'changed' }))
    expect(history.getSnapshot().template.regions).toBe(standardA3SheetTemplate.regions)
    expect(history.getSnapshot().template.defaultUnderlay).toBe(standardA3SheetTemplate.defaultUnderlay)
    history.undo()
    expect(history.getSnapshot().dirty).toBe(false)
    expect(history.getSnapshot().past).toHaveLength(0)
  })

  it('bounds history and keeps separate gestures separate', () => {
    const history = createTemplateDraftHistory(standardA3SheetTemplate, false, undefined, 3)
    for (let i = 0; i < 8; i++) history.setTemplate(t => ({ ...t, name: String(i) }))
    expect(history.getSnapshot().past).toHaveLength(3)
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(true)
    expect(history.undo()).toBe(false)
    expect(history.getSnapshot().template.name).toBe('4')
  })

  it('retains history when reopening a panel but rejects a clean history for a different document', () => {
    const history = createTemplateDraftHistory(standardA3SheetTemplate)
    history.setTemplate(t => ({ ...t, name: 'draft' }))
    const reopened = createTemplateDraftHistory(standardA3SheetTemplate, false, history.getSnapshot())
    expect(reopened.getSnapshot().template.name).toBe('draft')
    reopened.undo()
    expect(reopened.getSnapshot().dirty).toBe(false)
    const changedProject = { ...standardA3SheetTemplate, name: 'external' }
    const fresh = createTemplateDraftHistory(changedProject, false, reopened.getSnapshot())
    expect(fresh.getSnapshot().template).toBe(changedProject)
    expect(fresh.getSnapshot().future).toHaveLength(0)
  })

  it('resets history for a newly loaded document and preserves initial unsaved state', () => {
    const history = createTemplateDraftHistory(standardA3SheetTemplate, true)
    history.setTemplate(t => ({ ...t, name: 'unsaved' }))
    history.undo()
    expect(history.getSnapshot().dirty).toBe(true)
    history.reset(standardA3SheetTemplate)
    expect(history.getSnapshot().dirty).toBe(false)
    expect(history.getSnapshot().future).toHaveLength(0)
  })
})
