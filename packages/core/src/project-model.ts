import type { CorrectionLayer, CutMetadata, CutProject, ExportProfile, LogicalSheet, LogicalTimelineLane, LogicalTimelineSection, LogicalTimelineSectionRole, PaperTrack, PaperTrackName, ProductionStage, SheetTimingRole } from './types'
import { getSheetTemplatePaperTracks, getSheetViewLayout, isInteractiveSheetTemplateGridRegion, withSheetTemplatePaperTracks, standardA3SheetTemplate, standardA3SheetTemplatePreset, type SheetGridLayoutOptions, type SheetTemplate } from './sheet-template'
import { defaultLogicalSheetWorkRange, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameStart } from './logical-sheet'
import { createDefaultSheetViewState } from './sheet-view'
import { createDefaultCspTrackSlots, defaultCorrectionLayers, defaultProductionStages, isSpecialTimingEvent, nearestTemplatePaperTrackBeforeOverlay, nextOverlayOrderInGap, nextOverlayPaperTrackName, normalizeCorrectionLayers, normalizeOverlayPaperTrackOrderInGaps, normalizePaperTrackLabels, normalizePaperTrackOrder, normalizeStackGuideLabelForProject, reconcileCspTrackSlots, stackGuideRegistrations, uniquePaperTrackName } from './project-shared'
import { DEFAULT_CSP_CELL_NAME_POLICY, ROOT_ASSET_BIN_ID } from './project-constants'
import { createEmptySheetFormData } from './sheet-form-data'
import { replaceTimedRangeCues, timelineLanesForLayout } from './timed-range'

export interface CreateProjectOptions {
  projectId?: string
  cut?: CutMetadata
  studioPresetId?: string
  sheetTemplateId?: string
}

export interface ReprojectProjectToTemplateOptions {
  studioPresetId?: string
  resetSheetView?: boolean
}

/**
 * Resolves the complete geometry context shared by every project sheet surface.
 * Templates define presentation; the project remains authoritative for logical
 * paper tracks, SOUND/CAMERA lanes, display duration, and per-project overrides.
 */
export function projectSheetLayoutOptions(
  project: Pick<CutProject, 'logicalSheet' | 'sheetView'>,
  template: SheetTemplate,
): SheetGridLayoutOptions {
  const viewLayout = getSheetViewLayout(template)
  const showAllLogicalTracks = viewLayout.trackAxis?.type === 'logical-width'
  const paperTracks = project.logicalSheet.paperTracks
    .filter(track => showAllLogicalTracks || track.source !== 'overlay')
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(track => track.paperTrack)
  const continuousFrameAxis = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
  return {
    paperTracks,
    timelineLanes: timelineLanesForLayout(project),
    durationFrames: logicalSheetDisplayDurationFrames(project.logicalSheet),
    frameOrigin: continuousFrameAxis
      ? logicalSheetDisplayFrameStart(project.logicalSheet)
      : template.defaults.frameOrigin,
    layoutOverrides: project.sheetView.layoutOverrides,
  }
}

export function createDefaultProject(): CutProject {
  return createProjectFromTemplate(standardA3SheetTemplate, {
    studioPresetId: standardA3SheetTemplatePreset.presetId,
    sheetTemplateId: standardA3SheetTemplate.templateId,
  })
}

/**
 * Changes only the sheet presentation used by a project.
 *
 * Logical tracks, timeline lanes, timing data, and FPS belong to the project,
 * not to the template. A template switch must therefore never rebuild them.
 */
