import { describe, expect, it } from 'vitest'
import {
  buildActionCellTransferPlan, applyActionCellTransferPlan, createDefaultProject, createKey, setEvent, setTimingSpecialEvent,
  setTimingReferenceAt, createProjectDocumentFromCutProject, parseProjectDocument, activeCutProjectFromDocument,
  createProjectHistory, commitHistory, undoHistory, redoHistory, ensureClipDocument, createClipNode, addClipLayers,
  bindClipCel, synchronizeClipBindings, buildClipRegistrationPlan, validateProject, selectTimingProcess, timingForProcess,
  buildProjectArchiveManifest, buildAeRemapPlan,
  type CutProject,
} from './index'

function write(project: CutProject, values: string[], start = 1, paperTrack = 'A', step = 1): CutProject {
  for (const [index, value] of values.entries()) {
    const frame = start + index * step
    if (['○', '●', '×'].includes(value)) project = setTimingSpecialEvent(project, paperTrack, frame, value === '○' ? 'inbetween' : value === '●' ? 'reverse' : 'blank', 'action')
    else {
      const created = createKey(project, paperTrack, value, 'manual', undefined, 'action')
      project = setEvent(created.project, paperTrack, frame, created.key.keyId, 'action', { fontSizePx: 18 })
    }
  }
  return project
}
const convert = (project: CutProject) => applyActionCellTransferPlan(project, buildActionCellTransferPlan(project))
const numbers = (project: CutProject, track = 'A') => project.logicalSheet.events.filter(event => event.sheetRole === 'cell' && event.paperTrack === track)
  .sort((a, b) => a.frame - b.frame).map(event => event.valueKind === 'blank' ? '×' : project.logicalSheet.keys.find(key => key.keyId === event.keyId)!.displayLabel)

