import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, createDefaultProject, createKey, createOrSetEvent, createProjectDocumentFromCutProject, NULL_CELL_KEY_ID, setEvent, setTimingSpecialEvent, updateActiveCutProjectInDocument, upsertBinding } from './index'
import { buildClipRegistrationPlan, clipImagePlacement, normalizeClipName, validateClipCanvas } from './clip-export'

describe('CLIP registration plan', () => {
  it('exports typed markers as track labels while holding the exposure on every process track', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    let project = upsertBinding(first.project, { slotId: 'slot_A', keyId: first.key.keyId, cspCellName: 'A_001', materialState: 'unassigned' })
    project = upsertBinding(project, { slotId: 'slot_enshutsu_A', keyId: first.key.keyId, cspCellName: 'A_001_e', materialState: 'unassigned' })
    project = setTimingSpecialEvent(project, 'A', 3, 'inbetween', 'action')
    project = setTimingSpecialEvent(project, 'A', 4, 'inbetween', 'action')
    project = setTimingSpecialEvent(project, 'A', 7, 'reverse', 'action')
    project = setTimingSpecialEvent(project, 'A', 10, 'blank', 'action')
    project = setTimingSpecialEvent(project, 'A', 2, 'reverse', 'cell')
    const literal = createKey(project, 'A', 'SYMBOL_TICK_1', 'manual', 'SYMBOL_TICK_1', 'action')
    project = setEvent(literal.project, 'A', 12, literal.key.keyId, 'action')
    project = upsertBinding(project, { slotId: 'slot_A', keyId: literal.key.keyId, cspCellName: 'SYMBOL_TICK_1', materialState: 'unassigned' })
    const plan = buildClipRegistrationPlan(createProjectDocumentFromCutProject(project), 'action')
    expect(plan.folders.flatMap(folder => folder.cels.map(cel => cel.name)).sort()).toEqual(['A_001', 'A_001_e', 'SYMBOL_TICK_1'])
    expect(plan.timelines[0].tracks).toHaveLength(2)
    for (const track of plan.timelines[0].tracks) {
      expect(track.labels).toEqual([{ frame: 2, kind: 'inbetween' }, { frame: 3, kind: 'inbetween' }, { frame: 6, kind: 'reverse' }])
      expect(track.frames.some(frame => [2, 3, 6].includes(frame.frame))).toBe(false)
      expect(track.frames).toContainEqual({ frame: 9, value: null })
    }
  })
  it('keeps marker-only tracks, offsets their frames and excludes markers outside the cut or chosen role', () => {
    const initial = createDefaultProject()
    let project = { ...initial, logicalSheet: { ...initial.logicalSheet, frameOrigin: 101, durationFrames: 12 } }
    project = setTimingSpecialEvent(project, 'B', 101, 'inbetween', 'action')
    project = setTimingSpecialEvent(project, 'B', 112, 'reverse', 'action')
    project = setTimingSpecialEvent(project, 'B', 113, 'reverse', 'action')
    project = setTimingSpecialEvent(project, 'C', 102, 'reverse', 'cell')
    const plan = buildClipRegistrationPlan(createProjectDocumentFromCutProject(project), 'action')
    expect(plan.folders).toHaveLength(1)
    expect(plan.folders[0]).toMatchObject({ name: 'B', cels: [] })
    expect(plan.timelines[0].tracks).toEqual([{ folderId: plan.folders[0].id, frames: [], labels: [{ frame: 0, kind: 'inbetween' }, { frame: 11, kind: 'reverse' }] }])
  })
  it('bounds the shooting frame inside the paper for both positive and negative centered offsets', () => {
    const canvas = { width: 100, height: 80, dpi: 150, basisWidth: 60, basisHeight: 40, offsetX: 20, offsetY: -20 }
    expect(() => validateClipCanvas(canvas)).not.toThrow()
    for (const patch of [{ offsetX: 21 }, { offsetX: -21 }, { offsetY: 21 }, { offsetY: -21 }, { basisWidth: 101 }, { basisHeight: 81 }]) expect(() => validateClipCanvas({ ...canvas, ...patch })).toThrow()
    expect(() => validateClipCanvas({ ...canvas, width: 101, offsetX: 20 })).not.toThrow()
    expect(() => validateClipCanvas({ ...canvas, width: 101, offsetX: 21 })).toThrow()
  })
  it('keeps repeat events and shared cels across cuts without requiring material files', () => {
    const created = createOrSetEvent({ ...createDefaultProject(), cut: { cut: 'C001' } }, 'A', 1, 'action')
    const bound = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: '1', materialState: 'unassigned' })
    const repeated = setEvent(setEvent(bound, 'A', 6, NULL_CELL_KEY_ID, 'action'), 'A', 12, created.key.keyId, 'action')
    let document = createProjectDocumentFromCutProject(repeated)
    document = addBlankSharedCutToProjectDocument(document, repeated, { cut: { cut: 'C002' } })
    document = updateActiveCutProjectInDocument(document, setEvent(activeCutProjectFromDocument(document), 'A', 7, created.key.keyId, 'action'))
    const plan = buildClipRegistrationPlan(document, 'action')
    expect(plan.timelines.map(timeline => timeline.name)).toEqual(['C001', 'C002'])
    expect(plan.folders).toHaveLength(1)
    expect(plan.folders[0]).toMatchObject({ path: ['LO', '作画'], name: 'A', cels: [{ name: '1' }] })
    expect(plan.timelines[0].tracks[0].frames).toContainEqual({ frame: 11, value: '1' })
    expect(plan.timelines[0].tracks[0].frames).toContainEqual({ frame: 5, value: null })
    expect(plan.timelines[1].tracks[0].frames).toContainEqual({ frame: 6, value: '1' })
    expect(plan.timelines[0].tracks[0].folderId).toBe(plan.timelines[1].tracks[0].folderId)
    expect(buildClipRegistrationPlan(document, 'action', [document.activeCutId]).timelines).toHaveLength(1)
    expect(() => buildClipRegistrationPlan(document, 'action', [])).toThrow('カットを選択')
  })
  it('normalizes spaces, full width characters and invisible separators only for matching', () => {
    expect(normalizeClipName(' Ａ\t１\u200b\u2060　')).toBe('A1')
  })
  it('never shrinks, expands only the necessary axis, and specifies the odd pixel crop', () => {
    const canvas = { width: 100, height: 80 }
    expect(clipImagePlacement(canvas, { width: 60, height: 40 }, 'expand')).toMatchObject({ width: 100, height: 80, x: 20, y: 20, cropLeft: 0, cropRight: 0 })
    expect(clipImagePlacement(canvas, { width: 103, height: 70 }, 'expand')).toMatchObject({ width: 103, height: 80, x: 0, y: 5 })
    expect(clipImagePlacement(canvas, { width: 103, height: 83 }, 'crop')).toEqual({ width: 100, height: 80, x: -1, y: -1, cropLeft: 1, cropRight: 2, cropTop: 1, cropBottom: 2 })
  })
})