export function reprojectProjectToTemplate(
  project: CutProject,
  template: SheetTemplate,
  options: ReprojectProjectToTemplateOptions = {},
): CutProject {
  return {
    ...project,
    studioPresetId: options.studioPresetId,
    sheetTemplateId: template.templateId,
    sheetView: options.resetSheetView
      ? createDefaultSheetViewState(template)
      : { ...project.sheetView, templateId: template.templateId },
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
    timelineSections: defaultTimelineSections(template),
    keys: [],
    events: [],
  }
  const cspTrackSlots = createDefaultCspTrackSlots(paperTracks, productionStages, correctionLayers)
  const exportProfiles: ExportProfile[] = [
    {
      profileId: 'import-stack',
      name: '仮置きスタック',
      mode: 'import-stack',
      cspCellNamePolicy: DEFAULT_CSP_CELL_NAME_POLICY,
      slotIds: cspTrackSlots.map(slot => slot.slotId),
    },
  ]
  return {
    schemaVersion: 3,
    projectId: options.projectId ?? 'project_sample',
    cut: options.cut ?? { cut: '001' },
    sheetFormData: createEmptySheetFormData(),
    studioPresetId: options.studioPresetId,
    sheetTemplateId: options.sheetTemplateId ?? template.templateId,
    sheetView: createDefaultSheetViewState(template),
    logicalSheet,
    productionStages,
    correctionLayers,
    assetRoot: undefined,
    assetBins: [{ binId: ROOT_ASSET_BIN_ID, name: 'プロジェクト素材', order: 0 }],
    assets: [],
    cspTrackSlots,
    bindings: [],
    stackGuideLabels: [],
    memos: [],
    timedRangeCues: [],
    exportProfiles,
  }
}

export function createPaperTracks(labels: PaperTrackName[]): PaperTrack[] {
  const normalized = normalizePaperTrackLabels(labels)
  if (normalized.length === 0) throw new Error('paperTracks must contain at least one label')
  return normalized.map((label, order) => ({ paperTrack: label, label, order, source: 'template' }))
}

export function defaultTimelineSections(template: SheetTemplate = standardA3SheetTemplate): LogicalTimelineSection[] {
  return [
    {
      sectionId: 'section_action',
      role: 'action',
      label: timelineSectionLabelForTemplate(template, 'action', 'ACTION'),
      order: 0,
      inputMode: 'point-event',
      trackAxis: 'paper-tracks',
      frameAxis: 'shared-logical-frames',
    },
    {
      sectionId: 'section_sound',
      role: 'sound',
      label: timelineSectionLabelForTemplate(template, 'sound', 'SOUND'),
      order: 1,
      inputMode: 'timed-range',
      trackAxis: 'fixed-lanes',
      frameAxis: 'shared-logical-frames',
      lanes: timelineLanesForTemplate(template, 'sound', 4),
    },
    {
      sectionId: 'section_cell',
      role: 'cell',
      label: timelineSectionLabelForTemplate(template, 'cell', 'CELL'),
      order: 2,
      inputMode: 'point-event',
      trackAxis: 'paper-tracks',
      frameAxis: 'shared-logical-frames',
    },
    {
      sectionId: 'section_camera',
      role: 'camera',
      label: timelineSectionLabelForTemplate(template, 'camera', 'CAMERA'),
      order: 3,
      inputMode: 'timed-range',
      trackAxis: 'fixed-lanes',
      frameAxis: 'shared-logical-frames',
      lanes: timelineLanesForTemplate(template, 'camera', 4),
    },
  ]
}

function timelineSectionLabelForTemplate(
  template: SheetTemplate,
  role: Extract<LogicalTimelineSectionRole, 'action' | 'sound' | 'cell' | 'camera'>,
  fallback: string,
): string {
  const region = template.regions.find(candidate =>
    isInteractiveSheetTemplateGridRegion(candidate) && candidate.grid.role === role,
  )
  if (!region) return fallback
  const label = region.label
    .replace(/\s*\d+\s*[-–—〜~]\s*\d+\s*$/u, '')
    .trim()
  return label || fallback
}

