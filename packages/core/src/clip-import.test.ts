import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, buildClipRegistrationPlan, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, defaultCorrectionLayerId, updateLogicalSheetSettings, updatePaperTrack, validateProject, type ClipImportData } from './index'
import { clipImportFolders, importClipTimeline, importClipTimelines, suggestClipImportColumns } from './clip-import'

const data: ClipImportData = {
  fileName: 'studio.clip', fileHash: 'abc123', currentTimelineId: 'first',
  nodes: [
    { id: 'top', name: '任意の工程', path: ['任意の工程'], visible: false, animation: false, children: [
      { id: 'duplicate', name: 'A', path: ['任意の工程', 'A'], visible: false, animation: true, children: [] },
      { id: 'long', name: '長いフォルダー名', path: ['任意の工程', '長いフォルダー名'], visible: false, animation: true, children: [] },
    ] },
    { id: 'bottom', name: 'A', path: ['A'], visible: true, animation: true, children: [] },
  ],
  timelines: [
    { id: 'first', name: 'C001', fps: 24, startFrame: 10, endFrame: 34, tracks: [
      { layerId: 'bottom', frames: [{ frame: 0, value: '001' }, { frame: 3, value: null }, { frame: 7, value: '001' }, { frame: 12, value: ' 01a ' }] },
      { layerId: 'long', frames: [{ frame: 6, value: '3' }] },
    ] },
    { id: 'second', name: 'C002', fps: 30, startFrame: 0, endFrame: 60, tracks: [
      { layerId: 'bottom', frames: [{ frame: 0, value: null }, { frame: 6, value: '001' }, { frame: 20, value: '2' }] },
    ] },
  ],
}
const options = { timelineId: 'first', role: 'action' as const, columns: [{ layerId: 'bottom', name: 'A' }, { layerId: 'long', name: 'B' }, { layerId: 'duplicate', name: 'C' }] }

