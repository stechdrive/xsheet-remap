import type {
  Annotation,
  AssetRoot,
  CellBinding,
  CorrectionLayer,
  CspTrackSlot,
  CspCellNamePolicy,
  CutAsset,
  CutGroupProjectDocument,
  CutMetadata,
  CutProject,
  CutSheetDocument,
  CutSheetMetadata,
  DomainCommand,
  ExportMode,
  ExportPlan,
  ExportProfile,
  LogicalSheet,
  LogicalTimelineSection,
  NameNormalizationAssetRename,
  NameNormalizationAssetRenameResult,
  NameNormalizationOptions,
  NameNormalizationPlan,
  NameNormalizationPlanItem,
  PaperTrack,
  PaperTrackName,
  ProductionMetadata,
  ProductionStage,
  ProjectHistory,
  SharedRegisteredCellCatalog,
  SheetViewState,
  SheetTimingRole,
  StackGuideLabel,
  StackGuideLabelPlacementState,
  StackGuideRegistration,
  StackGuideStackBand,
  TimedRangeCue,
  TimelineEvent,
  TimingKey,
} from './types'
import { NULL_CELL_CSP_CELL_NAME, NULL_CELL_KEY_ID } from './types'
import {
  alphabeticTrackLabel,
  getSheetTemplatePaperTracks,
  withSheetTemplatePaperTracks,
  standardA3SheetTemplate,
  standardA3SheetTemplatePreset,
  sheetTemplatePresets,
  SHEET_TEMPLATE_SCHEMA_VERSION,
  type SheetTemplate,
} from './sheet-template'
import {
  defaultLogicalSheetWorkRange,
  logicalSheetOfficialFrameEnd,
  normalizeLogicalSheetWorkRange,
} from './logical-sheet'
import {
  addAnnotation,
  clearAnnotations,
  migrateAnnotation,
} from './annotations'
import {
  registerAsset,
} from './assets'
import {
  createDefaultSheetViewState,
  migrateSheetView,
} from './sheet-view'
import {
  clampNumberForCore,
  nextId,
  withoutUndefined,
} from './core-utils'
import { validateProject } from './validation'

export const DEFAULT_SHEET_TIMING_ROLE: SheetTimingRole = 'cell'
export const DEFAULT_EXPORT_TIMING_ROLE: SheetTimingRole = 'action'
export const DEFAULT_CSP_CELL_NAME_POLICY: CspCellNamePolicy = { mode: 'binding-or-paper-track-label' }
export const DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME = '===== XSHEET IMPORT START ====='
export const DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME = '===== XSHEET IMPORT END ====='
export const MAX_CORRECTION_LAYERS = 10
export const PROJECT_DOCUMENT_KIND = 'xsheet-remap-cut-group-project'
export const PROJECT_DOCUMENT_SCHEMA_VERSION = 4

export {
  DEFAULT_PRE_ROLL_FRAMES,
  defaultLogicalSheetWorkRange,
  formatLogicalSheetFrameTimecode,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameEnd,
  logicalSheetDisplayFrameStart,
  logicalSheetFrameIsInOfficialRange,
  logicalSheetFrameNumber,
  logicalSheetOfficialFrameEnd,
  logicalSheetWorkRange,
  normalizeLogicalSheetWorkRange,
} from './logical-sheet'
export {
  addAnnotation,
  clearAnnotations,
  clearAnnotationsForPage,
  eraseAnnotations,
} from './annotations'
export {
  registerAsset,
  registerAssetRoot,
  registerSheetSource,
} from './assets'
export {
  assignSheetSourceToPage,
  createDefaultSheetViewState,
  defaultSheetImageAlignment,
  updateSheetPageViewState,
  updateSheetViewState,
} from './sheet-view'

export interface CreateProjectOptions {
  projectId?: string
  cut?: CutMetadata
  studioPresetId?: string
  sheetTemplateId?: string
}

export function createDefaultProject(): CutProject {
  return createProjectFromTemplate(standardA3SheetTemplate, {
    studioPresetId: standardA3SheetTemplatePreset.presetId,
    sheetTemplateId: standardA3SheetTemplate.templateId,
  })
}

export function createDefaultProjectDocument(): CutGroupProjectDocument {
  return createProjectDocumentFromCutProject(createDefaultProject(), { sheetTemplate: standardA3SheetTemplate })
}

export function createProjectDocumentFromCutProject(
  projectInput: CutProject,
  options: { cutId?: string; sheetTemplate?: SheetTemplate } = {},
): CutGroupProjectDocument {
  const project = migrateProject(projectInput)
  const cutId = options.cutId ?? 'cut_1'
  const sheetTemplate = options.sheetTemplate
    ?? sheetTemplatePresets.find(preset => preset.sheetTemplate.templateId === project.sheetTemplateId)?.sheetTemplate
    ?? standardA3SheetTemplate
  return {
    documentKind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId: project.projectId,
    activeCutId: cutId,
    production: productionMetadataFromProject(project),
    studioPresetId: project.studioPresetId,
    sheetTemplate,
    productionStages: project.productionStages,
    correctionLayers: project.correctionLayers,
    assetRoots: project.assetRoots,
    cspImportAssetRootId: preferredCspImportAssetRootId(project.assetRoots),
    assets: project.assets,
    registeredCells: sharedRegisteredCellCatalogFromProject(project),
    exportProfiles: project.exportProfiles,
    cuts: [cutSheetFromProject(project, cutId, 0)],
  }
}

export function createProjectFromTemplate(template: SheetTemplate, options: CreateProjectOptions = {}): CutProject {
  return createProjectFromTrackLabels(getSheetTemplatePaperTracks(template), { ...options, template })
}

export function createProjectFromTrackLabels(
  labels: PaperTrackName[],
  options: CreateProjectOptions & { template?: SheetTemplate } = {},
): CutProject {
  const paperTracks = createPaperTracks(labels)
  const template = options.template
    ? withSheetTemplatePaperTracks(options.template, paperTracks.map(track => track.paperTrack))
    : withSheetTemplatePaperTracks(standardA3SheetTemplate, paperTracks.map(track => track.paperTrack))
  const productionStages: ProductionStage[] = defaultProductionStages()
  const correctionLayers: CorrectionLayer[] = defaultCorrectionLayers(productionStages[0]?.stageId ?? 'stage_lo')
  const logicalSheet: LogicalSheet = {
    fps: Math.max(1, Math.round(template.defaults.fps)),
    frameOrigin: template.defaults.frameOrigin,
    durationFrames: Math.max(1, Math.round(template.defaults.durationFrames)),
    allowNegativeFrames: true,
    workRange: defaultLogicalSheetWorkRange(template),
    paperTracks,
    timelineSections: defaultTimelineSections(),
    keys: [],
    events: [],
  }
  const cspTrackSlots = createDefaultCspTrackSlots(paperTracks, productionStages, correctionLayers)
  const importStackStartSeparatorName = template.exportDefaults?.importStackStartSeparatorName ?? DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME
  const importStackEndSeparatorName = template.exportDefaults?.importStackEndSeparatorName ?? DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME
  const exportProfiles: ExportProfile[] = [
    {
      profileId: 'import-stack',
      name: '仮置きスタック',
      mode: 'import-stack',
      timingSourceRole: DEFAULT_EXPORT_TIMING_ROLE,
      cspCellNamePolicy: DEFAULT_CSP_CELL_NAME_POLICY,
      slotIds: cspTrackSlots.map(slot => slot.slotId),
      includeDummySeparators: true,
      importStackStartSeparatorName,
      importStackEndSeparatorName,
    },
  ]
  return {
    schemaVersion: 1,
    projectId: options.projectId ?? 'project_sample',
    cut: options.cut ?? { cut: '001' },
    studioPresetId: options.studioPresetId,
    sheetTemplateId: options.sheetTemplateId ?? template.templateId,
    sheetView: createDefaultSheetViewState(template),
    logicalSheet,
    productionStages,
    correctionLayers,
    assetRoots: [],
    assets: [],
    cspTrackSlots,
    bindings: [],
    stackGuideLabels: [],
    annotations: [],
    timedRangeCues: [],
    exportProfiles,
  }
}

export function createPaperTracks(labels: PaperTrackName[]): PaperTrack[] {
  const normalized = normalizePaperTrackLabels(labels)
  if (normalized.length === 0) throw new Error('paperTracks must contain at least one label')
  return normalized.map((label, order) => ({ paperTrack: label, label, order, source: 'template' }))
}

export function defaultTimelineSections(): LogicalTimelineSection[] {
  return [
    {
      sectionId: 'section_action',
      role: 'action',
      label: 'ACTION',
      order: 0,
      inputMode: 'point-event',
      trackAxis: 'paper-tracks',
      frameAxis: 'shared-logical-frames',
    },
    {
      sectionId: 'section_sound',
      role: 'sound',
      label: 'SOUND',
      order: 1,
      inputMode: 'timed-range',
      trackAxis: 'fixed-lanes',
      frameAxis: 'shared-logical-frames',
      laneLabels: ['S1', 'S2', 'S3', 'S4'],
    },
    {
      sectionId: 'section_cell',
      role: 'cell',
      label: 'CELL',
      order: 2,
      inputMode: 'point-event',
      trackAxis: 'paper-tracks',
      frameAxis: 'shared-logical-frames',
    },
    {
      sectionId: 'section_camera',
      role: 'camera',
      label: 'CAMERA',
      order: 3,
      inputMode: 'timed-range',
      trackAxis: 'fixed-lanes',
      frameAxis: 'shared-logical-frames',
      laneLabels: ['1', '2', '3', '4'],
    },
  ]
}

