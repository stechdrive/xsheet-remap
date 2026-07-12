import { describe, expect, it } from 'vitest'
import { createDefaultProject, createKey, registerAsset, registerAssetsToCspTrack, setEvent, upsertBinding, type SheetHit } from '@xsheet-remap/core'
import { assignRegisteredCellKeyToHit } from './sheet-layers-process'

const actionAFrame = (frame: number): SheetHit => ({
  regionId: 'action',
  role: 'action',
  frame,
  rowIndex: frame - 1,
  columnIndex: 0,
  columnId: 'action_A',
  label: 'A',
  paperTrack: 'A',
})

const cellAFrame = (frame: number): SheetHit => ({
  regionId: 'cell',
  role: 'cell',
  frame,
  rowIndex: frame - 1,
  columnIndex: 0,
  columnId: 'cell_A',
  label: 'A',
  paperTrack: 'A',
})

describe('CSP process card timing assignment', () => {
  it('links an unplaced process card to the logical cell already present at the drop frame', () => {
    const logicalA1 = createKey(createDefaultProject(), 'A', '1', 'manual', '1', 'action')
    let project = setEvent(logicalA1.project, 'A', 1, logicalA1.key.keyId, 'action')
    project = upsertBinding(project, {
      slotId: 'slot_A',
      keyId: logicalA1.key.keyId,
      cspCellName: 'A1',
      materialState: 'missing-ok',
    })
    const correctionAsset = registerAsset(project, { name: 'scan_0042.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const registered = registerAssetsToCspTrack(correctionAsset.project, {
      slotId: 'slot_enshutsu_A',
      assetIds: [correctionAsset.asset.assetId],
      sheetRole: 'action',
    })
    const unlinkedKeyId = registered.addedKeyIds[0]!

    expect(registered.project.logicalSheet.keys.find(key => key.keyId === unlinkedKeyId)?.displayLabel).toBe('')
    const provisionalBinding = registered.project.bindings.find(binding => binding.keyId === unlinkedKeyId)!
    expect(provisionalBinding.cspCellName).toBe('scan_0042')
    const renamed = upsertBinding(registered.project, {
      ...provisionalBinding,
      cspCellName: 'A1_e',
    })

    const linked = assignRegisteredCellKeyToHit(renamed, unlinkedKeyId, actionAFrame(1))

    expect(linked.keyId).toBe(logicalA1.key.keyId)
    expect(linked.project.logicalSheet.keys.map(key => [key.keyId, key.displayLabel])).toEqual([[logicalA1.key.keyId, '1']])
    expect(linked.project.logicalSheet.events.map(event => [event.frame, event.keyId])).toEqual([[1, logicalA1.key.keyId]])
    expect(linked.project.bindings.map(binding => [binding.slotId, binding.keyId, binding.cspCellName])).toEqual([
      ['slot_A', logicalA1.key.keyId, 'A1'],
      ['slot_enshutsu_A', logicalA1.key.keyId, 'A1_e'],
    ])

    const reused = assignRegisteredCellKeyToHit(linked.project, logicalA1.key.keyId, actionAFrame(24))
    expect(reused.project.logicalSheet.events.map(event => [event.frame, event.keyId])).toEqual([
      [1, logicalA1.key.keyId],
      [24, logicalA1.key.keyId],
    ])
  })

  it('keeps an unplaced card unnamed when it is first placed on an empty frame', () => {
    const asset = registerAsset(createDefaultProject(), { name: 'unorganized-scan.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const registered = registerAssetsToCspTrack(asset.project, {
      slotId: 'slot_enshutsu_A',
      assetIds: [asset.asset.assetId],
      sheetRole: 'action',
    })
    const keyId = registered.addedKeyIds[0]!

    const placed = assignRegisteredCellKeyToHit(registered.project, keyId, actionAFrame(24))

    expect(placed.keyId).toBe(keyId)
    expect(placed.project.logicalSheet.keys.find(key => key.keyId === keyId)?.displayLabel).toBe('')
    expect(placed.project.logicalSheet.events).toEqual([
      expect.objectContaining({ frame: 24, keyId }),
    ])
  })

  it('keeps a new asset card role-neutral until its first sheet drop', () => {
    const asset = registerAsset(createDefaultProject(), { name: 'A1_scan.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const registered = registerAssetsToCspTrack(asset.project, {
      slotId: 'slot_enshutsu_A',
      assetIds: [asset.asset.assetId],
    })
    const keyId = registered.addedKeyIds[0]!

    expect(registered.project.logicalSheet.keys.find(key => key.keyId === keyId)?.sheetRole).toBeUndefined()

    const placed = assignRegisteredCellKeyToHit(registered.project, keyId, cellAFrame(12))

    expect(placed.project.logicalSheet.keys.find(key => key.keyId === keyId)?.sheetRole).toBe('cell')
    expect(placed.project.logicalSheet.events).toEqual([
      expect.objectContaining({ frame: 12, keyId, sheetRole: 'cell' }),
    ])
    expect(placed.project.bindings.find(binding => binding.keyId === keyId)).toMatchObject({
      slotId: 'slot_enshutsu_A',
      assetId: asset.asset.assetId,
      cspCellName: 'A1_scan',
    })
  })
})
