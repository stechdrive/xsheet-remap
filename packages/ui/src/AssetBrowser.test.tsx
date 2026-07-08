import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { CutAsset } from '@xsheet-remap/core'
import { AssetTray } from './AssetBrowser'
import { uiText } from './i18n'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('AssetBrowser', () => {
  it('keeps the asset list scroll position while dragging an asset card out', () => {
    const asset: CutAsset = {
      assetId: 'asset_drag_scroll_1',
      originalFileName: 'DragScroll_A.png',
      displayName: 'DragScroll_A.png',
      role: 'cell-material',
      thumbnailUrl: 'blob:drag-scroll-a',
    }

    render(
      <AssetTray
        assetRoots={[]}
        assets={[asset]}
        registrationSummaries={new Map()}
        onAssets={vi.fn()}
        onAssetRefs={vi.fn()}
        onAssetRoots={vi.fn()}
        onEnsureAssetRef={vi.fn(() => null)}
      />,
    )

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
      originalFileName: 'QuickLook_A.png',
      displayName: 'QuickLook_A.png',
      role: 'cell-material',
      thumbnailUrl: 'blob:quicklook-a',
    }

    render(
      <AssetTray
        assetRoots={[]}
        assets={[asset]}
        registrationSummaries={new Map()}
        onAssets={vi.fn()}
        onAssetRefs={vi.fn()}
        onAssetRoots={vi.fn()}
        onEnsureAssetRef={vi.fn(() => null)}
      />,
    )

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
})
