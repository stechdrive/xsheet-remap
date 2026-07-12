import type { CspTrackSlot, CspCellNamePolicy, CutProject, ExportMode, ExportPlan, LogicalSheet, NameNormalizationAssetRename, NameNormalizationAssetRenameResult, NameNormalizationOptions, NameNormalizationPlan, NameNormalizationPlanItem, PaperTrackName, SheetTimingRole, StackGuideLabel, StackGuideRegistration, TimingKey } from './types'
import type { SheetTemplate } from './sheet-template-schema'
import { normalizeLogicalSheetWorkRange } from './logical-sheet'
import { withoutUndefined } from './core-utils'
import { validateProject } from './validation'
import { CSP_IMPORT_STACK_END_SEPARATOR_NAME, CSP_IMPORT_STACK_START_SEPARATOR_NAME, DEFAULT_CSP_CELL_NAME_POLICY, DEFAULT_EXPORT_TIMING_ROLE } from './project-constants'
import { compareStackGuideExportTracksForProject, compareStackGuideLabelsForProject, correctionLayerIdForSlot, correctionLayerOrderById, correctionLayerFileNameSuffix, defaultCorrectionLayerId, eventsForSlot, exportEventsForSlot, groupLabelForCorrectionLayer, groupLabelForSlot, isNullCellEvent, resolveCspCellName, sanitizeFileBaseName, sequenceCspCellName, sheetTimingRoleForEvent, sheetTimingRoleForKey, stackGuideCspCellName, stackGuideGapIndex, stackGuideRegistrationForLayer, stackGuideRegistrations, stackGuideStackBand, stackGuideStackBandOrder, stageOrderForCorrectionLayer } from './project-shared'
import { assetAbsolutePath } from './assets'
import { resolveCutExportIdentity } from './project-export-identity'

export function buildNameNormalizationPlan(project: CutProject, options: NameNormalizationOptions): NameNormalizationPlan {
  const sheetRole = options.sheetRole
  const targetKeyIds = new Set(options.keyIds ?? [])
  const targetPaperTracks = new Set(options.paperTracks ?? [])
  const targetCorrectionLayerIds = new Set(options.correctionLayerIds ?? [])
  const sequencePadding = resolveNameNormalizationSequencePadding(project, sheetRole, options.sequencePadding, options.includeStackGuides)
  const keySequence = buildNormalizedKeySequence(project, sheetRole)
  const targetKeys = project.logicalSheet.keys.filter(key => {
    if (sheetTimingRoleForKey(key) !== sheetRole) return false
    if (targetKeyIds.size > 0 && !targetKeyIds.has(key.keyId)) return false
    if (targetPaperTracks.size > 0 && !targetPaperTracks.has(key.paperTrack)) return false
    return true
  })
  const targetKeyIdSet = new Set(targetKeys.map(key => key.keyId))
  const bindingItems = project.bindings
    .flatMap<NameNormalizationPlanItem>(binding => {
      if (!targetKeyIdSet.has(binding.keyId)) return []
      const key = project.logicalSheet.keys.find(item => item.keyId === binding.keyId)
      const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
      if (!key || !slot) return []
      if (targetCorrectionLayerIds.size > 0 && (!slot.correctionLayerId || !targetCorrectionLayerIds.has(slot.correctionLayerId))) return []
      const asset = binding.assetId ? project.assets.find(item => item.assetId === binding.assetId) : undefined
      const nextCspCellName = normalizedCspCellNameForSlot(project, key, slot, keySequence.get(key.keyId) ?? 1, sequencePadding)
      return [{
        itemId: `${binding.bindingId}:${nextCspCellName}`,
        targetType: 'binding',
        bindingId: binding.bindingId,
        keyId: binding.keyId,
        slotId: binding.slotId,
        paperTrack: key.paperTrack,
        displayLabel: key.displayLabel,
        processLabel: processLabelForSlot(project, slot),
        correctionLayerId: slot.correctionLayerId,
        currentCspCellName: binding.cspCellName,
        nextCspCellName,
        cspCellNameChanged: binding.cspCellName !== nextCspCellName,
        assetId: binding.assetId,
        assetDisplayName: asset?.displayName,
      }]
    })
  const stackGuideItems = options.includeStackGuides
    ? buildStackGuideNameNormalizationItems(project, sequencePadding, targetCorrectionLayerIds)
    : []
  const items = [...bindingItems, ...stackGuideItems]
    .sort(compareNameNormalizationPlanItems)
  const assetRenames = options.includeAssetFiles ? buildAssetRenamePlan(project, items, sheetRole) : []
  const warnings = [
    ...(items.length === 0 ? ['対象に正規化できるCSPセル名がありません。'] : []),
    ...assetRenames.flatMap(rename => rename.warnings.map(warning => `${rename.currentFileName}: ${warning}`)),
  ]
  return { options, items, assetRenames, warnings }
}

