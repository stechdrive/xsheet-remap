import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, registerAsset, upsertBinding } from '@xsheet-remap/core'
import { fileToFileRef } from '@xsheet-remap/adapters'
import { strFromU8, unzipSync } from 'fflate'
import { buildBrowserCspImportPackage, uniquePortableAssetPath } from './browserCspImportPackage'

const originalCreateObjectUrl = URL.createObjectURL

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl
})

describe('uniquePortableAssetPath', () => {
  it('removes path traversal and Windows-reserved filename characters', () => {
    expect(uniquePortableAssetPath('../A:01?.png', 'asset_1', new Set())).toBe('assets/__A_01_.png')
  })

  it('keeps case-insensitive paths unique', () => {
    const used = new Set<string>()
    expect(uniquePortableAssetPath('A1.png', 'asset_1', used)).toBe('assets/A1.png')
    expect(uniquePortableAssetPath('a1.png', 'asset_2', used)).toBe('assets/a1-asset_2.png')
  })

  it('bundles referenced browser materials beside a portable relative manifest', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:portable-a1')
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const fileRef = await fileToFileRef(new File(['image-bytes'], 'A_01.png', { type: 'image/png' }))
    const withAsset = registerAsset(created.project, fileRef)
    const project = upsertBinding(withAsset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: withAsset.asset.assetId,
    })
    const result = await buildBrowserCspImportPackage(createProjectDocumentFromCutProject(project), { appVersion: 'test' })
    const entries = unzipSync(result.archiveBytes)
    const manifest = JSON.parse(strFromU8(entries['xsheet-csp-import/csp-import.xci']!)) as {
      assetRoot: string
      cuts: Array<{ tracks: Array<{ cels: Array<{ material?: { path: string } }> }> }>
    }
    expect(manifest.assetRoot).toBe('..')
    expect(manifest.cuts[0]?.tracks[0]?.cels[0]?.material?.path).toBe('assets/A_01.png')
    expect(strFromU8(entries['assets/A_01.png']!)).toBe('image-bytes')
    expect(result.packageBuild.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('omits local-only material paths when the browser has no bytes for them', async () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const withAsset = registerAsset(created.project, {
      name: 'A_02.png',
      size: 1,
      lastModified: 1,
      path: 'D:\\private\\A_02.png',
    })
    const project = upsertBinding(withAsset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_02',
      materialState: 'assigned',
      assetId: withAsset.asset.assetId,
    })
    const result = await buildBrowserCspImportPackage(createProjectDocumentFromCutProject(project), { appVersion: 'test' })
    const cel = result.packageBuild.manifest.cuts[0]?.tracks[0]?.cels[0]
    expect(cel?.material).toBeUndefined()
    expect(JSON.stringify(result.packageBuild.manifest)).not.toContain('D:\\private')
    expect(result.packageBuild.issues.some(issue => issue.severity === 'warning')).toBe(true)
  })
})
