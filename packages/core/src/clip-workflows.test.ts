import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, addClipLayers, addSheetRevisionToProjectDocument, assignClipCelToKey, bindClipCel, buildClipRegistrationPlan, clipCelDropTarget, commitHistory, createClipNode, createDefaultProject, createKey, createProjectDocumentFromCutProject, createProjectHistory, ensureClipDocument, openClipDocument, parseProjectDocument, redoHistory, remapClipTracks, selectTimingProcess, setEvent, suggestClipProcessColumns, timingForProcess, undoHistory, updateActiveCutProjectInDocument, updateKey } from './index'

import { independentClipFixture } from './clip-workflows.fixture'

describe('common sheet and preserved CLIP workflows', () => {
  it('shares sheet identities and fills sparse correction materials without inserting keys or exposures', () => {
    let project = ensureClipDocument(createDefaultProject())
    const base = project.correctionLayers[0].layerId, correction = project.correctionLayers[1].layerId
    expect(project.logicalSheet.processTimings).toBeUndefined()
    const folder = (processId: string) => project.clipDocument!.targets.find(target => target.slotId === project.cspTrackSlots.find(slot => slot.paperTrack === 'A' && slot.correctionLayerId === processId)!.slotId)!.folderId
    const baseFolder = folder(base), correctionFolder = folder(correction)
    for (let i = 1; i <= 3; i++) {
      const cel = createClipNode(`scan-${i}`, 'raster', baseFolder, `base${i}`)
      project = bindClipCel(addClipLayers(project, [cel]), cel.id, 'A', 1 + (i - 1) * 4, 'cell', base)
    }
    const before = project, cel = createClipNode('fix-file', 'raster', correctionFolder, 'fix')
    project = bindClipCel(addClipLayers(project, [cel]), cel.id, 'A', 6, 'cell', correction)
    expect(project.logicalSheet).toBe(before.logicalSheet)
    expect(project.bindings.at(-1)?.keyId).toBe(project.logicalSheet.events[1].keyId)
    expect(selectTimingProcess(project, correction)).toBe(project)
    const plan = buildClipRegistrationPlan(createProjectDocumentFromCutProject(project), 'cell')
    expect(plan.timelines[0].tracks.find(track => track.folderId === correctionFolder)?.frames).toEqual([{ frame: 0, value: null }, { frame: 4, value: 'fix-file' }, { frame: 8, value: null }])
    expect(plan.document!.nodes.filter(node => node.parentId === correctionFolder)).toEqual([cel])
    const history = commitHistory(createProjectHistory(before), project)
    expect(undoHistory(history).present).toEqual(before)
    expect(redoHistory(undoHistory(history)).present).toEqual(project)
    const restored = parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(project))))
    expect(buildClipRegistrationPlan(restored, 'cell').timelines).toEqual(plan.timelines)
    const occupied = createClipNode('another', 'raster', baseFolder, 'another')
    const withAnother = addClipLayers(project, [occupied])
    expect(() => clipCelDropTarget(withAnother, occupied.id, 'A', base, { frame: 1, role: 'cell' })).toThrow('登録済み')
    const replaced = assignClipCelToKey(withAnother, occupied.id, project.logicalSheet.events[0].keyId, base)
    expect(replaced.logicalSheet).toBe(project.logicalSheet)
    expect(replaced.clipDocument!.nodes).toContainEqual(before.clipDocument!.nodes.find(node => node.id === 'base1'))
  })

  it('attaches a scan to an already entered sheet number and keeps CSP names when notation changes', () => {
    let project = ensureClipDocument(createDefaultProject())
    const slot = project.cspTrackSlots.find(slot => slot.paperTrack === 'A')!, target = project.clipDocument!.targets.find(target => target.slotId === slot.slotId)!
    const created = createKey(project, 'A', '2', 'manual', '2', 'cell')
    project = setEvent(created.project, 'A', 5, created.key.keyId, 'cell')
    const node = createClipNode('2', 'raster', target.folderId, 'two')
    project = bindClipCel(addClipLayers(project, [node]), node.id, 'A', 5, 'cell', slot.correctionLayerId!)
    expect(project.logicalSheet.keys).toHaveLength(1)
    expect(project.logicalSheet.events).toHaveLength(1)
    project = updateKey(project, created.key.keyId, { displayLabel: 'new notation' })
    expect(project.bindings[0].cspCellName).toBe('2')
    expect(project.clipDocument!.nodes.find(layer => layer.id === node.id)?.name).toBe('2')
  })

  it('keeps literal imported columns, independent sparse timelines and the original hierarchy', () => {
    const { data, columns, document } = independentClipFixture()
    expect(columns.map(column => column.name)).toEqual(['AA', '01'])
    expect(activeCutProjectFromDocument(document).logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual(['AA', '01'])
    expect(document.clipDocument!.nodes).toEqual(data.layers)
    expect(buildClipRegistrationPlan(document, 'cell').timelines.every(timeline => timeline.tracks.every(track => track.preserve))).toBe(true)
    const renamed = structuredClone(data)
    renamed.nodes[1].children[0].children[0].name = '01'
    renamed.nodes[1].children[0].children[0].path[2] = '01'
    expect(suggestClipProcessColumns(renamed, ['a0', 'a1']).map(column => column.name)).toEqual(['01', '01'])
    const duplicate = { ...renamed.nodes[0].children[0].children[0], id: 'duplicate' }
    renamed.nodes[0].children[0].children.push(duplicate)
    expect(suggestClipProcessColumns(renamed, ['a0', 'a1', 'duplicate']).map(column => column.name)).toEqual(['01', '01', '01 (2)'])
    const materialOnly = openClipDocument(data, 'data:,', { timelineIds: [], columns, role: 'cell' })
    expect(activeCutProjectFromDocument(materialOnly).logicalSheet.processTimings).toBeUndefined()
    expect(materialOnly.clipDocument!.sourceTimelines).toEqual(data.timelines)
  })

  it('remaps across every cut and revision while exported native timing and source identities remain identical', () => {
    let { document } = independentClipFixture()
    document = addSheetRevisionToProjectDocument(document, activeCutProjectFromDocument(document), { name: 'revision', mode: 'duplicate' })
    const before = buildClipRegistrationPlan(document, 'cell'), project = activeCutProjectFromDocument(document)
    const processId = project.cspTrackSlots.find(slot => slot.slotId === document.clipDocument!.targets.find(target => target.folderId === 'a1')!.slotId)!.correctionLayerId!
    const destination = project.cspTrackSlots.find(slot => slot.paperTrack === '01' && slot.correctionLayerId === processId)!
    const remapped = remapClipTracks(document, [{ folderId: 'a1', slotId: destination.slotId }])
    expect(remapped.clipDocument!.nodes).toEqual(document.clipDocument!.nodes)
    expect(remapped.registeredCells.keys.map(key => key.keyId)).toEqual(document.registeredCells.keys.map(key => key.keyId))
    expect(buildClipRegistrationPlan(remapped, 'cell')).toEqual({ ...before, document: remapped.clipDocument })
    for (const cut of remapped.cuts) for (const revision of cut.revisions) {
      const selected = activeCutProjectFromDocument({ ...remapped, activeCutId: cut.cutId, cuts: remapped.cuts.map(item => item === cut ? { ...cut, activeRevisionId: revision.revisionId } : item) })
      expect(timingForProcess(selected.logicalSheet, processId).events.map(event => event.paperTrack)).toEqual(['01'])
    }
    const selected = selectTimingProcess(activeCutProjectFromDocument(remapped), processId)
    const edited = setEvent(selected, '01', 12, selected.logicalSheet.events[0].keyId, 'cell')
    const exported = buildClipRegistrationPlan(updateActiveCutProjectInDocument(remapped, edited), 'cell')
    expect(exported.timelines[0].tracks.find(track => track.folderId === 'a0')?.preserve).toBe(true)
    expect(exported.timelines[0].tracks.find(track => track.folderId === 'a1')?.frames.at(-1)).toEqual({ frame: 11, value: '001' })
  })

  it('rejects collisions and protected revisions without partially changing the document, and allows swaps', () => {
    const { document } = independentClipFixture(), [left, right] = document.clipDocument!.targets
    const snapshot = JSON.stringify(document)
    expect(() => remapClipTracks(document, [{ folderId: left.folderId, slotId: right.slotId }])).toThrow('複数')
    expect(JSON.stringify(document)).toBe(snapshot)
    const assignments = [{ folderId: left.folderId, slotId: right.slotId }, { folderId: right.folderId, slotId: left.slotId }]
    const swapped = remapClipTracks(document, assignments)
    expect(buildClipRegistrationPlan(swapped, 'cell').timelines).toEqual(buildClipRegistrationPlan(document, 'cell').timelines)
    const protectedDocument = structuredClone(document)
    protectedDocument.cuts[1].revisions[0].protected = true
    expect(() => remapClipTracks(protectedDocument, assignments)).toThrow('保護')
  })
})