export function applyNameNormalizationPlan(
  project: CutProject,
  plan: NameNormalizationPlan,
  assetRenameResults: NameNormalizationAssetRenameResult[] = [],
): CutProject {
  const cspNameByBindingId = new Map(plan.items
    .filter(item => item.targetType !== 'stack-guide')
    .map(item => [item.bindingId, item.nextCspCellName]))
  const cspNameByStackGuideRegistration = new Map(plan.items
    .filter(item => item.targetType === 'stack-guide' && item.stackGuideLabelId && item.stackGuideRegistrationId)
    .map(item => [`${item.stackGuideLabelId}:${item.stackGuideRegistrationId}`, item.nextCspCellName]))
  const renameResultByAssetId = new Map(assetRenameResults.filter(result => result.renamed).map(result => [result.assetId, result]))
  return {
    ...project,
    bindings: project.bindings.map(binding => {
      const cspCellName = cspNameByBindingId.get(binding.bindingId)
      return cspCellName ? { ...binding, cspCellName } : binding
    }),
    stackGuideLabels: project.stackGuideLabels.map(label => ({
      ...label,
      registrations: stackGuideRegistrations(label).map(registration => {
        const cspCellName = cspNameByStackGuideRegistration.get(`${label.labelId}:${registration.registrationId}`)
        return cspCellName ? { ...registration, cspCellName } : registration
      }),
    })),
    assets: project.assets.map(asset => {
      const result = renameResultByAssetId.get(asset.assetId)
      if (!result?.nextFileName) return asset
      return {
        ...asset,
        displayName: result.nextFileName,
        source: asset.source.kind === 'root-relative'
          ? { ...asset.source, relativePath: replacePathFileName(asset.source.relativePath, result.nextFileName) }
          : result.nextPath
            ? { kind: 'external-file' as const, absolutePath: result.nextPath }
            : asset.source,
      }
    }),
  }
}

export function updateLogicalSheetSettings(
  project: CutProject,
  updates: Partial<Pick<LogicalSheet, 'fps' | 'durationFrames' | 'frameOrigin' | 'allowNegativeFrames' | 'workRange'>>,
): CutProject {
  const workRange = normalizeLogicalSheetWorkRange({
    ...project.logicalSheet.workRange,
    ...updates.workRange,
  })
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      ...withoutUndefined(updates),
      fps: Math.max(1, Math.round(updates.fps ?? project.logicalSheet.fps)),
      durationFrames: Math.max(1, Math.round(updates.durationFrames ?? project.logicalSheet.durationFrames)),
      workRange,
    },
  }
}

export interface BuildExportPlanOptions {
  profileId?: string
  timingSourceRole?: SheetTimingRole
  sheetTemplate?: Pick<SheetTemplate, 'naming'>
  fallbackCutId?: string
}

export function buildExportPlan(project: CutProject, options: BuildExportPlanOptions = {}): ExportPlan {
  const profileId = options.profileId ?? project.exportProfiles[0]?.profileId ?? 'import-stack'
  const profile = project.exportProfiles.find(item => item.profileId === profileId) ?? project.exportProfiles[0]
  const mode: ExportMode = profile?.mode ?? 'direct-to-visible-slots'
  const timingSourceRole = options.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE
  const cspCellNamePolicy = profile?.cspCellNamePolicy ?? DEFAULT_CSP_CELL_NAME_POLICY
  const validation = validateProject(project, profile)
  const identity = resolveCutExportIdentity(project, options.sheetTemplate, options.fallbackCutId)
  const selectedSlots = (profile?.slotIds ?? project.cspTrackSlots.map(slot => slot.slotId))
    .map(slotId => project.cspTrackSlots.find(slot => slot.slotId === slotId))
    .filter((slot): slot is CspTrackSlot => Boolean(slot))
    .sort((a, b) => a.trackNo - b.trackNo)

  const tracks = mode === 'import-stack'
    ? buildImportStackTracks(
      project,
      selectedSlots,
      timingSourceRole,
      cspCellNamePolicy,
    )
    : buildDirectExportTracks(project, selectedSlots, timingSourceRole, cspCellNamePolicy)

  return {
    mode,
    metadata: {
      cut: identity.cutNumber,
      scene: identity.sceneNumber,
      displayName: identity.displayName,
      timeTableName: identity.timelineName,
    },
    timingSourceRole,
    durationFrames: project.logicalSheet.durationFrames,
    fps: project.logicalSheet.fps,
    tracks,
    validation,
    cspInstructions: buildCspInstructions(mode),
  }
}