function timelineLanesForTemplate(
  template: SheetTemplate,
  role: Extract<LogicalTimelineSectionRole, 'sound' | 'camera'>,
  fallbackCount: number,
): LogicalTimelineLane[] {
  const lanes = new Map<string, LogicalTimelineLane>()
  for (const region of template.regions) {
    if (!isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== role) continue
    region.grid.columns.forEach((column, index) => {
      const laneId = column.timelineLaneId ?? `${role}_lane_${index + 1}`
      const existing = lanes.get(laneId)
      if (existing) {
        if (!existing.label && column.label.trim()) existing.label = column.label.trim()
        return
      }
      lanes.set(laneId, {
        laneId,
        label: column.label.trim() || (role === 'sound' ? `S${lanes.size + 1}` : String(lanes.size + 1)),
        order: lanes.size,
      })
    })
  }
  if (lanes.size > 0) return [...lanes.values()]
  return Array.from({ length: fallbackCount }, (_, index) => ({
    laneId: `${role}_lane_${index + 1}`,
    label: role === 'sound' ? `S${index + 1}` : String(index + 1),
    order: index,
  }))
}

export function updateProjectTimelineSectionsFromTemplate(project: CutProject, template: SheetTemplate): CutProject {
  const templateSections = new Map(defaultTimelineSections(template).map(section => [section.role, section]))
  const replacements = new Map<LogicalTimelineSectionRole, LogicalTimelineLane[]>([
    ['sound', timelineLanesForTemplate(template, 'sound', 4)],
    ['camera', timelineLanesForTemplate(template, 'camera', 4)],
  ])
  const laneRemapByRole = new Map<string, Map<string, string>>()
  const timelineSections = project.logicalSheet.timelineSections.map(section => {
    const templateSection = templateSections.get(section.role)
    const lanes = replacements.get(section.role)
    if (!lanes) return templateSection ? { ...section, label: templateSection.label } : section
    const nextIds = new Set(lanes.map(lane => lane.laneId))
    const oldLanes = [...(section.lanes ?? [])].sort((a, b) => a.order - b.order)
    const nextLanes = [...lanes].sort((a, b) => a.order - b.order)
    laneRemapByRole.set(section.role, new Map(oldLanes.flatMap((lane, index) => {
      const replacement = nextLanes[index]
      return replacement && !nextIds.has(lane.laneId) ? [[lane.laneId, replacement.laneId]] : []
    })))
    return { ...section, label: templateSection?.label ?? section.label, lanes }
  })
  const withSections = {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      timelineSections,
    },
  }
  return replaceTimedRangeCues(withSections, project.timedRangeCues.map(cue => {
    const laneId = laneRemapByRole.get(cue.role)?.get(cue.laneId)
    return laneId ? { ...cue, laneId } : cue
  }))
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

export function updateProductionStageLabel(project: CutProject, stageId: string, label: string): CutProject {
  const normalizedLabel = label.trim()
  if (!normalizedLabel) throw new Error('制作段階名は空にできません。')
  if (!project.productionStages.some(stage => stage.stageId === stageId)) {
    throw new Error(`production stage not found: ${stageId}`)
  }
  if (project.productionStages.some(stage => stage.stageId !== stageId && stage.label === normalizedLabel)) {
    throw new Error(`制作段階名が重複しています: ${normalizedLabel}`)
  }
  return {
    ...project,
    productionStages: project.productionStages.map(stage =>
      stage.stageId === stageId ? { ...stage, label: normalizedLabel } : stage,
    ),
  }
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
  const cspTrackSlots = reconcileCspTrackSlots(project.logicalSheet.paperTracks, productionStages, correctionLayers, project.cspTrackSlots)
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
  const cspTrackSlots = reconcileCspTrackSlots(paperTracks, project.productionStages, project.correctionLayers, project.cspTrackSlots)
  const allowedSlotIds = new Set(cspTrackSlots.map(slot => slot.slotId))
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks,
      keys: options.filterRemovedTracks ? project.logicalSheet.keys.filter(key => allowedTracks.has(key.paperTrack)) : project.logicalSheet.keys,
      events: options.filterRemovedTracks
        ? project.logicalSheet.events.filter(event => allowedTracks.has(event.paperTrack) && (isSpecialTimingEvent(event) || allowedKeyIds.has(event.keyId)))
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
