import { describe, expect, it } from 'vitest'
import { createDefaultProjectDocument } from '@xsheet-remap/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  decodeProjectFileBytes,
  encodeProjectArchive,
  isXsrProjectFileName,
  XSR_PROJECT_FILE_ACCEPT,
  XSR_PROJECT_MIME_TYPE,
} from './projectArchive'

const embeddedImage = 'data:image/png;base64,aGVsbG8='

describe('project archive codec', () => {
  it('deduplicates embedded data, compresses it as a blob, and restores it', async () => {
    const source = createDefaultProjectDocument()
    source.sheetTemplate = {
      ...source.sheetTemplate,
      defaultUnderlay: {
        ...source.sheetTemplate.defaultUnderlay!,
        assetPath: embeddedImage,
        imageRef: {
          ...source.sheetTemplate.defaultUnderlay!.imageRef,
          assetPath: embeddedImage,
        },
      },
    }
    source.assets = [{
      assetId: 'asset_1',
      binId: 'asset_bin_root',
      originalFileName: 'A.png',
      displayName: 'A.png',
      role: 'cell-material',
      source: { kind: 'external-file', absolutePath: 'D:/cut/A.png' },
      thumbnailUrl: 'asset://localhost/D:/cut/A.png',
    }]

    const bytes = await encodeProjectArchive(source, { createdWith: 'test' })
    const entries = unzipSync(bytes)
    const blobEntries = Object.keys(entries).filter(path => path.startsWith('blobs/'))
    const archivedJson = strFromU8(entries['project.json']!)
    expect(blobEntries).toHaveLength(1)
    expect(archivedJson).not.toContain('data:image/png')
    expect(archivedJson).not.toContain('thumbnailUrl')

    const restored = await decodeProjectFileBytes(bytes)
    expect(restored.manifest?.createdWith).toBe('test')
    expect(restored.document.sheetTemplate.defaultUnderlay?.assetPath).toBe(embeddedImage)
    expect(restored.document.sheetTemplate.defaultUnderlay?.imageRef.assetPath).toBe(embeddedImage)
    expect(restored.document.assets[0]?.thumbnailUrl).toBeUndefined()
  })

  it('detects corrupted embedded blobs', async () => {
    const source = createDefaultProjectDocument()
    source.sheetTemplate = {
      ...source.sheetTemplate,
      defaultUnderlay: {
        ...source.sheetTemplate.defaultUnderlay!,
        assetPath: embeddedImage,
        imageRef: { ...source.sheetTemplate.defaultUnderlay!.imageRef, assetPath: embeddedImage },
      },
    }
    const entries = unzipSync(await encodeProjectArchive(source))
    const blobPath = Object.keys(entries).find(path => path.startsWith('blobs/'))!
    entries[blobPath] = strToU8('corrupt')
    await expect(decodeProjectFileBytes(zipSync(entries))).rejects.toThrow(/サイズが一致|破損/)
  })

  it('can preserve browser asset previews as checked archive blobs', async () => {
    const source = createDefaultProjectDocument()
    source.assets = [{
      assetId: 'asset_browser',
      binId: 'asset_bin_root',
      originalFileName: 'A1.png',
      displayName: 'A1.png',
      role: 'cell-material',
      source: { kind: 'unresolved' },
      thumbnailUrl: embeddedImage,
    }]
    const bytes = await encodeProjectArchive(source, { includeAssetPreviews: true })
    const restored = await decodeProjectFileBytes(bytes)
    expect(restored.document.assets[0]?.thumbnailUrl).toBe(embeddedImage)
  })

  it('refuses archives that require an unsupported future feature', async () => {
    const entries = unzipSync(await encodeProjectArchive(createDefaultProjectDocument()))
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
      features: Record<string, number>
      requiredFeatures: string[]
    }
    manifest.features['future-camera-model'] = 3
    manifest.requiredFeatures.push('future-camera-model')
    entries['manifest.json'] = strToU8(JSON.stringify(manifest))
    await expect(decodeProjectFileBytes(zipSync(entries))).rejects.toThrow('対応していない必須プロジェクト機能')
  })

  it('rejects raw JSON as a project file', async () => {
    const source = createDefaultProjectDocument()
    await expect(decodeProjectFileBytes(strToU8(JSON.stringify(source)))).rejects.toThrow('JSONファイルはXSRプロジェクトとして開けません')
  })

  it('defines XSR as the only public project file type', () => {
    expect(XSR_PROJECT_FILE_ACCEPT).toBe(`.xsr,${XSR_PROJECT_MIME_TYPE}`)
    expect(isXsrProjectFileName('cut.xsr')).toBe(true)
    expect(isXsrProjectFileName('CUT.XSR')).toBe(true)
    expect(isXsrProjectFileName('cut.xsr.json')).toBe(false)
    expect(isXsrProjectFileName('cut.json')).toBe(false)
  })
})
