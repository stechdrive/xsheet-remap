import { describe, expect, it } from 'vitest'
import { addClipImages, addClipLayers, bindClipCel, clipEffectiveCel, createClipNode, deleteClipLayer, ensureClipDocument, moveClipLayer, setClipTarget, updateClipLayer } from './clip-document'
import { activeCutProjectFromDocument, createProjectDocumentFromCutProject, parseProjectDocument, updateActiveCutProjectInDocument } from './project-documents'
import { createDefaultProject } from './project-model'
import { commitHistory, createProjectHistory, redoHistory, undoHistory } from './project-commands'

function setup() {
  const project = ensureClipDocument(createDefaultProject()), target = project.clipDocument!.targets[0], slot = project.cspTrackSlots.find(item => item.slotId === target.slotId)!
  const node = createClipNode('001', 'raster', target.folderId)
  return { project: addClipLayers(project, [node]), node, target, slot }
}

describe('CLIP document identity and operations', () => {
  it('preserves media and label metadata through project persistence, and prevents media from becoming image cels', () => {
    const { project, target, slot } = setup()
    const folder = createClipNode('音声・動画', 'folder', null, 'media')
    const media = { ...createClipNode('音声001', 'audio', folder.id, 'audio'), sourceLayerId: 10, labelColor: '#ffaa82' }
    const next = addClipLayers(project, [folder, media, { ...createClipNode('動画001', 'video', folder.id, 'movie'), sourceLayerId: 11 }])
    const restored = activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(next)))))
    expect(restored.clipDocument!.nodes.find(node => node.id === media.id)).toEqual(media)
    expect(() => moveClipLayer(next, folder.id, target.folderId)).toThrow('音声・動画')
    expect(() => moveClipLayer(next, media.id, target.folderId)).toThrow('音声・動画')
    expect(() => bindClipCel(next, media.id, slot.paperTrack, 1, 'action', slot.correctionLayerId!)).toThrow('画像セル')
    expect(moveClipLayer(next, media.id, null).clipDocument!.nodes.find(node => node.id === media.id)?.parentId).toBe(null)
  })
  it('inserts several images at the shown sibling boundary in source order, atomically and without exposures', () => {
    const { project, node, target } = setup()
    const images = ['002', '003'].map(name => ({ name: `${name}.png`, assetId: name, imageDataUrl: `data:image/png;base64,${name}` }))
    const next = addClipImages(project, target.folderId, images, undefined, node.id)
    expect(next.clipDocument!.nodes.filter(item => item.parentId === target.folderId).map(item => item.name)).toEqual(['002', '003', '001'])
    expect(next.logicalSheet.events).toEqual(project.logicalSheet.events)
    expect(undoHistory(commitHistory(createProjectHistory(project), next)).present).toEqual(project)
    expect(() => addClipImages(project, null, images, undefined, node.id)).toThrow('挿入先')
    expect(() => addClipImages(project, target.folderId, [...images, images[0]], undefined, node.id)).toThrow('存在')
    expect(project.clipDocument!.nodes.filter(item => item.parentId === target.folderId)).toEqual([node])
  })
  it('migrates process visibility and keeps unused tray images in a normal folder', () => {
    const original = createDefaultProject()
    original.correctionLayers[0].defaultVisible = false
    original.assets.push({ assetId: 'unused', binId: 'root', displayName: 'BOOK.png', originalFileName: 'BOOK.png', role: 'cell-material', source: { kind: 'unresolved' } })
    const project = ensureClipDocument(original)
    expect(project.clipDocument!.nodes.find(node => node.id === `process:${original.correctionLayers[0].layerId}`)?.visible).toBe(false)
    const material = project.clipDocument!.nodes.find(node => node.assetId === 'unused')!
    expect(material.name).toBe('BOOK')
    expect(project.clipDocument!.nodes.find(node => node.id === material.parentId)?.kind).toBe('folder')
  })
  it('adds pixels and timing atomically using the explicit per-cel subfolder, and rejects multi-image sheet drops', () => {
    const { project, slot, target } = setup()
    const configured = setClipTarget(project, slot.slotId, target.folderId, ['作監'])
    const images = [{ name: '002.png', assetId: 'image', imageDataUrl: 'data:image/png;base64,AA==' }]
    const sheet = { paperTrack: slot.paperTrack, frame: 5, role: 'action' as const, processId: slot.correctionLayerId! }
    const next = addClipImages(configured, null, images, sheet)
    const cel = next.clipDocument!.nodes.find(node => node.parentId === target.folderId && node.name === '002')!
    const nested = next.clipDocument!.nodes.find(node => node.parentId === cel.id && node.name === '作監')!
    expect(cel.kind).toBe('folder')
    expect(next.clipDocument!.nodes.find(node => node.parentId === nested.id)?.imageDataUrl).toBe(images[0].imageDataUrl)
    expect(next.bindings[0].clipLayerId).toBe(cel.id)
    expect(next.logicalSheet.events[0].frame).toBe(5)
    expect(undoHistory(commitHistory(createProjectHistory(configured), next)).present).toEqual(configured)
    expect(() => addClipImages(configured, null, [...images, { ...images[0], name: '003.png' }], sheet)).toThrow('1枚ずつ')
  })
  it('preserves a static layer and unused cel through project conversion, parse and shared-cut projection', () => {
    const { project, node } = setup()
    const staticLayer = createClipNode('BG', 'raster', null)
    const next = addClipLayers(project, [staticLayer])
    const doc = parseProjectDocument(createProjectDocumentFromCutProject(next))
    expect(activeCutProjectFromDocument(doc).clipDocument?.nodes).toContainEqual(staticLayer)
    expect(updateActiveCutProjectInDocument(doc, next).clipDocument?.nodes).toContainEqual(node)
  })
  it('reuses the same cel at different frames and keeps sheet numbers independent of layer names', () => {
    const { project, node, slot } = setup()
    const first = bindClipCel(project, node.id, slot.paperTrack, 0, 'action', slot.correctionLayerId!)
    const next = bindClipCel(first, node.id, slot.paperTrack, 12, 'action', slot.correctionLayerId!)
    expect(next.clipDocument?.nodes).toHaveLength(project.clipDocument!.nodes.length)
    expect(next.bindings).toHaveLength(1)
    expect(next.logicalSheet.keys[0].displayLabel).toBe('1')
    expect(next.bindings[0].cspCellName).toBe('001')
    expect(next.logicalSheet.events.map(event => event.keyId)).toEqual([next.bindings[0].keyId, next.bindings[0].keyId])
    const history = commitHistory(createProjectHistory(project), next)
    expect(undoHistory(history).present.logicalSheet.events).toHaveLength(0)
    expect(redoHistory(undoHistory(history)).present).toBe(next)
  })
  it('rejects missing process targets instead of falling back, static material assignment, nested animation and cycles', () => {
    const { project, node, slot, target } = setup()
    expect(() => bindClipCel(project, node.id, slot.paperTrack, 0, 'action', 'missing')).toThrow('登録先')
    const staticLayer = createClipNode('BOOK', 'raster', null)
    expect(() => bindClipCel(addClipLayers(project, [staticLayer]), staticLayer.id, slot.paperTrack, 0, 'action', slot.correctionLayerId!)).toThrow('通常レイヤー')
    expect(() => addClipLayers(project, [createClipNode('B', 'animation', target.folderId)])).toThrow('入れ子')
    expect(() => moveClipLayer(project, target.folderId, target.folderId)).toThrow('親子関係')
  })
  it('retains imported duplicate names and resolves the bottom cel, but prevents new ambiguous cels', () => {
    const { project, node, target, slot } = setup()
    const duplicate = { ...node, id: 'duplicate' }
    const imported = { ...project, clipDocument: { ...project.clipDocument!, nodes: [...project.clipDocument!.nodes, duplicate] } }
    expect(clipEffectiveCel(imported.clipDocument, target.folderId, '001')?.id).toBe('duplicate')
    expect(() => bindClipCel(imported, node.id, slot.paperTrack, 0, 'action', slot.correctionLayerId!)).toThrow('同名')
    expect(() => addClipLayers(project, [duplicate])).toThrow('存在')
    expect(() => moveClipLayer(imported, duplicate.id, target.folderId, node.id)).toThrow('採用対象')
    expect(() => deleteClipLayer(imported, duplicate.id)).toThrow('採用対象')
    expect(updateClipLayer(imported, node.id, { opacity: 0.5 }).clipDocument!.nodes.find(item => item.id === node.id)?.opacity).toBe(0.5)
    expect(() => addClipLayers(project, [createClipNode('same', 'folder', null), createClipNode('same', 'folder', null)])).not.toThrow()
  })
  it('preserves children on move and removes mappings when the parent is deleted', () => {
    const { project, node, target, slot } = setup()
    const folder = createClipNode('素材', 'folder', null)
    const next = moveClipLayer(addClipLayers(project, [folder]), target.folderId, folder.id)
    expect(next.clipDocument!.nodes.find(item => item.id === node.id)?.parentId).toBe(target.folderId)
    expect(deleteClipLayer(next, folder.id).clipDocument!.targets.some(item => item.slotId === slot.slotId)).toBe(false)
    expect(() => setClipTarget(project, 'missing', target.folderId)).toThrow()
  })
})
