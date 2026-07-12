import type { CellBinding, CorrectionLayer, CspTrackSlot, CspCellNamePolicy, CutAsset, CutProject, ExportPlan, PaperTrack, PaperTrackName, ProductionStage, SheetTimingRole, StackGuideLabel, StackGuideRegistration, StackGuideStackBand, TimelineEvent, TimingKey } from './types'
import { NULL_CELL_CSP_CELL_NAME, NULL_CELL_KEY_ID } from './types'
import { alphabeticTrackLabel } from './sheet-template'
import { logicalSheetOfficialFrameEnd } from './logical-sheet'
import { clampNumberForCore } from './core-utils'
import { DEFAULT_CSP_CELL_NAME_POLICY, DEFAULT_SHEET_TIMING_ROLE, MAX_CORRECTION_LAYERS } from './project-constants'

export function nextDisplayLabel(
  project: CutProject,
  paperTrack: PaperTrackName,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): string {
  const used = new Set(
    project.logicalSheet.keys
      .filter(key => key.paperTrack === paperTrack && sheetTimingRoleForKey(key) === sheetRole)
      .map(key => Number(key.displayLabel))
      .filter(Number.isInteger),
  )
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return String(candidate)
}

export function normalizeTimingKeyDisplayLabel(value: string): string {
  return value.trim()
}

export function stackGuideGapIndex(project: Pick<CutProject, 'logicalSheet'>, label: Pick<StackGuideLabel, 'gapIndex' | 'insertAfterPaperTrack'>): number {
  if (label.insertAfterPaperTrack) {
    const trackIndex = project.logicalSheet.paperTracks.findIndex(track => track.paperTrack === label.insertAfterPaperTrack)
    if (trackIndex >= 0) return trackIndex + 1
  }
  return clampNumberForCore(Math.round(label.gapIndex), 0, project.logicalSheet.paperTracks.length)
}

export function stackGuideCspCellName(
  label: Pick<StackGuideLabel, 'label' | 'cspCellName'>,
  registration?: Pick<StackGuideRegistration, 'cspCellName'>,
): string {
  return (registration?.cspCellName?.trim() || label.cspCellName?.trim() || label.label.trim())
}

export function stackGuideRegistrations(label: Pick<StackGuideLabel, 'registrations' | 'assetIds' | 'cspCellName'>): StackGuideRegistration[] {
  const registrations = label.registrations ?? []
  if (registrations.length > 0) {
    return registrations.map(registration => ({ ...registration, assetIds: registration.assetIds ?? [] }))
  }
  if ((label.assetIds ?? []).length === 0 && !label.cspCellName) return []
  return [{
    registrationId: 'stack_reg_legacy',
    correctionLayerId: 'layer_sakuga',
    cspCellName: label.cspCellName,
    assetIds: label.assetIds ?? [],
  }]
}

export function stackGuideRegistrationForLayer(
  label: Pick<StackGuideLabel, 'registrations' | 'assetIds' | 'cspCellName'>,
  correctionLayerId: string,
): StackGuideRegistration | undefined {
  return stackGuideRegistrations(label).find(registration => registration.correctionLayerId === correctionLayerId)
}

export function normalizeStackGuideLabelForProject(label: StackGuideLabel, project: Pick<CutProject, 'logicalSheet' | 'correctionLayers'>): StackGuideLabel {
  const gapIndex = stackGuideGapIndex(project, label)
  const defaultLayerId = defaultCorrectionLayerId(project) ?? 'layer_sakuga'
  const registrations = (label.registrations?.length ? label.registrations : (
    label.assetIds?.length || label.cspCellName
      ? [{
          registrationId: 'stack_reg_0001',
          correctionLayerId: defaultLayerId,
          cspCellName: label.cspCellName,
          assetIds: label.assetIds ?? [],
        }]
      : []
  )).map((registration, index) => ({
    registrationId: registration.registrationId ?? `stack_reg_${String(index + 1).padStart(4, '0')}`,
    correctionLayerId: registration.correctionLayerId ?? defaultLayerId,
    cspCellName: registration.cspCellName?.trim() || undefined,
    assetIds: registration.assetIds ?? [],
  })).sort(compareStackGuideRegistrationsForProject(project))
  const kind = label.kind ?? inferStackGuideLabelKind(label.label)
  return {
    ...label,
    gapIndex,
    insertAfterPaperTrack: paperTrackBeforeGap(project, gapIndex),
    assetIds: label.assetIds ?? [],
    exportAsStaticCell: label.exportAsStaticCell ?? true,
    kind,
    placement: label.placement ?? defaultStackGuidePlacementForKind(kind),
    stackBand: label.stackBand ?? defaultStackGuideStackBandForKind(kind),
    displayRole: label.displayRole ?? 'action',
    viewSnapIndex: normalizeOptionalStackGuideViewSnapIndex(label.viewSnapIndex),
    registrations,
  }
}

