import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, ensureClipDocument, setTimingSpecialEvent, unsetClipTarget } from './index'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, applyCutTimelineFrameEdit, buildClipRegistrationPlan, buildProjectArchiveManifest, createClipNode, createOrSetEvent, openClipDocument, parseProjectDocument, processTimingDifferences, selectTimingProcess, setEvent, suggestClipProcessColumns, timingForProcess, updateActiveCutProjectInDocument, updateCorrectionLayers, updatePaperTrack, validateProject, type ClipImportData } from './index'

function fixture() {
  const groups = ['LO／作画', 'LO／修正']
  const data: ClipImportData = {
    fileName: 'nested.clip', fileHash: 'fixture', currentTimelineId: 't1',
    layers: [createClipNode('LO', 'folder', null, 'lo'), ...groups.flatMap((name, i) => [
      createClipNode(name.split('／')[1], 'folder', 'lo', `g${i}`), createClipNode('A', 'animation', `g${i}`, `a${i}`),
      createClipNode('001', 'raster', `a${i}`, `one${i}`), createClipNode('002', 'raster', `a${i}`, `two${i}`),
    ])],
    nodes: [{ id: 'lo', name: 'LO', path: ['LO'], animation: false, visible: true, children: groups.map((name, i) => ({
      id: `g${i}`, name: name.split('／')[1], path: name.split('／'), animation: false, visible: true,
      children: [{ id: `a${i}`, name: 'A', path: [...name.split('／'), 'A'], animation: true, visible: true, children: [] }],
    })) }],
    timelines: [{ id: 't1', name: 'C001', fps: 24, startFrame: 0, endFrame: 24, tracks: [
      { layerId: 'a0', frames: [{ frame: 0, value: '001' }, { frame: 4, value: '002' }] },
      { layerId: 'a1', frames: [{ frame: 0, value: '001' }, { frame: 6, value: '002' }] },
    ] }],
  }
  const columns = suggestClipProcessColumns(data, ['a0', 'a1'])
  const document = openClipDocument(data, 'data:application/octet-stream;base64,AA==', { timelineIds: ['t1'], role: 'cell', columns })
  const project = activeCutProjectFromDocument(document)
  const base = project.correctionLayers.find(process => process.label === groups[0])!.layerId
  const correction = project.correctionLayers.find(process => process.label === groups[1])!.layerId
  return { data, columns, document, project, base, correction }
}