describe('ACTION to CELL numbering', () => {
  it('numbers the mixed Japanese example and preserves each occurrence enclosure independently', () => {
    let source = write(createDefaultProject(), '1 ○ ○ ○ 2 ○ あ い ○ 3 ● ● ● 2 ○ ○ 1'.split(' '))
    for (const frame of [1, 5, 10, 14, 17]) source = setTimingReferenceAt(source, 'A', frame, 'action', 'circle')
    for (const frame of [7, 8]) source = setTimingReferenceAt(source, 'A', frame, 'action', true)
    const result = convert(source)
    expect(numbers(result)).toEqual('1 2 3 4 5 6 7 8 9 10 11 12 13 5 14 15 1'.split(' '))
    expect(result.logicalSheet.referenceMarks?.filter(mark => mark.sheetRole === 'cell')).toEqual(source.logicalSheet.referenceMarks?.map(mark => ({ ...mark, sheetRole: 'cell' })).sort((a, b) => a.frame - b.frame))
    expect(result.logicalSheet.events.filter(event => event.sheetRole === 'action')).toEqual(source.logicalSheet.events)
    expect(result.logicalSheet.keys.slice(0, source.logicalSheet.keys.length)).toEqual(source.logicalSheet.keys)
    expect(result.bindings).toBe(source.bindings)
    expect(buildProjectArchiveManifest(createProjectDocumentFromCutProject(result)).requiredFeatures).toEqual(expect.arrayContaining(['action-cell-transfer', 'timing-enclosures']))
    const ae = buildAeRemapPlan(result, { paperTracks: ['A'], sheetRole: 'cell' })
    expect(ae.diagnostics).toEqual([])
    expect(ae.columns[0].keys.map(key => key.cellNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 5, 14, 15, 1])
    expect(() => buildClipRegistrationPlan(createProjectDocumentFromCutProject(result), 'cell')).toThrow('素材未登録')
    expect(result.assets).toBe(source.assets)
    const targetIds = new Set(result.logicalSheet.events.filter(event => event.sheetRole === 'cell').map(event => event.keyId))
    expect(source.logicalSheet.keys.every(key => !targetIds.has(key.keyId))).toBe(true)
    const history = commitHistory(createProjectHistory(source), result)
    expect(undoHistory(history).present).toEqual(source)
    expect(redoHistory(undoHistory(history)).present).toEqual(result)
    const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(result)))))
    expect(numbers(restored)).toEqual(numbers(result))
    expect(restored.logicalSheet.referenceMarks).toEqual(result.logicalSheet.referenceMarks)
    expect(restored.logicalSheet.keys.filter(key => targetIds.has(key.keyId)).every(key => key.requiresExplicitBinding)).toBe(true)
  })
  it('matches the official successive examples, including standalone ticks and mixed reusable slots', () => {
    const examples = [
      ['1 ○ ○ 2', '1 2 3 4'], ['2 ○ ○ 1', '4 3 2 1'], ['1 ● ○ 2', '1 5 3 4'], ['2 ○ ● 1', '4 3 6 1'],
      ['1 ○ 2', '1 7 4'], ['1 3', '1 8'], ['●', '9'], ['○', '10'], ['○ ●', '11 12'], ['● ○', '13 14'], ['○ ○', '11 14'],
    ]
    const source = write(createDefaultProject(), examples.flatMap(([input]) => [...input.split(' '), '×']))
    expect(numbers(convert(source))).toEqual(examples.flatMap(([, output]) => [...output.split(' '), '×']))
  })
  it('handles identical endpoints, longer holds and independent columns without numeric-label sorting', () => {
    let source = write(createDefaultProject(), ['15', '○', '○', '15', '○', '○', '15'], 1, 'A', 3)
    source = write(source, ['9', '7', '9'], 1, 'B')
    const result = convert(source)
    expect(numbers(result)).toEqual(['1', '2', '3', '1', '2', '3', '1'])
    expect(numbers(result, 'B')).toEqual(['1', '2', '1'])
    expect(result.logicalSheet.events.filter(event => event.sheetRole === 'cell' && event.paperTrack === 'A').map(event => event.frame)).toEqual([1, 4, 7, 10, 13, 16, 19])
  })
  it('includes hidden pre/post-roll drawings, holds and interval endpoints in one numbering pass', () => {
    const initial = createDefaultProject()
    initial.logicalSheet.durationFrames = 4
    initial.logicalSheet.frameOrigin = 1
    initial.logicalSheet.workRange = { preRollFrames: 4, postRollFrames: 4, showPreRoll: false, showPostRoll: false }
    let source = write(initial, ['8', '○', '○', '2'], -2)
    source = write(source, ['○', '○', '8'], 4)
    const hidden = convert(source)
    expect(numbers(hidden)).toEqual(['1', '2', '3', '4', '3', '2', '1'])
    const visible = convert({ ...source, logicalSheet: { ...source.logicalSheet, workRange: { ...source.logicalSheet.workRange, showPreRoll: true, showPostRoll: true } } })
    expect(visible.logicalSheet.events).toEqual(hidden.logicalSheet.events)
    expect(visible.logicalSheet.keys).toEqual(hidden.logicalSheet.keys)
  })
  it('skips occupied/registered target columns including hidden marks, and rejects stale previews', () => {
    let source = write(createDefaultProject(), ['1', '○', '2'])
    source = write(source, ['1'], 1, 'B')
    source = setTimingReferenceAt(source, 'B', -10, 'cell', 'circle')
    const plan = buildActionCellTransferPlan(source)
    expect(plan.columns.find(column => column.paperTrack === 'B')?.status).toBe('occupied')
    expect(numbers(applyActionCellTransferPlan(source, plan), 'B')).toEqual([])
    expect(() => applyActionCellTransferPlan({ ...source }, plan)).toThrow('プレビュー')
    expect(buildActionCellTransferPlan(convert(source)).columns.find(column => column.paperTrack === 'A')?.status).toBe('occupied')
    const created = createKey(source, 'A', '1', 'manual', undefined, 'cell')
    const registered = { ...created.project, bindings: [{ bindingId: 'test', keyId: created.key.keyId, slotId: source.cspTrackSlots[0].slotId, cspCellName: 'A_1', materialState: 'unassigned' as const }] }
    expect(buildActionCellTransferPlan(registered).columns[0].status).toBe('bound')
  })
  it('preserves an assembled CLIP and its ACTION export while leaving new CELL drawings explicitly unregistered', () => {
    let source = ensureClipDocument(createDefaultProject())
    const target = source.clipDocument!.targets[0], slot = source.cspTrackSlots.find(slot => slot.slotId === target.slotId)!
    const node = createClipNode('001', 'raster', target.folderId)
    source = addClipLayers(source, [node])
    source = bindClipCel(source, node.id, slot.paperTrack, 1, 'action', slot.correctionLayerId!)
    source = setTimingSpecialEvent(source, slot.paperTrack, 3, 'inbetween', 'action')
    const before = buildClipRegistrationPlan(createProjectDocumentFromCutProject(source), 'action')
    const result = synchronizeClipBindings(convert(source))
    expect(result.clipDocument).toEqual(source.clipDocument)
    expect(result.bindings).toEqual(source.bindings)
    expect(buildClipRegistrationPlan(createProjectDocumentFromCutProject(result), 'action')).toEqual(before)
    expect(() => buildClipRegistrationPlan(createProjectDocumentFromCutProject(result), 'cell')).toThrow('素材未登録')
    expect(validateProject(result).filter(issue => issue.severity === 'error')).toEqual([])
    const restored = synchronizeClipBindings(activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(result))))))
    expect(restored.clipDocument).toEqual(result.clipDocument)
    expect(restored.bindings).toEqual(result.bindings)
    expect(() => buildClipRegistrationPlan(createProjectDocumentFromCutProject(restored), 'cell')).toThrow('素材未登録')
  })
  it('retains inactive process data and circle marks through switching and persistence', () => {
    let source = createDefaultProject()
    const [base, other] = source.correctionLayers.map(layer => layer.layerId)
    source = { ...source, logicalSheet: { ...source.logicalSheet, processTimings: { activeProcessId: base, inactive: {} } } }
    source = write(source, ['1', '○', '2'])
    source = setTimingReferenceAt(source, 'A', 1, 'action', 'circle')
    source = write(selectTimingProcess(source, other), ['9', '○', '8'])
    source = selectTimingProcess(source, base)
    const result = convert(source)
    expect(timingForProcess(result.logicalSheet, other)).toEqual(timingForProcess(source.logicalSheet, other))
    const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(selectTimingProcess(result, other))))))
    expect(numbers(selectTimingProcess(restored, base))).toEqual(['1', '2', '3'])
    expect(timingForProcess(restored.logicalSheet, base).referenceMarks?.filter(mark => mark.shape === 'circle')).toHaveLength(2)
  })
})
