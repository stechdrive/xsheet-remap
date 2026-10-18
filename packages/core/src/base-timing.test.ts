import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, baseTimingProcessId, baseTimingProject, buildClipRegistrationPlan, createDefaultProject, createOrSetEvent, openClipDocument, parseProjectDocument, selectTimingProcess, setBaseTimingProcess, timingForProcess, updateActiveCutProjectInDocument, updateCorrectionLayers } from './index'
import { independentClipFixture } from './clip-workflows.fixture'

describe('base sheet process', () => {
  it('normalizes the selected base with the same whitespace rules as imported process names', () => {
    const { data, columns } = independentClipFixture()
    const chosen = openClipDocument(data, 'data:,', { timelineIds: ['t1'], role: 'cell',
      columns: columns.map(column => ({ ...column, process: ` ${column.process} ` })), baseProcess: ' あ／テスト ' })
    const project = activeCutProjectFromDocument(chosen)
    expect(project.correctionLayers.find(process => process.layerId === baseTimingProcessId(project))?.label).toBe('あ／テスト')
    expect(project.clipDocument!.nodes).toEqual(data.layers)
  })
  it('persists an explicit imported base through cuts, renaming and round trips without changing native timing', () => {
    const { data, columns, document } = independentClipFixture()
    const chosen = openClipDocument(data, 'data:,', { timelineIds: ['t1', 't2'], role: 'cell', columns, baseProcess: 'あ／テスト' })
    const expected = buildClipRegistrationPlan(document, 'cell').timelines
    for (const cut of chosen.cuts) {
      const project = activeCutProjectFromDocument({ ...chosen, activeCutId: cut.cutId })
      const base = baseTimingProcessId(project)
      expect(project.correctionLayers.find(process => process.layerId === base)?.label).toBe('あ／テスト')
      expect(project.logicalSheet.events[0]?.frame).toBe(cut.order + 1)
      const other = project.correctionLayers.find(process => process.layerId !== base)!.layerId
      const editedView = selectTimingProcess(project, other)
      expect(baseTimingProcessId(editedView)).toBe(base)
      const renamed = updateCorrectionLayers(editedView, editedView.correctionLayers.map(process => process.layerId === base ? { ...process, label: '納品用' } : process))
      const saved = updateActiveCutProjectInDocument({ ...chosen, activeCutId: cut.cutId }, renamed)
      const restored = parseProjectDocument(JSON.parse(JSON.stringify(saved)))
      expect(baseTimingProcessId(activeCutProjectFromDocument(restored))).toBe(base)
      expect(buildClipRegistrationPlan(restored, 'cell').timelines).toEqual(expected)
    }
  })
  it('changes only the base designation in a common sheet and blocks deletion of that process', () => {
    const original = createOrSetEvent(createDefaultProject(), 'A', 1).project
    const other = original.correctionLayers[1].layerId
    const next = setBaseTimingProcess(original, other)
    expect(next.logicalSheet.processTimings).toBeUndefined()
    expect(next.logicalSheet.events).toBe(original.logicalSheet.events)
    expect(baseTimingProject(next)).toBe(next)
    expect(() => updateCorrectionLayers(next, next.correctionLayers.filter(process => process.layerId !== other))).toThrow('基準')
    expect(() => setBaseTimingProcess(next, 'missing')).toThrow('見つかりません')
  })
  it('rejects a base still used by another cut and preserves sparse keys when changing the active base', () => {
    const { document } = independentClipFixture(), project = activeCutProjectFromDocument(document)
    const base = baseTimingProcessId(project), other = project.correctionLayers.find(process => process.layerId !== base)!.layerId
    const next = baseTimingProject(setBaseTimingProcess(project, other))
    expect(timingForProcess(next.logicalSheet, base).events).toEqual(timingForProcess(project.logicalSheet, base).events)
    expect(timingForProcess(next.logicalSheet, other).events).toEqual(timingForProcess(project.logicalSheet, other).events)
    const empty = { ...next, correctionLayers: next.correctionLayers.filter(process => process.layerId !== base), logicalSheet: { ...next.logicalSheet, processTimings: undefined, events: [] } }
    expect(() => updateActiveCutProjectInDocument(document, empty)).toThrow('基準')
  })
})
