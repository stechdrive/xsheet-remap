import { type CSSProperties } from 'react'
import { assetSourceDisplayPath, defaultCspCellName, defaultCorrectionLayerId, type CellBinding, type CutProject, type CspTrackSlot, type NameNormalizationOptions, type SheetHit, type SheetTimingRole, type StackGuideLabel, formatLogicalSheetFrameTimecode, sheetTimingRoleForEvent, sheetTimingRoleForKey, stackGuideCspCellName, stackGuideRegistrations, type CutAsset, type TimingKey, isSpecialTimingKeyId } from '@xsheet-remap/core'
import { isTauriHost } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { type SheetRangeSelection } from './appTypes'
import { type AssetRegistrationSummary } from './AssetBrowser'
import { assetBaseName } from './assetFiles'
import { nativeAssetPreviewItemPayload, updateNativeAssetPreviewPayloadIfOpen, type AssetPreviewItemPayload, type AssetPreviewPayload } from './assetPreviewModel'
import { compareNaturalFileNameText } from './naturalSort'
import { sortedCorrectionLayers } from './sheetAssets'
import { clampNumber, sheetRoleForHit, sheetRoleLabel } from './sheetInteraction'
import { rangePaperTracks } from './timingEditing'
import { TooltipTarget } from './Tooltip'
import { RegisteredCellFirstUse, RegisteredCellSortDirection } from './app-foundation'
import { processLabelForSlot } from './app-sheet-layers'
import { CellStackOrderItem, cellStackOrderItems } from './registered-cells-stack-order'

export type NameNormalizationTarget = 'selected-key' | 'selected-column' | 'cell' | 'action'

export type RegisteredCellSection = {
  sectionId: SheetTimingRole
  title: string
  keys: TimingKey[]
}

export interface RegisteredCellThumbnailRow {
  rowId: string
  correctionLayerId?: string
  processLabel: string
  cspCellName: string
  assetName: string
  thumbnailUrl?: string
  detailText?: string
}