function buildDirectExportTracks(
  project: CutProject,
  selectedSlots: CspTrackSlot[],
  timingSourceRole: SheetTimingRole,
  cspCellNamePolicy: CspCellNamePolicy,
): ExportPlan['tracks'] {
  const tracks: ExportPlan['tracks'] = []
  for (const slot of selectedSlots) {
    const events = exportEventsForSlot(project, slot, timingSourceRole)
    const eventKeyIds = new Set(events.map(event => event.keyId))
    const slotHasBinding = project.bindings.some(binding => binding.slotId === slot.slotId && eventKeyIds.has(binding.keyId))
    const trackHasBinding = selectedSlots.some(candidate =>
      candidate.paperTrack === slot.paperTrack
      && project.bindings.some(binding => binding.slotId === candidate.slotId && eventKeyIds.has(binding.keyId))
    )
    if (events.length === 0) continue
    if (!slotHasBinding && trackHasBinding) continue
    if (!slotHasBinding && !trackHasBinding && correctionLayerIdForSlot(project, slot) !== defaultCorrectionLayerId(project)) continue

    const frames = events.map(event => {
      const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
      const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === event.keyId)
      return {
        frame: event.frame - project.logicalSheet.frameOrigin,
        value: key || binding || isNullCellEvent(event)
          ? resolveCspCellName({ slot, key, binding, event, policy: cspCellNamePolicy })
          : null,
      }
    })

    tracks.push({
      trackNo: slot.trackNo,
      name: slot.xdtsName,
      slotId: slot.slotId,
      frames,
    })
  }
  return tracks
}

function buildImportStackTracks(
  project: CutProject,
  selectedSlots: CspTrackSlot[],
  timingSourceRole: SheetTimingRole,
  cspCellNamePolicy: CspCellNamePolicy,
): ExportPlan['tracks'] {
  const selectedSlotIds = new Set(selectedSlots.map(slot => slot.slotId))
  const sortedSlots = [...selectedSlots].sort((a, b) => compareImportStackSlots(project, a, b))
  const groups: Array<{ label: string; correctionLayerId: string; slots: CspTrackSlot[] }> = []

  const ensureGroup = (correctionLayerId: string, label: string) => {
    const existing = groups.find(item => item.correctionLayerId === correctionLayerId)
    if (existing) return existing
    const group = { label, correctionLayerId, slots: [] }
    groups.push(group)
    return group
  }

  for (const slot of sortedSlots) {
    const correctionLayerId = correctionLayerIdForSlot(project, slot) ?? defaultCorrectionLayerId(project) ?? ''
    const label = groupLabelForSlot(project, slot) || '工程'
    ensureGroup(correctionLayerId, label).slots.push(slot)
  }
  for (const label of project.stackGuideLabels) {
    if (!label.label.trim()) continue
    for (const registration of stackGuideRegistrations(label)) {
      const correctionLayerId = registration.correctionLayerId
      if (!correctionLayerId) continue
      ensureGroup(correctionLayerId, groupLabelForCorrectionLayer(project, correctionLayerId))
    }
  }

  const tracks: ExportPlan['tracks'] = []
  let outputTrackNo = 0
  const pendingTracks: ExportPlan['tracks'] = []

  for (const group of groups.sort((a, b) => compareImportStackGroups(project, a, b))) {
    const slotTracks = group.slots.flatMap(slot => {
      const frames = buildImportStackFramesForSlot(project, slot, timingSourceRole, selectedSlotIds, cspCellNamePolicy)
      return frames.length > 0 ? [{ kind: 'slot' as const, slot, frames }] : []
    })
    const stackGuideTracks = buildStackGuideImportTracks(project, group.correctionLayerId)
      .map(track => ({ kind: 'stack-guide' as const, track }))
    const groupTracks = [...slotTracks, ...stackGuideTracks].sort((a, b) => compareImportStackGroupEntries(project, a, b))
    if (groupTracks.length === 0) continue

    pendingTracks.push({
      trackNo: -1,
      name: `===== ${group.label} =====`,
      dummy: true,
      frames: [{ frame: 0, value: null }],
    })

    for (const entry of groupTracks) {
      if (entry.kind === 'slot') {
        pendingTracks.push({
          trackNo: -1,
          name: entry.slot.xdtsName,
          slotId: entry.slot.slotId,
          frames: entry.frames,
        })
      } else {
        pendingTracks.push({
          ...entry.track,
          trackNo: -1,
        })
      }
    }
  }

  const addDummyTrack = (name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    tracks.push({
      trackNo: outputTrackNo,
      name: trimmedName,
      dummy: true,
      frames: [{ frame: 0, value: null }],
    })
    outputTrackNo += 1
  }

  if (pendingTracks.length > 0) {
    addDummyTrack(CSP_IMPORT_STACK_START_SEPARATOR_NAME)
    for (const track of pendingTracks) {
      tracks.push({ ...track, trackNo: outputTrackNo })
      outputTrackNo += 1
    }
    addDummyTrack(CSP_IMPORT_STACK_END_SEPARATOR_NAME)
  }

  return tracks
}

