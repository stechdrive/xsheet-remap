import {
  createKey,
  isNullCellKeyId,
  setEvent,
  sheetTimingRoleForEvent,
  sheetTimingRoleForKey,
  updateKey,
  upsertBinding,
  type CellBinding,
  type CutAsset,
  type CutProject,
  type SheetHit,
} from '@xsheet-remap/core'
import { clampNumber, sheetRoleForHit } from './sheetInteraction'

export interface CellAssetPreviewItem {
  bindingId: string
  processLabel: string
  cspCellName: string
  assetName: string
  thumbnailUrl?: string
}

export function bindAssetToHit(project: CutProject, asset: CutAsset, hit: SheetHit, correctionLayerId: string): { project: CutProject; keyId: string | null } {
  if (!hit.paperTrack) return { project, keyId: null }
  const sheetRole = sheetRoleForHit(hit)
  const slot = project.cspTrackSlots.find(item => item.paperTrack === hit.paperTrack && item.correctionLayerId === correctionLayerId)
    ?? project.cspTrackSlots.find(item => item.paperTrack === hit.paperTrack)
  const cspCellName = assetCspCellName(asset)
  const reusableBinding = slot
    ? findReusableAssetBinding(project, slot.slotId, cspCellName, asset.assetId, hit.paperTrack, sheetRole)
    : null
  if (slot && reusableBinding) {
    const withEvent = setEvent(project, hit.paperTrack, hit.frame, reusableBinding.keyId, sheetRole)
    return {
      project: upsertBinding(withEvent, {
        slotId: slot.slotId,
        keyId: reusableBinding.keyId,
        assetId: asset.assetId,
        cspCellName,
        materialState: 'assigned',
      }),
      keyId: reusableBinding.keyId,
    }
  }

  const existingEvent = project.logicalSheet.events.find(event => event.paperTrack === hit.paperTrack && event.frame === hit.frame && sheetTimingRoleForEvent(event) === sheetRole)
  let next = project
  let keyId = existingEvent && !isNullCellKeyId(existingEvent.keyId) ? existingEvent.keyId : null
  if (!keyId) {
    const created = createKey(next, hit.paperTrack, undefined, 'asset-drop', undefined, sheetRole)
    const withEvent = setEvent(created.project, hit.paperTrack, hit.frame, created.key.keyId, sheetRole)
    next = updateKey(withEvent, created.key.keyId, { displayLabel: '', paperToken: '' })
    keyId = created.key.keyId
  }
  if (!slot) return { project: next, keyId }
  return {
    project: upsertBinding(next, {
      slotId: slot.slotId,
      keyId,
      assetId: asset.assetId,
      cspCellName,
      materialState: 'assigned',
    }),
    keyId,
  }
}

function findReusableAssetBinding(
  project: CutProject,
  slotId: string,
  cspCellName: string,
  assetId: string,
  paperTrack: string,
  sheetRole: ReturnType<typeof sheetRoleForHit>,
): CellBinding | null {
  const keyBelongsToTarget = (keyId: string) => {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    return Boolean(key && key.paperTrack === paperTrack && sheetTimingRoleForKey(key) === sheetRole)
  }
  return project.bindings.find(binding =>
    binding.slotId === slotId
    && binding.assetId === assetId
    && keyBelongsToTarget(binding.keyId),
  ) ?? project.bindings.find(binding =>
    binding.slotId === slotId
    && binding.cspCellName === cspCellName
    && keyBelongsToTarget(binding.keyId),
  ) ?? null
}

export function cellAssetPreviewItemsForHit(project: CutProject, hit: SheetHit): CellAssetPreviewItem[] {
  if (!hit.paperTrack) return []
  const sheetRole = sheetRoleForHit(hit)
  const event = project.logicalSheet.events.find(item => item.paperTrack === hit.paperTrack && item.frame === hit.frame && sheetTimingRoleForEvent(item) === sheetRole)
  if (!event) return []

  const slotsById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const correctionLayersById = new Map(project.correctionLayers.map(layer => [layer.layerId, layer]))
  const correctionLayerOrder = new Map(project.correctionLayers.map((layer, index) => [layer.layerId, index]))

  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== event.keyId || !binding.assetId) return []
      const slot = slotsById.get(binding.slotId)
      const asset = assetsById.get(binding.assetId)
      if (!slot || !asset || slot.paperTrack !== hit.paperTrack) return []
      const processLabel = slot.correctionLayerId ? correctionLayersById.get(slot.correctionLayerId)?.label : undefined
      return [{
        bindingId: binding.bindingId,
        processLabel: processLabel ?? slot.displayPath,
        cspCellName: binding.cspCellName,
        assetName: asset.displayName,
        thumbnailUrl: asset.thumbnailUrl,
        sortKey: [
          correctionLayerOrder.get(slot.correctionLayerId ?? '') ?? 999,
          slot.trackNo,
          slot.occurrenceIndex,
          slot.displayPath,
          asset.displayName,
        ] as const,
      }]
    })
    .sort((a, b) =>
      a.sortKey[0] - b.sortKey[0]
      || a.sortKey[1] - b.sortKey[1]
      || a.sortKey[2] - b.sortKey[2]
      || a.sortKey[3].localeCompare(b.sortKey[3])
      || a.sortKey[4].localeCompare(b.sortKey[4]),
    )
    .map(item => ({
      bindingId: item.bindingId,
      processLabel: item.processLabel,
      cspCellName: item.cspCellName,
      assetName: item.assetName,
      thumbnailUrl: item.thumbnailUrl,
    }))
}

export function cellAssetPreviewPosition(anchor: { x: number; y: number }, itemCount: number) {
  const width = itemCount === 1 ? 154 : 336
  const gap = 18
  const padding = 12
  const viewportWidth = window.innerWidth || width + padding * 2
  const viewportHeight = window.innerHeight || 480
  const maxHeight = Math.max(96, viewportHeight - padding * 2)
  let visibleCount = Math.min(itemCount, 6)
  const estimatedHeightFor = (count: number) => {
    if (itemCount === 1) return 158
    return 48 + Math.ceil(count / 2) * 112 + (itemCount > count ? 28 : 0)
  }
  while (visibleCount > 1 && estimatedHeightFor(visibleCount) > maxHeight) {
    visibleCount -= 1
  }
  const estimatedHeight = Math.min(maxHeight, estimatedHeightFor(visibleCount))
  const leftCandidate = anchor.x + gap
  const left = leftCandidate + width <= viewportWidth - padding
    ? leftCandidate
    : Math.max(padding, anchor.x - width - gap)
  const top = clampNumber(anchor.y - 28, padding, Math.max(padding, viewportHeight - estimatedHeight - padding))
  return {
    left,
    top,
    width,
    maxHeight,
    visibleCount,
  }
}

export function isCellMaterialAsset(asset: CutAsset): boolean {
  return (asset.role ?? 'cell-material') === 'cell-material'
}

export function sortedCorrectionLayers(project: CutProject) {
  return [...project.correctionLayers].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

function assetCspCellName(asset: CutAsset): string {
  return asset.displayName.replace(/\.[^.]+$/, '')
}