export function updateProjectPaperTracks(project: CutProject, labels: PaperTrackName[]): CutProject {
  const paperTracks = createPaperTracks(labels)
  const preservedOverlayTracks = project.logicalSheet.paperTracks
    .filter(track => track.source === 'overlay')
    .filter(track => !paperTracks.some(base => base.paperTrack === track.paperTrack))
  const nextPaperTracks = normalizePaperTrackOrder([...paperTracks, ...preservedOverlayTracks])
  return rebuildProjectPaperTrackSlots(project, nextPaperTracks, {
    filterRemovedTracks: true,
    normalizeStackGuides: true,
  })
}

export function updateCorrectionLayers(project: CutProject, layers: CorrectionLayer[]): CutProject {
  const productionStages = project.productionStages.length > 0 ? project.productionStages : defaultProductionStages()
  const correctionLayers = normalizeCorrectionLayers(layers, productionStages, project.correctionLayers)
  const removedLayerIds = new Set(project.correctionLayers.map(layer => layer.layerId).filter(layerId => !correctionLayers.some(layer => layer.layerId === layerId)))
  if (removedLayerIds.size > 0) {
    const removedSlotIds = new Set(project.cspTrackSlots.filter(slot => slot.correctionLayerId && removedLayerIds.has(slot.correctionLayerId)).map(slot => slot.slotId))
    const hasBindings = project.bindings.some(binding => removedSlotIds.has(binding.slotId))
    const hasStackGuideRegistrations = project.stackGuideLabels.some(label =>
      stackGuideRegistrations(label).some(registration =>
        removedLayerIds.has(registration.correctionLayerId)
        && (registration.assetIds.length > 0 || Boolean(registration.cspCellName?.trim())),
      ),
    )
    if (hasBindings || hasStackGuideRegistrations) {
      throw new Error('使用中の工程は削除できません。登録セルまたは補助トラックの登録を先に外してください。')
    }
  }

  const projectWithLayers: CutProject = {
    ...project,
    productionStages,
    correctionLayers,
  }
  const defaultSlots = createDefaultCspTrackSlots(project.logicalSheet.paperTracks, productionStages, correctionLayers)
  const usedSlotIds = new Set<string>()
  const cspTrackSlots = defaultSlots.map(defaultSlot => {
    const existing = project.cspTrackSlots.find(slot =>
      slot.paperTrack === defaultSlot.paperTrack
      && slot.correctionLayerId === defaultSlot.correctionLayerId,
    )
    const slot = existing
      ? {
          ...existing,
          stageId: defaultSlot.stageId,
          correctionLayerId: defaultSlot.correctionLayerId,
          displayPath: defaultSlot.displayPath,
          trackNo: defaultSlot.trackNo,
          occurrenceIndex: defaultSlot.occurrenceIndex,
        }
      : defaultSlot
    const slotId = uniqueId(slot.slotId, usedSlotIds)
    usedSlotIds.add(slotId)
    return slotId === slot.slotId ? slot : { ...slot, slotId }
  })
  const allowedSlotIds = new Set(cspTrackSlots.map(slot => slot.slotId))
  const allowedLayerIds = new Set(correctionLayers.map(layer => layer.layerId))
  return {
    ...projectWithLayers,
    cspTrackSlots,
    bindings: project.bindings.filter(binding => allowedSlotIds.has(binding.slotId)),
    stackGuideLabels: project.stackGuideLabels.map(label => ({
      ...label,
      registrations: stackGuideRegistrations(label).filter(registration => allowedLayerIds.has(registration.correctionLayerId)),
    })),
    exportProfiles: project.exportProfiles.map(profile => ({
      ...profile,
      slotIds: cspTrackSlots.map(slot => slot.slotId),
    })),
  }
}

export function addOverlayPaperTrack(
  project: CutProject,
  input: {
    paperTrack?: PaperTrackName
    label?: string
    insertAfterPaperTrack?: PaperTrackName
    sheetRole?: SheetTimingRole
    snapIndex?: number
    orderInGap?: number
    templateId?: string
  } = {},
): { project: CutProject; paperTrack: PaperTrack } {
  const name = uniquePaperTrackName(project, input.paperTrack ?? nextOverlayPaperTrackName(project))
  const insertAfterPaperTrack = input.insertAfterPaperTrack && project.logicalSheet.paperTracks.some(track => track.paperTrack === input.insertAfterPaperTrack)
    ? input.insertAfterPaperTrack
    : nearestTemplatePaperTrackBeforeOverlay(project, input.snapIndex ?? 0)
  const orderInGap = input.orderInGap ?? nextOverlayOrderInGap(project, insertAfterPaperTrack)
  const paperTrack: PaperTrack = {
    paperTrack: name,
    label: input.label?.trim() || name,
    order: project.logicalSheet.paperTracks.length,
    source: 'overlay',
    exportPlacement: {
      insertAfterPaperTrack,
      orderInGap,
    },
    viewPlacement: {
      templateId: input.templateId ?? project.sheetTemplateId,
      sheetRole: input.sheetRole ?? 'cell',
      snapIndex: Math.round(input.snapIndex ?? 0),
      expanded: true,
    },
  }
  const projectWithTrack = rebuildProjectPaperTrackSlots(project, normalizeOverlayPaperTrackOrderInGaps([...project.logicalSheet.paperTracks, paperTrack]), {
    filterRemovedTracks: false,
    normalizeStackGuides: true,
  })
  const createdTrack = projectWithTrack.logicalSheet.paperTracks.find(track => track.paperTrack === paperTrack.paperTrack) ?? paperTrack
  return { project: projectWithTrack, paperTrack: createdTrack }
}

export function updatePaperTrack(
  project: CutProject,
  paperTrackName: PaperTrackName,
  updates: {
    paperTrack?: PaperTrackName
    label?: string
    exportPlacement?: Partial<NonNullable<PaperTrack['exportPlacement']>>
    viewPlacement?: Partial<NonNullable<PaperTrack['viewPlacement']>>
  },
): CutProject {
  const existing = project.logicalSheet.paperTracks.find(track => track.paperTrack === paperTrackName)
  if (!existing) throw new Error(`paperTrack not found: ${paperTrackName}`)
  const nextName = updates.paperTrack?.trim() || existing.paperTrack
  if (nextName !== existing.paperTrack && project.logicalSheet.paperTracks.some(track => track.paperTrack === nextName)) {
    throw new Error(`paperTrack already exists: ${nextName}`)
  }
  const nextLabel = updates.label?.trim() || (nextName !== existing.paperTrack ? nextName : existing.label)
  const paperTracks = normalizeOverlayPaperTrackOrderInGaps(project.logicalSheet.paperTracks.map(track => {
    const exportPlacement = track.exportPlacement?.insertAfterPaperTrack === existing.paperTrack
      ? { ...track.exportPlacement, insertAfterPaperTrack: nextName }
      : track.exportPlacement
    if (track.paperTrack !== existing.paperTrack) return { ...track, exportPlacement }
    return {
      ...track,
      paperTrack: nextName,
      label: nextLabel,
      exportPlacement: {
        ...track.exportPlacement,
        ...updates.exportPlacement,
      },
      viewPlacement: {
        ...track.viewPlacement,
        ...updates.viewPlacement,
      },
    }
  }))
  const next = rebuildProjectPaperTrackSlots({
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      keys: project.logicalSheet.keys.map(key => key.paperTrack === existing.paperTrack ? { ...key, paperTrack: nextName } : key),
      events: project.logicalSheet.events.map(event => event.paperTrack === existing.paperTrack ? { ...event, paperTrack: nextName } : event),
    },
    cspTrackSlots: project.cspTrackSlots.map(slot => slot.paperTrack === existing.paperTrack
      ? {
          ...slot,
          paperTrack: nextName,
          xdtsName: slot.xdtsName === existing.paperTrack ? nextName : slot.xdtsName,
          displayPath: slot.displayPath.endsWith(`/${existing.paperTrack}`)
            ? `${slot.displayPath.slice(0, -existing.paperTrack.length)}${nextName}`
            : slot.displayPath,
        }
      : slot),
    stackGuideLabels: project.stackGuideLabels.map(label => label.insertAfterPaperTrack === existing.paperTrack
      ? { ...label, insertAfterPaperTrack: nextName }
      : label),
  }, paperTracks, {
    filterRemovedTracks: false,
    normalizeStackGuides: true,
  })
  return next
}

export function deleteOverlayPaperTrack(project: CutProject, paperTrackName: PaperTrackName): CutProject {
  const existing = project.logicalSheet.paperTracks.find(track => track.paperTrack === paperTrackName)
  if (!existing) throw new Error(`paperTrack not found: ${paperTrackName}`)
  if (existing.source !== 'overlay') throw new Error(`paperTrack is not an overlay track: ${paperTrackName}`)
  const paperTracks = normalizeOverlayPaperTrackOrderInGaps(project.logicalSheet.paperTracks.filter(track => track.paperTrack !== paperTrackName))
  return rebuildProjectPaperTrackSlots(project, paperTracks, {
    filterRemovedTracks: true,
    normalizeStackGuides: true,
  })
}