type ImportStackGroupEntry =
  | { kind: 'slot'; slot: CspTrackSlot; frames: ExportPlan['tracks'][number]['frames'] }
  | { kind: 'stack-guide'; track: ExportPlan['tracks'][number] & { stackGuideLabelId: string; stackGuideRegistrationId?: string } }

function buildStackGuideImportTracks(project: CutProject, correctionLayerId: string): Array<ExportPlan['tracks'][number] & { stackGuideLabelId: string; stackGuideRegistrationId?: string }> {
  return project.stackGuideLabels
    .flatMap(label => {
      if (!label.label.trim()) return []
      const registration = stackGuideRegistrationForLayer(label, correctionLayerId)
      if (!registration) return []
      return [{
        trackNo: -1,
        name: label.label.trim(),
        stackGuideLabelId: label.labelId,
        stackGuideRegistrationId: registration.registrationId,
        frames: [{ frame: 0, value: stackGuideCspCellName(label, registration) }],
      }]
    })
    .sort((a, b) => compareStackGuideExportTracksForProject(project, a, b))
}

function compareImportStackGroupEntries(project: CutProject, a: ImportStackGroupEntry, b: ImportStackGroupEntry): number {
  const aPosition = importStackGroupEntryPosition(project, a)
  const bPosition = importStackGroupEntryPosition(project, b)
  return aPosition.position - bPosition.position
    || aPosition.orderInGap - bPosition.orderInGap
    || aPosition.trackNo - bPosition.trackNo
    || aPosition.name.localeCompare(bPosition.name, 'ja')
}

function importStackGroupEntryPosition(project: CutProject, entry: ImportStackGroupEntry): { position: number; orderInGap: number; trackNo: number; name: string } {
  if (entry.kind === 'slot') {
    const paperTrack = project.logicalSheet.paperTracks.find(track => track.paperTrack === entry.slot.paperTrack)
    if (paperTrack?.source === 'overlay') {
      const insertAfter = paperTrack.exportPlacement?.insertAfterPaperTrack
      const anchorIndex = insertAfter ? project.logicalSheet.paperTracks.findIndex(track => track.paperTrack === insertAfter) : -1
      return {
        position: anchorIndex + 1,
        orderInGap: paperTrack.exportPlacement?.orderInGap ?? 0,
        trackNo: entry.slot.trackNo,
        name: entry.slot.xdtsName,
      }
    }
    return {
      position: paperTrackOrder(project, entry.slot.paperTrack) + 0.5,
      orderInGap: 0,
      trackNo: entry.slot.trackNo,
      name: entry.slot.xdtsName,
    }
  }
  const label = project.stackGuideLabels.find(item => item.labelId === entry.track.stackGuideLabelId)
  const stackBand = label ? stackGuideStackBand(label) : 'cell-interleave'
  if (stackBand !== 'cell-interleave') {
    return {
      position: project.logicalSheet.paperTracks.length + stackGuideStackBandOrder(stackBand),
      orderInGap: label?.orderInGap ?? 0,
      trackNo: Number.MAX_SAFE_INTEGER,
      name: entry.track.name,
    }
  }
  return {
    position: label ? stackGuideGapIndex(project, label) : Number.MAX_SAFE_INTEGER,
    orderInGap: label?.orderInGap ?? 0,
    trackNo: Number.MAX_SAFE_INTEGER,
    name: entry.track.name,
  }
}

