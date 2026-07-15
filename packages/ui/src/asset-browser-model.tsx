import { dedupeStringList } from './assetFiles'
import type { AssetSelectionIntent } from './asset-browser-types'

const ASSET_SELECTION_PREFIX = 'asset:'

export function assetSelectionKey(assetId: string): string {
  return `${ASSET_SELECTION_PREFIX}${assetId}`
}

export function assetIdFromSelectionKey(selectionKey: string): string | null {
  return selectionKey.startsWith(ASSET_SELECTION_PREFIX)
    ? selectionKey.slice(ASSET_SELECTION_PREFIX.length) || null
    : null
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

export function assetContextMenuStyle(x: number, y: number): { left: number; top: number } {
  const width = 220
  const height = 40
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
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