function rebuildProjectPaperTrackSlots(
  project: CutProject,
  paperTracks: PaperTrack[],
  options: { filterRemovedTracks: boolean; normalizeStackGuides: boolean },
): CutProject {
  const allowedTracks = new Set(paperTracks.map(track => track.paperTrack))
  const allowedKeyIds = new Set(project.logicalSheet.keys.filter(key => allowedTracks.has(key.paperTrack)).map(key => key.keyId))
  const defaultSlots = createDefaultCspTrackSlots(paperTracks, project.productionStages, project.correctionLayers)
  const usedSlotIds = new Set<string>()
  const cspTrackSlots = defaultSlots.map(defaultSlot => {
    const existing = findMatchingSlot(project.cspTrackSlots, defaultSlot)
    const slot = existing
      ? {
          ...existing,
          paperTrack: defaultSlot.paperTrack,
          trackNo: defaultSlot.trackNo,
        }
      : defaultSlot
    const slotId = uniqueId(slot.slotId, usedSlotIds)
    usedSlotIds.add(slotId)
    return slotId === slot.slotId ? slot : { ...slot, slotId }
  })
  const allowedSlotIds = new Set(cspTrackSlots.map(slot => slot.slotId))
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks,
      keys: options.filterRemovedTracks ? project.logicalSheet.keys.filter(key => allowedTracks.has(key.paperTrack)) : project.logicalSheet.keys,
      events: options.filterRemovedTracks
        ? project.logicalSheet.events.filter(event => allowedTracks.has(event.paperTrack) && allowedKeyIds.has(event.keyId))
        : project.logicalSheet.events,
    },
    cspTrackSlots,
    bindings: options.filterRemovedTracks
      ? project.bindings.filter(binding => allowedSlotIds.has(binding.slotId) && allowedKeyIds.has(binding.keyId))
      : project.bindings.filter(binding => allowedSlotIds.has(binding.slotId)),
    stackGuideLabels: options.normalizeStackGuides
      ? project.stackGuideLabels.map(label => normalizeStackGuideLabelForProject({ ...label }, { ...project, logicalSheet: { ...project.logicalSheet, paperTracks } }))
      : project.stackGuideLabels,
    exportProfiles: project.exportProfiles.map(profile => ({
      ...profile,
      slotIds: cspTrackSlots.map(slot => slot.slotId),
    })),
  }
}

export function createKey(
  project: CutProject,
  paperTrack: PaperTrackName,
  displayLabel?: string,
  createdFrom: TimingKey['createdFrom'] = 'manual',
  paperToken?: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): { project: CutProject; key: TimingKey } {
  ensurePaperTrack(project, paperTrack)
  const label = displayLabel?.trim() || nextDisplayLabel(project, paperTrack, sheetRole)
  const existing = findTimingKeyByDisplayLabel(project, paperTrack, label, sheetRole)
  if (existing) return { project, key: existing }
  const key: TimingKey = {
    keyId: nextId('key', project.logicalSheet.keys.map(item => item.keyId)),
    paperTrack,
    sheetRole,
    displayLabel: label,
    paperToken,
    createdFrom,
  }
  return {
    project: {
      ...project,
      logicalSheet: {
        ...project.logicalSheet,
        keys: [...project.logicalSheet.keys, key],
      },
    },
    key,
  }
}

export function findTimingKeyByDisplayLabel(
  project: CutProject,
  paperTrack: PaperTrackName,
  displayLabel: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): TimingKey | null {
  const label = normalizeTimingKeyDisplayLabel(displayLabel)
  if (!label) return null
  return project.logicalSheet.keys.find(key =>
    key.paperTrack === paperTrack
    && sheetTimingRoleForKey(key) === sheetRole
    && normalizeTimingKeyDisplayLabel(key.displayLabel) === label
  ) ?? null
}

export function setEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  keyId: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
  options: { fontSizePx?: number; source?: TimelineEvent['source'] } = {},
): CutProject {
  ensurePaperTrack(project, paperTrack)
  if (!isNullCellKeyId(keyId)) {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) throw new Error(`key not found: ${keyId}`)
    if (key.paperTrack !== paperTrack) throw new Error(`key ${keyId} does not belong to paperTrack ${paperTrack}`)
    if (sheetTimingRoleForKey(key) !== sheetRole) throw new Error(`key ${keyId} does not belong to ${sheetRole}`)
  }
  const event: TimelineEvent = {
    eventId: nextId('event', project.logicalSheet.events.map(item => item.eventId)),
    paperTrack,
    sheetRole,
    frame,
    keyId,
    ...(typeof options.fontSizePx === 'number' && Number.isFinite(options.fontSizePx) ? { fontSizePx: options.fontSizePx } : {}),
    source: options.source ?? 'manual',
  }
  const events = project.logicalSheet.events
    .filter(item => !sameEventTarget(item, paperTrack, frame, sheetRole))
    .concat(event)
    .sort(compareTimelineEvents)
  return { ...project, logicalSheet: { ...project.logicalSheet, events } }
}

export function clearEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      events: project.logicalSheet.events.filter(item => !sameEventTarget(item, paperTrack, frame, sheetRole)),
    },
  }
}

export function createOrSetEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): { project: CutProject; key: TimingKey } {
  const created = createKey(project, paperTrack, undefined, 'manual', undefined, sheetRole)
  const withEvent = setEvent(created.project, paperTrack, frame, created.key.keyId, sheetRole)
  return { project: ensureDefaultBindingsForKey(withEvent, created.key.keyId), key: created.key }
}

export type CreateRecognizedEventStatus = 'created' | 'already-present' | 'conflict'

export function createRecognizedEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole,
  displayLabel: string,
): { project: CutProject; key: TimingKey | null; status: CreateRecognizedEventStatus } {
  const normalizedLabel = normalizeTimingKeyDisplayLabel(displayLabel)
  if (!normalizedLabel) return { project, key: null, status: 'conflict' }

  const existingEvent = project.logicalSheet.events.find(event => sameEventTarget(event, paperTrack, frame, sheetRole))
  if (existingEvent) {
    const existingKey = project.logicalSheet.keys.find(key => key.keyId === existingEvent.keyId) ?? null
    const matches = existingKey
      && normalizeTimingKeyDisplayLabel(existingKey.displayLabel) === normalizedLabel
    return {
      project,
      key: matches ? existingKey : null,
      status: matches ? 'already-present' : 'conflict',
    }
  }

  const created = createKey(project, paperTrack, displayLabel, 'recognition', undefined, sheetRole)
  const withEvent = setEvent(created.project, paperTrack, frame, created.key.keyId, sheetRole, { source: 'recognition' })
  return {
    project: ensureDefaultBindingsForKey(withEvent, created.key.keyId),
    key: created.key,
    status: 'created',
  }
}

export function upsertBinding(
  project: CutProject,
  input: {
    slotId: string
    keyId: string
    cspCellName?: string
    assetId?: string
    materialState?: CellBinding['materialState']
  },
): CutProject {
  const slot = project.cspTrackSlots.find(item => item.slotId === input.slotId)
  if (!slot) throw new Error(`slot not found: ${input.slotId}`)
  const key = project.logicalSheet.keys.find(item => item.keyId === input.keyId)
  if (!key) throw new Error(`key not found: ${input.keyId}`)
  const existing = project.bindings.find(item => item.slotId === input.slotId && item.keyId === input.keyId)
  const cspCellName = input.cspCellName ?? existing?.cspCellName ?? defaultCspCellName(key.displayLabel, slot.paperTrack)
  const materialState = input.materialState ?? (input.assetId || existing?.assetId ? 'assigned' : existing?.materialState ?? 'unassigned')
  const binding: CellBinding = {
    bindingId: existing?.bindingId ?? nextId('binding', project.bindings.map(item => item.bindingId)),
    slotId: input.slotId,
    keyId: input.keyId,
    cspCellName,
    assetId: input.assetId ?? existing?.assetId,
    materialState,
  }
  return {
    ...project,
    bindings: [...project.bindings.filter(item => item.bindingId !== binding.bindingId), binding].sort((a, b) =>
      a.slotId.localeCompare(b.slotId) || a.keyId.localeCompare(b.keyId),
    ),
  }
}

export interface RegisterAssetsToCspTrackResult {
  project: CutProject
  addedKeyIds: string[]
  duplicateKeyIds: string[]
  missingAssetIds: string[]
}

export function registerAssetsToCspTrack(
  project: CutProject,
  input: { slotId: string; assetIds: string[]; sheetRole?: SheetTimingRole },
): RegisterAssetsToCspTrackResult {
  const slot = project.cspTrackSlots.find(item => item.slotId === input.slotId)
  if (!slot) throw new Error(`slot not found: ${input.slotId}`)

  const requestedAssetIds = Array.from(new Set(input.assetIds.filter(Boolean)))
  const addedKeyIds: string[] = []
  const duplicateKeyIds: string[] = []
  const missingAssetIds: string[] = []
  const sheetRole = input.sheetRole ?? DEFAULT_EXPORT_TIMING_ROLE
  let next = project

  for (const assetId of requestedAssetIds) {
    const asset = next.assets.find(item => item.assetId === assetId)
    if (!asset) {
      missingAssetIds.push(assetId)
      continue
    }

    const duplicate = next.bindings.find(binding => binding.slotId === slot.slotId && binding.assetId === assetId)
    if (duplicate) {
      duplicateKeyIds.push(duplicate.keyId)
      continue
    }

    const reusableBinding = next.bindings.find(binding => {
      if (binding.assetId !== assetId) return false
      const key = next.logicalSheet.keys.find(item => item.keyId === binding.keyId)
      if (!key || key.paperTrack !== slot.paperTrack || sheetTimingRoleForKey(key) !== sheetRole) return false
      return !next.bindings.some(candidate => candidate.slotId === slot.slotId && candidate.keyId === key.keyId)
    })
    const reusableKey = reusableBinding
      ? next.logicalSheet.keys.find(item => item.keyId === reusableBinding.keyId)
      : undefined
    const created = reusableKey
      ? { project: next, key: reusableKey }
      : createKey(next, slot.paperTrack, undefined, 'asset-drop', undefined, sheetRole)
    next = created.project

    const desiredCspCellName = reusableBinding?.cspCellName || assetFileBaseName(asset) || defaultCspCellName(created.key.displayLabel, slot.paperTrack)
    const cspCellName = uniqueCspCellNameForSlot(next, slot.slotId, desiredCspCellName)
    next = upsertBinding(next, {
      slotId: slot.slotId,
      keyId: created.key.keyId,
      assetId,
      cspCellName,
      materialState: 'assigned',
    })
    addedKeyIds.push(created.key.keyId)
  }

  return { project: next, addedKeyIds, duplicateKeyIds, missingAssetIds }
}