function buildImportStackFramesForSlot(
  project: CutProject,
  slot: CspTrackSlot,
  timingSourceRole: SheetTimingRole,
  selectedSlotIds: Set<string>,
  cspCellNamePolicy: CspCellNamePolicy,
): ExportPlan['tracks'][number]['frames'] {
  const frames: ExportPlan['tracks'][number]['frames'] = []
  const events = exportEventsForSlot(project, slot, timingSourceRole)
  const defaultLayerId = defaultCorrectionLayerId(project)
  const slotLayerId = correctionLayerIdForSlot(project, slot)
  let hasOutput = false
  let previousValue: string | null = null

  for (const event of events) {
    const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
    const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === event.keyId)
    const hasSelectedBinding = project.bindings.some(item => item.keyId === event.keyId && selectedSlotIds.has(item.slotId))
    const nextValue = isNullCellEvent(event)
      ? slotLayerId === defaultLayerId
        ? resolveCspCellName({ slot, key, binding, event, policy: cspCellNamePolicy })
        : undefined
      : binding
      ? resolveCspCellName({ slot, key, binding, event, policy: cspCellNamePolicy })
      : !hasSelectedBinding && slotLayerId === defaultLayerId && key
        ? resolveCspCellName({ slot, key, event, policy: cspCellNamePolicy })
        : undefined

    if (nextValue === undefined) {
      if (hasOutput && previousValue !== null) {
        frames.push({ frame: event.frame - project.logicalSheet.frameOrigin, value: null })
        previousValue = null
      }
      continue
    }

    if (!hasOutput || nextValue !== previousValue) {
      frames.push({ frame: event.frame - project.logicalSheet.frameOrigin, value: nextValue })
    }
    hasOutput = true
    previousValue = nextValue
  }

  return frames
}

function compareImportStackSlots(project: CutProject, a: CspTrackSlot, b: CspTrackSlot): number {
  return stageOrderForSlot(project, a) - stageOrderForSlot(project, b)
    || correctionLayerOrderForSlot(project, a) - correctionLayerOrderForSlot(project, b)
    || paperTrackOrder(project, a.paperTrack) - paperTrackOrder(project, b.paperTrack)
    || (a.occurrenceIndex ?? 0) - (b.occurrenceIndex ?? 0)
    || a.trackNo - b.trackNo
    || a.slotId.localeCompare(b.slotId)
}

function compareImportStackGroups(
  project: CutProject,
  a: { label: string; correctionLayerId: string },
  b: { label: string; correctionLayerId: string },
): number {
  return stageOrderForCorrectionLayer(project, a.correctionLayerId) - stageOrderForCorrectionLayer(project, b.correctionLayerId)
    || correctionLayerOrderById(project, a.correctionLayerId) - correctionLayerOrderById(project, b.correctionLayerId)
    || a.label.localeCompare(b.label, 'ja')
}

function stageOrderForSlot(project: CutProject, slot: CspTrackSlot): number {
  const layer = slot.correctionLayerId ? project.correctionLayers.find(item => item.layerId === slot.correctionLayerId) : undefined
  const stageId = slot.stageId ?? layer?.stageId
  const stage = stageId ? project.productionStages.find(item => item.stageId === stageId) : undefined
  return stage?.order ?? Number.MAX_SAFE_INTEGER
}

function correctionLayerOrderForSlot(project: CutProject, slot: CspTrackSlot): number {
  const layerId = correctionLayerIdForSlot(project, slot)
  const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
  return layer?.order ?? Number.MAX_SAFE_INTEGER
}

function paperTrackOrder(project: CutProject, paperTrack: PaperTrackName): number {
  return project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)?.order ?? Number.MAX_SAFE_INTEGER
}

function buildNormalizedKeySequence(project: CutProject, sheetRole: SheetTimingRole): Map<string, number> {
  const result = new Map<string, number>()
  for (const track of project.logicalSheet.paperTracks) {
    const keys = project.logicalSheet.keys
      .filter(key => key.paperTrack === track.paperTrack && sheetTimingRoleForKey(key) === sheetRole)
      .sort((a, b) =>
        firstEventFrameForKey(project, a.keyId, sheetRole) - firstEventFrameForKey(project, b.keyId, sheetRole)
        || compareNaturalText(a.displayLabel, b.displayLabel)
        || a.keyId.localeCompare(b.keyId),
      )
    keys.forEach((key, index) => {
      result.set(key.keyId, index + 1)
    })
  }
  return result
}

