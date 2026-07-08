import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  NULL_CELL_KEY_ID,
  registerAsset,
  setEvent,
  sheetTimingRoleForEvent,
  validateProject,
  type SheetHit,
} from '@xsheet-remap/core'
import { bindAssetToHit, cellAssetPreviewPosition } from './sheetAssets'

function cellHit(paperTrack: string, frame: number): SheetHit {
  return {
    regionId: 'test_cell_grid',
    role: 'cell',
    frame,
    rowIndex: frame - 1,
    columnIndex: 0,
    columnId: `cell_${paperTrack}`,
    label: paperTrack,
    paperTrack,
  }
}

describe('sheet asset binding', () => {
  it('reuses an existing key when the same material is dropped into the same process slot again', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'A3.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })

    const first = bindAssetToHit(registered.project, registered.asset, cellHit('A', 1), 'layer_sakuga')
    const second = bindAssetToHit(first.project, registered.asset, cellHit('A', 12), 'layer_sakuga')

    expect(second.project.logicalSheet.keys).toHaveLength(1)
    expect(second.project.bindings).toHaveLength(1)
    expect(second.project.logicalSheet.events.map(event => [event.frame, event.keyId, sheetTimingRoleForEvent(event)])).toEqual([
      [1, first.keyId, 'cell'],
      [12, first.keyId, 'cell'],
    ])
    expect(validateProject(second.project).some(issue => issue.code === 'binding.cspCellName.duplicateInSlot')).toBe(false)
  })

  it('keeps sheet text blank while using the material file name for asset-drop bindings', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'scan_007.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })

    const bound = bindAssetToHit(registered.project, registered.asset, cellHit('C', 1), 'layer_sakuga')
    const key = bound.project.logicalSheet.keys.find(item => item.keyId === bound.keyId)

    expect(key).toMatchObject({
      displayLabel: '',
      paperToken: '',
      createdFrom: 'asset-drop',
    })
    expect(bound.project.bindings).toEqual([expect.objectContaining({
      keyId: bound.keyId,
      cspCellName: 'scan_007',
      assetId: registered.asset.assetId,
    })])
  })

  it('allows the same material name to be registered on different paper tracks', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'A3.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })

    const a = bindAssetToHit(registered.project, registered.asset, cellHit('A', 1), 'layer_sakuga')
    const b = bindAssetToHit(a.project, registered.asset, cellHit('B', 5), 'layer_sakuga')

    expect(b.project.logicalSheet.keys).toHaveLength(2)
    expect(b.project.bindings.map(binding => [binding.slotId, binding.cspCellName, binding.assetId])).toEqual([
      ['slot_A', 'A3', registered.asset.assetId],
      ['slot_B', 'A3', registered.asset.assetId],
    ])
    expect(validateProject(b.project).some(issue => issue.severity === 'error')).toBe(false)
  })

  it('allows the same material name to be registered across process slots', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'A3.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })

    const sakuga = bindAssetToHit(registered.project, registered.asset, cellHit('A', 1), 'layer_sakuga')
    const enshutsu = bindAssetToHit(sakuga.project, registered.asset, cellHit('A', 18), 'layer_enshutsu')

    expect(enshutsu.project.bindings.map(binding => [binding.slotId, binding.cspCellName, binding.assetId])).toEqual([
      ['slot_A', 'A3', registered.asset.assetId],
      ['slot_enshutsu_A', 'A3', registered.asset.assetId],
    ])
    expect(validateProject(enshutsu.project).some(issue => issue.severity === 'error')).toBe(false)
  })

  it('reuses a multi-process key when the same material is dropped in the same paper track', () => {
    const sakugaAsset = registerAsset(createDefaultProject(), { name: 'A3.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const enshutsuAsset = registerAsset(sakugaAsset.project, { name: 'A3_e.jpg', size: 101, lastModified: 2 }, { role: 'cell-material' })

    const first = bindAssetToHit(enshutsuAsset.project, sakugaAsset.asset, cellHit('A', 1), 'layer_sakuga')
    const withEnshutsu = bindAssetToHit(first.project, enshutsuAsset.asset, cellHit('A', 1), 'layer_enshutsu')
    const reused = bindAssetToHit(withEnshutsu.project, sakugaAsset.asset, cellHit('A', 12), 'layer_sakuga')

    expect(reused.keyId).toBe(first.keyId)
    expect(reused.project.logicalSheet.keys).toHaveLength(1)
    expect(reused.project.bindings.map(binding => [binding.slotId, binding.keyId, binding.assetId])).toEqual([
      ['slot_A', first.keyId, sakugaAsset.asset.assetId],
      ['slot_enshutsu_A', first.keyId, enshutsuAsset.asset.assetId],
    ])
    expect(reused.project.logicalSheet.events.map(event => [event.frame, event.keyId, sheetTimingRoleForEvent(event)])).toEqual([
      [1, first.keyId, 'cell'],
      [12, first.keyId, 'cell'],
    ])
    expect(validateProject(reused.project).some(issue => issue.severity === 'error')).toBe(false)
  })

  it('replaces a reserved null-cell event with a normal material key when an asset is dropped', () => {
    const projectWithNull = setEvent(createDefaultProject(), 'A', 1, NULL_CELL_KEY_ID, 'cell')
    const registered = registerAsset(projectWithNull, { name: 'A3.jpg', size: 100, lastModified: 1 }, { role: 'cell-material' })

    const bound = bindAssetToHit(registered.project, registered.asset, cellHit('A', 1), 'layer_sakuga')

    expect(bound.keyId).not.toBe(NULL_CELL_KEY_ID)
    expect(bound.project.logicalSheet.keys).toHaveLength(1)
    expect(bound.project.logicalSheet.events).toEqual([expect.objectContaining({ frame: 1, keyId: bound.keyId })])
    expect(bound.project.bindings).toEqual([expect.objectContaining({ keyId: bound.keyId, cspCellName: 'A3', assetId: registered.asset.assetId })])
  })
})

describe('cell asset hover preview positioning', () => {
  function withViewport(width: number, height: number, run: () => void) {
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    try {
      run()
    } finally {
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth)
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight)
    }
  }

  it('uses compact width for a single material preview and grid width for multiple materials', () => {
    withViewport(1200, 900, () => {
      expect(cellAssetPreviewPosition({ x: 100, y: 100 }, 1)).toMatchObject({
        width: 154,
        visibleCount: 1,
      })
      expect(cellAssetPreviewPosition({ x: 100, y: 100 }, 6)).toMatchObject({
        width: 336,
        visibleCount: 6,
      })
    })
  })

  it('caps visible preview items when there are more bindings than fit in the hover panel', () => {
    withViewport(1200, 250, () => {
      const position = cellAssetPreviewPosition({ x: 100, y: 100 }, 9)

      expect(position.visibleCount).toBe(2)
      expect(position.maxHeight).toBe(226)
    })
  })
})