export function moveBindingToCorrectionLayer(
  project: CutProject,
  input: {
    keyId: string
    sourceSlotId: string
    targetCorrectionLayerId: string
    overwrite?: boolean
  },
): CutProject {
  const sourceBinding = project.bindings.find(binding => binding.keyId === input.keyId && binding.slotId === input.sourceSlotId)
  if (!sourceBinding) throw new Error(`binding not found: ${input.sourceSlotId} / ${input.keyId}`)
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === input.sourceSlotId)
  if (!sourceSlot) throw new Error(`slot not found: ${input.sourceSlotId}`)
  const targetSlot = project.cspTrackSlots.find(slot =>
    slot.paperTrack === sourceSlot.paperTrack
    && slot.correctionLayerId === input.targetCorrectionLayerId,
  )
  if (!targetSlot) throw new Error(`target slot not found: ${sourceSlot.paperTrack} / ${input.targetCorrectionLayerId}`)
  if (targetSlot.slotId === sourceSlot.slotId) return project

  const existingTargetBinding = project.bindings.find(binding => binding.keyId === input.keyId && binding.slotId === targetSlot.slotId)
  if (existingTargetBinding && !input.overwrite) {
    throw new Error(`target binding already exists: ${targetSlot.slotId} / ${input.keyId}`)
  }

  const withoutSourceAndTarget: CutProject = {
    ...project,
    bindings: project.bindings.filter(binding =>
      binding.bindingId !== sourceBinding.bindingId
      && binding.bindingId !== existingTargetBinding?.bindingId,
    ),
  }
  return upsertBinding(withoutSourceAndTarget, {
    slotId: targetSlot.slotId,
    keyId: sourceBinding.keyId,
    cspCellName: sourceBinding.cspCellName,
    assetId: sourceBinding.assetId,
    materialState: sourceBinding.materialState,
  })
}

export function createStackGuideLabel(
  project: CutProject,
  input: {
    label: string
    gapIndex: number
    insertAfterPaperTrack?: PaperTrackName
    kind?: StackGuideLabel['kind']
    displayRole?: StackGuideLabel['displayRole']
    exportAsStaticCell?: boolean
    cspCellName?: string
    correctionLayerId?: string
    placement?: StackGuideLabel['placement']
    stackBand?: StackGuideLabel['stackBand']
    viewSnapIndex?: number
  },
): { project: CutProject; label: StackGuideLabel } {
  const labelText = input.label.trim()
  if (!labelText) throw new Error('stack guide label must not be empty')
  const kind = input.kind ?? inferStackGuideLabelKind(labelText)
  const placement = input.placement ?? defaultStackGuidePlacementForKind(kind)
  const stackBand = input.stackBand ?? defaultStackGuideStackBandForKind(kind)
  const gapIndex = clampStackGuideGapIndex(project, input.gapIndex)
  const insertAfterPaperTrack = input.insertAfterPaperTrack ?? paperTrackBeforeGap(project, gapIndex)
  const orderInGap = nextStackGuideOrderInGap(project, gapIndex, insertAfterPaperTrack)
  const correctionLayerId = input.correctionLayerId ?? defaultCorrectionLayerId(project)
  const registrations = correctionLayerId
    ? [{
        registrationId: 'stack_reg_0001',
        correctionLayerId,
        cspCellName: input.cspCellName?.trim() || undefined,
        assetIds: [],
      }]
    : []
  const label: StackGuideLabel = {
    labelId: nextId('stack_label', project.stackGuideLabels.map(item => item.labelId)),
    label: labelText,
    kind,
    placement,
    stackBand,
    displayRole: input.displayRole ?? 'action',
    viewSnapIndex: normalizeOptionalStackGuideViewSnapIndex(input.viewSnapIndex),
    insertAfterPaperTrack,
    gapIndex,
    orderInGap,
    exportAsStaticCell: input.exportAsStaticCell ?? true,
    cspCellName: input.cspCellName?.trim() || undefined,
    assetIds: [],
    registrations,
  }
  return {
    project: {
      ...project,
      stackGuideLabels: [...project.stackGuideLabels, label].sort(compareStackGuideLabelsForProject(project)),
    },
    label,
  }
}

export function updateStackGuideLabel(
  project: CutProject,
  labelId: string,
  updates: Partial<Pick<StackGuideLabel, 'label' | 'kind' | 'placement' | 'stackBand' | 'displayRole' | 'viewSnapIndex' | 'insertAfterPaperTrack' | 'gapIndex' | 'orderInGap' | 'exportAsStaticCell' | 'cspCellName'>>,
): CutProject {
  const existing = project.stackGuideLabels.find(label => label.labelId === labelId)
  if (!existing) throw new Error(`stack guide label not found: ${labelId}`)
  const nextGapIndex = updates.gapIndex === undefined
    ? existing.gapIndex
    : clampStackGuideGapIndex(project, updates.gapIndex)
  const nextInsertAfterPaperTrack = updates.insertAfterPaperTrack === undefined
    ? existing.insertAfterPaperTrack
    : updates.insertAfterPaperTrack || undefined
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels
      .map(label => label.labelId === labelId
        ? {
            ...label,
            ...withoutUndefined({
              label: updates.label?.trim() || undefined,
              kind: updates.kind,
              placement: updates.placement,
              stackBand: updates.stackBand,
              displayRole: updates.displayRole,
              viewSnapIndex: updates.viewSnapIndex === undefined ? undefined : normalizeOptionalStackGuideViewSnapIndex(updates.viewSnapIndex),
              insertAfterPaperTrack: nextInsertAfterPaperTrack,
              gapIndex: nextGapIndex,
              orderInGap: updates.orderInGap,
              exportAsStaticCell: updates.exportAsStaticCell,
              cspCellName: updates.cspCellName?.trim() || undefined,
            }),
          }
        : label)
      .sort(compareStackGuideLabelsForProject(project)),
  }
}

export function deleteStackGuideLabel(project: CutProject, labelId: string): CutProject {
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.filter(label => label.labelId !== labelId),
  }
}

export function updateStackGuideRegistration(
  project: CutProject,
  labelId: string,
  correctionLayerId: string,
  updates: Partial<Pick<StackGuideRegistration, 'cspCellName' | 'assetIds'>>,
): CutProject {
  const label = project.stackGuideLabels.find(item => item.labelId === labelId)
  if (!label) throw new Error(`stack guide label not found: ${labelId}`)
  const registration = stackGuideRegistrationForLayer(label, correctionLayerId)
  const nextRegistration: StackGuideRegistration = {
    registrationId: registration?.registrationId ?? nextStackGuideRegistrationId(label),
    correctionLayerId,
    cspCellName: updates.cspCellName === undefined
      ? registration?.cspCellName
      : updates.cspCellName.trim() || undefined,
    assetIds: updates.assetIds ?? registration?.assetIds ?? [],
  }
  const registrations = [
    ...stackGuideRegistrations(label).filter(item => item.correctionLayerId !== correctionLayerId),
    nextRegistration,
  ].sort(compareStackGuideRegistrationsForProject(project))
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(item => item.labelId === labelId
      ? { ...item, registrations }
      : item),
  }
}

export function assignAssetToStackGuideLabel(project: CutProject, labelId: string, assetId: string, correctionLayerId = defaultCorrectionLayerId(project) ?? ''): CutProject {
  if (!project.assets.some(asset => asset.assetId === assetId)) throw new Error(`asset not found: ${assetId}`)
  const label = project.stackGuideLabels.find(item => item.labelId === labelId)
  if (!label) throw new Error(`stack guide label not found: ${labelId}`)
  if (!correctionLayerId) throw new Error('stack guide correction layer is required')
  const registration = stackGuideRegistrationForLayer(label, correctionLayerId)
  const asset = project.assets.find(item => item.assetId === assetId)
  const nextRegistration: StackGuideRegistration = {
    registrationId: registration?.registrationId ?? nextStackGuideRegistrationId(label),
    correctionLayerId,
    cspCellName: registration?.cspCellName ?? (asset ? assetFileBaseName(asset) : undefined),
    assetIds: registration?.assetIds.includes(assetId)
      ? registration.assetIds
      : [...(registration?.assetIds ?? []), assetId],
  }
  const registrations = [
    ...stackGuideRegistrations(label).filter(item => item.correctionLayerId !== correctionLayerId),
    nextRegistration,
  ].sort(compareStackGuideRegistrationsForProject(project))
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(item => item.labelId === labelId
      ? {
          ...item,
          registrations,
          assetIds: item.assetIds.includes(assetId) ? item.assetIds : [...item.assetIds, assetId],
        }
      : item),
  }
}

