import { describe, expect, it } from 'vitest'
import { createDefaultProject, createOrSetEvent, synchronizeAssetRoot, upsertBinding } from './index'

describe('asset root reconnection', () => {
  it('reconnects a moved cut folder by relative path without changing asset or binding identity', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const first = synchronizeAssetRoot(created.project, {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [{
      name: 'A1.png',
      path: 'D:\\cuts\\C001\\LO\\A1.png',
      relativePath: 'LO/A1.png',
      size: 120,
      lastModified: 10,
      contentHash: 'sha256:before',
    }])
    const assetId = first.assetIds[0]!
    const bound = upsertBinding(first.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      materialState: 'assigned',
      assetId,
    })

    const reconnected = synchronizeAssetRoot(bound, {
      label: 'C001-copy',
      path: 'E:\\production\\C001',
    }, [{
      name: 'A1.png',
      path: 'E:\\production\\C001\\LO\\A1.png',
      relativePath: 'LO/A1.png',
      size: 140,
      lastModified: 20,
      contentHash: 'sha256:updated',
    }])

    expect(reconnected.project.assets).toHaveLength(1)
    expect(reconnected.assetIds).toEqual([assetId])
    expect(reconnected.project.assets[0]).toMatchObject({
      assetId,
      source: { kind: 'root-relative', relativePath: 'LO/A1.png' },
      fileSize: 140,
      contentHash: 'sha256:updated',
    })
    expect(reconnected.project.bindings.find(binding => binding.keyId === created.key.keyId)?.assetId).toBe(assetId)
  })

  it('reconnects a relocated and renamed material by content hash', () => {
    const first = synchronizeAssetRoot(createDefaultProject(), {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [{
      name: 'BG_old.png',
      path: 'D:\\cuts\\C001\\BG\\BG_old.png',
      relativePath: 'BG/BG_old.png',
      size: 500,
      lastModified: 10,
      contentHash: 'sha256:same-image',
    }])
    const assetId = first.assetIds[0]!

    const reconnected = synchronizeAssetRoot(first.project, {
      label: 'C001-moved',
      path: 'E:\\archive\\C001',
    }, [{
      name: 'BG_renamed.png',
      path: 'E:\\archive\\C001\\references\\BG_renamed.png',
      relativePath: 'references/BG_renamed.png',
      size: 500,
      lastModified: 30,
      contentHash: 'sha256:same-image',
    }])

    expect(reconnected.project.assets).toHaveLength(1)
    expect(reconnected.assetIds).toEqual([assetId])
    expect(reconnected.project.assets[0]).toMatchObject({
      assetId,
      originalFileName: 'BG_renamed.png',
      source: { kind: 'root-relative', relativePath: 'references/BG_renamed.png' },
    })
  })

  it('reconnects identical-content files one-to-one instead of collapsing distinct asset identities', () => {
    const first = synchronizeAssetRoot(createDefaultProject(), {
      label: 'C001',
      path: 'D:\\cuts\\C001',
    }, [
      { name: 'A1.png', path: 'D:\\cuts\\C001\\A1.png', relativePath: 'A1.png', contentHash: 'sha256:blank' },
      { name: 'A2.png', path: 'D:\\cuts\\C001\\A2.png', relativePath: 'A2.png', contentHash: 'sha256:blank' },
    ])

    const reconnected = synchronizeAssetRoot(first.project, {
      label: 'C001-moved',
      path: 'E:\\cuts\\C001',
    }, [
      { name: 'renamed-1.png', path: 'E:\\cuts\\C001\\refs\\renamed-1.png', relativePath: 'refs/renamed-1.png', contentHash: 'sha256:blank' },
      { name: 'renamed-2.png', path: 'E:\\cuts\\C001\\refs\\renamed-2.png', relativePath: 'refs/renamed-2.png', contentHash: 'sha256:blank' },
    ])

    expect(new Set(reconnected.assetIds)).toEqual(new Set(first.assetIds))
    expect(reconnected.project.assets).toHaveLength(2)
    expect(reconnected.project.assets.every(asset => asset.source.kind === 'root-relative')).toBe(true)
  })
})
