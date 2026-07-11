import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack,
  buildCspLayerTree,
  createDefaultProject,
  createOrSetEvent,
  cspTopToBottomFromXdtsBottomToTop,
  registerAsset,
  registerAssetsToCspTrack,
  upsertBinding,
  xdtsBottomToTopFromCspTopToBottom,
} from './index'

describe('CSP layer tree', () => {
  it('defines the CSP visual order as the reverse of XDTS storage order', () => {
    expect(cspTopToBottomFromXdtsBottomToTop(['bottom', 'middle', 'top']))
      .toEqual(['top', 'middle', 'bottom'])
    expect(xdtsBottomToTopFromCspTopToBottom(['top', 'middle', 'bottom']))
      .toEqual(['bottom', 'middle', 'top'])
  })

  it('projects first-use cel order from CSP palette top to bottom and preserves reversible track order', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 12, 'action')
    let project = upsertBinding(second.project, {
      slotId: 'slot_A',
      keyId: first.key.keyId,
      cspCellName: 'A1',
      materialState: 'assigned',
      assetId: 'asset_A1',
    })
    project = upsertBinding(project, {
      slotId: 'slot_A',
      keyId: second.key.keyId,
      cspCellName: 'A2',
      materialState: 'missing-ok',
    })

    const tree = buildCspLayerTree(project, 'import-stack')
    const track = tree.stages.flatMap(stage => stage.layers).flatMap(layer => layer.tracks)
      .find(item => item.slotId === 'slot_A')

    expect(track?.cels.map(cel => [cel.cspCellName, cel.firstFrame])).toEqual([['A2', 11], ['A1', 0]])
    expect(tree.bottomToTopTrackNodeIds).toEqual([...tree.topToBottomTrackNodeIds].reverse())
  })

  it('keeps configured correction layers and explicit empty overlay tracks without exposing unused template tracks', () => {
    const project = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'LO',
      label: 'LO',
      insertAfterPaperTrack: 'A',
      snapIndex: 2,
    }).project

    const tree = buildCspLayerTree(project, 'import-stack')
    const layers = tree.stages.flatMap(stage => stage.layers)
    const tracks = layers.flatMap(layer => layer.tracks)

    expect(layers.map(layer => layer.layerId)).toEqual(expect.arrayContaining(project.correctionLayers.map(layer => layer.layerId)))
    expect(tracks.find(track => track.paperTrack === 'LO')).toMatchObject({ label: 'LO', cels: [] })
    expect(tracks.some(track => track.paperTrack === 'A')).toBe(false)
  })

  it('projects registered cards before they are placed on the timeline', () => {
    const firstAsset = registerAsset(createDefaultProject(), { name: 'A1.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const secondAsset = registerAsset(firstAsset.project, { name: 'A2.png', size: 101, lastModified: 2 }, { role: 'cell-material' })
    const registered = registerAssetsToCspTrack(secondAsset.project, {
      slotId: 'slot_A',
      assetIds: [firstAsset.asset.assetId, secondAsset.asset.assetId],
    })

    const track = buildCspLayerTree(registered.project, 'import-stack')
      .stages.flatMap(stage => stage.layers)
      .flatMap(layer => layer.tracks)
      .find(item => item.slotId === 'slot_A')

    expect(track?.cels.map(cel => [cel.cspCellName, cel.firstFrame, cel.assetId])).toEqual([
      ['A2', undefined, secondAsset.asset.assetId],
      ['A1', undefined, firstAsset.asset.assetId],
    ])
  })
})
