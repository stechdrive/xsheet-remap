import type { CutAsset } from '@xsheet-remap/core'
import { isTauriHost } from '@xsheet-remap/adapters'
import { clampNumber } from './sheetInteraction'

export type AssetPreviewRect = {
  left: number
  top: number
  width: number
  height: number
}

export type AssetPreviewPayload = {
  displayName: string
  imageUrl?: string
  detailText?: string
  items?: AssetPreviewItemPayload[]
}

export type AssetPreviewItemPayload = {
  label: string
  imageUrl?: string
  detailText?: string
  processLabel?: string
}

export const ASSET_PREVIEW_UPDATE_EVENT = 'asset-preview:update'
export const ASSET_PREVIEW_REFRESH_EVENT = 'asset-preview:refresh'

const ASSET_PREVIEW_RECT_STORAGE_KEY = 'xsheet-remap.asset-preview.rect'
const ASSET_PREVIEW_PAYLOAD_STORAGE_KEY = 'xsheet-remap.asset-preview.payload'
const ASSET_PREVIEW_MIN_WIDTH = 320
const ASSET_PREVIEW_MIN_HEIGHT = 240
const ASSET_PREVIEW_VIEWPORT_INSET = 12

export async function openNativeAssetPreview(asset: CutAsset): Promise<boolean> {
  const payload = await nativeAssetPreviewPayload(asset)
  if (!payload) return false
  return openNativeAssetPreviewPayload(payload)
}

export async function openNativeAssetPreviewPayload(payload: AssetPreviewPayload): Promise<boolean> {
  try {
    window.localStorage.setItem(ASSET_PREVIEW_PAYLOAD_STORAGE_KEY, JSON.stringify(payload))
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_asset_preview_window', { payload })
    return true
  } catch (error) {
    console.warn('Failed to open native asset preview window.', error)
    return false
  }
}

export async function updateNativeAssetPreviewIfOpen(asset: CutAsset): Promise<boolean> {
  const payload = await nativeAssetPreviewPayload(asset)
  return payload ? updateNativeAssetPreviewPayloadIfOpen(payload) : false
}

export async function updateNativeAssetPreviewPayloadIfOpen(payload: AssetPreviewPayload): Promise<boolean> {
  if (!isTauriHost()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const updated = await invoke<boolean>('update_asset_preview_window_if_open', { payload })
    if (updated) {
      window.localStorage.setItem(ASSET_PREVIEW_PAYLOAD_STORAGE_KEY, JSON.stringify(payload))
    }
    return updated
  } catch (error) {
    console.warn('Failed to update native asset preview window.', error)
    return false
  }
}

export async function nativeAssetPreviewPayload(asset: CutAsset): Promise<AssetPreviewPayload | null> {
  if (!isTauriHost()) return null
  const item = await nativeAssetPreviewItemPayload(asset)
  if (!item) return null
  return {
    displayName: asset.displayName,
    imageUrl: item.imageUrl,
    detailText: item.detailText,
    items: [item],
  }
}

export async function nativeAssetPreviewItemPayload(
  asset: CutAsset,
  options: { label?: string; processLabel?: string } = {},
): Promise<AssetPreviewItemPayload | null> {
  if (!isTauriHost()) return null
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const imageUrl = asset.currentPath ? convertFileSrc(asset.currentPath) : asset.thumbnailUrl
    if (!imageUrl && !asset.currentPath) return null
    return {
      label: options.label ?? asset.displayName,
      imageUrl,
      detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
      processLabel: options.processLabel,
    }
  } catch {
    if (!asset.thumbnailUrl) return null
    return {
      label: options.label ?? asset.displayName,
      imageUrl: asset.thumbnailUrl,
      detailText: asset.relativePath ?? asset.currentPath ?? asset.displayName,
      processLabel: options.processLabel,
    }
  }
}

export function embeddedAssetPreviewPayload(asset: CutAsset): AssetPreviewPayload {
  const detailText = asset.relativePath ?? asset.currentPath
  return {
    displayName: asset.displayName,
    imageUrl: asset.thumbnailUrl,
    detailText,
    items: [{
      label: asset.displayName,
      imageUrl: asset.thumbnailUrl,
      detailText,
    }],
  }
}

export function initialAssetPreviewRect(): AssetPreviewRect {
  return clampAssetPreviewRect(readAssetPreviewRect() ?? defaultAssetPreviewRect())
}

export function writeAssetPreviewRect(rect: AssetPreviewRect) {
  try {
    window.localStorage.setItem(ASSET_PREVIEW_RECT_STORAGE_KEY, JSON.stringify(rect))
  } catch {
    // Local storage is only a convenience for the floating preview position.
  }
}