function resolveNameNormalizationSequencePadding(project: CutProject, sheetRole: SheetTimingRole, explicitPadding: number | undefined, includeStackGuides = false): number {
  if (typeof explicitPadding === 'number') return Math.max(0, explicitPadding)
  const keySequence = buildNormalizedKeySequence(project, sheetRole)
  const stackGuideSequence = includeStackGuides ? buildNormalizedStackGuideSequence(project) : new Map<string, number>()
  const maxSequence = Math.max(0, ...keySequence.values(), ...stackGuideSequence.values())
  return Math.max(2, String(maxSequence).length)
}

function normalizedCspCellNameForSlot(project: CutProject, key: TimingKey, slot: CspTrackSlot, sequenceIndex: number, sequencePadding: number): string {
  return sequenceCspCellName(project, key.paperTrack, slot.correctionLayerId, sequenceIndex, sequencePadding)
}

function buildNormalizedStackGuideSequence(project: CutProject): Map<string, number> {
  const result = new Map<string, number>()
  const sequenceByTrackName = new Map<string, number>()
  for (const label of [...project.stackGuideLabels].sort(compareStackGuideLabelsForProject(project))) {
    if (!label.label.trim()) continue
    const trackName = label.label.trim()
    const sequenceIndex = (sequenceByTrackName.get(trackName) ?? 0) + 1
    sequenceByTrackName.set(trackName, sequenceIndex)
    result.set(label.labelId, sequenceIndex)
  }
  return result
}

function buildStackGuideNameNormalizationItems(
  project: CutProject,
  sequencePadding: number,
  targetCorrectionLayerIds: ReadonlySet<string> = new Set(),
): NameNormalizationPlanItem[] {
  const stackGuideSequence = buildNormalizedStackGuideSequence(project)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const layersById = new Map(project.correctionLayers.map(layer => [layer.layerId, layer]))
  return [...project.stackGuideLabels]
    .sort(compareStackGuideLabelsForProject(project))
    .flatMap<NameNormalizationPlanItem>(label => {
      if (!label.label.trim()) return []
      const sequenceIndex = stackGuideSequence.get(label.labelId) ?? 1
      return stackGuideRegistrations(label).flatMap(registration => {
        if (targetCorrectionLayerIds.size > 0 && !targetCorrectionLayerIds.has(registration.correctionLayerId)) return []
        const nextCspCellName = normalizedCspCellNameForStackGuide(project, label, registration, sequenceIndex, sequencePadding)
        const assetIds = registration.assetIds.length > 0 ? registration.assetIds : [undefined]
        return assetIds.flatMap(assetId => {
          const asset = assetId ? assetsById.get(assetId) : undefined
          if (assetId && !asset) return []
          const itemId = `stack-guide:${label.labelId}:${registration.registrationId}:${assetId ?? 'no-asset'}`
          return [{
            itemId,
            targetType: 'stack-guide',
            bindingId: itemId,
            keyId: label.labelId,
            slotId: registration.correctionLayerId,
            stackGuideLabelId: label.labelId,
            stackGuideRegistrationId: registration.registrationId,
            paperTrack: label.label,
            displayLabel: stackGuideDisplayLabel(label),
            processLabel: layersById.get(registration.correctionLayerId)?.label ?? registration.correctionLayerId,
            correctionLayerId: registration.correctionLayerId,
            currentCspCellName: stackGuideCspCellName(label, registration),
            nextCspCellName,
            cspCellNameChanged: stackGuideCspCellName(label, registration) !== nextCspCellName,
            assetId,
            assetDisplayName: asset?.displayName,
          }]
        })
      })
    })
}

function normalizedCspCellNameForStackGuide(
  project: CutProject,
  label: Pick<StackGuideLabel, 'label'>,
  registration: Pick<StackGuideRegistration, 'correctionLayerId'>,
  sequenceIndex: number,
  sequencePadding: number,
): string {
  const cellNumber = String(sequenceIndex).padStart(sequencePadding, '0')
  const suffix = correctionLayerFileNameSuffix(project, registration.correctionLayerId)
  return sanitizeFileBaseName(`${label.label}_${cellNumber}${suffix}`)
}

function stackGuideDisplayLabel(label: Pick<StackGuideLabel, 'kind'>): string {
  if (label.kind === 'camera-note') return '撮影指示'
  if (label.kind === 'memo') return 'メモ'
  if (label.kind === 'background' || label.kind === 'book' || label.kind === 'reference') return 'BG/BOOK'
  return '補助'
}