export function removeAssetFromStackGuideLabel(project: CutProject, labelId: string, assetId: string, correctionLayerId?: string): CutProject {
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(label => label.labelId === labelId
      ? {
          ...label,
          registrations: stackGuideRegistrations(label).map(registration => {
            if (correctionLayerId && registration.correctionLayerId !== correctionLayerId) return registration
            return { ...registration, assetIds: registration.assetIds.filter(id => id !== assetId) }
          }),
          assetIds: label.assetIds.filter(id => id !== assetId),
        }
      : label),
  }
}

export function ensureDefaultBindingsForKey(project: CutProject, keyId: string): CutProject {
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) throw new Error(`key not found: ${keyId}`)
  return project
}

export function updateKey(project: CutProject, keyId: string, updates: { displayLabel?: string; paperToken?: string }): CutProject {
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) throw new Error(`key not found: ${keyId}`)
  if (updates.displayLabel !== undefined) {
    const duplicate = findTimingKeyByDisplayLabel(project, key.paperTrack, updates.displayLabel, sheetTimingRoleForKey(key))
    if (duplicate && duplicate.keyId !== keyId) {
      throw new Error(`displayLabel already exists in ${key.paperTrack}: ${updates.displayLabel}`)
    }
  }
  const cleanUpdates = withoutUndefined(updates)
  const nextKeys = project.logicalSheet.keys.map(item => item.keyId === keyId ? { ...item, ...cleanUpdates } : item)
  let next: CutProject = { ...project, logicalSheet: { ...project.logicalSheet, keys: nextKeys } }
  if (updates.displayLabel) {
    for (const slot of next.cspTrackSlots.filter(item => item.paperTrack === key.paperTrack)) {
      const binding = next.bindings.find(item => item.slotId === slot.slotId && item.keyId === keyId)
      if (binding && binding.cspCellName === defaultCspCellName(key.displayLabel, slot.paperTrack)) {
        next = upsertBinding(next, {
          slotId: slot.slotId,
          keyId,
          cspCellName: defaultCspCellName(updates.displayLabel, slot.paperTrack),
          materialState: binding?.materialState ?? 'unassigned',
          assetId: binding?.assetId,
        })
      }
    }
  }
  return next
}

