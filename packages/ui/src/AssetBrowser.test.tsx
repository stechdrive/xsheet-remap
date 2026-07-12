import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AssetRoot, CutAsset } from '@xsheet-remap/core'
import { AssetTray } from './AssetBrowser'
import { uiText } from './i18n'
import { subscribeInternalDrag, type InternalDragPayload } from './internalDrag'

const adapterMocks = vi.hoisted(() => ({
  tauriHost: false,
  listAssetDirectory: vi.fn(),
}))

vi.mock('@xsheet-remap/adapters', async () => {
  const actual = await vi.importActual<typeof import('@xsheet-remap/adapters')>('@xsheet-remap/adapters')
  return {
    ...actual,
    isTauriHost: () => adapterMocks.tauriHost,
    listAssetDirectory: adapterMocks.listAssetDirectory,
  }
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  adapterMocks.tauriHost = false
  adapterMocks.listAssetDirectory.mockReset()
  vi.restoreAllMocks()
})

describe('AssetBrowser', () => {
  it('keeps the asset list scroll position while dragging an asset card out', () => {
    const asset: CutAsset = {
      assetId: 'asset_drag_scroll_1',
      binId: 'asset_bin_root',
      originalFileName: 'DragScroll_A.png',
      displayName: 'DragScroll_A.png',
      role: 'cell-material',
      source: { kind: 'unresolved' },
      thumbnailUrl: 'blob:drag-scroll-a',
    }

    render(
      <AssetTray
        assets={[asset]}
        registrationSummaries={new Map()}
        onAssets={vi.fn()}
        onAssetRoots={vi.fn()}
        onEnsureAssetRefs={vi.fn(() => [])}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: uiText.assets.sourceView.project }))

    const card = screen.getByText('DragScroll_A.png').closest('.assetCard')
    const items = document.querySelector('.assetBrowserItems')
    if (!(card instanceof HTMLElement)) throw new Error('asset card not found')
    if (!(items instanceof HTMLElement)) throw new Error('asset browser items not found')

    items.scrollTop = 120
    fireEvent.pointerDown(card, { pointerId: 5, pointerType: 'mouse', button: 0, buttons: 1, clientX: 24, clientY: 24 })
    fireEvent.pointerMove(window, { pointerId: 5, pointerType: 'mouse', buttons: 1, clientX: 34, clientY: 24 })

    items.scrollTop = 12
    fireEvent.pointerMove(window, { pointerId: 5, pointerType: 'mouse', buttons: 1, clientX: 42, clientY: 28 })
    expect(items.scrollTop).toBe(120)

    items.scrollTop = 8
    fireEvent.pointerUp(window, { pointerId: 5, pointerType: 'mouse', button: 0, buttons: 0, clientX: 42, clientY: 28 })
    expect(items.scrollTop).toBe(120)
  })

  it('opens quick preview directly when the magnifier button is clicked on an unselected asset', async () => {
    const asset: CutAsset = {
      assetId: 'asset_quicklook_1',
      binId: 'asset_bin_root',
      originalFileName: 'QuickLook_A.png',
      displayName: 'QuickLook_A.png',
      role: 'cell-material',
      source: { kind: 'unresolved' },
      thumbnailUrl: 'blob:quicklook-a',
    }

    render(
      <AssetTray
        assets={[asset]}
        registrationSummaries={new Map()}
        onAssets={vi.fn()}
        onAssetRoots={vi.fn()}
        onEnsureAssetRefs={vi.fn(() => [])}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: uiText.assets.sourceView.project }))

    const card = screen.getByText('QuickLook_A.png').closest('.assetCard')
    if (!(card instanceof HTMLElement)) throw new Error('asset card not found')
    expect(card.classList.contains('selected')).toBe(false)

    const previewButton = within(card).getByRole('button', { name: uiText.assets.quickPreview })
    fireEvent.pointerDown(previewButton, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 })
    expect(card.classList.contains('selected')).toBe(false)

    fireEvent.click(previewButton)

    const preview = await screen.findByRole('dialog', { name: uiText.assets.previewDialog('QuickLook_A.png') })
    expect(card.classList.contains('selected')).toBe(true)
    expect(preview.querySelector('img')?.getAttribute('src')).toBe('blob:quicklook-a')
  })

  it('selects unregistered directory files with Ctrl and Shift and resolves the selection when dragging', async () => {
    adapterMocks.tauriHost = true
    adapterMocks.listAssetDirectory.mockResolvedValue({
      rootPath: 'C:\\materials',
      currentPath: 'C:\\materials',
      entries: ['A1.png', 'A2.png', 'A3.png'].map((name, index) => ({
        name,
        path: `C:\\materials\\${name}`,
        relativePath: name,
        kind: 'file' as const,
        isSupportedImage: true,
        size: index + 1,
        lastModified: index + 1,
        objectUrl: `asset://${name}`,
      })),
    })
    const root: AssetRoot = {
      label: 'materials',
      path: 'C:\\materials',
      handleKind: 'directory',
    }
    const onEnsureAssetRefs = vi.fn((refs: Array<{ name: string }>) => refs.map(ref => `asset_${ref.name.replace('.png', '')}`))

    render(
      <AssetTray
        assetRoot={root}
        assets={[]}
        registrationSummaries={new Map()}
        onAssets={vi.fn()}
        onAssetRoots={vi.fn()}
        onEnsureAssetRefs={onEnsureAssetRefs}
      />,
    )

    const card = async (name: string) => {
      const element = (await screen.findByText(name)).closest<HTMLElement>('.assetCard')
      if (!element) throw new Error(`asset card not found: ${name}`)
      return element
    }
    const a1 = await card('A1.png')
    const a2 = await card('A2.png')
    const a3 = await card('A3.png')

    fireEvent.click(a1)
    fireEvent.click(a3, { ctrlKey: true })
    expect(a1.getAttribute('aria-selected')).toBe('true')
    expect(a2.getAttribute('aria-selected')).toBe('false')
    expect(a3.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('2件選択')).toBeTruthy()

    fireEvent.click(a3, { ctrlKey: true })
    expect(a3.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: uiText.assets.clearSelection }))
    fireEvent.click(a1)
    fireEvent.click(a3, { shiftKey: true })
    expect([a1, a2, a3].every(item => item.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(screen.getByText('3件選択')).toBeTruthy()
    expect(onEnsureAssetRefs).not.toHaveBeenCalled()

    const droppedPayloads: InternalDragPayload[] = []
    const unsubscribe = subscribeInternalDrag(detail => {
      if (detail.phase === 'drop') droppedPayloads.push(detail.payload)
    })
    fireEvent.pointerDown(a2, { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 12, pointerType: 'mouse', buttons: 1, clientX: 30, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 0, clientX: 40, clientY: 20 })
    unsubscribe()

    expect(onEnsureAssetRefs).toHaveBeenCalledTimes(1)
    expect(onEnsureAssetRefs.mock.calls[0]?.[0].map(ref => ref.name)).toEqual(['A1.png', 'A2.png', 'A3.png'])
    expect(droppedPayloads).toEqual([{
      kind: 'asset',
      assetIds: ['asset_A1', 'asset_A2', 'asset_A3'],
    }])
  })
})