function buildAssetRenamePlan(project: CutProject, items: NameNormalizationPlanItem[], sheetRole: SheetTimingRole): NameNormalizationAssetRename[] {
  const columnCounts = columnRegistrationCounts(project, sheetRole)
  for (const item of items) {
    if (item.targetType !== 'stack-guide') continue
    columnCounts.set(item.paperTrack, (columnCounts.get(item.paperTrack) ?? 0) + 1)
  }
  const itemsByAssetId = new Map<string, NameNormalizationPlanItem[]>()
  for (const item of items) {
    if (!item.assetId) continue
    const current = itemsByAssetId.get(item.assetId) ?? []
    current.push(item)
    itemsByAssetId.set(item.assetId, current)
  }

  const renames = Array.from(itemsByAssetId.entries())
    .flatMap<NameNormalizationAssetRename>(([assetId, assetItems]) => {
      const asset = project.assets.find(item => item.assetId === assetId)
      if (!asset) return []
      const representativePaperTrack = representativePaperTrackForAssetItems(assetItems, columnCounts)
      const representativeItem = assetItems
        .filter(item => item.paperTrack === representativePaperTrack)
        .sort((a, b) =>
          (columnCounts.get(b.paperTrack) ?? 0) - (columnCounts.get(a.paperTrack) ?? 0)
          || correctionLayerOrderById(project, a.correctionLayerId) - correctionLayerOrderById(project, b.correctionLayerId)
          || compareNaturalText(a.nextCspCellName, b.nextCspCellName)
          || a.bindingId.localeCompare(b.bindingId),
        )[0] ?? assetItems[0]
      if (!representativeItem) return []

      const currentFileName = asset.displayName || asset.originalFileName
      const nextFileName = `${representativeItem.nextCspCellName}${fileExtension(currentFileName)}`
      const currentPath = assetAbsolutePath(asset, project.assetRoot)
      const nextPath = currentPath ? replacePathFileName(currentPath, nextFileName) : undefined
      const requestedNames = Array.from(new Set(assetItems.map(item => item.nextCspCellName))).sort(compareNaturalText)
      const warnings = [
        ...(currentPath ? [] : ['実ファイルパスがないためリネームできません。']),
        ...(requestedNames.length > 1 ? [`同一素材に複数のCSPセル名候補があります: ${requestedNames.join(', ')}`] : []),
      ]
      const changed = currentFileName !== nextFileName
      return [{
        assetId,
        currentFileName,
        nextFileName,
        currentPath,
        nextPath,
        representativePaperTrack,
        representativeReason: `${representativePaperTrack}列 ${columnCounts.get(representativePaperTrack) ?? 0}件`,
        canRename: Boolean(currentPath && nextPath && changed),
        warnings,
      }]
    })
    .sort((a, b) => compareNaturalText(a.currentFileName, b.currentFileName) || a.assetId.localeCompare(b.assetId))

  const targetPathCounts = new Map<string, number>()
  for (const rename of renames) {
    if (!rename.nextPath) continue
    targetPathCounts.set(rename.nextPath, (targetPathCounts.get(rename.nextPath) ?? 0) + 1)
  }
  return renames.map(rename => {
    if (!rename.nextPath || (targetPathCounts.get(rename.nextPath) ?? 0) <= 1) return rename
    return {
      ...rename,
      canRename: false,
      warnings: [...rename.warnings, '同じ変更後パスを持つ素材が複数あります。'],
    }
  })
}

function compareNameNormalizationPlanItems(a: NameNormalizationPlanItem, b: NameNormalizationPlanItem): number {
  return paperTrackNameCompare(a.paperTrack, b.paperTrack)
    || correctionLayerOrderText(a.correctionLayerId) - correctionLayerOrderText(b.correctionLayerId)
    || compareNaturalText(a.nextCspCellName, b.nextCspCellName)
    || a.bindingId.localeCompare(b.bindingId)
}

function representativePaperTrackForAssetItems(items: NameNormalizationPlanItem[], columnCounts: Map<string, number>): PaperTrackName {
  return Array.from(new Set(items.map(item => item.paperTrack)))
    .sort((a, b) =>
      (columnCounts.get(b) ?? 0) - (columnCounts.get(a) ?? 0)
      || paperTrackNameCompare(a, b),
    )[0] ?? items[0]?.paperTrack ?? ''
}