export function nextStackGuideRegistrationId(label: Pick<StackGuideLabel, 'registrations'>): string {
  const used = new Set((label.registrations ?? []).map(registration => registration.registrationId))
  let index = (label.registrations ?? []).length + 1
  let candidate = `stack_reg_${String(index).padStart(4, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `stack_reg_${String(index).padStart(4, '0')}`
  }
  return candidate
}

export function compareStackGuideRegistrationsForProject(project: Pick<CutProject, 'correctionLayers'>) {
  return (a: StackGuideRegistration, b: StackGuideRegistration): number =>
    correctionLayerOrderById(project, a.correctionLayerId) - correctionLayerOrderById(project, b.correctionLayerId)
    || a.correctionLayerId.localeCompare(b.correctionLayerId, 'ja')
}

export function nextStackGuideOrderInGap(project: CutProject, gapIndex: number, insertAfterPaperTrack: PaperTrackName | undefined): number {
  const matchingLabels = project.stackGuideLabels.filter(label =>
    stackGuideGapIndex(project, label) === gapIndex
    && (label.insertAfterPaperTrack ?? '') === (insertAfterPaperTrack ?? ''),
  )
  return matchingLabels.reduce((max, label) => Math.max(max, label.orderInGap), -1) + 1
}

export function paperTrackBeforeGap(project: Pick<CutProject, 'logicalSheet'>, gapIndex: number): PaperTrackName | undefined {
  if (gapIndex <= 0) return undefined
  return project.logicalSheet.paperTracks[gapIndex - 1]?.paperTrack
}

export function clampStackGuideGapIndex(project: Pick<CutProject, 'logicalSheet'>, gapIndex: number): number {
  return clampNumberForCore(Math.round(gapIndex), 0, project.logicalSheet.paperTracks.length)
}

export function normalizeOptionalStackGuideViewSnapIndex(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.round(value as number))
}

export function normalizePaperTrackOrder(paperTracks: PaperTrack[]): PaperTrack[] {
  const templateTracks = paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order || a.paperTrack.localeCompare(b.paperTrack, 'ja'))
  const templateOrder = new Map(templateTracks.map((track, index) => [track.paperTrack, index]))
  const sorted = [...paperTracks].sort((a, b) => {
    const aKey = paperTrackExportSortKey(a, templateOrder)
    const bKey = paperTrackExportSortKey(b, templateOrder)
    return aKey.position - bKey.position
      || aKey.orderInGap - bKey.orderInGap
      || aKey.baseOrder - bKey.baseOrder
      || a.paperTrack.localeCompare(b.paperTrack, 'ja')
  })
  return sorted.map((track, order) => ({ ...track, order }))
}

export function normalizeOverlayPaperTrackOrderInGaps(paperTracks: PaperTrack[]): PaperTrack[] {
  const sorted = normalizePaperTrackOrder(paperTracks)
  const lastOrderByGap = new Map<string, number>()
  const withGapOrder = sorted.map(track => {
    if (track.source !== 'overlay') return track
    const gapKey = track.exportPlacement?.insertAfterPaperTrack ?? ''
    const previousOrder = lastOrderByGap.get(gapKey) ?? -1
    const requestedOrder = Number.isFinite(track.exportPlacement?.orderInGap)
      ? track.exportPlacement?.orderInGap ?? 0
      : previousOrder + 1
    const orderInGap = requestedOrder > previousOrder ? requestedOrder : previousOrder + 1
    lastOrderByGap.set(gapKey, orderInGap)
    return {
      ...track,
      exportPlacement: {
        ...track.exportPlacement,
        orderInGap,
      },
    }
  })
  return normalizePaperTrackOrder(withGapOrder)
}

function paperTrackExportSortKey(track: PaperTrack, templateOrder: Map<string, number>): { position: number; orderInGap: number; baseOrder: number } {
  const baseOrder = templateOrder.get(track.paperTrack) ?? Number.MAX_SAFE_INTEGER
  if (track.source !== 'overlay') return { position: baseOrder, orderInGap: 0, baseOrder }
  const insertAfter = track.exportPlacement?.insertAfterPaperTrack
  const afterOrder = insertAfter ? templateOrder.get(insertAfter) : undefined
  return {
    position: (afterOrder ?? -1) + 0.5,
    orderInGap: track.exportPlacement?.orderInGap ?? 0,
    baseOrder,
  }
}

export function uniquePaperTrackName(project: Pick<CutProject, 'logicalSheet'>, requestedName: PaperTrackName): PaperTrackName {
  const trimmed = requestedName.trim()
  if (!trimmed) return nextOverlayPaperTrackName(project)
  if (!project.logicalSheet.paperTracks.some(track => track.paperTrack === trimmed)) return trimmed
  let index = 2
  let candidate = `${trimmed}${index}`
  while (project.logicalSheet.paperTracks.some(track => track.paperTrack === candidate)) {
    index += 1
    candidate = `${trimmed}${index}`
  }
  return candidate
}

export function nextOverlayPaperTrackName(project: Pick<CutProject, 'logicalSheet'>): PaperTrackName {
  const used = new Set(project.logicalSheet.paperTracks.map(track => track.paperTrack))
  for (let index = 0; index < 702; index += 1) {
    const candidate = alphabeticTrackLabel(index)
    if (!used.has(candidate)) return candidate
  }
  return uniquePaperTrackName(project, '追加')
}

export function nextOverlayOrderInGap(project: Pick<CutProject, 'logicalSheet'>, insertAfterPaperTrack: PaperTrackName | undefined): number {
  return project.logicalSheet.paperTracks
    .filter(track => track.source === 'overlay' && (track.exportPlacement?.insertAfterPaperTrack ?? '') === (insertAfterPaperTrack ?? ''))
    .reduce((max, track) => Math.max(max, track.exportPlacement?.orderInGap ?? 0), -1) + 1
}

export function nearestTemplatePaperTrackBeforeOverlay(project: Pick<CutProject, 'logicalSheet'>, snapIndex: number): PaperTrackName | undefined {
  const templateTracks = project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order)
  if (templateTracks.length === 0) return undefined
  const index = clampNumberForCore(Math.round(snapIndex), 0, templateTracks.length)
  return index <= 0 ? undefined : templateTracks[Math.min(index - 1, templateTracks.length - 1)]?.paperTrack
}

export function compareStackGuideLabelsForProject(project: Pick<CutProject, 'logicalSheet'>) {
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideStackBandOrder(stackGuideStackBand(a)) - stackGuideStackBandOrder(stackGuideStackBand(b))
    || stackGuideGapIndex(project, a) - stackGuideGapIndex(project, b)
    || a.orderInGap - b.orderInGap
    || a.label.localeCompare(b.label, 'ja')
    || a.labelId.localeCompare(b.labelId, 'ja')
}

export function compareStackGuideExportTracksForProject(
  project: Pick<CutProject, 'logicalSheet' | 'stackGuideLabels'>,
  a: ExportPlan['tracks'][number] & { stackGuideLabelId: string },
  b: ExportPlan['tracks'][number] & { stackGuideLabelId: string },
): number {
  const labelA = project.stackGuideLabels.find(label => label.labelId === a.stackGuideLabelId)
  const labelB = project.stackGuideLabels.find(label => label.labelId === b.stackGuideLabelId)
  if (!labelA || !labelB) return a.name.localeCompare(b.name, 'ja')
  return compareStackGuideLabelsForProject(project)(labelA, labelB)
}

export function stackGuideStackBand(label: Pick<StackGuideLabel, 'kind' | 'stackBand'>): StackGuideStackBand {
  return label.stackBand ?? defaultStackGuideStackBandForKind(label.kind)
}

export function stackGuideStackBandOrder(stackBand: StackGuideStackBand): number {
  if (stackBand === 'cell-interleave') return 0
  if (stackBand === 'camera-note') return 1
  return 2
}

export function defaultStackGuidePlacementForKind(kind: StackGuideLabel['kind']): StackGuideLabel['placement'] {
  return kind === 'camera-note' || kind === 'memo' ? 'above-cells' : 'between-cells'
}

export function defaultStackGuideStackBandForKind(kind: StackGuideLabel['kind']): StackGuideStackBand {
  if (kind === 'camera-note') return 'camera-note'
  if (kind === 'memo') return 'memo'
  return 'cell-interleave'
}

export function inferStackGuideLabelKind(label: string): StackGuideLabel['kind'] {
  const upper = label.trim().toUpperCase()
  if (upper.startsWith('BG')) return 'background'
  if (upper.startsWith('BOOK')) return 'book'
  if (upper.includes('CAM') || upper.includes('撮')) return 'camera-note'
  if (upper.includes('MEMO') || upper.includes('メモ')) return 'memo'
  if (upper.includes('原図')) return 'reference'
  return 'other'
}

export function defaultCorrectionLayerId(project: Pick<CutProject, 'correctionLayers'>): string | undefined {
  return defaultCorrectionLayerIdFromLayers(project.correctionLayers)
}

export function defaultCorrectionLayerFileNameSuffix(layer: Pick<CorrectionLayer, 'layerId' | 'label'> | undefined): string {
  switch (layer?.layerId) {
    case 'layer_enshutsu':
      return '_e'
    case 'layer_kantoku':
      return '_k'
    case 'layer_sakkan':
      return '_s'
    case 'layer_ryouri':
      return '_y'
    case 'layer_sousakkan':
      return '_ss'
    case 'layer_sakuga':
      return ''
  }
  switch (layer?.label) {
    case '演出':
      return '_e'
    case '監督':
      return '_k'
    case '作監':
      return '_s'
    case '料理':
      return '_y'
    case '総作監':
      return '_ss'
    case '作画':
      return ''
    default:
      return ''
  }
}

export function correctionLayerOrderById(project: Pick<CutProject, 'correctionLayers'>, layerId: string | undefined): number {
  const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
  return layer?.order ?? Number.MAX_SAFE_INTEGER
}

export function sheetTimingRoleForEvent(event: Pick<TimelineEvent, 'sheetRole'>): SheetTimingRole {
  return event.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE
}

export function sheetTimingRoleForKey(key: Pick<TimingKey, 'sheetRole'>): SheetTimingRole {
  return key.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE
}

export function defaultCspCellName(displayLabel: string, paperTrack: PaperTrackName): string {
  const trimmed = displayLabel.trim()
  if (isNullLabel(trimmed)) return NULL_CELL_CSP_CELL_NAME
  if (/^[A-Za-z]/.test(trimmed)) return trimmed
  return `${paperTrack}${trimmed}`
}

export function resolveCspCellName(input: {
  slot: CspTrackSlot
  key?: TimingKey
  binding?: CellBinding
  asset?: CutAsset
  event?: TimelineEvent
  policy?: CspCellNamePolicy
  sequenceIndex?: number
}): string {
  if (input.event && isNullCellEvent(input.event)) return NULL_CELL_CSP_CELL_NAME
  if (input.binding) return input.binding.cspCellName

  const policy = input.policy ?? DEFAULT_CSP_CELL_NAME_POLICY
  const displayLabel = input.key?.displayLabel ?? ''
  switch (policy.mode) {
    case 'binding-or-display-label':
      return displayLabelCspCellName(displayLabel)
    case 'binding-or-asset-name':
      return input.asset ? assetFileBaseName(input.asset) : defaultCspCellName(displayLabel, input.slot.paperTrack)
    case 'sequence':
      return typeof input.sequenceIndex === 'number'
        ? String(input.sequenceIndex).padStart(policy.sequencePadding ?? 3, '0')
        : defaultCspCellName(displayLabel, input.slot.paperTrack)
    case 'binding-or-paper-track-label':
      return defaultCspCellName(displayLabel, input.slot.paperTrack)
  }
}

function displayLabelCspCellName(displayLabel: string): string {
  const trimmed = displayLabel.trim()
  return isNullLabel(trimmed) ? NULL_CELL_CSP_CELL_NAME : trimmed
}

export function assetFileBaseName(asset: Pick<CutAsset, 'displayName' | 'originalFileName'>): string {
  return (asset.displayName || asset.originalFileName).replace(/\.[^.]+$/, '')
}

export function uniqueCspCellNameForSlot(project: CutProject, slotId: string, desiredName: string): string {
  const baseName = desiredName.trim() || 'CELL'
  const usedNames = new Set(
    project.bindings
      .filter(binding => binding.slotId === slotId)
      .map(binding => binding.cspCellName.trim().toLocaleLowerCase()),
  )
  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName

  let suffix = 2
  while (usedNames.has(`${baseName}_${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${baseName}_${suffix}`
}

export function isNullLabel(value: string): boolean {
  return ['x', 'X', '×', 'カラ', '空', 'null', 'NULL'].includes(value.trim())
}

export function isNullCellKeyId(keyId: string | null | undefined): boolean {
  return keyId === NULL_CELL_KEY_ID
}

export function isNullCellEvent(event: Pick<TimelineEvent, 'keyId'>): boolean {
  return isNullCellKeyId(event.keyId)
}

export function ensurePaperTrack(project: CutProject, paperTrack: PaperTrackName): void {
  if (!project.logicalSheet.paperTracks.some(track => track.paperTrack === paperTrack)) {
    throw new Error(`paperTrack not found: ${paperTrack}`)
  }
}

export function groupLabelForSlot(project: CutProject, slot: CspTrackSlot): string {
  const layer = project.correctionLayers.find(item => item.layerId === slot.correctionLayerId)
  return layer?.label ?? slot.displayPath
}

export function groupLabelForCorrectionLayer(project: Pick<CutProject, 'correctionLayers'>, correctionLayerId: string): string {
  const layer = project.correctionLayers.find(item => item.layerId === correctionLayerId)
  return (layer?.label ?? correctionLayerId) || '工程'
}

export function stageOrderForCorrectionLayer(project: Pick<CutProject, 'productionStages' | 'correctionLayers'>, correctionLayerId: string): number {
  const layer = project.correctionLayers.find(item => item.layerId === correctionLayerId)
  const stage = layer?.stageId ? project.productionStages.find(item => item.stageId === layer.stageId) : undefined
  return stage?.order ?? Number.MAX_SAFE_INTEGER
}

export function defaultProductionStages(): ProductionStage[] {
  return [
    { stageId: 'stage_lo', label: 'LO', order: 0 },
  ]
}

export function defaultCorrectionLayers(stageId: string): CorrectionLayer[] {
  return [
    { layerId: 'layer_sakuga', stageId, label: '作画', order: 0, role: 'base', defaultVisible: true, fileNameSuffix: '' },
    { layerId: 'layer_enshutsu', stageId, label: '演出', order: 1, role: 'correction', defaultVisible: true, fileNameSuffix: '_e' },
    { layerId: 'layer_kantoku', stageId, label: '監督', order: 2, role: 'review', defaultVisible: true, fileNameSuffix: '_k' },
    { layerId: 'layer_sakkan', stageId, label: '作監', order: 3, role: 'correction', defaultVisible: true, fileNameSuffix: '_s' },
    { layerId: 'layer_ryouri', stageId, label: '料理', order: 4, role: 'other', defaultVisible: true, fileNameSuffix: '_y' },
    { layerId: 'layer_sousakkan', stageId, label: '総作監', order: 5, role: 'review', defaultVisible: true, fileNameSuffix: '_ss' },
  ]
}

export function normalizeCorrectionLayers(
  inputLayers: CorrectionLayer[],
  productionStages: ProductionStage[],
  existingLayers: CorrectionLayer[],
): CorrectionLayer[] {
  if (inputLayers.length < 1) throw new Error('工程は最低1件必要です。')
  if (inputLayers.length > MAX_CORRECTION_LAYERS) throw new Error(`工程は最大${MAX_CORRECTION_LAYERS}件までです。`)
  const defaultStageId = productionStages[0]?.stageId ?? 'stage_default'
  const usedIds = new Set<string>()
  const usedLabels = new Set<string>()
  const existingById = new Map(existingLayers.map(layer => [layer.layerId, layer]))
  const baseInputIndex = inputLayers.findIndex(layer => layer.role === 'base')
  const baseIndex = baseInputIndex >= 0 ? baseInputIndex : 0

  return inputLayers.map((layer, index) => {
    const label = layer.label.trim()
    if (!label) throw new Error('工程名は空にできません。')
    if (usedLabels.has(label)) throw new Error(`工程名が重複しています: ${label}`)
    usedLabels.add(label)
    if (/[<>:"/\\|?*]/.test(layer.fileNameSuffix ?? '')) throw new Error(`工程「${label}」のサフィックスにファイル名で使えない文字があります。`)

    const generatedIdFragment = safeIdFragment(label)
    const generatedId = /^[\W_]+$/.test(generatedIdFragment)
      ? 'layer_custom'
      : `layer_${generatedIdFragment}`
    const baseId = layer.layerId?.trim()
      || uniqueId(generatedId, new Set([...existingLayers.map(item => item.layerId), ...usedIds]))
    const layerId = uniqueId(baseId, usedIds)
    usedIds.add(layerId)
    const existing = existingById.get(layer.layerId)
    const role: CorrectionLayer['role'] = index === baseIndex
      ? 'base'
      : layer.role === 'base'
        ? existing?.role === 'base' ? 'correction' : existing?.role ?? 'correction'
        : layer.role
    return {
      ...layer,
      layerId,
      stageId: productionStages.some(stage => stage.stageId === layer.stageId) ? layer.stageId : defaultStageId,
      label,
      order: index,
      role,
      defaultVisible: layer.defaultVisible ?? true,
      fileNameSuffix: layer.fileNameSuffix?.trim() ?? '',
    }
  })
}

export function createDefaultCspTrackSlots(
  paperTracks: PaperTrack[],
  productionStages: ProductionStage[],
  correctionLayers: CorrectionLayer[],
): CspTrackSlot[] {
  const layers: CorrectionLayer[] = correctionLayers.length > 0
    ? [...correctionLayers].sort((a, b) => a.order - b.order)
    : [{ layerId: 'layer_base', stageId: productionStages[0]?.stageId ?? 'stage_default', label: '作画', order: 0, role: 'base', defaultVisible: true }]
  const usedIds = new Set<string>()
  return paperTracks.flatMap<CspTrackSlot>((track, trackIndex) =>
    layers.map((layer, layerIndex) => {
      const slotId = uniqueId(defaultSlotId(track.paperTrack, layer), usedIds)
      usedIds.add(slotId)
      return {
        slotId,
        paperTrack: track.paperTrack,
        stageId: layer.stageId,
        correctionLayerId: layer.layerId,
        displayPath: [layer.label, track.paperTrack].filter(Boolean).join('/'),
        xdtsName: track.paperTrack,
        trackNo: trackIndex * layers.length + layerIndex,
        occurrenceIndex: layerIndex,
        resolutionSource: 'preset',
      }
    }),
  )
}

export function reconcileCspTrackSlots(
  paperTracks: PaperTrack[],
  productionStages: ProductionStage[],
  correctionLayers: CorrectionLayer[],
  existingSlots: CspTrackSlot[],
): CspTrackSlot[] {
  const usedSlotIds = new Set<string>()
  return createDefaultCspTrackSlots(paperTracks, productionStages, correctionLayers).map(defaultSlot => {
    const existing = existingSlots.find(slot =>
      slot.paperTrack === defaultSlot.paperTrack
      && slot.correctionLayerId === defaultSlot.correctionLayerId,
    )
    const slot = existing
      ? {
          ...defaultSlot,
          slotId: existing.slotId,
          resolutionSource: existing.resolutionSource,
        }
      : defaultSlot
    const slotId = uniqueId(slot.slotId, usedSlotIds)
    usedSlotIds.add(slotId)
    return slotId === slot.slotId ? slot : { ...slot, slotId }
  })
}

function defaultSlotId(paperTrack: PaperTrackName, layer: CorrectionLayer): string {
  const trackKey = safeIdFragment(paperTrack)
  if (layer.role === 'base') return `slot_${trackKey}`
  return `slot_${safeIdFragment(layer.layerId.replace(/^layer_/, ''))}_${trackKey}`
}

function defaultCorrectionLayerIdFromLayers(layers: CorrectionLayer[]): string | undefined {
  const sorted = [...layers].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  return sorted.find(layer => layer.role === 'base')?.layerId ?? sorted[0]?.layerId
}

export function correctionLayerIdForSlot(project: Pick<CutProject, 'correctionLayers'>, slot: Pick<CspTrackSlot, 'correctionLayerId'>): string | undefined {
  if (slot.correctionLayerId && project.correctionLayers.some(layer => layer.layerId === slot.correctionLayerId)) return slot.correctionLayerId
  return defaultCorrectionLayerId(project)
}

export function sameEventTarget(
  event: TimelineEvent,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole,
): boolean {
  return event.paperTrack === paperTrack
    && event.frame === frame
    && sheetTimingRoleForEvent(event) === sheetRole
}

export function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  return sheetTimingRoleForEvent(a).localeCompare(sheetTimingRoleForEvent(b))
    || a.paperTrack.localeCompare(b.paperTrack)
    || a.frame - b.frame
}

export function eventsForSlot(project: CutProject, slot: CspTrackSlot, sheetRole: SheetTimingRole): TimelineEvent[] {
  return project.logicalSheet.events
    .filter(event => event.paperTrack === slot.paperTrack && sheetTimingRoleForEvent(event) === sheetRole)
    .sort((a, b) => a.frame - b.frame)
}

export function exportEventsForSlot(project: CutProject, slot: CspTrackSlot, sheetRole: SheetTimingRole): TimelineEvent[] {
  const startFrame = project.logicalSheet.frameOrigin
  const endFrame = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const events = eventsForSlot(project, slot, sheetRole).filter(event => event.frame <= endFrame)
  let carryIntoStart: TimelineEvent | undefined
  const officialEvents: TimelineEvent[] = []
  for (const event of events) {
    if (event.frame < startFrame) {
      carryIntoStart = event
    } else {
      officialEvents.push(event)
    }
  }
  if (!carryIntoStart || officialEvents[0]?.frame === startFrame || isNullCellEvent(carryIntoStart)) return officialEvents
  return [{ ...carryIntoStart, eventId: `${carryIntoStart.eventId}:export-start`, frame: startFrame }, ...officialEvents]
}

export function normalizePaperTrackLabels(labels: PaperTrackName[]): PaperTrackName[] {
  const seen = new Set<string>()
  const normalized: PaperTrackName[] = []
  for (const label of labels) {
    const trimmed = label.trim()
    if (!trimmed || seen.has(trimmed)) continue
    normalized.push(trimmed)
    seen.add(trimmed)
  }
  return normalized
}

function safeIdFragment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_') || 'track'
}

export function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let index = 2
  let id = `${base}_${index}`
  while (used.has(id)) {
    index += 1
    id = `${base}_${index}`
  }
  return id
}
