import { describe, expect, it } from 'vitest'
import { assetIdFromAssetTextDragData, assetTextDragData, collectAssetFilesFromDrop, compareFileNames, parseAssetIdsFromDragData } from './assetFiles'

describe('assetFiles', () => {
  it('uses a transferred File when WebKit exposes a missing entry path, without hiding other read failures', async () => {
    const file = new File(['pixels'], 'BOOK.png', { type: 'image/png' })
    const transfer = (name: string) => ({ items: [{ getAsFile: () => file, webkitGetAsEntry: () => ({ isFile: true, file: (_success: (file: File) => void, error: (reason: DOMException) => void) => error(new DOMException('entry error', name)) }) }], files: [file] }) as unknown as DataTransfer
    expect(await collectAssetFilesFromDrop(transfer('NotFoundError'))).toEqual([file])
    await expect(collectAssetFilesFromDrop(transfer('NotReadableError'))).rejects.toMatchObject({ name: 'NotReadableError' })
  })
  it('sorts sheet-like filenames in natural Windows-friendly order', () => {
    const files = [
      new File(['2'], '_133_sheet_e_2.jpg', { type: 'image/jpeg' }),
      new File(['1'], '_133_sheet_e.jpg', { type: 'image/jpeg' }),
      new File(['10'], 'A10.png', { type: 'image/png' }),
      new File(['2'], 'A2.png', { type: 'image/png' }),
    ].sort(compareFileNames)

    expect(files.map(file => file.name)).toEqual([
      '_133_sheet_e.jpg',
      '_133_sheet_e_2.jpg',
      'A2.png',
      'A10.png',
    ])
  })

  it('parses multi asset drag payloads while deduping ids', () => {
    expect(parseAssetIdsFromDragData(JSON.stringify(['asset_1', 'asset_2', 'asset_1']))).toEqual(['asset_1', 'asset_2'])
    expect(parseAssetIdsFromDragData('asset_legacy')).toEqual(['asset_legacy'])
    expect(parseAssetIdsFromDragData('')).toEqual([])
  })

  it('only accepts prefixed text payloads as asset drag ids', () => {
    expect(assetIdFromAssetTextDragData(assetTextDragData('asset_1'))).toBe('asset_1')
    expect(assetIdFromAssetTextDragData('C:\\cut\\A1.png')).toBe('')
    expect(assetIdFromAssetTextDragData('file:///C:/cut/A1.png')).toBe('')
    expect(assetIdFromAssetTextDragData('asset_1')).toBe('')
  })
})