export function clampAssetPreviewRect(rect: AssetPreviewRect): AssetPreviewRect {
  const viewportWidth = window.innerWidth || 1280
  const viewportHeight = window.innerHeight || 760
  const maxWidth = Math.max(ASSET_PREVIEW_MIN_WIDTH, viewportWidth - ASSET_PREVIEW_VIEWPORT_INSET * 2)
  const maxHeight = Math.max(ASSET_PREVIEW_MIN_HEIGHT, viewportHeight - ASSET_PREVIEW_VIEWPORT_INSET * 2)
  const width = clampNumber(rect.width, ASSET_PREVIEW_MIN_WIDTH, maxWidth)
  const height = clampNumber(rect.height, ASSET_PREVIEW_MIN_HEIGHT, maxHeight)
  return {
    left: clampNumber(rect.left, ASSET_PREVIEW_VIEWPORT_INSET, Math.max(ASSET_PREVIEW_VIEWPORT_INSET, viewportWidth - width - ASSET_PREVIEW_VIEWPORT_INSET)),
    top: clampNumber(rect.top, ASSET_PREVIEW_VIEWPORT_INSET, Math.max(ASSET_PREVIEW_VIEWPORT_INSET, viewportHeight - height - ASSET_PREVIEW_VIEWPORT_INSET)),
    width,
    height,
  }
}

export function readStoredAssetPreviewPayload(): AssetPreviewPayload | null {
  try {
    const raw = window.localStorage.getItem(ASSET_PREVIEW_PAYLOAD_STORAGE_KEY)
    if (!raw) return null
    return assetPreviewPayloadFromUnknown(JSON.parse(raw))
  } catch {
    return null
  }
}

export function assetPreviewPayloadFromUnknown(value: unknown): AssetPreviewPayload | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<AssetPreviewPayload>
  if (typeof input.displayName !== 'string') return null
  return {
    displayName: input.displayName,
    imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl : undefined,
    detailText: typeof input.detailText === 'string' ? input.detailText : undefined,
    items: Array.isArray(input.items)
      ? input.items.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const previewItem = item as Partial<AssetPreviewItemPayload>
        if (typeof previewItem.label !== 'string') return []
        return [{
          label: previewItem.label,
          imageUrl: typeof previewItem.imageUrl === 'string' ? previewItem.imageUrl : undefined,
          detailText: typeof previewItem.detailText === 'string' ? previewItem.detailText : undefined,
          processLabel: typeof previewItem.processLabel === 'string' ? previewItem.processLabel : undefined,
        }]
      })
      : undefined,
  }
}

export function assetPreviewItems(payload: AssetPreviewPayload | null): AssetPreviewItemPayload[] {
  if (!payload) return []
  if (payload.items?.length) return payload.items
  if (payload.imageUrl || payload.detailText) {
    return [{
      label: payload.displayName,
      imageUrl: payload.imageUrl,
      detailText: payload.detailText,
    }]
  }
  return []
}

export function assetPreviewSingleDetail(payload: AssetPreviewPayload | null): string | undefined {
  const items = assetPreviewItems(payload)
  if (items.length !== 1) return undefined
  return items[0].detailText ?? payload?.detailText
}

function defaultAssetPreviewRect(): AssetPreviewRect {
  const viewportWidth = window.innerWidth || 1280
  const viewportHeight = window.innerHeight || 760
  const width = clampNumber(Math.round(viewportWidth * 0.38), ASSET_PREVIEW_MIN_WIDTH, 620)
  const height = clampNumber(Math.round(viewportHeight * 0.48), ASSET_PREVIEW_MIN_HEIGHT, 520)
  return {
    left: Math.max(ASSET_PREVIEW_VIEWPORT_INSET, Math.round((viewportWidth - width) / 2)),
    top: Math.max(ASSET_PREVIEW_VIEWPORT_INSET, Math.round((viewportHeight - height) / 2)),
    width,
    height,
  }
}

function readAssetPreviewRect(): AssetPreviewRect | null {
  try {
    const raw = window.localStorage.getItem(ASSET_PREVIEW_RECT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AssetPreviewRect>
    if (
      typeof parsed.left !== 'number'
      || typeof parsed.top !== 'number'
      || typeof parsed.width !== 'number'
      || typeof parsed.height !== 'number'
    ) {
      return null
    }
    return {
      left: parsed.left,
      top: parsed.top,
      width: parsed.width,
      height: parsed.height,
    }
  } catch {
    return null
  }
}
