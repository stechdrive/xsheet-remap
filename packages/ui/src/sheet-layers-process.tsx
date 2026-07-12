import { createKey, type CellBinding, type CutProject, type CspTrackSlot, type SheetHit, type SheetTimingRole, setEvent, sheetTimingRoleForKey, updateKey, upsertBinding, type TimingKey } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { type CellAssetPreviewItem, sortedCorrectionLayers } from './sheetAssets'
import { clampNumber, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction'
import { Tooltip, TooltipTarget } from './Tooltip'
import { AssetDropMenuState, CELL_ASSET_PREVIEW_MAX_ITEMS } from './app-foundation'

export function CellAssetPreview({ position, items }: { position: { left: number; top: number; width: number; maxHeight: number; visibleCount: number }; items: CellAssetPreviewItem[] }) {
  const previewItems = items.slice(0, Math.min(CELL_ASSET_PREVIEW_MAX_ITEMS, position.visibleCount))
  const hiddenCount = Math.max(0, items.length - previewItems.length)
  const className = items.length === 1 ? 'cellAssetPreviewPanel single' : 'cellAssetPreviewPanel grid'
  return (
    <div className={className} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      <div className="cellAssetPreviewTitle">{uiText.sheet.registeredAssetsCount(items.length)}</div>
      <div className="cellAssetPreviewList">
        {previewItems.map(item => (
          <TooltipTarget key={item.bindingId} label={`${item.processLabel}: ${item.cspCellName}`}>
            {tooltipProps => (
              <div className="cellAssetPreviewItem" {...tooltipProps}>
                {item.thumbnailUrl
                  ? <img src={item.thumbnailUrl} alt="" />
                  : <div className="cellAssetPreviewThumbFallback">{uiText.app.noPreview}</div>}
                <div className="cellAssetPreviewMeta">
                  <span className="cellAssetPreviewProcess">{item.processLabel}</span>
                  <strong>{item.cspCellName}</strong>
                </div>
              </div>
            )}
          </TooltipTarget>
        ))}
        {hiddenCount > 0 && <div className="cellAssetPreviewMore">{uiText.sheet.moreRegisteredAssets(hiddenCount)}</div>}
      </div>
    </div>
  )
}

export function AssetDropProcessMenu({
  state,
  project,
  onSelect,
  onCancel,
}: {
  state: AssetDropMenuState
  project: CutProject
  onSelect: (slotId: string) => void
  onCancel: () => void
}) {
  const asset = project.assets.find(item => item.assetId === state.assetId)
  const key = project.logicalSheet.keys.find(item => item.keyId === state.keyId)
  if (!asset || !key) return null
  const options = processSlotsForKey(project, key)
  if (options.length === 0) return null
  const position = assetDropMenuPosition(state, options.length)

  return (
    <div
      className="sheetContextMenu assetDropMenu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="assetDropMenuTitle">{uiText.assetDrop.title}</div>
      <Tooltip label={`${sheetRoleLabel(sheetTimingRoleForKey(key))} ${key.paperTrack} ${key.displayLabel} / ${asset.displayName}`}>
        <div className="assetDropMenuMeta">
          <strong>{sheetRoleLabel(sheetTimingRoleForKey(key))} {key.paperTrack} {key.displayLabel || uiText.assetDrop.untitledCell}</strong>
          <span>{asset.displayName}</span>
        </div>
      </Tooltip>
      {options.map(({ slot, label, bindingAsset }) => (
        <button key={slot.slotId} role="menuitem" onClick={() => onSelect(slot.slotId)}>
          <span>{bindingAsset ? uiText.assetDrop.overwrite(label) : uiText.assetDrop.register(label)}</span>
          <small>{bindingAsset ? bindingAsset.displayName : slot.displayPath}</small>
        </button>
      ))}
      <button role="menuitem" onClick={onCancel}>
        <span>{uiText.assetDrop.cancel}</span>
      </button>
    </div>
  )
}

export function ProcessMoveMenu({
  project,
  keyId,
  sourceSlotId,
  x,
  y,
  onSelect,
  onCancel,
}: {
  project: CutProject
  keyId: string
  sourceSlotId: string
  x: number
  y: number
  onSelect: (targetCorrectionLayerId: string) => void
  onCancel: () => void
}) {
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === sourceSlotId)
  if (!sourceSlot) return null
  const sourceLabel = processLabelForSlot(project, sourceSlot)
  const options = processMoveOptionsForSlot(project, sourceSlot, keyId)
  if (options.length === 0) return null
  const position = assetDropMenuPosition({ x, y }, options.length + 1)

  return (
    <div
      className="sheetContextMenu assetDropMenu processMoveMenu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="assetDropMenuTitle">{uiText.processMove.title}</div>
      <div className="assetDropMenuMeta">
        <strong>{uiText.processMove.current(sourceLabel)}</strong>
      </div>
      {options.map(({ layer, targetSlot, existingTargetBinding }) => (
        <button key={layer.layerId} role="menuitem" onClick={() => onSelect(layer.layerId)}>
          <span>{uiText.processMove.moveTo(layer.label)}</span>
          <small>{existingTargetBinding ? uiText.processMove.occupied : targetSlot.displayPath}</small>
        </button>
      ))}
      <button role="menuitem" onClick={onCancel}>
        <span>{uiText.assetDrop.cancel}</span>
      </button>
    </div>
  )
}