export function buildNameNormalizationPlan(project: CutProject, options: NameNormalizationOptions): NameNormalizationPlan {
  const sheetRole = options.sheetRole
  const targetKeyIds = new Set(options.keyIds ?? [])
  const targetPaperTracks = new Set(options.paperTracks ?? [])
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
    ? buildStackGuideNameNormalizationItems(project, sequencePadding)
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
        currentPath: result.nextPath ?? asset.currentPath,
        relativePath: asset.relativePath ? replacePathFileName(asset.relativePath, result.nextFileName) : asset.relativePath,
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

export function buildExportPlan(project: CutProject, profileId = project.exportProfiles[0]?.profileId ?? 'import-stack'): ExportPlan {
  const profile = project.exportProfiles.find(item => item.profileId === profileId) ?? project.exportProfiles[0]
  const mode: ExportMode = profile?.mode ?? 'direct-to-visible-slots'
  const timingSourceRole = profile?.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE
  const cspCellNamePolicy = profile?.cspCellNamePolicy ?? DEFAULT_CSP_CELL_NAME_POLICY
  const validation = validateProject(project, profile)
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
      profile?.includeDummySeparators ?? true,
      profile?.importStackStartSeparatorName,
      profile?.importStackEndSeparatorName,
    )
    : buildDirectExportTracks(project, selectedSlots, timingSourceRole, cspCellNamePolicy)

  return {
    mode,
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
  includeDummySeparators: boolean,
  startSeparatorName?: string,
  endSeparatorName?: string,
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

    if (includeDummySeparators) {
      pendingTracks.push({
        trackNo: -1,
        name: `===== ${group.label} =====`,
        dummy: true,
        frames: [{ frame: 0, value: null }],
      })
    }

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
    addDummyTrack(startSeparatorName ?? '')
    for (const track of pendingTracks) {
      tracks.push({ ...track, trackNo: outputTrackNo })
      outputTrackNo += 1
    }
    addDummyTrack(endSeparatorName ?? '')
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
  const cellNumber = String(sequenceIndex).padStart(sequencePadding, '0')
  const suffix = correctionLayerFileNameSuffix(project, slot.correctionLayerId)
  return sanitizeFileBaseName(`${key.paperTrack}_${cellNumber}${suffix}`)
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

function buildStackGuideNameNormalizationItems(project: CutProject, sequencePadding: number): NameNormalizationPlanItem[] {
  const stackGuideSequence = buildNormalizedStackGuideSequence(project)
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const layersById = new Map(project.correctionLayers.map(layer => [layer.layerId, layer]))
  return [...project.stackGuideLabels]
    .sort(compareStackGuideLabelsForProject(project))
    .flatMap<NameNormalizationPlanItem>(label => {
      if (!label.label.trim()) return []
      const sequenceIndex = stackGuideSequence.get(label.labelId) ?? 1
      return stackGuideRegistrations(label).flatMap(registration => {
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
      const currentPath = asset.currentPath
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

function correctionLayerFileNameSuffix(project: Pick<CutProject, 'correctionLayers'>, layerId: string | undefined): string {
  const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
  return layer?.fileNameSuffix ?? defaultCorrectionLayerFileNameSuffix(layer)
}

function defaultCorrectionLayerFileNameSuffix(layer: Pick<CorrectionLayer, 'layerId' | 'label'> | undefined): string {
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

function correctionLayerOrderById(project: Pick<CutProject, 'correctionLayers'>, layerId: string | undefined): number {
  const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
  return layer?.order ?? Number.MAX_SAFE_INTEGER
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

function sanitizeFileBaseName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map(character => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
  return cleaned || 'cell'
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

export function updateSlot(
  project: CutProject,
  slotId: string,
  updates: Partial<Pick<CspTrackSlot, 'displayPath' | 'xdtsName' | 'trackNo' | 'occurrenceIndex' | 'stageId' | 'correctionLayerId'>>,
): CutProject {
  if (!project.cspTrackSlots.some(slot => slot.slotId === slotId)) throw new Error(`slot not found: ${slotId}`)
  return {
    ...project,
    cspTrackSlots: project.cspTrackSlots
      .map(slot => slot.slotId === slotId ? { ...slot, ...withoutUndefined(updates) } : slot)
      .sort((a, b) => a.trackNo - b.trackNo || a.slotId.localeCompare(b.slotId)),
  }
}

export function applyCommand(project: CutProject, command: DomainCommand): CutProject {
  switch (command.type) {
    case 'event.create': {
      const sheetRole = command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE
      const created = createKey(project, command.paperTrack, command.displayLabel, command.createdFrom ?? 'manual', undefined, sheetRole)
      return ensureDefaultBindingsForKey(setEvent(created.project, command.paperTrack, command.frame, created.key.keyId, sheetRole), created.key.keyId)
    }
    case 'event.set':
      return setEvent(project, command.paperTrack, command.frame, command.keyId, command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE)
    case 'event.clear':
      return clearEvent(project, command.paperTrack, command.frame, command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE)
    case 'key.update':
      return updateKey(project, command.keyId, { displayLabel: command.displayLabel, paperToken: command.paperToken })
    case 'asset.register': {
      const registered = registerAsset(project, command.file)
      if (!command.target?.keyId) return registered.project
      const targetKey = registered.project.logicalSheet.keys.find(key => key.keyId === command.target?.keyId)
      const targetLayerId = defaultCorrectionLayerId(registered.project)
      const slotId = command.target.slotId
        ?? registered.project.cspTrackSlots.find(slot => slot.paperTrack === targetKey?.paperTrack && correctionLayerIdForSlot(registered.project, slot) === targetLayerId)?.slotId
        ?? registered.project.cspTrackSlots.find(slot => slot.paperTrack === targetKey?.paperTrack)?.slotId
      return slotId
        ? upsertBinding(registered.project, {
            slotId,
            keyId: command.target.keyId,
            assetId: registered.asset.assetId,
            cspCellName: registered.asset.displayName.replace(/\.[^.]+$/, ''),
            materialState: 'assigned',
          })
        : registered.project
    }
    case 'binding.upsert':
      return upsertBinding(project, command)
    case 'annotation.add':
      return addAnnotation(project, command.stroke)
    case 'annotation.clear':
      return clearAnnotations(project)
    case 'slot.update':
      return updateSlot(project, command.slotId, command.updates)
  }
}

export function createProjectHistory(project: CutProject): ProjectHistory {
  return { past: [], present: migrateProject(project), future: [] }
}

export function commitHistory(history: ProjectHistory, project: CutProject): ProjectHistory {
  return { past: [...history.past, history.present], present: migrateProject(project), future: [] }
}

export function undoHistory(history: ProjectHistory): ProjectHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory(history: ProjectHistory): ProjectHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}

export function parseProjectDocument(input: unknown): CutGroupProjectDocument {
  if (!isCutGroupProjectDocumentInput(input)) {
    throw new Error('対応していないプロジェクトファイルです。新しい兼用カットプロジェクトを作成してください。')
  }
  if (input.schemaVersion !== PROJECT_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`対応していないプロジェクトバージョンです: ${String(input.schemaVersion)}`)
  }
  if (!isRecord(input.production) || !isSheetTemplateInput(input.sheetTemplate)) {
    throw new Error('プロジェクトの制作情報またはシートテンプレートが不正です。')
  }
  if (!Array.isArray(input.cuts) || input.cuts.length === 0) {
    throw new Error('プロジェクトには1件以上のタイムシートが必要です。')
  }
  if (!Array.isArray(input.productionStages) || !Array.isArray(input.correctionLayers)
    || !Array.isArray(input.assetRoots) || !Array.isArray(input.assets)
    || !Array.isArray(input.exportProfiles) || !isRecord(input.registeredCells)) {
    throw new Error('プロジェクトの共有データが不正です。')
  }

  const document = input as unknown as CutGroupProjectDocument
  const production: ProductionMetadata = {
    title: stringValue(document.production.title),
    episode: stringValue(document.production.episode),
    custom: isStringRecord(document.production.custom) ? { ...document.production.custom } : undefined,
  }
  const registeredCells = sharedRegisteredCellCatalogFromInput(document.registeredCells)
  const cuts = document.cuts
    .map((cut, index) => normalizeCutSheetDocument(cut, index))
    .sort((a, b) => a.order - b.order || a.cutId.localeCompare(b.cutId, 'ja'))
    .map((cut, order) => ({ ...cut, order }))
  const activeCutId = cuts.some(cut => cut.cutId === document.activeCutId) ? document.activeCutId : cuts[0]!.cutId
  const cspImportAssetRootId = document.cspImportAssetRootId && document.assetRoots.some(root => root.rootId === document.cspImportAssetRootId)
    ? document.cspImportAssetRootId
    : preferredCspImportAssetRootId(document.assetRoots)
  return {
    documentKind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId: document.projectId,
    activeCutId,
    production,
    studioPresetId: document.studioPresetId,
    sheetTemplate: document.sheetTemplate,
    productionStages: document.productionStages,
    correctionLayers: document.correctionLayers,
    assetRoots: document.assetRoots,
    cspImportAssetRootId,
    assets: document.assets,
    registeredCells,
    exportProfiles: document.exportProfiles,
    cuts,
  }
}

export function activeCutProjectFromDocument(documentInput: CutGroupProjectDocument): CutProject {
  const document = parseProjectDocument(documentInput)
  const activeCut = document.cuts.find(cut => cut.cutId === document.activeCutId) ?? document.cuts[0]
  return cutProjectFromDocumentCut(document, activeCut)
}

export function updateActiveCutProjectInDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  options: { sheetTemplate?: SheetTemplate; cspImportAssetRootId?: string } = {},
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const activeProject = migrateProject(activeProjectInput)
  const activeCutId = document.cuts.some(cut => cut.cutId === document.activeCutId) ? document.activeCutId : document.cuts[0]?.cutId ?? 'cut_1'
  const currentCut = document.cuts.find(cut => cut.cutId === activeCutId)
  const activeCut = cutSheetFromProject(activeProject, activeCutId, currentCut?.order ?? document.cuts.length)
  const cuts = document.cuts.some(cut => cut.cutId === activeCutId)
    ? document.cuts.map(cut => cut.cutId === activeCutId ? activeCut : cut)
    : [...document.cuts, activeCut]
  const requestedRootId = options.cspImportAssetRootId ?? document.cspImportAssetRootId
  const cspImportAssetRootId = requestedRootId && activeProject.assetRoots.some(root => root.rootId === requestedRootId)
    ? requestedRootId
    : preferredCspImportAssetRootId(activeProject.assetRoots)
  return {
    ...document,
    projectId: activeProject.projectId,
    activeCutId,
    production: productionMetadataFromProject(activeProject, document.production),
    studioPresetId: activeProject.studioPresetId,
    sheetTemplate: options.sheetTemplate ?? document.sheetTemplate,
    productionStages: activeProject.productionStages,
    correctionLayers: activeProject.correctionLayers,
    assetRoots: activeProject.assetRoots,
    cspImportAssetRootId,
    assets: activeProject.assets,
    registeredCells: sharedRegisteredCellCatalogFromProject(activeProject),
    exportProfiles: activeProject.exportProfiles,
    cuts,
  }
}

export function switchActiveCutInProjectDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  cutId: string,
  options: { sheetTemplate?: SheetTemplate } = {},
): CutGroupProjectDocument {
  const document = updateActiveCutProjectInDocument(documentInput, activeProjectInput, options)
  if (!document.cuts.some(cut => cut.cutId === cutId)) throw new Error(`cut not found: ${cutId}`)
  return {
    ...document,
    activeCutId: cutId,
  }
}

export function addBlankSharedCutToProjectDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  input: { cut?: Partial<CutMetadata> } = {},
): CutGroupProjectDocument {
  const document = updateActiveCutProjectInDocument(documentInput, activeProjectInput)
  const baseProject = activeCutProjectFromDocument(document)
  const cutId = nextProjectCutId(document)
  const cutProject = blankSharedCutProject(baseProject, input.cut)
  return {
    ...document,
    activeCutId: cutId,
    cuts: [...document.cuts, cutSheetFromProject(cutProject, cutId, document.cuts.length)],
  }
}

export function migrateProject(input: Partial<CutProject>): CutProject {
  const base = createDefaultProject()
  const productionStages = input.productionStages ?? base.productionStages
  const correctionLayers = (input.correctionLayers ?? base.correctionLayers).map(layer => ({
    ...layer,
    fileNameSuffix: layer.fileNameSuffix ?? defaultCorrectionLayerFileNameSuffix(layer),
  }))
  const keys = (input.logicalSheet?.keys ?? []).map(key => ({
    ...key,
    sheetRole: sheetTimingRoleForKey(key),
  }))
  const paperTracks = normalizePaperTrackOrder((input.logicalSheet?.paperTracks ?? base.logicalSheet.paperTracks).map((track, index) => ({
    ...track,
    label: track.label || track.paperTrack,
    order: typeof track.order === 'number' ? track.order : index,
    source: track.source ?? 'template',
  })))
  const project: CutProject = {
    ...base,
    ...input,
    logicalSheet: {
      ...base.logicalSheet,
      ...input.logicalSheet,
      workRange: normalizeLogicalSheetWorkRange(input.logicalSheet?.workRange ?? base.logicalSheet.workRange),
      paperTracks,
      timelineSections: input.logicalSheet?.timelineSections ?? base.logicalSheet.timelineSections,
      keys,
      events: (input.logicalSheet?.events ?? []).map(event => ({
        ...event,
        sheetRole: sheetTimingRoleForEvent(event),
      })),
    },
    productionStages,
    correctionLayers,
    assetRoots: input.assetRoots ?? [],
    assets: (input.assets ?? []).map(asset => ({
      ...asset,
      role: asset.role ?? 'cell-material',
    })),
    sheetView: migrateSheetView(input.sheetView, input.sheetTemplateId ?? base.sheetTemplateId ?? standardA3SheetTemplate.templateId),
    cspTrackSlots: input.cspTrackSlots ?? base.cspTrackSlots,
    bindings: input.bindings ?? [],
    stackGuideLabels: (input.stackGuideLabels ?? []).map(label => normalizeStackGuideLabelForProject(label, {
      ...base,
      ...input,
      logicalSheet: {
        ...base.logicalSheet,
        ...input.logicalSheet,
        workRange: normalizeLogicalSheetWorkRange(input.logicalSheet?.workRange ?? base.logicalSheet.workRange),
        paperTracks,
      },
    } as CutProject)),
    annotations: (input.annotations ?? []).map(annotation => migrateAnnotation(annotation, input.sheetTemplateId ?? base.sheetTemplateId ?? standardA3SheetTemplate.templateId)),
    timedRangeCues: input.timedRangeCues ?? [],
    exportProfiles: (input.exportProfiles ?? base.exportProfiles).map(profile => ({
      ...profile,
      timingSourceRole: profile.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE,
      cspCellNamePolicy: profile.cspCellNamePolicy ?? DEFAULT_CSP_CELL_NAME_POLICY,
      includeDummySeparators: profile.includeDummySeparators ?? (profile.mode === 'import-stack'),
      importStackStartSeparatorName: profile.importStackStartSeparatorName ?? (
        profile.mode === 'import-stack' ? DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME : undefined
      ),
      importStackEndSeparatorName: profile.importStackEndSeparatorName ?? (
        profile.mode === 'import-stack' ? DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME : undefined
      ),
    })),
  }
  return { ...project, schemaVersion: 1 }
}

function repairBlankAssetDropBindingNames(project: CutProject): CutProject {
  const assetsById = new Map(project.assets.map(asset => [asset.assetId, asset]))
  const assetDropBlankKeyIds = new Set(project.logicalSheet.keys
    .filter(key => key.createdFrom === 'asset-drop' && !key.displayLabel.trim())
    .map(key => key.keyId))
  if (assetDropBlankKeyIds.size === 0) return project

  let changed = false
  const bindings = project.bindings.map(binding => {
    if (!binding.assetId || !assetDropBlankKeyIds.has(binding.keyId)) return binding
    const asset = assetsById.get(binding.assetId)
    if (!asset) return binding
    const cspCellName = assetFileBaseName(asset)
    if (!cspCellName || binding.cspCellName === cspCellName) return binding
    changed = true
    return { ...binding, cspCellName }
  })
  return changed ? { ...project, bindings } : project
}

function productionMetadataFromProject(project: CutProject, fallback: ProductionMetadata = {}): ProductionMetadata {
  return {
    ...fallback,
    title: project.cut.title ?? fallback.title,
    episode: project.cut.episode ?? fallback.episode,
  }
}

function sharedRegisteredCellCatalogFromProject(project: CutProject): SharedRegisteredCellCatalog {
  return {
    keys: project.logicalSheet.keys.map(key => ({ ...key })),
    bindings: project.bindings.map(binding => ({ ...binding })),
    stackGuideLabels: project.stackGuideLabels.map(label => cloneStackGuideLabel(label)),
  }
}

function sharedRegisteredCellCatalogFromInput(input: unknown): SharedRegisteredCellCatalog {
  if (!isRecord(input)) throw new Error('プロジェクトの登録セルカタログが不正です。')
  return {
    keys: Array.isArray(input.keys) ? input.keys.filter(isRecord).map(key => ({ ...key } as unknown as TimingKey)) : [],
    bindings: Array.isArray(input.bindings) ? input.bindings.filter(isRecord).map(binding => ({ ...binding } as unknown as CellBinding)) : [],
    stackGuideLabels: Array.isArray(input.stackGuideLabels)
      ? input.stackGuideLabels.filter(isRecord).map(label => cloneStackGuideLabel(label as unknown as StackGuideLabel))
      : [],
  }
}

function cloneStackGuideLabel(label: StackGuideLabel): StackGuideLabel {
  return {
    ...label,
    registrations: stackGuideRegistrations(label).map(registration => ({
      ...registration,
      assetIds: [...registration.assetIds],
    })),
    assetIds: [...(label.assetIds ?? [])],
  }
}

function stackGuideLabelPlacementsFromProject(project: Pick<CutProject, 'stackGuideLabels'>): StackGuideLabelPlacementState[] {
  return project.stackGuideLabels.map(label => ({
    labelId: label.labelId,
    displayRole: label.displayRole,
    viewSnapIndex: label.viewSnapIndex,
    insertAfterPaperTrack: label.insertAfterPaperTrack,
    gapIndex: label.gapIndex,
    orderInGap: label.orderInGap,
  }))
}

function applyStackGuideLabelPlacements(labels: StackGuideLabel[], placements: StackGuideLabelPlacementState[], project: Pick<CutProject, 'logicalSheet' | 'correctionLayers'>): StackGuideLabel[] {
  const placementById = new Map(placements.map(placement => [placement.labelId, placement]))
  return labels.map(label => {
    const placement = placementById.get(label.labelId)
    if (!placement) return normalizeStackGuideLabelForProject(label, project)
    return normalizeStackGuideLabelForProject({
      ...label,
      displayRole: placement.displayRole ?? label.displayRole,
      viewSnapIndex: placement.viewSnapIndex ?? label.viewSnapIndex,
      insertAfterPaperTrack: placement.insertAfterPaperTrack,
      gapIndex: placement.gapIndex,
      orderInGap: placement.orderInGap,
    }, project)
  }).sort(compareStackGuideLabelsForProject(project))
}

function blankSharedCutProject(baseProject: CutProject, cutInput: Partial<CutMetadata> = {}): CutProject {
  return {
    ...baseProject,
    cut: {
      ...baseProject.cut,
      ...withoutUndefined({
        title: cutInput.title ?? baseProject.cut.title,
        episode: cutInput.episode ?? baseProject.cut.episode,
        scene: cutInput.scene,
        cut: cutInput.cut,
        cspTimelineName: cutInput.cspTimelineName,
        worker: cutInput.worker,
        custom: cutInput.custom,
      }),
    },
    sheetView: createDefaultSheetViewState(baseProject.sheetTemplateId ?? baseProject.sheetView.templateId),
    logicalSheet: {
      ...baseProject.logicalSheet,
      durationFrames: baseProject.logicalSheet.durationFrames,
      events: [],
    },
    annotations: [],
    timedRangeCues: [],
  }
}

function nextProjectCutId(document: CutGroupProjectDocument): string {
  const usedIds = new Set(document.cuts.map(cut => cut.cutId))
  let index = document.cuts.length + 1
  let cutId = `cut_${index}`
  while (usedIds.has(cutId)) {
    index += 1
    cutId = `cut_${index}`
  }
  return cutId
}

function cutSheetFromProject(project: CutProject, cutId: string, order: number): CutSheetDocument {
  const logicalSheet: CutSheetDocument['logicalSheet'] = {
    fps: project.logicalSheet.fps,
    frameOrigin: project.logicalSheet.frameOrigin,
    durationFrames: project.logicalSheet.durationFrames,
    allowNegativeFrames: project.logicalSheet.allowNegativeFrames,
    workRange: project.logicalSheet.workRange,
    paperTracks: project.logicalSheet.paperTracks,
    timelineSections: project.logicalSheet.timelineSections,
    events: project.logicalSheet.events,
  }
  return {
    cutId,
    order,
    metadata: cutSheetMetadataFromProject(project),
    sheetView: project.sheetView,
    logicalSheet,
    cspTrackSlots: project.cspTrackSlots,
    stackGuideLabelPlacements: stackGuideLabelPlacementsFromProject(project),
    annotations: project.annotations,
    timedRangeCues: project.timedRangeCues,
  }
}

function cutSheetMetadataFromProject(project: Pick<CutProject, 'cut'>): CutSheetMetadata {
  return withoutUndefined({
    scene: project.cut.scene,
    cut: project.cut.cut,
    cspTimelineName: project.cut.cspTimelineName,
    worker: project.cut.worker,
    custom: project.cut.custom,
  })
}

function cutProjectFromDocumentCut(document: CutGroupProjectDocument, cut: CutSheetDocument | undefined): CutProject {
  if (!cut) throw new Error('active cut not found')
  const base = migrateProject({
    projectId: document.projectId,
    cut: cutMetadataWithProduction(cut.metadata, document.production),
    studioPresetId: document.studioPresetId,
    sheetTemplateId: document.sheetTemplate.templateId,
    productionStages: document.productionStages,
    correctionLayers: document.correctionLayers,
    assetRoots: document.assetRoots,
    assets: document.assets,
    sheetView: cut.sheetView,
    logicalSheet: { ...cut.logicalSheet, keys: document.registeredCells.keys.map(key => ({ ...key })) },
    cspTrackSlots: cut.cspTrackSlots,
    bindings: document.registeredCells.bindings.map(binding => ({ ...binding })),
    stackGuideLabels: document.registeredCells.stackGuideLabels.map(label => cloneStackGuideLabel(label)),
    annotations: cut.annotations,
    timedRangeCues: cut.timedRangeCues,
    exportProfiles: document.exportProfiles,
  })
  return repairBlankAssetDropBindingNames({
    ...base,
    stackGuideLabels: applyStackGuideLabelPlacements(base.stackGuideLabels, cut.stackGuideLabelPlacements, base),
  })
}

function normalizeCutSheetDocument(input: unknown, fallbackOrder: number): CutSheetDocument {
  if (!isRecord(input) || typeof input.cutId !== 'string' || !isRecord(input.metadata)
    || !isRecord(input.sheetView) || !isRecord(input.logicalSheet)
    || !Array.isArray(input.cspTrackSlots) || !Array.isArray(input.stackGuideLabelPlacements)
    || !Array.isArray(input.annotations) || !Array.isArray(input.timedRangeCues)) {
    throw new Error(`タイムシート${fallbackOrder + 1}のデータが不正です。`)
  }
  const metadata: CutSheetMetadata = {
    scene: stringValue(input.metadata.scene),
    cut: stringValue(input.metadata.cut),
    cspTimelineName: stringValue(input.metadata.cspTimelineName),
    worker: stringValue(input.metadata.worker),
    custom: isStringRecord(input.metadata.custom) ? { ...input.metadata.custom } : undefined,
  }
  return {
    cutId: input.cutId,
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? Math.max(0, Math.round(input.order)) : fallbackOrder,
    metadata,
    sheetView: input.sheetView as unknown as SheetViewState,
    logicalSheet: input.logicalSheet as unknown as CutSheetDocument['logicalSheet'],
    cspTrackSlots: input.cspTrackSlots as CspTrackSlot[],
    stackGuideLabelPlacements: input.stackGuideLabelPlacements as StackGuideLabelPlacementState[],
    annotations: input.annotations as Annotation[],
    timedRangeCues: input.timedRangeCues as TimedRangeCue[],
  }
}

function cutMetadataWithProduction(cut: CutSheetMetadata, production: ProductionMetadata): CutMetadata {
  return {
    title: production.title,
    episode: production.episode,
    scene: cut.scene,
    cut: cut.cut,
    cspTimelineName: cut.cspTimelineName,
    worker: cut.worker,
    custom: cut.custom,
  }
}

function isCutGroupProjectDocumentInput(input: unknown): input is Partial<CutGroupProjectDocument> {
  return isRecord(input) && input.documentKind === PROJECT_DOCUMENT_KIND
}

function isSheetTemplateInput(input: unknown): input is SheetTemplate {
  return isRecord(input)
    && input.schemaVersion === SHEET_TEMPLATE_SCHEMA_VERSION
    && typeof input.templateId === 'string'
    && typeof input.name === 'string'
    && isRecord(input.page)
    && isRecord(input.defaults)
    && Array.isArray(input.regions)
}

function preferredCspImportAssetRootId(assetRoots: AssetRoot[]): string | undefined {
  const pathRoots = assetRoots.filter(root => Boolean(root.path))
  return pathRoots.length === 1 ? pathRoots[0]?.rootId : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' ? input : undefined
}

function isStringRecord(input: unknown): input is Record<string, string> {
  return isRecord(input) && Object.values(input).every(value => typeof value === 'string')
}

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

function normalizeTimingKeyDisplayLabel(value: string): string {
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

function normalizeStackGuideLabelForProject(label: StackGuideLabel, project: Pick<CutProject, 'logicalSheet' | 'correctionLayers'>): StackGuideLabel {
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

function nextStackGuideRegistrationId(label: Pick<StackGuideLabel, 'registrations'>): string {
  const used = new Set((label.registrations ?? []).map(registration => registration.registrationId))
  let index = (label.registrations ?? []).length + 1
  let candidate = `stack_reg_${String(index).padStart(4, '0')}`
  while (used.has(candidate)) {
    index += 1
    candidate = `stack_reg_${String(index).padStart(4, '0')}`
  }
  return candidate
}

function compareStackGuideRegistrationsForProject(project: Pick<CutProject, 'correctionLayers'>) {
  return (a: StackGuideRegistration, b: StackGuideRegistration): number =>
    correctionLayerOrderById(project, a.correctionLayerId) - correctionLayerOrderById(project, b.correctionLayerId)
    || a.correctionLayerId.localeCompare(b.correctionLayerId, 'ja')
}

function nextStackGuideOrderInGap(project: CutProject, gapIndex: number, insertAfterPaperTrack: PaperTrackName | undefined): number {
  const matchingLabels = project.stackGuideLabels.filter(label =>
    stackGuideGapIndex(project, label) === gapIndex
    && (label.insertAfterPaperTrack ?? '') === (insertAfterPaperTrack ?? ''),
  )
  return matchingLabels.reduce((max, label) => Math.max(max, label.orderInGap), -1) + 1
}

function paperTrackBeforeGap(project: Pick<CutProject, 'logicalSheet'>, gapIndex: number): PaperTrackName | undefined {
  if (gapIndex <= 0) return undefined
  return project.logicalSheet.paperTracks[gapIndex - 1]?.paperTrack
}

function clampStackGuideGapIndex(project: Pick<CutProject, 'logicalSheet'>, gapIndex: number): number {
  return clampNumberForCore(Math.round(gapIndex), 0, project.logicalSheet.paperTracks.length)
}

function normalizeOptionalStackGuideViewSnapIndex(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.round(value as number))
}

function normalizePaperTrackOrder(paperTracks: PaperTrack[]): PaperTrack[] {
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

function normalizeOverlayPaperTrackOrderInGaps(paperTracks: PaperTrack[]): PaperTrack[] {
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

function uniquePaperTrackName(project: Pick<CutProject, 'logicalSheet'>, requestedName: PaperTrackName): PaperTrackName {
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

function nextOverlayPaperTrackName(project: Pick<CutProject, 'logicalSheet'>): PaperTrackName {
  const used = new Set(project.logicalSheet.paperTracks.map(track => track.paperTrack))
  for (let index = 0; index < 702; index += 1) {
    const candidate = alphabeticTrackLabel(index)
    if (!used.has(candidate)) return candidate
  }
  return uniquePaperTrackName(project, '追加')
}

function nextOverlayOrderInGap(project: Pick<CutProject, 'logicalSheet'>, insertAfterPaperTrack: PaperTrackName | undefined): number {
  return project.logicalSheet.paperTracks
    .filter(track => track.source === 'overlay' && (track.exportPlacement?.insertAfterPaperTrack ?? '') === (insertAfterPaperTrack ?? ''))
    .reduce((max, track) => Math.max(max, track.exportPlacement?.orderInGap ?? 0), -1) + 1
}

function nearestTemplatePaperTrackBeforeOverlay(project: Pick<CutProject, 'logicalSheet'>, snapIndex: number): PaperTrackName | undefined {
  const templateTracks = project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order)
  if (templateTracks.length === 0) return undefined
  const index = clampNumberForCore(Math.round(snapIndex), 0, templateTracks.length)
  return index <= 0 ? undefined : templateTracks[Math.min(index - 1, templateTracks.length - 1)]?.paperTrack
}

function compareStackGuideLabelsForProject(project: Pick<CutProject, 'logicalSheet'>) {
  return (a: StackGuideLabel, b: StackGuideLabel): number =>
    stackGuideStackBandOrder(stackGuideStackBand(a)) - stackGuideStackBandOrder(stackGuideStackBand(b))
    || stackGuideGapIndex(project, a) - stackGuideGapIndex(project, b)
    || a.orderInGap - b.orderInGap
    || a.label.localeCompare(b.label, 'ja')
    || a.labelId.localeCompare(b.labelId, 'ja')
}

function compareStackGuideExportTracksForProject(
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

function stackGuideStackBandOrder(stackBand: StackGuideStackBand): number {
  if (stackBand === 'cell-interleave') return 0
  if (stackBand === 'camera-note') return 1
  return 2
}

function defaultStackGuidePlacementForKind(kind: StackGuideLabel['kind']): StackGuideLabel['placement'] {
  return kind === 'camera-note' || kind === 'memo' ? 'above-cells' : 'between-cells'
}

function defaultStackGuideStackBandForKind(kind: StackGuideLabel['kind']): StackGuideStackBand {
  if (kind === 'camera-note') return 'camera-note'
  if (kind === 'memo') return 'memo'
  return 'cell-interleave'
}

function inferStackGuideLabelKind(label: string): StackGuideLabel['kind'] {
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

function assetFileBaseName(asset: Pick<CutAsset, 'displayName' | 'originalFileName'>): string {
  return (asset.displayName || asset.originalFileName).replace(/\.[^.]+$/, '')
}

function uniqueCspCellNameForSlot(project: CutProject, slotId: string, desiredName: string): string {
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

function ensurePaperTrack(project: CutProject, paperTrack: PaperTrackName): void {
  if (!project.logicalSheet.paperTracks.some(track => track.paperTrack === paperTrack)) {
    throw new Error(`paperTrack not found: ${paperTrack}`)
  }
}

function groupLabelForSlot(project: CutProject, slot: CspTrackSlot): string {
  const layer = project.correctionLayers.find(item => item.layerId === slot.correctionLayerId)
  return layer?.label ?? slot.displayPath
}

function groupLabelForCorrectionLayer(project: Pick<CutProject, 'correctionLayers'>, correctionLayerId: string): string {
  const layer = project.correctionLayers.find(item => item.layerId === correctionLayerId)
  return (layer?.label ?? correctionLayerId) || '工程'
}

function stageOrderForCorrectionLayer(project: Pick<CutProject, 'productionStages' | 'correctionLayers'>, correctionLayerId: string): number {
  const layer = project.correctionLayers.find(item => item.layerId === correctionLayerId)
  const stage = layer?.stageId ? project.productionStages.find(item => item.stageId === layer.stageId) : undefined
  return stage?.order ?? Number.MAX_SAFE_INTEGER
}

function defaultProductionStages(): ProductionStage[] {
  return [
    { stageId: 'stage_lo', label: 'LO', order: 0 },
  ]
}

function defaultCorrectionLayers(stageId: string): CorrectionLayer[] {
  return [
    { layerId: 'layer_sakuga', stageId, label: '作画', order: 0, role: 'base', defaultVisible: true, fileNameSuffix: '' },
    { layerId: 'layer_enshutsu', stageId, label: '演出', order: 1, role: 'correction', defaultVisible: true, fileNameSuffix: '_e' },
    { layerId: 'layer_kantoku', stageId, label: '監督', order: 2, role: 'review', defaultVisible: true, fileNameSuffix: '_k' },
    { layerId: 'layer_sakkan', stageId, label: '作監', order: 3, role: 'correction', defaultVisible: true, fileNameSuffix: '_s' },
    { layerId: 'layer_ryouri', stageId, label: '料理', order: 4, role: 'other', defaultVisible: true, fileNameSuffix: '_y' },
    { layerId: 'layer_sousakkan', stageId, label: '総作監', order: 5, role: 'review', defaultVisible: true, fileNameSuffix: '_ss' },
  ]
}

function normalizeCorrectionLayers(
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

function createDefaultCspTrackSlots(
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

function findMatchingSlot(slots: CspTrackSlot[], target: CspTrackSlot): CspTrackSlot | undefined {
  return slots.find(slot =>
    slot.paperTrack === target.paperTrack
    && slot.stageId === target.stageId
    && slot.correctionLayerId === target.correctionLayerId
    && slot.occurrenceIndex === target.occurrenceIndex,
  ) ?? slots.find(slot => slot.paperTrack === target.paperTrack && slot.occurrenceIndex === target.occurrenceIndex)
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

function correctionLayerIdForSlot(project: Pick<CutProject, 'correctionLayers'>, slot: Pick<CspTrackSlot, 'correctionLayerId'>): string | undefined {
  if (slot.correctionLayerId && project.correctionLayers.some(layer => layer.layerId === slot.correctionLayerId)) return slot.correctionLayerId
  return defaultCorrectionLayerId(project)
}

function sameEventTarget(
  event: TimelineEvent,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole,
): boolean {
  return event.paperTrack === paperTrack
    && event.frame === frame
    && sheetTimingRoleForEvent(event) === sheetRole
}

function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  return sheetTimingRoleForEvent(a).localeCompare(sheetTimingRoleForEvent(b))
    || a.paperTrack.localeCompare(b.paperTrack)
    || a.frame - b.frame
}

function eventsForSlot(project: CutProject, slot: CspTrackSlot, sheetRole: SheetTimingRole): TimelineEvent[] {
  return project.logicalSheet.events
    .filter(event => event.paperTrack === slot.paperTrack && sheetTimingRoleForEvent(event) === sheetRole)
    .sort((a, b) => a.frame - b.frame)
}

function exportEventsForSlot(project: CutProject, slot: CspTrackSlot, sheetRole: SheetTimingRole): TimelineEvent[] {
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

function normalizePaperTrackLabels(labels: PaperTrackName[]): PaperTrackName[] {
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

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let index = 2
  let id = `${base}_${index}`
  while (used.has(id)) {
    index += 1
    id = `${base}_${index}`
  }
  return id
}
