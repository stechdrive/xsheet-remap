import { describe, expect, it } from 'vitest'
import { assetIdFromAssetTextDragData, assetTextDragData, compareFileNames, parseAssetIdsFromDragData } from './assetFiles'

describe('assetFiles', () => {
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
