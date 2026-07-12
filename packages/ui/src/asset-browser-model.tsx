import type { AssetRoot, CutAsset, FileRef } from '@xsheet-remap/core'
import { type AssetDirectoryEntry } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { dedupeStringList } from './assetFiles'
import { type AssetPreviewPayload } from './assetPreviewModel'
import type { AssetSelectionIntent } from './asset-browser-types'

const ASSET_SELECTION_PREFIX = 'asset:'
const DIRECTORY_ENTRY_SELECTION_PREFIX = 'entry:'

export function assetSelectionKey(assetId: string): string {
  return `${ASSET_SELECTION_PREFIX}${assetId}`
}

export function assetIdFromSelectionKey(selectionKey: string): string | null {
  return selectionKey.startsWith(ASSET_SELECTION_PREFIX)
    ? selectionKey.slice(ASSET_SELECTION_PREFIX.length) || null
    : null
}

export function directoryEntrySelectionKey(entry: Pick<AssetDirectoryEntry, 'path'>): string {
  return `${DIRECTORY_ENTRY_SELECTION_PREFIX}${entry.path.replace(/\\/g, '/').toLocaleLowerCase()}`
}

export function assetSelectionFromIntent(
  currentAssetIds: string[],
  sortedAssetIds: string[],
  anchorAssetId: string | null,
  targetAssetId: string,
  intent: AssetSelectionIntent,
): { assetIds: string[]; anchorAssetId: string } {
  const isToggle = Boolean(intent.ctrlKey || intent.metaKey)
  if (intent.shiftKey && anchorAssetId && sortedAssetIds.includes(anchorAssetId)) {
    const rangeAssetIds = assetRange(sortedAssetIds, anchorAssetId, targetAssetId)
    if (isToggle) return { assetIds: dedupeStringList([...currentAssetIds, ...rangeAssetIds]), anchorAssetId }
    return { assetIds: rangeAssetIds, anchorAssetId }
  }
  if (isToggle) {
    const assetIds = currentAssetIds.includes(targetAssetId)
      ? currentAssetIds.filter(assetId => assetId !== targetAssetId)
      : [...currentAssetIds, targetAssetId]
    return { assetIds, anchorAssetId: targetAssetId }
  }
  return { assetIds: [targetAssetId], anchorAssetId: targetAssetId }
}

export function assetForDirectoryEntry(entry: AssetDirectoryEntry, root: AssetRoot | null, assetsByRootRelativePath: Map<string, CutAsset>): CutAsset | null {
  if (entry.kind !== 'file' || !root) return null
  return assetsByRootRelativePath.get(assetDirectoryAssetKey(entry.relativePath)) ?? null
}

export function assetDirectoryAssetKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').toLocaleLowerCase()
}

export function assetContextMenuStyle(x: number, y: number): { left: number; top: number } {
  const width = 220
  const height = 40
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  }
}

export function fileRefFromDirectoryEntry(entry: AssetDirectoryEntry, root: AssetRoot | null): FileRef | null {
  if (entry.kind !== 'file' || !entry.isSupportedImage) return null
  return {
    name: entry.name,
    size: entry.size,
    lastModified: entry.lastModified,
    path: entry.path,
    rootPath: root?.path,
    relativePath: entry.relativePath,
    objectUrl: entry.objectUrl,
  }
}

export function previewPayloadForDirectoryEntry(entry: AssetDirectoryEntry): AssetPreviewPayload | null {
  if (entry.kind !== 'file' || !entry.isSupportedImage) return null
  const detailText = entry.relativePath || entry.path
  return {
    displayName: entry.name,
    imageUrl: entry.objectUrl,
    detailText,
    items: [{
      label: entry.name,
      imageUrl: entry.objectUrl,
      detailText,
    }],
  }
}

function assetRange(sortedAssetIds: string[], anchorAssetId: string, targetAssetId: string): string[] {
  const anchorIndex = sortedAssetIds.indexOf(anchorAssetId)
  const targetIndex = sortedAssetIds.indexOf(targetAssetId)
  if (anchorIndex < 0 || targetIndex < 0) return [targetAssetId]
  const startIndex = Math.min(anchorIndex, targetIndex)
  const endIndex = Math.max(anchorIndex, targetIndex)
  return sortedAssetIds.slice(startIndex, endIndex + 1)
}

export function createAssetDragImage(source: HTMLElement) {
  const shell = document.createElement('div')
  shell.className = 'assetDragImageShell'

  const preview = document.createElement('div')
  preview.className = 'assetDragImagePreview'

  const sourceImage = source.querySelector<HTMLImageElement>('img')
  if (sourceImage) {
    const image = sourceImage.cloneNode(true) as HTMLImageElement
    image.alt = ''
    preview.append(image)
  } else {
    const placeholder = document.createElement('div')
    placeholder.className = 'assetDragImagePlaceholder'
    placeholder.textContent = uiText.app.noPreview
    preview.append(placeholder)
  }

  shell.append(preview)
  return shell
}