describe('CLIP timeline import', () => {
  it('walks bottom to top, gives duplicate/long folders short names, and retains source paths', () => {
    const project = createDefaultProject()
    expect(clipImportFolders(data.nodes).map(node => node.id)).toEqual(['bottom', 'long', 'duplicate'])
    expect(suggestClipImportColumns(project, data.nodes, ['duplicate', 'long', 'bottom'])).toEqual(options.columns)
    const next = importClipTimeline(project, data, options)
    expect(next.logicalSheet.paperTracks.slice(0, 3).map(track => track.label)).toEqual(['A', 'B', 'C'])
    expect(next.logicalSheet.paperTracks[1].clipSource).toMatchObject({ fileName: 'studio.clip', layerId: 'long', path: ['任意の工程', '長いフォルダー名'], startFrame: 10 })
    expect(next.cspTrackSlots.map(slot => slot.trackNo)).toEqual(next.cspTrackSlots.map((_, i) => i))
    expect(next.bindings.every(binding => next.cspTrackSlots.find(slot => slot.slotId === binding.slotId)?.correctionLayerId === defaultCorrectionLayerId(next))).toBe(true)
    expect(next.logicalSheet.durationFrames).toBe(24)
    expect(project.logicalSheet.events).toHaveLength(0)
  })
  it('preserves literal cel names, repeated keys, blanks and ACTION/CELL without importing pixels', () => {
    const next = importClipTimeline(createDefaultProject(), data, { ...options, role: 'cell' })
    const plan = buildClipRegistrationPlan(createProjectDocumentFromCutProject(next), 'cell')
    expect(plan.timelines[0].tracks[0].frames).toEqual(data.timelines[0].tracks[0].frames)
    expect(next.logicalSheet.events.filter(event => event.paperTrack === 'A').map(event => event.frame)).toEqual([1, 4, 8, 13])
    expect(next.logicalSheet.keys.filter(key => key.paperTrack === 'A').map(key => key.displayLabel)).toEqual(['001', ' 01a '])
    expect(next.logicalSheet.events.every(event => event.sheetRole === 'cell')).toBe(true)
    expect(next.assets).toHaveLength(0)
    expect(next.bindings.every(binding => binding.materialState === 'unassigned')).toBe(true)
  })
  it('never overwrites occupied columns and rejects equivalent names', () => {
    const existing = createOrSetEvent(createDefaultProject(), 'A', 1, 'action').project
    expect(() => importClipTimeline(existing, data, options)).toThrow('使用中')
    const columns = suggestClipImportColumns(existing, data.nodes, ['bottom'])
    expect(columns[0].name).toBe('B')
    const next = importClipTimeline(existing, data, { ...options, columns })
    expect(next.logicalSheet.events).toContainEqual(existing.logicalSheet.events[0])
    expect(next.logicalSheet.durationFrames).toBe(existing.logicalSheet.durationFrames)
    expect(() => importClipTimeline(createDefaultProject(), data, { ...options, columns: [{ layerId: 'bottom', name: 'A' }, { layerId: 'long', name: ' Ａ\u200b ' }] })).toThrow('重複')
  })
  it.each(['action', 'cell'] as const)('keeps %s dummy keys, blanks and repeats through hidden save/reload without extending official export', role => {
    const source = structuredClone(data)
    source.timelines[0].tracks[0].frames = [
      { frame: -30, value: '001' }, { frame: -6, value: '001' }, { frame: 3, value: null },
      { frame: 24, value: '002' }, { frame: 40, value: '002' },
    ]
    const initial = updateLogicalSheetSettings(createDefaultProject(), { frameOrigin: 5, allowNegativeFrames: false,
      workRange: { preRollFrames: 0, postRollFrames: 0, showPreRoll: false, showPostRoll: false } })
    const imported = importClipTimeline(initial, source, { ...options, role, columns: [options.columns[0]] })
    expect(imported.logicalSheet).toMatchObject({ frameOrigin: 5, durationFrames: 24, allowNegativeFrames: true,
      workRange: { preRollFrames: 30, postRollFrames: 17, showPreRoll: true, showPostRoll: true } })
    expect(imported.logicalSheet.events.map(event => event.frame)).toEqual([-25, -1, 8, 29, 45])
    expect(imported.logicalSheet.events[0].keyId).toBe(imported.logicalSheet.events[1].keyId)
    expect(imported.logicalSheet.events[3].keyId).toBe(imported.logicalSheet.events[4].keyId)
    const hidden = updateLogicalSheetSettings(imported, { workRange: { ...imported.logicalSheet.workRange!, showPreRoll: false, showPostRoll: false } })
    const document = JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(hidden)))
    const reopened = activeCutProjectFromDocument(document)
    expect(reopened.logicalSheet.events).toEqual(imported.logicalSheet.events)
    expect(reopened.logicalSheet.workRange).toEqual(hidden.logicalSheet.workRange)
    expect(validateProject(reopened).filter(issue => issue.severity === 'error')).toEqual([])
    const exported = buildClipRegistrationPlan(document, role).timelines[0]
    expect(exported.duration).toBe(24)
    expect(exported.tracks[0].frames).toEqual([{ frame: 0, value: '001' }, { frame: 3, value: null }])
    expect(initial.logicalSheet.events).toEqual([])
  })
  it('uses only selected tracks to expand dummy frames and preserves longer existing work ranges', () => {
    const source = structuredClone(data)
    source.timelines[0].tracks[0].frames.push({ frame: 24, value: '2' })
    source.timelines[0].tracks[1].frames = [{ frame: -999_999, value: '3' }]
    const initial = updateLogicalSheetSettings(createDefaultProject(), {
      workRange: { preRollFrames: 60, postRollFrames: 72, showPreRoll: false, showPostRoll: false },
    })
    const imported = importClipTimeline(initial, source, { ...options, columns: [options.columns[0]] })
    expect(imported.logicalSheet.workRange).toEqual({ preRollFrames: 60, postRollFrames: 72, showPreRoll: false, showPostRoll: true })
    expect(imported.logicalSheet.durationFrames).toBe(24)
    expect(imported.logicalSheet.events.at(-1)?.frame).toBe(25)
  })
  it.each([
    [{ frame: -3, value: '1' }, { frame: -3, value: '2' }],
    [{ frame: 0, value: '1' }, { frame: -3, value: '2' }],
    [{ frame: -0.5, value: '1' }],
    [{ frame: Number.NaN, value: '1' }],
    [{ frame: Number.MAX_SAFE_INTEGER + 1, value: '1' }],
    [{ frame: -1_000_000, value: '1' }],
    [{ frame: 1_000_000, value: '1' }],
  ])('rejects invalid or excessive dummy timing atomically: %j', (...frames) => {
    const source = structuredClone(data)
    source.timelines[0].tracks[0].frames = frames
    const project = createDefaultProject()
    expect(() => importClipTimeline(project, source, options)).toThrow()
    expect(project.logicalSheet.events).toEqual([])
  })
  it('creates shared cuts with a single shared catalog and distinct FPS/duration/exposures', () => {
    const before = createProjectDocumentFromCutProject(createDefaultProject())
    const imported = importClipTimelines(before, data, { ...options, timelineIds: ['first', 'second'] })
    expect(before.cuts).toHaveLength(1)
    expect(imported.cuts.map(cut => cut.metadata.cut)).toEqual(['C001', 'C002'])
    const first = activeCutProjectFromDocument(imported)
    const second = activeCutProjectFromDocument({ ...imported, activeCutId: imported.cuts[1].cutId })
    expect([first.logicalSheet.fps, first.logicalSheet.durationFrames, second.logicalSheet.fps, second.logicalSheet.durationFrames]).toEqual([24, 24, 30, 60])
    expect(second.logicalSheet.events.find(event => event.frame === 7)?.keyId).toBe(first.logicalSheet.events[0].keyId)
    expect(second.logicalSheet.keys.filter(key => key.paperTrack === 'A').map(key => key.displayLabel)).toEqual(['001', ' 01a ', '2'])
    expect(second.logicalSheet.paperTracks[0].clipSource?.timelineId).toBe('second')
    expect(buildClipRegistrationPlan(imported, 'action').timelines.map(timeline => timeline.tracks[0].frames)).toEqual(data.timelines.map(timeline => timeline.tracks[0].frames))
  })
  it('retains existing cuts when adding several timelines and preserves provenance across rename/save/reload', () => {
    const existing = createOrSetEvent(createDefaultProject(), 'A', 1, 'action').project
    const doc = createProjectDocumentFromCutProject(existing)
    const columns = suggestClipImportColumns(existing, data.nodes, ['bottom'])
    const imported = importClipTimelines(doc, data, { ...options, columns, timelineIds: ['first', 'second'] })
    expect(imported.cuts).toHaveLength(3)
    const original = activeCutProjectFromDocument({ ...imported, activeCutId: doc.activeCutId })
    expect(original.logicalSheet.events).toEqual(existing.logicalSheet.events)
    const active = activeCutProjectFromDocument(imported)
    const renamed = updatePaperTrack(active, columns[0].name, { label: '撮影A' })
    const reopened = activeCutProjectFromDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(renamed))))
    expect(reopened.logicalSheet.paperTracks.find(track => track.label === '撮影A')?.clipSource).toMatchObject({ fileHash: 'abc123', layerId: 'bottom', path: ['A'], timelineId: 'first' })
  })
  it('retains separate dummy timing and official durations for shared timelines', () => {
    const source = structuredClone(data)
    source.timelines[0].tracks[0].frames.unshift({ frame: -30, value: '002' })
    source.timelines[0].tracks[0].frames.push({ frame: 24, value: '003' })
    source.timelines[1].tracks[0].frames.unshift({ frame: -48, value: '003' })
    source.timelines[1].tracks[0].frames.push({ frame: 90, value: '002' })
    const imported = importClipTimelines(createProjectDocumentFromCutProject(createDefaultProject()), source, { ...options, timelineIds: ['first', 'second'] })
    const projects = imported.cuts.map(cut => activeCutProjectFromDocument({ ...imported, activeCutId: cut.cutId }))
    expect(projects.map(project => [project.logicalSheet.durationFrames, project.logicalSheet.workRange?.preRollFrames, project.logicalSheet.workRange?.postRollFrames])).toEqual([[24, 30, 1], [60, 48, 31]])
    expect(projects.map(project => project.logicalSheet.events.filter(event => event.paperTrack === 'A').map(event => event.frame))).toEqual([[-29, 1, 4, 8, 13, 25], [-47, 1, 7, 21, 91]])
    for (const project of projects) expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([])
  })
  it('fails atomically if a selected timeline or frame cannot be represented', () => {
    const document = createProjectDocumentFromCutProject(createDefaultProject())
    const invalid = structuredClone(data)
    invalid.timelines[1].tracks[0].error = '未対応のクリップ'
    expect(() => importClipTimelines(document, invalid, { ...options, timelineIds: ['first', 'second'] })).toThrow('未対応')
    expect(document.cuts).toHaveLength(1)
    expect(activeCutProjectFromDocument(document).logicalSheet.events).toHaveLength(0)
    invalid.timelines[1].fps = 0
    expect(() => importClipTimelines(document, invalid, { ...options, timelineIds: ['first', 'second'] })).toThrow('FPS')
  })
})
