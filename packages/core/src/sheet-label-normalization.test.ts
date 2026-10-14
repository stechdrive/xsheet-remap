import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, buildClipRegistrationPlan, commitHistory, createDefaultProject, createKey, createProjectDocumentFromCutProject, createProjectHistory, redoHistory, registerAsset, registerAssetsToCspTrack, setEvent, setTimingSpecialEvent, undoHistory, updateActiveCutProjectInDocument, upsertBinding, type CutProject, type SheetTimingRole } from './index'
import { applySheetLabelNormalizationPlan, buildSheetLabelNormalizationPlan } from './sheet-label-normalization'

function cell(project: CutProject, label: string, frame: number, track = 'A', role: SheetTimingRole = 'action') {
  const created = createKey(project, track, label, 'import', label, role)
  const key = { ...created.key, displayLabel: label }
  const literal = { ...created.project, logicalSheet: { ...created.project.logicalSheet, keys: created.project.logicalSheet.keys.map(item => item.keyId === key.keyId ? key : item) } }
  return { key, project: setEvent(literal, track, frame, key.keyId, role) }
}
const strip = { sheetRole: 'action' as const, method: 'strip-leading-zeros' as const }

describe('sheet label normalization', () => {
  it('changes repeated sheet labels atomically, preserving CSP/material/timing and CLIP export through save and undo', () => {
    const created = cell(createDefaultProject(), '0001', 1)
    const registered = registerAsset(created.project, { name: 'A0001.png', size: 7, lastModified: 1 }, { role: 'cell-material' })
    let project = upsertBinding(registered.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A0001', materialState: 'assigned', assetId: registered.asset.assetId })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: created.key.keyId, cspCellName: 'A0001_e', materialState: 'missing-ok' })
    project = setEvent(project, 'A', 9, created.key.keyId, 'action')
    project = setTimingSpecialEvent(project, 'A', 6, 'blank', 'action')
    const beforeExport = buildClipRegistrationPlan(createProjectDocumentFromCutProject(project), 'action')
    const plan = buildSheetLabelNormalizationPlan(project, strip)
    expect(plan.items[0]).toMatchObject({ currentLabel: '0001', nextLabel: '1', occurrences: 2 })
    const next = applySheetLabelNormalizationPlan(project, plan)
    expect(next.logicalSheet.keys[0]).toMatchObject({ keyId: created.key.keyId, displayLabel: '1', paperToken: '1' })
    expect(next.bindings).toBe(project.bindings)
    expect(next.assets).toBe(project.assets)
    expect(next.logicalSheet.events).toBe(project.logicalSheet.events)
    const saved = JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(next)))
    expect(buildClipRegistrationPlan(saved, 'action')).toEqual(beforeExport)
    expect(activeCutProjectFromDocument(saved).logicalSheet.keys[0].displayLabel).toBe('1')
    const history = commitHistory(createProjectHistory(project), next)
    expect(undoHistory(history).present).toEqual(project)
    expect(redoHistory(undoHistory(history)).present).toEqual(next)
  })

  it('does not name blank image cards or affect the other column/role', () => {
    const a = cell(createDefaultProject(), '0001', 1)
    const b = cell(a.project, '0002', 1, 'B')
    const otherRole = cell(b.project, '0003', 1, 'A', 'cell')
    const asset = registerAsset(otherRole.project, { name: 'scan.png', size: 1 }, { role: 'cell-material' })
    const cards = registerAssetsToCspTrack(asset.project, { slotId: 'slot_A', assetIds: [asset.asset.assetId] })
    const next = applySheetLabelNormalizationPlan(cards.project, buildSheetLabelNormalizationPlan(cards.project, { ...strip, paperTracks: ['A'] }))
    expect(next.logicalSheet.keys.map(key => key.displayLabel)).toEqual(['1', '0002', '0003', ''])
    expect(next.logicalSheet.keys.at(-1)?.sheetRole).toBeUndefined()
    expect(next.bindings).toBe(cards.project.bindings)
  })

  it('checks collisions with untouched cells, including whitespace-equivalent names', () => {
    const first = cell(createDefaultProject(), '0001', 1)
    const second = cell(first.project, ' 1 ', 4)
    const plan = buildSheetLabelNormalizationPlan(second.project, { ...strip, keyIds: [first.key.keyId] })
    expect(plan.conflicts).toEqual([{ paperTrack: 'A', label: '1', keyIds: [first.key.keyId, second.key.keyId] }])
    expect(() => applySheetLabelNormalizationPlan(second.project, plan)).toThrow('重複')
    expect(second.project.logicalSheet.keys).toHaveLength(2)
  })

  it('renumbers by first appearance and handles simultaneous swaps without merging keys', () => {
    const first = cell(createDefaultProject(), '2', 1)
    const second = cell(first.project, '1', 10)
    const project = setEvent(second.project, 'A', 20, first.key.keyId, 'action')
    const plan = buildSheetLabelNormalizationPlan(project, { ...strip, method: 'sequence' })
    expect(plan.conflicts).toEqual([])
    expect(plan.items.map(item => [item.currentLabel, item.nextLabel])).toEqual([['2', '1'], ['1', '2']])
    const next = applySheetLabelNormalizationPlan(project, plan)
    expect(next.logicalSheet.keys.map(key => [key.keyId, key.displayLabel])).toEqual([[first.key.keyId, '1'], [second.key.keyId, '2']])
    expect(next.logicalSheet.events).toBe(project.logicalSheet.events)
  })

  it('preserves literal nonnumeric labels and exact large integers, including zero', () => {
    let project = createDefaultProject()
    for (const [index, name] of ['A_0001', '0000', '000123456789012345678901234567890', ' 0002 ', '１２３４'].entries()) project = cell(project, name, index + 1).project
    const plan = buildSheetLabelNormalizationPlan(project, strip)
    expect(plan.items.map(item => item.nextLabel)).toEqual(['A_0001', '0', '123456789012345678901234567890', ' 0002 ', '１２３４'])
    const next = applySheetLabelNormalizationPlan(project, plan)
    expect(applySheetLabelNormalizationPlan(next, buildSheetLabelNormalizationPlan(next, strip))).toBe(next)
    expect(buildSheetLabelNormalizationPlan(project, { ...strip, keyIds: [] }).items).toEqual([])
  })

  it('rejects stale previews and rechecks new collisions at application time', () => {
    const initial = cell(createDefaultProject(), '0001', 1)
    const plan = buildSheetLabelNormalizationPlan(initial.project, { ...strip, keyIds: [initial.key.keyId] })
    const edited = { ...initial.project, logicalSheet: { ...initial.project.logicalSheet, keys: [{ ...initial.key, displayLabel: '0002' }] } }
    expect(() => applySheetLabelNormalizationPlan(edited, plan)).toThrow('確認し直')
    expect(() => applySheetLabelNormalizationPlan(cell(initial.project, '1', 3).project, plan)).toThrow('重複')
  })

  it('updates the shared catalog across cuts without modifying their timing or source names', () => {
    const first = cell(createDefaultProject(), '0001', 1)
    const bound = upsertBinding(first.project, { slotId: 'slot_A', keyId: first.key.keyId, cspCellName: '0001', materialState: 'unassigned' })
    let document = createProjectDocumentFromCutProject(bound)
    document = addBlankSharedCutToProjectDocument(document, bound, { cut: { cut: 'C002' } })
    const second = setEvent(activeCutProjectFromDocument(document), 'A', 10, first.key.keyId, 'action')
    document = updateActiveCutProjectInDocument(document, second)
    const before = buildClipRegistrationPlan(document, 'action')
    const next = applySheetLabelNormalizationPlan(second, buildSheetLabelNormalizationPlan(second, strip))
    const saved = JSON.parse(JSON.stringify(updateActiveCutProjectInDocument(document, next)))
    expect(saved.cuts.map((cut: { cutId: string }) => activeCutProjectFromDocument({ ...saved, activeCutId: cut.cutId }).logicalSheet.keys[0].displayLabel)).toEqual(['1', '1'])
    expect(buildClipRegistrationPlan(saved, 'action')).toEqual(before)
  })
})
