import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, migrateProject, parseProjectDocument, type SheetSource } from './index'

describe('project native-path migration', () => {
  it('normalizes asset and sheet-image paths without changing web asset references', () => {
    const base = createDefaultProject()
    const migrated = migrateProject({
      ...base,
      assetRoot: { label: 'C001', path: '\\\\?\\C:\\cuts\\C001', handleKind: 'directory' },
      assets: [
        {
          assetId: 'asset_external',
          binId: 'asset_bin_root',
          originalFileName: 'A1.png',
          displayName: 'A1.png',
          role: 'cell-material',
          source: { kind: 'external-file', absolutePath: '\\\\?\\C:\\cuts\\C001\\A1.png' },
        },
        {
          assetId: 'asset_unresolved',
          binId: 'asset_bin_root',
          originalFileName: 'B1.png',
          displayName: 'B1.png',
          role: 'cell-material',
          source: { kind: 'unresolved', lastKnownPath: '\\\\?\\UNC\\server\\share\\B1.png' },
        },
      ],
      sheetView: {
        ...base.sheetView,
        sources: [{
          sourceId: 'sheet_source_1',
          kind: 'sheet-scan',
          imageRef: { name: 'sheet.png', path: '\\\\?\\C:\\cuts\\C001\\sheet.png', assetPath: 'templates/sheet.png' },
        } as unknown as SheetSource],
        pages: base.sheetView.pages.map((page, index) => index === 0 ? {
          ...page,
          sourceId: 'sheet_source_1',
          imageRef: { name: 'sheet.png', path: '\\\\?\\C:\\cuts\\C001\\sheet.png', assetPath: 'templates/sheet.png' },
        } : page),
      },
    })

    expect(migrated.assetRoot?.path).toBe('C:\\cuts\\C001')
    expect(migrated.assets[0]?.source).toEqual({ kind: 'external-file', absolutePath: 'C:\\cuts\\C001\\A1.png' })
    expect(migrated.assets[1]?.source).toEqual({ kind: 'unresolved', lastKnownPath: '\\\\server\\share\\B1.png' })
    expect(migrated.sheetView.sources[0]?.imageRef.path).toBe('C:\\cuts\\C001\\sheet.png')
    expect(migrated.sheetView.sources[0]?.imageRef.assetPath).toBe('templates/sheet.png')
  })

  it('normalizes paths while parsing an existing project document', () => {
    const document = createProjectDocumentFromCutProject(createDefaultProject())
    const parsed = parseProjectDocument({
      ...document,
      assetRoot: { label: 'C001', path: '\\\\?\\C:\\cuts\\C001', handleKind: 'directory' },
      assets: [{
        assetId: 'asset_external',
        binId: 'asset_bin_root',
        originalFileName: 'A1.png',
        displayName: 'A1.png',
        role: 'cell-material',
        source: { kind: 'external-file', absolutePath: '\\\\?\\C:\\cuts\\C001\\A1.png' },
      }],
    })

    expect(parsed.assetRoot?.path).toBe('C:\\cuts\\C001')
    expect(parsed.assets[0]?.source).toEqual({ kind: 'external-file', absolutePath: 'C:\\cuts\\C001\\A1.png' })
  })
})