function columnRegistrationCounts(project: CutProject, sheetRole: SheetTimingRole): Map<string, number> {
  const usedKeysByTrack = new Map<string, Set<string>>()
  for (const event of project.logicalSheet.events) {
    if (sheetTimingRoleForEvent(event) !== sheetRole || isNullCellEvent(event)) continue
    const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
    if (!key) continue
    const current = usedKeysByTrack.get(event.paperTrack) ?? new Set<string>()
    current.add(event.keyId)
    usedKeysByTrack.set(event.paperTrack, current)
  }
  const counts = new Map<string, number>()
  for (const track of project.logicalSheet.paperTracks) {
    const usedCount = usedKeysByTrack.get(track.paperTrack)?.size ?? 0
    const registeredCount = project.logicalSheet.keys.filter(key => key.paperTrack === track.paperTrack && sheetTimingRoleForKey(key) === sheetRole).length
    counts.set(track.paperTrack, usedCount || registeredCount)
  }
  return counts
}

function firstEventFrameForKey(project: CutProject, keyId: string, sheetRole: SheetTimingRole): number {
  return project.logicalSheet.events
    .filter(event => event.keyId === keyId && sheetTimingRoleForEvent(event) === sheetRole)
    .reduce((min, event) => Math.min(min, event.frame), Number.MAX_SAFE_INTEGER)
}

function processLabelForSlot(project: CutProject, slot: CspTrackSlot): string {
  const layer = slot.correctionLayerId ? project.correctionLayers.find(item => item.layerId === slot.correctionLayerId) : undefined
  return layer?.label ?? slot.displayPath
}

function correctionLayerOrderText(layerId: string | undefined): number {
  const order = [
    'layer_sakuga',
    'layer_enshutsu',
    'layer_kantoku',
    'layer_sakkan',
    'layer_ryouri',
    'layer_sousakkan',
  ].indexOf(layerId ?? '')
  return order === -1 ? Number.MAX_SAFE_INTEGER : order
}

function replacePathFileName(path: string, nextFileName: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separatorIndex < 0) return nextFileName
  return `${path.slice(0, separatorIndex + 1)}${nextFileName}`
}

function fileExtension(fileName: string): string {
  const lastSlash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= lastSlash) return ''
  return fileName.slice(lastDot)
}

function paperTrackNameCompare(a: string, b: string): number {
  return compareNaturalText(a, b)
}

function compareNaturalText(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' })
}

export function buildAeRemapText(
  project: CutProject,
  slotId: string,
  sheetRole: SheetTimingRole = DEFAULT_EXPORT_TIMING_ROLE,
  cspCellNamePolicy: CspCellNamePolicy = DEFAULT_CSP_CELL_NAME_POLICY,
): string {
  const slot = project.cspTrackSlots.find(item => item.slotId === slotId)
  if (!slot) throw new Error(`slot not found: ${slotId}`)
  const lines = ['frame\tcellName\tkeyId']
  for (const event of eventsForSlot(project, slot, sheetRole)) {
    const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === event.keyId)
    const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
    const cspCellName = key || binding || isNullCellEvent(event)
      ? resolveCspCellName({ slot, key, binding, event, policy: cspCellNamePolicy })
      : ''
    lines.push(`${event.frame}\t${cspCellName}\t${key?.keyId ?? event.keyId}`)
  }
  return `${lines.join('\n')}\n`
}

function buildCspInstructions(mode: ExportMode) {
  if (mode === 'import-stack') {
    return [
      { level: 'info' as const, message: '仮置きスタックとして読み込む場合は、CSP側で既存の工程フォルダー、またはその親フォルダーを非表示にしてからXDTSを読み込みます。' },
      { level: 'info' as const, message: 'CSPは表示中の階層に同名アニメーションフォルダーがあると、階層位置に関係なくそこへXDTSトラックを解決します。表示中のA/B/Cなどが残っていると、仮置きスタックではなく既存フォルダーへ読み込まれます。' },
      { level: 'info' as const, message: '読み込み後、XSHEET IMPORT STARTからXSHEET IMPORT ENDまでの範囲を確認し、作成された仮置きトラックを人間が正しい工程フォルダーへ移動します。' },
    ]
  }
  if (mode === 'sparse-cell-material') {
    return [
      { level: 'warning' as const, message: 'CSP側で対象工程フォルダーを表示状態にしてから読み込む必要があります。' },
      { level: 'info' as const, message: 'missing-okのセル名もXDTSへ書き出します。CSP側で実体セルが無い工程では表示されない想定です。' },
    ]
  }
  return [
    { level: 'warning' as const, message: 'CSP側で対象工程フォルダーを表示状態にしてから読み込む必要があります。' },
    { level: 'info' as const, message: '同名トラックはCSP側のボトム解決に依存します。' },
  ]
}