describe('independent process timing', () => {
  it('does not dirty an empty document by switching groups, and compares point markers for one frame only', () => {
    const empty = ensureClipDocument(createDefaultProject())
    expect(createProjectDocumentFromCutProject(selectTimingProcess(empty, empty.correctionLayers[1].layerId)).cuts).toEqual(createProjectDocumentFromCutProject(empty).cuts)
    const { project, base } = fixture()
    const marked = setTimingSpecialEvent(selectTimingProcess(project, base), 'A', 12, 'reverse', 'cell')
    expect(processTimingDifferences(marked).map(item => [item.frameStart, item.frameEnd])).toEqual([[5, 6], [12, 12]])
  })
  it('blocks export of an unresolved mapping or cel rather than silently producing blanks', () => {
    const { document, project, base } = fixture()
    const selected = selectTimingProcess(project, base), slot = project.cspTrackSlots.find(slot => slot.paperTrack === 'A' && slot.correctionLayerId === base)!
    expect(() => buildClipRegistrationPlan(updateActiveCutProjectInDocument(document, unsetClipTarget(selected, slot.slotId)), 'cell')).toThrow('登録先が未設定')
    expect(() => buildClipRegistrationPlan(updateActiveCutProjectInDocument(document, createOrSetEvent(selected, 'A', 15, 'cell').project), 'cell')).toThrow('セルが未登録')
  })
  it('suggests full ancestry without a fixed process taxonomy, and shares only the paper column', () => {
    const { columns, project, base, correction } = fixture()
    expect(columns.map(column => column.name)).toEqual(['A', 'A'])
    expect(new Set(columns.map(column => column.process))).toEqual(new Set(['LO／作画', 'LO／修正']))
    expect(project.logicalSheet.paperTracks.filter(track => track.paperTrack === 'A')).toHaveLength(1)
    expect(timingForProcess(project.logicalSheet, base).events.map(event => event.frame)).toEqual([1, 5])
    expect(timingForProcess(project.logicalSheet, correction).events.map(event => event.frame)).toEqual([1, 7])
    expect(project.logicalSheet.keys).toHaveLength(4)
    expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([])
    expect(processTimingDifferences(project)).toMatchObject([{ paperTrack: 'A', role: 'cell', frameStart: 5, frameEnd: 6 }])
  })

  it('allows explicit aliases and arbitrary group names while preserving CLIP node identities', () => {
    const { data, columns } = fixture()
    const document = openClipDocument(data, 'data:,', { timelineIds: ['t1'], role: 'cell', columns: columns.map((column, index) => ({ ...column, process: `自由名${index}`, name: 'B' })) })
    const project = activeCutProjectFromDocument(document)
    expect(project.correctionLayers.map(layer => layer.label)).toEqual(['自由名0', '自由名1'])
    expect(project.clipDocument!.nodes).toEqual(data.layers)
    const renamed = updateCorrectionLayers(project, project.correctionLayers.map(layer => ({ ...layer, label: `${layer.label}改` })))
    expect(renamed.clipDocument).toBe(project.clipDocument)
    expect(() => openClipDocument(data, 'data:,', { timelineIds: ['t1'], role: 'cell', columns: columns.map(column => ({ ...column, process: '同じ' })) })).toThrow('重複')
  })

  it('keeps edits, repeated labels, export and preservation local to the chosen process', () => {
    const { document, project, base, correction } = fixture()
    const selected = selectTimingProcess(project, base)
    const beforeOther = timingForProcess(selected.logicalSheet, correction)
    const edited = setEvent(selected, 'A', 9, selected.logicalSheet.events[0].keyId, 'cell')
    expect(timingForProcess(edited.logicalSheet, correction)).toEqual(beforeOther)
    const wrongKey = edited.logicalSheet.keys.find(key => key.processId === correction)!
    expect(() => setEvent(edited, 'A', 11, wrongKey.keyId, 'cell')).toThrow()
    const newBase = createOrSetEvent(edited, 'A', 12, 'cell').project
    const other = createOrSetEvent(selectTimingProcess(newBase, correction), 'A', 13, 'cell').project
    expect(other.logicalSheet.keys.filter(key => key.displayLabel === '3')).toHaveLength(2)
    const plan = buildClipRegistrationPlan(updateActiveCutProjectInDocument(document, edited), 'cell')
    expect(plan.timelines[0].tracks.find(track => track.folderId === 'a0')).toMatchObject({ preserve: false })
    expect(plan.timelines[0].tracks.find(track => track.folderId === 'a1')).toMatchObject({ preserve: true, frames: [{ frame: 0, value: '001' }, { frame: 6, value: '002' }] })
  })

  it('persists both slices, canonicalizes selection, and rejects a foreign key in an inactive slice', () => {
    const { document, project, base, correction } = fixture()
    const first = updateActiveCutProjectInDocument(document, selectTimingProcess(project, base))
    const second = updateActiveCutProjectInDocument(document, selectTimingProcess(project, correction))
    expect(first.cuts).toEqual(second.cuts)
    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(second)))
    const restored = activeCutProjectFromDocument(parsed)
    expect(timingForProcess(restored.logicalSheet, base)).toEqual(timingForProcess(project.logicalSheet, base))
    expect(timingForProcess(restored.logicalSheet, correction)).toEqual(timingForProcess(project.logicalSheet, correction))
    expect(buildProjectArchiveManifest(second).requiredFeatures).toContain('process-timing')
    const broken = structuredClone(restored)
    const inactive = Object.values(broken.logicalSheet.processTimings!.inactive)[0]
    inactive.events[0].keyId = broken.logicalSheet.events[0].keyId
    expect(() => activeCutProjectFromDocument(updateActiveCutProjectInDocument(document, broken))).toThrow('工程別タイミング')
  })

  it('ripples all processes and renames columns consistently; a blank cut has no process exposures', () => {
    const { document, project, base, correction } = fixture()
    const inserted = applyCutTimelineFrameEdit(project, { kind: 'insert', atFrame: 3, frameCount: 2 })
    expect(timingForProcess(inserted.logicalSheet, base).events.map(event => event.frame)).toEqual([1, 7])
    expect(timingForProcess(inserted.logicalSheet, correction).events.map(event => event.frame)).toEqual([1, 9])
    const deleted = applyCutTimelineFrameEdit(inserted, { kind: 'delete', frameStart: 3, frameCount: 2 })
    expect(timingForProcess(deleted.logicalSheet, base).events).toEqual(timingForProcess(project.logicalSheet, base).events)
    const renamed = updatePaperTrack(project, 'A', { paperTrack: 'Z', label: 'Z' })
    expect(timingForProcess(renamed.logicalSheet, base).events.every(event => event.paperTrack === 'Z')).toBe(true)
    const blank = activeCutProjectFromDocument(addBlankSharedCutToProjectDocument(document, project))
    expect(timingForProcess(blank.logicalSheet, base).events).toEqual([])
    expect(timingForProcess(blank.logicalSheet, correction).events).toEqual([])
  })

  it('imports several timelines with independent timing and shared process-scoped cel identities', () => {
    const { data, columns } = fixture()
    data.timelines.push({ ...data.timelines[0], id: 't2', name: 'C002', tracks: data.timelines[0].tracks.map(track => ({ ...track, frames: track.frames.map(frame => ({ ...frame, frame: frame.frame + 2 })) })) })
    const document = openClipDocument(data, 'data:,', { timelineIds: ['t1', 't2'], role: 'cell', columns })
    const plan = buildClipRegistrationPlan(document, 'cell')
    expect(document.registeredCells.keys).toHaveLength(4)
    expect(plan.timelines[1].tracks.find(track => track.folderId === 'a0')!.frames.map(frame => frame.frame)).toEqual([2, 6])
    expect(plan.timelines[1].tracks.find(track => track.folderId === 'a1')!.frames.map(frame => frame.frame)).toEqual([2, 8])
  })
})
