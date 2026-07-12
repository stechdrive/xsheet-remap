import type { CorrectionLayer, CutMetadata, CutProject, ExportProfile, LogicalSheet, LogicalTimelineSection, PaperTrack, PaperTrackName, ProductionStage, SheetTimingRole } from './types'
import { getSheetTemplatePaperTracks, withSheetTemplatePaperTracks, standardA3SheetTemplate, standardA3SheetTemplatePreset, type SheetTemplate } from './sheet-template'
import { defaultLogicalSheetWorkRange } from './logical-sheet'
import { createDefaultSheetViewState } from './sheet-view'
import { createDefaultCspTrackSlots, defaultCorrectionLayers, defaultProductionStages, findMatchingSlot, nearestTemplatePaperTrackBeforeOverlay, nextOverlayOrderInGap, nextOverlayPaperTrackName, normalizeCorrectionLayers, normalizeOverlayPaperTrackOrderInGaps, normalizePaperTrackLabels, normalizePaperTrackOrder, normalizeStackGuideLabelForProject, stackGuideRegistrations, uniqueId, uniquePaperTrackName } from './project-shared'
import { DEFAULT_CSP_CELL_NAME_POLICY, DEFAULT_EXPORT_TIMING_ROLE, DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME, DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME } from './project-constants'

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
