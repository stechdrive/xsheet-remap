import { assignAssetToStackGuideLabel, createDefaultProject, createStackGuideLabel, registerAsset, type StackGuideLabel } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const previewMocks = vi.hoisted(() => ({
  updateIfOpen: vi.fn(async () => true),
}))

vi.mock('./assetPreviewModel', async importOriginal => {
  const actual = await importOriginal<typeof import('./assetPreviewModel')>()
  return {
    ...actual,
    updateNativeAssetPreviewPayloadIfOpen: previewMocks.updateIfOpen,
  }
})

import { updateNativeStackGuidePreviewIfOpen } from './registered-cells-model'

afterEach(() => {
  previewMocks.updateIfOpen.mockClear()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('stack guide material preview', () => {
  it('updates an open native preview for BG/BOOK, camera-note, and memo cards', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    let project = createDefaultProject()
    const labels: StackGuideLabel[] = []
    const cases: Array<{ label: string; kind: StackGuideLabel['kind']; gapIndex: number; assetName: string }> = [
      { label: 'BOOK_01', kind: 'background', gapIndex: 0, assetName: 'BOOK_01.png' },
      { label: 'SL_01', kind: 'camera-note', gapIndex: 9, assetName: 'SL_01.png' },
      { label: 'MEMO_01', kind: 'memo', gapIndex: 9, assetName: 'MEMO_01.png' },
    ]

    for (const entry of cases) {
      const created = createStackGuideLabel(project, {
        label: entry.label,
        kind: entry.kind,
        gapIndex: entry.gapIndex,
        correctionLayerId: 'layer_sakuga',
      })
      const registered = registerAsset(created.project, {
        name: entry.assetName,
        size: 100,
        lastModified: labels.length + 1,
      }, { role: 'cell-material' })
      project = assignAssetToStackGuideLabel({
        ...registered.project,
        assets: registered.project.assets.map(asset => asset.assetId === registered.asset.assetId
          ? { ...asset, thumbnailUrl: `blob:${entry.assetName}` }
          : asset),
      }, created.label.labelId, registered.asset.assetId, 'layer_sakuga')
      labels.push(project.stackGuideLabels.find(label => label.labelId === created.label.labelId)!)
    }

    for (const label of labels) {
      await expect(updateNativeStackGuidePreviewIfOpen(project, label)).resolves.toBe(true)
    }

    expect(previewMocks.updateIfOpen).toHaveBeenCalledTimes(3)
    for (const [index, entry] of cases.entries()) {
      expect(previewMocks.updateIfOpen).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        displayName: entry.label,
        imageUrl: `blob:${entry.assetName}`,
        items: [expect.objectContaining({ imageUrl: `blob:${entry.assetName}` })],
      }))
    }
  })
})
