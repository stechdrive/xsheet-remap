import { describe, expect, it } from 'vitest'
import {
  buildCspLayerTree,
  createDefaultProject,
  createOrSetEvent,
  cspTopToBottomFromXdtsBottomToTop,
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

  it('projects registered cels in first-use order and preserves reversible track order', () => {
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

    expect(track?.cels.map(cel => [cel.cspCellName, cel.firstFrame])).toEqual([['A1', 0], ['A2', 11]])
    expect(tree.bottomToTopTrackNodeIds).toEqual([...tree.topToBottomTrackNodeIds].reverse())
  })
})
