import { describe, expect, it } from 'vitest'
import { addClipLayers, clipChildren, createClipNode, ensureClipDocument, moveClipLayer } from './clip-document'
import { addOverlayPaperTrack, createDefaultProject, deleteOverlayPaperTrack, updatePaperTrack } from './project-model'
import { addOverlayPaperTrackAtCspTop } from './project-cell-stack-order'
import { activeCutProjectFromDocument, createProjectDocumentFromCutProject, parseProjectDocument } from './project-documents'
import { commitHistory, createProjectHistory, redoHistory, undoHistory } from './project-commands'
import type { CutProject } from './types'

const children = (project: CutProject, process = 'layer_sakuga') => clipChildren(project.clipDocument!, `process:${process}`)
const names = (project: CutProject, process?: string) => children(project, process).map(node => node.name)
const letters = 'IHGFEDCBA'.split('')

describe('paper columns and native animation folders', () => {
  it('starts every default process with the same nine folders and preserves them through persistence', () => {
    const project = ensureClipDocument(createDefaultProject())
    const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(project)))))
    expect(restored.correctionLayers.map(process => process.label)).toEqual(['作画', '演出', '監督', '作監', '総作監', 'その他修正'])
    for (const process of restored.correctionLayers) {
      expect(names(restored, process.layerId)).toEqual(letters)
      const slots = restored.cspTrackSlots.filter(slot => slot.correctionLayerId === process.layerId)
      expect(slots.map(slot => slot.paperTrack)).toEqual([...letters].reverse())
      expect(slots.every(slot => restored.clipDocument!.targets.some(target => target.slotId === slot.slotId))).toBe(true)
    }
    expect(restored.correctionLayers.map(process => restored.clipDocument!.nodes.find(node => node.id === `process:${process.layerId}`)?.labelColor))
      .toEqual([undefined, '#fbece6', '#dce4f1', '#fcf9cf', '#eaf6d5', '#ffddaa'])
  })

  it('inserts after I above I in all processes and undoes the column and folders together', () => {
    const project = ensureClipDocument(createDefaultProject())
    const next = addOverlayPaperTrackAtCspTop(project, { paperTrack: 'J' }).project
    for (const process of next.correctionLayers) expect(names(next, process.layerId)).toEqual(['J', ...letters])
    const history = commitHistory(createProjectHistory(project), next)
    expect(undoHistory(history).present.clipDocument).toEqual(project.clipDocument)
    expect(redoHistory(undoHistory(history)).present.clipDocument).toEqual(next.clipDocument)
  })

  it('uses the same middle and bottom insertion order before and after upgrading a legacy document', () => {
    const add = (project: CutProject) => addOverlayPaperTrack(addOverlayPaperTrack(project, { paperTrack: 'J', insertAfterPaperTrack: 'C' }).project, { paperTrack: 'K', snapIndex: 0 }).project
    const legacy = ensureClipDocument(add(createDefaultProject()))
    const current = add(ensureClipDocument(createDefaultProject()))
    expect(names(legacy)).toEqual(['I', 'H', 'G', 'F', 'E', 'D', 'J', 'C', 'B', 'A', 'K'])
    expect(names(current)).toEqual(names(legacy))
  })

  it('adds next to the mapped folder in an arbitrary hierarchy, preserving other siblings and user order', () => {
    let project = ensureClipDocument(createDefaultProject())
    const parent = createClipNode('テスト', 'folder', null, 'custom-parent')
    project = addClipLayers(project, [parent])
    const a = children(project).find(node => node.name === 'A')!, i = children(project).find(node => node.name === 'I')!
    project = moveClipLayer(project, i.id, parent.id)
    project = moveClipLayer(project, a.id, parent.id)
    const next = addOverlayPaperTrack(project, { paperTrack: 'J', insertAfterPaperTrack: 'I' }).project
    expect(clipChildren(next.clipDocument!, parent.id).map(node => node.name)).toEqual(['J', 'I', 'A'])
    expect(names(next)).toEqual(names(project))
  })

  it('keeps layer identities and material when sheet notation, display position or the column is removed', () => {
    const project = addOverlayPaperTrack(ensureClipDocument(createDefaultProject()), { paperTrack: 'J', insertAfterPaperTrack: 'I' }).project
    const renamed = updatePaperTrack(project, 'J', { paperTrack: 'K', label: 'K', viewPlacement: { snapIndex: 1 } })
    expect(renamed.clipDocument).toEqual(project.clipDocument)
    const removed = deleteOverlayPaperTrack(renamed, 'K')
    expect(removed.clipDocument!.nodes).toEqual(project.clipDocument!.nodes)
    expect(removed.clipDocument!.targets.every(target => removed.cspTrackSlots.some(slot => slot.slotId === target.slotId))).toBe(true)
  })

  it('inserts after another added column and moves only that column when its CSP stack placement changes', () => {
    const project = addOverlayPaperTrack(ensureClipDocument(createDefaultProject()), { paperTrack: 'J', insertAfterPaperTrack: 'I' }).project
    const k = addOverlayPaperTrack(project, { paperTrack: 'K', insertAfterPaperTrack: 'J' }).project
    const l = addOverlayPaperTrack(k, { paperTrack: 'L', insertAfterPaperTrack: 'J' }).project
    expect(names(l)).toEqual('KLJIHGFEDCBA'.split(''))
    expect(l.logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual('ABCDEFGHIJLK'.split(''))
    const moved = updatePaperTrack(l, 'L', { exportPlacement: { insertAfterPaperTrack: 'C', orderInGap: 0 } })
    expect(names(moved)).toEqual('KJIHGFEDLCBA'.split(''))
    expect(moved.clipDocument!.targets).toEqual(l.clipDocument!.targets)
    const folder = children(moved).find(node => node.name === 'L')!
    const manual = moveClipLayer(moved, folder.id, folder.parentId)
    const unchanged = updatePaperTrack(manual, 'L', { exportPlacement: { insertAfterPaperTrack: 'C', orderInGap: 0 }, viewPlacement: { snapIndex: 2 } })
    expect(unchanged.clipDocument).toEqual(manual.clipDocument)
  })

  it('does not regenerate deleted defaults or invent a parent for an unmapped imported group', () => {
    const project = ensureClipDocument(createDefaultProject())
    const other = project.correctionLayers[1].layerId
    const empty = { ...project, clipDocument: { ...project.clipDocument!,
      nodes: project.clipDocument!.nodes.filter(node => node.id !== `process:${other}` && node.parentId !== `process:${other}`),
      targets: project.clipDocument!.targets.filter(target => !project.cspTrackSlots.some(slot => slot.slotId === target.slotId && slot.correctionLayerId === other)),
    } }
    expect(ensureClipDocument(empty)).toBe(empty)
    const next = addOverlayPaperTrackAtCspTop(empty, { paperTrack: 'J' }).project
    const slot = next.cspTrackSlots.find(slot => slot.paperTrack === 'J' && slot.correctionLayerId === other)!
    expect(next.clipDocument!.targets.some(target => target.slotId === slot.slotId)).toBe(false)
    expect(next.clipDocument!.nodes.filter(node => node.parentId === null)).toEqual(empty.clipDocument.nodes.filter(node => node.parentId === null))
    expect(names(next)).toEqual('JIHGFEDCBA'.split(''))
  })
})