export function RegisteredCellHoverPreviewOverlay({ project, rows, label, style }: { project: CutProject; rows: RegisteredCellThumbnailRow[]; label: string; style: CSSProperties }) {
  const sortedRows = sortedThumbnailRows(project, rows)
  if (sortedRows.length === 0) return null
  return (
    <div className="registeredCellHoverPreview" role="tooltip" aria-label={uiText.assets.previewDialog(label)} style={style}>
      <div className="registeredCellHoverPreviewGrid">
        {sortedRows.slice(0, 8).map(row => (
          <TooltipTarget key={row.rowId} label={`${row.processLabel}: ${row.assetName}`}>
            {tooltipProps => (
              <div className="registeredCellHoverPreviewItem" {...tooltipProps}>
                <div className="registeredCellHoverPreviewImage">
                  {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" /> : <div className="registeredCellThumbPlaceholder">{uiText.app.noPreview}</div>}
                </div>
                <div className="registeredCellHoverPreviewCaption">
                  <span className="registeredCellAssetProcess">{row.processLabel}</span>
                  <strong>{row.cspCellName || row.assetName}</strong>
                </div>
              </div>
            )}
          </TooltipTarget>
        ))}
        {sortedRows.length > 8 && <div className="registeredCellThumbMore">{uiText.sheet.moreRegisteredAssets(sortedRows.length - 8)}</div>}
      </div>
    </div>
  )
}

export function registeredCellHoverPreviewStyle(anchor: DOMRect, rowCount: number): CSSProperties {
  const width = rowCount === 1 ? 178 : 348
  const visibleCount = Math.min(rowCount, 8)
  const columns = rowCount === 1 ? 1 : 2
  const rows = Math.ceil(visibleCount / columns)
  const estimatedHeight = Math.min(window.innerHeight - 24, 12 + rows * 190 + (rowCount > 8 ? 24 : 0))
  const rightSideLeft = anchor.right + 8
  const left = rightSideLeft + width <= window.innerWidth - 12
    ? rightSideLeft
    : Math.max(12, anchor.left - width - 8)
  const top = clampNumber(anchor.top, 12, Math.max(12, window.innerHeight - estimatedHeight - 12))
  return {
    left,
    top,
    width,
    maxHeight: 'calc(100vh - 24px)',
  }
}

function sortedThumbnailRows(project: CutProject, rows: RegisteredCellThumbnailRow[]): RegisteredCellThumbnailRow[] {
  const defaultLayerId = defaultCorrectionLayerId(project)
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return [...rows].sort((a, b) =>
    (a.correctionLayerId === defaultLayerId ? 0 : 1) - (b.correctionLayerId === defaultLayerId ? 0 : 1)
    || (correctionLayerOrder.get(a.correctionLayerId ?? '') ?? 999) - (correctionLayerOrder.get(b.correctionLayerId ?? '') ?? 999)
    || a.processLabel.localeCompare(b.processLabel, 'ja')
    || a.assetName.localeCompare(b.assetName, 'ja'),
  )
}

export function defaultNameNormalizationTarget(): NameNormalizationTarget {
  return 'action'
}

export function nameNormalizationTargetOptions(
  project: CutProject,
  selectedKeyId: string | null,
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
) {
  return [
    { value: 'action' as const, label: uiText.nameNormalization.targets.action },
    { value: 'cell' as const, label: uiText.nameNormalization.targets.cell },
    { value: 'selected-key' as const, label: uiText.nameNormalization.targets.selectedKey, disabled: !selectedKeyId || !project.logicalSheet.keys.some(key => key.keyId === selectedKeyId) },
    { value: 'selected-column' as const, label: uiText.nameNormalization.targets.selectedColumn, disabled: !normalizationColumnTarget(selectedHit, rangeSelection) },
  ]
}

export function nameNormalizationOptionsForTarget(
  project: CutProject,
  target: NameNormalizationTarget,
  selectedKeyId: string | null,
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
  correctionLayerId: string,
  includeAssetFiles: boolean,
  sequencePadding: number | undefined,
): NameNormalizationOptions {
  const selectedKey = selectedKeyId ? project.logicalSheet.keys.find(key => key.keyId === selectedKeyId) ?? null : null
  const columnTarget = normalizationColumnTarget(selectedHit, rangeSelection)
  const base = {
    includeAssetFiles,
    includeStackGuides: target === 'action',
    correctionLayerIds: correctionLayerId ? [correctionLayerId] : undefined,
    sequencePadding,
  }
  if (target === 'selected-key' && selectedKey) {
    return { ...base, sheetRole: sheetTimingRoleForKey(selectedKey), keyIds: [selectedKey.keyId] }
  }
  if (target === 'selected-column' && columnTarget) {
    return { ...base, sheetRole: columnTarget.sheetRole, paperTracks: columnTarget.paperTracks }
  }
  return {
    ...base,
    sheetRole: target === 'action' ? 'action' : 'cell',
  }
}

function normalizationColumnTarget(
  selectedHit: SheetHit | null,
  rangeSelection: SheetRangeSelection | null,
): { sheetRole: SheetTimingRole; paperTracks: string[] } | null {
  if (rangeSelection && (rangeSelection.role === 'action' || rangeSelection.role === 'cell') && rangeSelection.paperTrack) {
    return { sheetRole: rangeSelection.role, paperTracks: rangePaperTracks(rangeSelection) }
  }
  if (selectedHit?.paperTrack && (selectedHit.role === 'action' || selectedHit.role === 'cell')) {
    return { sheetRole: sheetRoleForHit(selectedHit), paperTracks: [selectedHit.paperTrack] }
  }
  return null
}

export function registeredCellSectionsForUi(project: CutProject, trackOrder: Map<string, number>, direction: RegisteredCellSortDirection): RegisteredCellSection[] {
  const comparer = compareRegisteredCellKeysForUi(project, trackOrder)
  return ([
    { sectionId: 'action', title: uiText.keys.sections.action },
    { sectionId: 'cell', title: uiText.keys.sections.cell },
  ] as const)
    .map(section => {
      const keys = project.logicalSheet.keys
        .filter(key => sheetTimingRoleForKey(key) === section.sectionId)
        .sort(comparer)
      return {
        ...section,
        keys: direction === 'asc' ? keys : keys.reverse(),
      }
    })
    .filter(section => section.keys.length > 0)
}

function compareRegisteredCellKeysForUi(project: CutProject, trackOrder: Map<string, number>) {
  const firstUseByKeyId = new Map(
    project.logicalSheet.keys.map(key => [key.keyId, firstTimelineUseForKey(project, key, trackOrder)]),
  )
  return (a: TimingKey, b: TimingKey): number =>
    (trackOrder.get(a.paperTrack) ?? Number.MAX_SAFE_INTEGER) - (trackOrder.get(b.paperTrack) ?? Number.MAX_SAFE_INTEGER)
    || compareNaturalFileNameText(a.paperTrack, b.paperTrack)
    || (firstUseByKeyId.get(a.keyId)?.frame ?? Number.MAX_SAFE_INTEGER) - (firstUseByKeyId.get(b.keyId)?.frame ?? Number.MAX_SAFE_INTEGER)
    || compareNaturalFileNameText(a.displayLabel, b.displayLabel)
    || a.keyId.localeCompare(b.keyId, 'ja')
}

export function registeredCellPrimaryDisplayName(key: TimingKey, cspCellName: string): string {
  return key.displayLabel.trim() || cspCellName || key.paperTrack
}

export function registeredCellCompactTitle(key: TimingKey, cspCellName: string): string {
  return [key.displayLabel.trim(), cspCellName].filter(Boolean).join(' / ') || key.paperTrack
}

export function registeredCellProcessLabels(rows: Array<{ processLabel: string }>): string[] {
  return Array.from(new Set(rows.map(row => row.processLabel).filter(Boolean)))
}

export function registeredCellTrackOrder(project: CutProject): Map<string, number> {
  return new Map(
    cellStackOrderItems(project)
      .filter((item): item is Extract<CellStackOrderItem, { paperTrack: string }> => 'paperTrack' in item)
      .map((item, index) => [item.paperTrack, index]),
  )
}

export function firstTimelineUseForKey(project: CutProject, key: TimingKey, trackOrder: Map<string, number>): RegisteredCellFirstUse | null {
  const keyRole = sheetTimingRoleForKey(key)
  const roleMatchedEvents = project.logicalSheet.events.filter(event =>
    event.keyId === key.keyId
    && sheetTimingRoleForEvent(event) === keyRole,
  )
  const events = roleMatchedEvents.length > 0
    ? roleMatchedEvents
    : project.logicalSheet.events.filter(event => event.keyId === key.keyId)
  if (events.length === 0) return null

  const [first] = [...events].sort((a, b) =>
    (trackOrder.get(a.paperTrack) ?? Number.MAX_SAFE_INTEGER) - (trackOrder.get(b.paperTrack) ?? Number.MAX_SAFE_INTEGER)
    || a.frame - b.frame
    || sheetTimingRoleSortValue(sheetTimingRoleForEvent(a)) - sheetTimingRoleSortValue(sheetTimingRoleForEvent(b))
    || a.eventId.localeCompare(b.eventId, 'ja'),
  )
  if (!first) return null

  const timecode = formatLogicalSheetFrameTimecode(first.frame, project.logicalSheet.frameOrigin, project.logicalSheet.fps)
  return {
    timecode,
    paperTrack: first.paperTrack,
    frame: first.frame,
    role: sheetTimingRoleForEvent(first),
    title: uiText.keys.firstUseTitle(sheetRoleLabel(sheetTimingRoleForEvent(first)), first.paperTrack, first.frame, timecode),
  }
}

function sheetTimingRoleSortValue(role: SheetTimingRole): number {
  return role === 'action' ? 0 : 1
}

export function primarySlotForKey(project: CutProject, key: Pick<TimingKey, 'paperTrack'>, activeCorrectionLayerId: string): CspTrackSlot | null {
  return project.cspTrackSlots.find(slot => slot.paperTrack === key.paperTrack && slot.correctionLayerId === activeCorrectionLayerId)
    ?? project.cspTrackSlots.find(slot => slot.paperTrack === key.paperTrack)
    ?? null
}

export function automaticRegisteredCellCspName(key: TimingKey, slot: CspTrackSlot, primaryAsset: CutAsset | null): string {
  return key.displayLabel.trim()
    ? defaultCspCellName(key.displayLabel, slot.paperTrack)
    : primaryAsset
      ? assetBaseName(primaryAsset)
      : defaultCspCellName(key.displayLabel, slot.paperTrack)
}

export function registeredCellAssetRows(project: CutProject, key: TimingKey) {
  const slotsById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const correctionLayerOrder = new Map(sortedCorrectionLayers(project).map((layer, index) => [layer.layerId, index]))
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== key.keyId || !binding.assetId) return []
      const slot = slotsById.get(binding.slotId)
      const asset = assetsById.get(binding.assetId)
      if (!slot || !asset) return []
        return [{
          bindingId: binding.bindingId,
          slotId: slot.slotId,
          correctionLayerId: slot.correctionLayerId,
          assetId: asset.assetId,
          processLabel: processLabelForSlot(project, slot),
          assetName: asset.displayName,
          cspCellName: binding.cspCellName,
          thumbnailUrl: asset.thumbnailUrl,
          detailText: assetSourceDisplayPath(asset),
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
      || a.sortKey[3].localeCompare(b.sortKey[3], 'ja')
      || a.sortKey[4].localeCompare(b.sortKey[4], 'ja'),
    )
    .map(row => ({
      bindingId: row.bindingId,
      slotId: row.slotId,
      correctionLayerId: row.correctionLayerId,
      assetId: row.assetId,
      processLabel: row.processLabel,
      assetName: row.assetName,
      cspCellName: row.cspCellName,
      thumbnailUrl: row.thumbnailUrl,
      detailText: row.detailText,
    }))
}

export function singleMovableBindingForHit(project: CutProject, hit: SheetHit): { binding: CellBinding; slot: CspTrackSlot; key: TimingKey } | null {
  if (!hit.paperTrack) return null
  const sheetRole = sheetRoleForHit(hit)
  const event = project.logicalSheet.events.find(item =>
    item.paperTrack === hit.paperTrack
    && item.frame === hit.frame
    && sheetTimingRoleForEvent(item) === sheetRole,
  )
  if (!event || isSpecialTimingKeyId(event.keyId)) return null
  const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
  if (!key) return null
  const bindings = project.bindings.filter(binding => binding.keyId === key.keyId && binding.assetId)
  if (bindings.length !== 1) return null
  const binding = bindings[0]
  const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
  if (!slot) return null
  return { binding, slot, key }
}

export function stackGuideAssetRows(project: CutProject, label: StackGuideLabel) {
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  return stackGuideRegistrations(label).flatMap(registration => {
    const layer = project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
    return registration.assetIds.flatMap(assetId => {
      const asset = assetsById.get(assetId)
      if (!asset) return []
      return [{
        rowId: `${registration.registrationId}:${asset.assetId}`,
        registrationId: registration.registrationId,
        correctionLayerId: registration.correctionLayerId,
        processLabel: layer?.label ?? registration.correctionLayerId,
        cspCellName: stackGuideCspCellName(label, registration),
        assetId: asset.assetId,
        assetName: asset.displayName,
        thumbnailUrl: asset.thumbnailUrl,
        detailText: assetSourceDisplayPath(asset),
      }]
    })
  })
}

export function stackGuideKindLabel(kind: StackGuideLabel['kind']): string {
  return uiText.stackGuides.kind[kind] ?? uiText.stackGuides.kind.other
}

export function stackGuideDropMenuStyle(x: number, y: number): CSSProperties {
  const width = 188
  const minHeight = 160
  const inset = 8
  const viewportWidth = typeof window === 'undefined' ? width + inset * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 420 : window.innerHeight
  const left = Math.max(inset, Math.min(x + 8, viewportWidth - width - inset))
  const top = Math.max(inset, Math.min(y + 8, viewportHeight - minHeight - inset))
  return {
    left,
    top,
    width,
    maxHeight: Math.max(minHeight, viewportHeight - top - inset),
  }
}

export function sheetContextMenuStyle(x: number, y: number, itemCount: number): CSSProperties {
  const width = 240
  const height = 10 + Math.max(1, itemCount) * 34
  const inset = 8
  const viewportWidth = typeof window === 'undefined' ? width + inset * 2 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? height + inset * 2 : window.innerHeight
  return {
    left: Math.max(inset, Math.min(x, viewportWidth - width - inset)),
    top: Math.max(inset, Math.min(y, viewportHeight - height - inset)),
    width,
  }
}

export function assetRegistrationSummaries(project: CutProject): Map<string, AssetRegistrationSummary> {
  const keysById = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const slotsById = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const detailsByAssetId = new Map<string, string[]>()

  for (const binding of project.bindings) {
    if (!binding.assetId) continue
    const key = keysById.get(binding.keyId)
    const slot = slotsById.get(binding.slotId)
    const detail = assetRegistrationDetail(binding, key, slot)
    const details = detailsByAssetId.get(binding.assetId) ?? []
    if (!details.includes(detail)) details.push(detail)
    detailsByAssetId.set(binding.assetId, details)
  }
  for (const label of project.stackGuideLabels) {
    const kindLabel = stackGuideKindLabel(label.kind)
    for (const row of stackGuideAssetRows(project, label)) {
      const detail = [kindLabel, label.label, row.processLabel, row.cspCellName].filter(Boolean).join(' / ')
      const details = detailsByAssetId.get(row.assetId) ?? []
      if (!details.includes(detail)) details.push(detail)
      detailsByAssetId.set(row.assetId, details)
    }
  }

  return new Map(Array.from(detailsByAssetId.entries()).map(([assetId, details]) => {
    const sortedDetails = [...details].sort(compareNaturalFileNameText)
    const count = sortedDetails.length
    return [assetId, {
      badgeLabel: count === 1 ? uiText.assets.registered : uiText.assets.registeredCount(count),
      title: `${count === 1 ? uiText.assets.registered : uiText.assets.registeredCount(count)}\n${sortedDetails.join('\n')}`,
    }]
  }))
}

function assetRegistrationDetail(binding: CellBinding, key: TimingKey | undefined, slot: CspTrackSlot | undefined): string {
  const roleLabel = key ? sheetRoleLabel(sheetTimingRoleForKey(key)) : ''
  const paperTrack = key?.paperTrack ?? slot?.paperTrack ?? ''
  const cellName = binding.cspCellName || key?.displayLabel || uiText.assetDrop.untitledCell
  const processLabel = slot?.displayPath ?? slot?.xdtsName ?? ''
  const sheetLabel = [roleLabel, paperTrack].filter(Boolean).join(' ')
  return [processLabel, sheetLabel, cellName].filter(Boolean).join(' / ')
}

export async function updateNativeRegisteredCellPreviewIfOpen(project: CutProject, keyOrId: TimingKey | string): Promise<boolean> {
  const key = typeof keyOrId === 'string'
    ? project.logicalSheet.keys.find(item => item.keyId === keyOrId)
    : keyOrId
  if (!key || isSpecialTimingKeyId(key.keyId)) return false
  const payload = await nativeRegisteredCellPreviewPayload(project, key)
  return payload ? updateNativeAssetPreviewPayloadIfOpen(payload) : false
}

export async function updateNativeStackGuidePreviewIfOpen(project: CutProject, labelOrId: StackGuideLabel | string): Promise<boolean> {
  const label = typeof labelOrId === 'string'
    ? project.stackGuideLabels.find(item => item.labelId === labelOrId)
    : labelOrId
  if (!label) return false
  const payload = await nativeStackGuidePreviewPayload(project, label)
  return payload ? updateNativeAssetPreviewPayloadIfOpen(payload) : false
}

export async function nativeRegisteredCellPreviewPayload(project: CutProject, key: TimingKey): Promise<AssetPreviewPayload | null> {
  if (!isTauriHost()) return null
  const rows = registeredCellAssetRows(project, key)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = (await Promise.all(rows.map(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return null
    return nativeAssetPreviewItemPayload(asset, {
      label: row.cspCellName || row.assetName,
      processLabel: row.processLabel,
    })
  }))).filter((item): item is AssetPreviewItemPayload => Boolean(item))
  if (items.length === 0) return null
  return {
    displayName: registeredCellPreviewName(key),
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

export async function nativeStackGuidePreviewPayload(project: CutProject, label: StackGuideLabel): Promise<AssetPreviewPayload | null> {
  if (!isTauriHost()) return null
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const rows = stackGuideAssetRows(project, label)
  const items = (await Promise.all(rows.map(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return null
    return nativeAssetPreviewItemPayload(asset, {
      label: row.cspCellName,
      processLabel: row.processLabel,
    })
  }))).filter((item): item is AssetPreviewItemPayload => Boolean(item))
  if (items.length === 0) return null
  return {
    displayName: label.label,
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

export function embeddedRegisteredCellPreviewPayload(project: CutProject, key: TimingKey): AssetPreviewPayload | null {
  const rows = registeredCellAssetRows(project, key)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = rows.flatMap<AssetPreviewItemPayload>(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return []
    return [{
      label: row.cspCellName || row.assetName,
      imageUrl: asset.thumbnailUrl,
      detailText: assetSourceDisplayPath(asset),
      processLabel: row.processLabel,
    }]
  })
  if (items.length === 0) return null
  return {
    displayName: registeredCellPreviewName(key),
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

export function embeddedStackGuidePreviewPayload(project: CutProject, label: StackGuideLabel): AssetPreviewPayload | null {
  const rows = stackGuideAssetRows(project, label)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const items = rows.flatMap<AssetPreviewItemPayload>(row => {
    const asset = assetsById.get(row.assetId)
    if (!asset) return []
    return [{
      label: row.cspCellName,
      imageUrl: asset.thumbnailUrl,
      detailText: assetSourceDisplayPath(asset),
      processLabel: row.processLabel,
    }]
  })
  if (items.length === 0) return null
  return {
    displayName: label.label,
    imageUrl: items.length === 1 ? items[0].imageUrl : undefined,
    detailText: items.length === 1 ? items[0].detailText : undefined,
    items,
  }
}

function registeredCellPreviewName(key: TimingKey): string {
  return [
    sheetRoleLabel(sheetTimingRoleForKey(key)),
    key.paperTrack,
    key.displayLabel.trim(),
  ].filter(Boolean).join(' ')
}
