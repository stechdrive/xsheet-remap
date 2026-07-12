import type { Annotation, CellBinding, CspTrackSlot, CutGroupProjectDocument, CutMetadata, CutProject, CutSheetDocument, CutSheetMetadata, ProductionMetadata, SharedRegisteredCellCatalog, SheetViewState, StackGuideLabel, StackGuideLabelPlacementState, TimedRangeCue, TimingKey } from './types'
import { sheetTemplatePresets, standardA3SheetTemplate, SHEET_TEMPLATE_SCHEMA_VERSION, type SheetTemplate } from './sheet-template'
import { normalizeLogicalSheetWorkRange } from './logical-sheet'
import { migrateAnnotation } from './annotations'
import { createDefaultSheetViewState, migrateSheetView } from './sheet-view'
import { withoutUndefined } from './core-utils'
import { DEFAULT_CSP_CELL_NAME_POLICY, DEFAULT_EXPORT_TIMING_ROLE, DEFAULT_IMPORT_STACK_END_SEPARATOR_NAME, DEFAULT_IMPORT_STACK_START_SEPARATOR_NAME, PROJECT_DOCUMENT_KIND, PROJECT_DOCUMENT_SCHEMA_VERSION, ROOT_ASSET_BIN_ID } from './project-constants'
import { createDefaultProject } from './project-model'
import { assetFileBaseName, compareStackGuideLabelsForProject, defaultCorrectionLayerFileNameSuffix, normalizePaperTrackOrder, normalizeStackGuideLabelForProject, reconcileCspTrackSlots, sheetTimingRoleForEvent, sheetTimingRoleForKey, stackGuideRegistrations } from './project-shared'

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
    assetRoot: project.assetRoot,
    assetBins: project.assetBins,
    assets: project.assets,
    registeredCells: sharedRegisteredCellCatalogFromProject(project),
    exportProfiles: project.exportProfiles,
    cuts: [cutSheetFromProject(project, cutId, 0)],
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
    || !Array.isArray(input.assetBins) || !Array.isArray(input.assets)
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
    assetRoot: document.assetRoot,
    assetBins: document.assetBins,
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
  options: { sheetTemplate?: SheetTemplate } = {},
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const activeProject = migrateProject(activeProjectInput)
  const activeCutId = document.cuts.some(cut => cut.cutId === document.activeCutId) ? document.activeCutId : document.cuts[0]?.cutId ?? 'cut_1'
  const currentCut = document.cuts.find(cut => cut.cutId === activeCutId)
  const activeCut = cutSheetFromProject(activeProject, activeCutId, currentCut?.order ?? document.cuts.length)
  const cuts = document.cuts.some(cut => cut.cutId === activeCutId)
    ? document.cuts.map(cut => cut.cutId === activeCutId ? activeCut : cut)
    : [...document.cuts, activeCut]
  return {
    ...document,
    projectId: activeProject.projectId,
    activeCutId,
    production: productionMetadataFromProject(activeProject, document.production),
    studioPresetId: activeProject.studioPresetId,
    sheetTemplate: options.sheetTemplate ?? document.sheetTemplate,
    productionStages: activeProject.productionStages,
    correctionLayers: activeProject.correctionLayers,
    assetRoot: activeProject.assetRoot,
    assetBins: activeProject.assetBins,
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
    assetRoot: input.assetRoot,
    assetBins: input.assetBins?.length ? input.assetBins : [{ binId: ROOT_ASSET_BIN_ID, name: 'プロジェクト素材', order: 0 }],
    assets: (input.assets ?? []).map(asset => ({
      ...asset,
      role: asset.role ?? 'cell-material',
    })),
    sheetView: migrateSheetView(input.sheetView, input.sheetTemplateId ?? base.sheetTemplateId ?? standardA3SheetTemplate.templateId),
    cspTrackSlots: reconcileCspTrackSlots(paperTracks, productionStages, correctionLayers, input.cspTrackSlots ?? base.cspTrackSlots),
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
  return { ...project, schemaVersion: 2 }
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

export function productionMetadataFromProject(project: CutProject, fallback: ProductionMetadata = {}): ProductionMetadata {
  return {
    ...fallback,
    title: project.cut.title ?? fallback.title,
    episode: project.cut.episode ?? fallback.episode,
  }
}

export function sharedRegisteredCellCatalogFromProject(project: CutProject): SharedRegisteredCellCatalog {
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

export function cutSheetFromProject(project: CutProject, cutId: string, order: number): CutSheetDocument {
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
    assetRoot: document.assetRoot,
    assetBins: document.assetBins,
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

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' ? input : undefined
}

function isStringRecord(input: unknown): input is Record<string, string> {
  return isRecord(input) && Object.values(input).every(value => typeof value === 'string')
}
