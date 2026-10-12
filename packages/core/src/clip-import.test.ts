import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, buildClipRegistrationPlan, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, defaultCorrectionLayerId, updatePaperTrack, type ClipImportData } from './index'
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