export function processSlotsForKey(project: CutProject, key: Pick<TimingKey, 'keyId' | 'paperTrack'>) {
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return project.cspTrackSlots
    .filter(slot => slot.paperTrack === key.paperTrack)
    .map(slot => {
      const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === key.keyId)
      const bindingAsset = binding?.assetId ? project.assets.find(asset => asset.assetId === binding.assetId) ?? null : null
      return {
        slot,
        bindingAsset,
        label: processLabelForSlot(project, slot),
      }
    })
    .sort((a, b) =>
      (correctionLayerOrder.get(a.slot.correctionLayerId ?? '') ?? 999) - (correctionLayerOrder.get(b.slot.correctionLayerId ?? '') ?? 999)
      || a.slot.trackNo - b.slot.trackNo
      || a.slot.occurrenceIndex - b.slot.occurrenceIndex
      || a.slot.displayPath.localeCompare(b.slot.displayPath, 'ja'),
    )
}

export function processLabelForSlot(project: CutProject, slot: CspTrackSlot): string {
  return slot.correctionLayerId
    ? project.correctionLayers.find(layer => layer.layerId === slot.correctionLayerId)?.label ?? slot.displayPath
    : slot.displayPath
}

type BindingProcessMoveTarget = {
  sourceSlot: CspTrackSlot
  targetSlot: CspTrackSlot
  existingTargetBinding: CellBinding | undefined
  sourceLabel: string
  targetLabel: string
}

export function bindingProcessMoveTarget(
  project: CutProject,
  keyId: string,
  sourceSlotId: string,
  targetCorrectionLayerId: string,
): BindingProcessMoveTarget | null {
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === sourceSlotId)
  if (!sourceSlot) return null
  const targetSlot = project.cspTrackSlots.find(slot =>
    slot.paperTrack === sourceSlot.paperTrack
    && slot.correctionLayerId === targetCorrectionLayerId,
  )
  if (!targetSlot) return null
  return {
    sourceSlot,
    targetSlot,
    existingTargetBinding: project.bindings.find(binding => binding.keyId === keyId && binding.slotId === targetSlot.slotId),
    sourceLabel: processLabelForSlot(project, sourceSlot),
    targetLabel: processLabelForSlot(project, targetSlot),
  }
}

export function processMoveOptionsForSlot(project: CutProject, sourceSlot: CspTrackSlot, keyId: string) {
  const layersById = new Map(project.correctionLayers.map(layer => [layer.layerId, layer]))
  return sortedCorrectionLayers(project)
    .flatMap(layer => {
      if (layer.layerId === sourceSlot.correctionLayerId) return []
      const target = bindingProcessMoveTarget(project, keyId, sourceSlot.slotId, layer.layerId)
      if (!target) return []
      return [{
        layer: layersById.get(layer.layerId) ?? layer,
        targetSlot: target.targetSlot,
        existingTargetBinding: target.existingTargetBinding,
      }]
    })
}

function assetDropMenuPosition(anchor: { x: number; y: number }, itemCount: number) {
  const width = 280
  const estimatedHeight = Math.min(420, 86 + itemCount * 46)
  const padding = 12
  const viewportWidth = window.innerWidth || width + padding * 2
  const viewportHeight = window.innerHeight || estimatedHeight + padding * 2
  return {
    left: clampNumber(anchor.x, padding, Math.max(padding, viewportWidth - width - padding)),
    top: clampNumber(anchor.y, padding, Math.max(padding, viewportHeight - estimatedHeight - padding)),
  }
}

type BindingCloneSpec = {
  slotId: string
  cspCellName: string
  assetId?: string
  materialState: CellBinding['materialState']
}

