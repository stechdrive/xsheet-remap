import { describe, expect, it } from 'vitest'
import { addClipLayers, createClipNode, createDefaultProject, ensureClipDocument, moveClipLayer } from '@xsheet-remap/core'
import { clipLayerDropTarget, clipLayerFileDropAllowed } from './clipLayerDrop'

describe('layer palette destinations', () => {
  const folder = createClipNode('folder', 'folder', null, 'folder')
  const a = createClipNode('a', 'raster', folder.id, 'a'), b = createClipNode('b', 'raster', folder.id, 'b'), c = createClipNode('c', 'raster', folder.id, 'c')
  const tail = createClipNode('tail', 'folder', null, 'tail')
  const project = addClipLayers(ensureClipDocument(createDefaultProject()), [folder, a, b, c, tail])
  const document = project.clipDocument!
  it('distinguishes folder siblings from its contents and uses the next sibling, not the next descendant', () => {
    expect(clipLayerDropTarget(document, folder.id, .1)).toMatchObject({ placement: 'before', parentId: null, beforeId: folder.id })
    expect(clipLayerDropTarget(document, folder.id, .5)).toMatchObject({ placement: 'inside', parentId: folder.id, beforeId: undefined })
    expect(clipLayerDropTarget(document, folder.id, .9)).toMatchObject({ placement: 'after', parentId: null, beforeId: tail.id })
  })
  it('moves an existing layer to the shown boundary, excluding the moving sibling from the insertion anchor', () => {
    const destination = clipLayerDropTarget(document, a.id, .9, b.id)!
    expect(destination).toMatchObject({ placement: 'after', parentId: folder.id, beforeId: c.id })
    const next = moveClipLayer(project, c.id, folder.id, b.id)
    expect(next.clipDocument!.nodes.filter(node => node.parentId === folder.id).map(node => node.id)).toEqual(['a', 'c', 'b'])
  })
  it('supports root/last insertion and disallows files inside locked folders without blocking their siblings', () => {
    expect(clipLayerDropTarget(document, null, 0)?.parentId).toBeNull()
    expect(clipLayerDropTarget(document, null, 0)?.beforeId).toBeUndefined()
    expect(clipLayerDropTarget(document, c.id, .9)).toMatchObject({ parentId: folder.id, beforeId: undefined })
    const locked = { ...document, nodes: document.nodes.map(node => node.id === folder.id ? { ...node, locked: true } : node) }
    expect(clipLayerFileDropAllowed(locked, clipLayerDropTarget(locked, folder.id, .5)!)).toBe(false)
    expect(clipLayerFileDropAllowed(locked, clipLayerDropTarget(locked, folder.id, .1)!)).toBe(true)
  })
})