export function assignRegisteredCellKeyToHit(project: CutProject, keyId: string, hit: SheetHit, fontSizePx?: number): { project: CutProject; keyId: string | null } {
  if (!hit.paperTrack) return { project, keyId: null }
  const sourceKey = project.logicalSheet.keys.find(key => key.keyId === keyId)
  if (!sourceKey) return { project, keyId: null }
  const sheetRole = sheetRoleForHit(hit)
  if (sheetTimingRoleForKey(sourceKey) !== sheetRole) return { project, keyId: null }

  if (sourceKey.paperTrack === hit.paperTrack) {
    return {
      project: setEvent(project, hit.paperTrack, hit.frame, sourceKey.keyId, sheetRole, { fontSizePx }),
      keyId: sourceKey.keyId,
    }
  }

  const reusableKey = findReusableRegisteredCellClone(project, sourceKey, hit.paperTrack, sheetRole)
  if (reusableKey) {
    return {
      project: setEvent(project, hit.paperTrack, hit.frame, reusableKey.keyId, sheetRole, { fontSizePx }),
      keyId: reusableKey.keyId,
    }
  }

  const created = createKey(project, hit.paperTrack, sourceKey.displayLabel || undefined, sourceKey.createdFrom, sourceKey.paperToken, sheetRole)
  let next = updateKey(created.project, created.key.keyId, { displayLabel: sourceKey.displayLabel, paperToken: sourceKey.paperToken })
  for (const spec of bindingCloneSpecsForTarget(project, sourceKey, hit.paperTrack)) {
    next = upsertBinding(next, {
      ...spec,
      keyId: created.key.keyId,
    })
  }
  return {
    project: setEvent(next, hit.paperTrack, hit.frame, created.key.keyId, sheetRole, { fontSizePx }),
    keyId: created.key.keyId,
  }
}

function findReusableRegisteredCellClone(
  project: CutProject,
  sourceKey: TimingKey,
  targetPaperTrack: string,
  sheetRole: SheetTimingRole,
): TimingKey | null {
  const expectedSignature = bindingCloneSignature(bindingCloneSpecsForTarget(project, sourceKey, targetPaperTrack))
  return project.logicalSheet.keys.find(candidate => {
    if (candidate.paperTrack !== targetPaperTrack) return false
    if (sheetTimingRoleForKey(candidate) !== sheetRole) return false
    if (candidate.displayLabel !== sourceKey.displayLabel) return false
    if ((candidate.paperToken ?? '') !== (sourceKey.paperToken ?? '')) return false
    return bindingCloneSignature(bindingCloneSpecsForExistingKey(project, candidate.keyId, targetPaperTrack)) === expectedSignature
  }) ?? null
}

function bindingCloneSpecsForTarget(project: CutProject, sourceKey: TimingKey, targetPaperTrack: string): BindingCloneSpec[] {
  const usedTargetSlotIds = new Set<string>()
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== sourceKey.keyId) return []
      const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === binding.slotId)
      if (!sourceSlot) return []
      const targetSlot = correspondingSlotForPaperTrack(project, sourceSlot, targetPaperTrack)
      if (!targetSlot || usedTargetSlotIds.has(targetSlot.slotId)) return []
      usedTargetSlotIds.add(targetSlot.slotId)
      return [{
        slotId: targetSlot.slotId,
        cspCellName: binding.cspCellName,
        assetId: binding.assetId,
        materialState: binding.materialState,
      }]
    })
    .sort(compareBindingCloneSpecs)
}

function bindingCloneSpecsForExistingKey(project: CutProject, keyId: string, paperTrack: string): BindingCloneSpec[] {
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== keyId) return []
      const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
      if (!slot || slot.paperTrack !== paperTrack) return []
      return [{
        slotId: binding.slotId,
        cspCellName: binding.cspCellName,
        assetId: binding.assetId,
        materialState: binding.materialState,
      }]
    })
    .sort(compareBindingCloneSpecs)
}

function correspondingSlotForPaperTrack(project: CutProject, sourceSlot: CspTrackSlot, targetPaperTrack: string): CspTrackSlot | null {
  const candidates = project.cspTrackSlots.filter(slot => slot.paperTrack === targetPaperTrack)
  return candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId && slot.occurrenceIndex === sourceSlot.occurrenceIndex)
    ?? candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId && slot.stageId === sourceSlot.stageId)
    ?? candidates.find(slot => slot.correctionLayerId === sourceSlot.correctionLayerId)
    ?? candidates.find(slot => slot.occurrenceIndex === sourceSlot.occurrenceIndex && slot.trackNo === sourceSlot.trackNo)
    ?? candidates[0]
    ?? null
}

function bindingCloneSignature(specs: BindingCloneSpec[]): string {
  return specs
    .map(spec => `${spec.slotId}\u0000${spec.cspCellName}\u0000${spec.assetId ?? ''}\u0000${spec.materialState}`)
    .join('\u0001')
}

function compareBindingCloneSpecs(a: BindingCloneSpec, b: BindingCloneSpec): number {
  return a.slotId.localeCompare(b.slotId, 'ja')
    || a.cspCellName.localeCompare(b.cspCellName, 'ja')
    || (a.assetId ?? '').localeCompare(b.assetId ?? '', 'ja')
    || a.materialState.localeCompare(b.materialState, 'ja')
}
