import type { Annotation, AssetRoot, CellBinding, CspTrackSlot, CutAsset, CutGroupProjectDocument, CutMetadata, CutProject, CutSheetDocument, CutSheetMetadata, ProductionMetadata, SharedRegisteredCellCatalog, SheetRevisionDocument, SheetViewState, StackGuideLabel, StackGuideLabelPlacementState, TimedRangeCue, TimelineInkMemo, TimingKey } from './types'
import { parseSheetTemplate, sheetTemplatePresets, standardA3SheetTemplate, type SheetTemplate } from './sheet-template'
import { normalizeLogicalSheetWorkRange } from './logical-sheet'
import { migrateAnnotation } from './annotations'
import { createDefaultSheetViewState, migrateSheetView } from './sheet-view'
import { withoutUndefined } from './core-utils'
import { DEFAULT_CSP_CELL_NAME_POLICY, LEGACY_PROJECT_DOCUMENT_SCHEMA_VERSION, PROJECT_DOCUMENT_KIND, PROJECT_DOCUMENT_SCHEMA_VERSION, ROOT_ASSET_BIN_ID } from './project-constants'
import { createDefaultProject } from './project-model'
import { assetFileBaseName, compareStackGuideLabelsForProject, defaultCorrectionLayerFileNameSuffix, normalizePaperTrackOrder, normalizeStackGuideLabelForProject, reconcileCspTrackSlots, sheetTimingRoleForEvent, sheetTimingRoleForKey, stackGuideRegistrations, timingEventValueKind } from './project-shared'
import { parseProjectExtensions } from './project-archive'
import { normalizeSheetFormData, normalizeSheetFormFieldValues, normalizeSheetFormPageFieldValues } from './sheet-form-data'
import { migrateLegacyMemos } from './sheet-memo'
import { normalizeAssetSourceNativePaths } from './assets'
import { normalizeNativeFileSystemPath } from './native-paths'

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
  if (!Number.isInteger(input.schemaVersion)
    || Number(input.schemaVersion) < LEGACY_PROJECT_DOCUMENT_SCHEMA_VERSION
    || Number(input.schemaVersion) > PROJECT_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`対応していないプロジェクトバージョンです: ${String(input.schemaVersion)}`)
  }
  if (!isRecord(input.production) || !isRecord(input.sheetTemplate)) {
    throw new Error('プロジェクトの制作情報またはシートテンプレートが不正です。')
  }
  let sheetTemplate: SheetTemplate
  try {
    sheetTemplate = parseSheetTemplate(input.sheetTemplate)
  } catch {
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
    sheetFields: normalizeSheetFormFieldValues(document.production.sheetFields),
  }
  const registeredCells = sharedRegisteredCellCatalogFromInput(document.registeredCells)
  const cuts = document.cuts
    .map((cut, index) => normalizeCutSheetDocument(cut, index))
    .sort((a, b) => a.order - b.order || a.cutId.localeCompare(b.cutId, 'ja'))
    .map((cut, order) => ({ ...cut, order }))
  const activeCutId = cuts.some(cut => cut.cutId === document.activeCutId) ? document.activeCutId : cuts[0]!.cutId
  const extensions = parseProjectExtensions(document.extensions)
  return {
    documentKind: PROJECT_DOCUMENT_KIND,
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId: document.projectId,
    activeCutId,
    production,
    studioPresetId: document.studioPresetId,
    sheetTemplate,
    productionStages: document.productionStages,
    correctionLayers: document.correctionLayers,
    assetRoot: normalizeAssetRootNativePath(document.assetRoot),
    assetBins: document.assetBins,
    assets: document.assets.map(normalizeCutAssetNativePaths),
    registeredCells,
    exportProfiles: document.exportProfiles,
    cuts,
    extensions,
  }
}

export function activeCutProjectFromDocument(documentInput: CutGroupProjectDocument): CutProject {
  const document = parseProjectDocument(documentInput)
  const activeCut = document.cuts.find(cut => cut.cutId === document.activeCutId) ?? document.cuts[0]
  return cutProjectFromDocumentCut(document, activeCut)
}

export function activeSheetRevisionFromDocument(documentInput: CutGroupProjectDocument): SheetRevisionDocument {
  const document = parseProjectDocument(documentInput)
  const cut = activeCutDocument(document)
  return activeRevisionForCut(cut)
}

export function sheetRevisionsForActiveCut(documentInput: CutGroupProjectDocument): SheetRevisionDocument[] {
  const document = parseProjectDocument(documentInput)
  return activeCutDocument(document).revisions.map(revision => cloneRevision(revision))
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
  const activeCut = currentCut
    ? updateCutActiveRevisionFromProject(currentCut, activeProject)
    : cutSheetFromProject(activeProject, activeCutId, document.cuts.length)
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

export function switchActiveSheetRevisionInProjectDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  revisionId: string,
): CutGroupProjectDocument {
  const document = updateActiveCutProjectInDocument(documentInput, activeProjectInput)
  const cut = activeCutDocument(document)
  if (!cut.revisions.some(revision => revision.revisionId === revisionId)) {
    throw new Error(`sheet revision not found: ${revisionId}`)
  }
  return replaceCut(document, { ...cut, activeRevisionId: revisionId })
}

export function addSheetRevisionToProjectDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  input: { name: string; mode: 'duplicate' | 'blank'; showSourceReference?: boolean },
): CutGroupProjectDocument {
  const name = input.name.trim()
  if (!name) throw new Error('追加するシートの名前を入力してください。')
  const document = updateActiveCutProjectInDocument(documentInput, activeProjectInput)
  const cut = activeCutDocument(document)
  const source = activeRevisionForCut(cut)
  const revisionId = nextSheetRevisionId(cut)
  const revision = input.mode === 'blank'
    ? blankRevisionFromSource(source, revisionId, cut.revisions.length, name)
    : duplicateRevisionFromSource(source, revisionId, cut.revisions.length, name)
  const withReference = input.showSourceReference
    ? { ...revision, reference: { revisionId: source.revisionId, opacity: 0.28 } }
    : revision
  return replaceCut(document, {
    ...cut,
    activeRevisionId: revisionId,
    revisions: [...cut.revisions, withReference],
  })
}

export function renameSheetRevisionInProjectDocument(
  documentInput: CutGroupProjectDocument,
  revisionId: string,
  name: string | undefined,
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const cut = activeCutDocument(document)
  const normalizedName = name?.trim() || undefined
  if (!cut.revisions.some(revision => revision.revisionId === revisionId)) throw new Error(`sheet revision not found: ${revisionId}`)
  return replaceCut(document, {
    ...cut,
    revisions: cut.revisions.map(revision => revision.revisionId === revisionId ? { ...revision, name: normalizedName } : revision),
  })
}

export function setSheetRevisionProtectedInProjectDocument(
  documentInput: CutGroupProjectDocument,
  revisionId: string,
  protectedState: boolean,
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const cut = activeCutDocument(document)
  if (!cut.revisions.some(revision => revision.revisionId === revisionId)) throw new Error(`sheet revision not found: ${revisionId}`)
  return replaceCut(document, {
    ...cut,
    revisions: cut.revisions.map(revision => revision.revisionId === revisionId
      ? { ...revision, protected: protectedState || undefined }
      : revision),
  })
}

export function setSheetRevisionReferenceInProjectDocument(
  documentInput: CutGroupProjectDocument,
  revisionId: string,
  reference: { revisionId: string; opacity?: number } | undefined,
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const cut = activeCutDocument(document)
  const target = cut.revisions.find(revision => revision.revisionId === revisionId)
  if (!target) throw new Error(`sheet revision not found: ${revisionId}`)
  if (reference?.revisionId === revisionId) throw new Error('現在のシート自身を下敷きにはできません。')
  if (reference && !cut.revisions.some(revision => revision.revisionId === reference.revisionId)) {
    throw new Error(`sheet revision not found: ${reference.revisionId}`)
  }
  const normalizedReference = reference
    ? { revisionId: reference.revisionId, opacity: clampReferenceOpacity(reference.opacity ?? 0.28) }
    : undefined
  return replaceCut(document, {
    ...cut,
    revisions: cut.revisions.map(revision => revision.revisionId === revisionId
      ? { ...revision, reference: normalizedReference }
      : revision),
  })
}

export function deleteSheetRevisionInProjectDocument(
  documentInput: CutGroupProjectDocument,
  revisionId: string,
): CutGroupProjectDocument {
  const document = parseProjectDocument(documentInput)
  const cut = activeCutDocument(document)
  if (cut.revisions.length <= 1) throw new Error('最後のシートは削除できません。')
  const deletedIndex = cut.revisions.findIndex(revision => revision.revisionId === revisionId)
  if (deletedIndex < 0) throw new Error(`sheet revision not found: ${revisionId}`)
  const deleted = cut.revisions[deletedIndex]!
  if (deleted.protected) throw new Error('保護中のシートは削除できません。')
  const remaining = cut.revisions
    .filter(revision => revision.revisionId !== revisionId)
    .map((revision, order) => ({
      ...revision,
      order,
      sourceRevisionId: revision.sourceRevisionId === revisionId ? deleted.sourceRevisionId : revision.sourceRevisionId,
      reference: revision.reference?.revisionId === revisionId ? undefined : revision.reference,
    }))
  const fallback = remaining[Math.min(deletedIndex, remaining.length - 1)]!
  return replaceCut(document, {
    ...cut,
    activeRevisionId: cut.activeRevisionId === revisionId ? fallback.revisionId : cut.activeRevisionId,
    revisions: remaining,
  })
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

export function deleteSharedCutFromProjectDocument(
  documentInput: CutGroupProjectDocument,
  activeProjectInput: CutProject,
  cutId: string,
  options: { sheetTemplate?: SheetTemplate } = {},
): CutGroupProjectDocument {
  const document = updateActiveCutProjectInDocument(documentInput, activeProjectInput, options)
  if (document.cuts.length <= 1) throw new Error('最後の兼用カットは削除できません。')
  const deletedIndex = document.cuts.findIndex(cut => cut.cutId === cutId)
  if (deletedIndex < 0) throw new Error(`cut not found: ${cutId}`)
  const cuts = document.cuts
    .filter(cut => cut.cutId !== cutId)
    .map((cut, order) => ({ ...cut, order }))
  const fallback = cuts[Math.min(deletedIndex, cuts.length - 1)]!
  return {
    ...document,
    activeCutId: document.activeCutId === cutId ? fallback.cutId : document.activeCutId,
    cuts,
  }
}

export function migrateProject(input: Partial<CutProject> & { annotations?: Annotation[]; timelineMemos?: Omit<TimelineInkMemo, 'kind'>[] }): CutProject {
  const base = createDefaultProject()
  const legacyInput = input as Partial<CutProject> & { annotations?: Annotation[]; timelineMemos?: Omit<TimelineInkMemo, 'kind'>[] }
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
    extensions: parseProjectExtensions(input.extensions),
    sheetFormData: normalizeSheetFormData(input.sheetFormData),
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
        valueKind: timingEventValueKind(event),
      })),
    },
    productionStages,
    correctionLayers,
    assetRoot: normalizeAssetRootNativePath(input.assetRoot),
    assetBins: input.assetBins?.length ? input.assetBins : [{ binId: ROOT_ASSET_BIN_ID, name: 'プロジェクト素材', order: 0 }],
    assets: (input.assets ?? []).map(asset => ({
      ...asset,
      role: asset.role ?? 'cell-material',
      source: normalizeAssetSourceNativePaths(asset.source),
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
    memos: migrateLegacyMemos(
      input.memos,
      (legacyInput.annotations ?? []).map(annotation => migrateAnnotation(annotation, input.sheetTemplateId ?? base.sheetTemplateId ?? standardA3SheetTemplate.templateId)),
      legacyInput.timelineMemos ?? [],
    ),
    timedRangeCues: input.timedRangeCues ?? [],
    exportProfiles: (input.exportProfiles ?? base.exportProfiles).map(profile => ({
      ...profile,
      cspCellNamePolicy: profile.cspCellNamePolicy ?? DEFAULT_CSP_CELL_NAME_POLICY,
    })),
  }
  return { ...project, schemaVersion: 3 }
}

function normalizeAssetRootNativePath(root: AssetRoot | undefined): AssetRoot | undefined {
  return root ? { ...root, path: normalizeNativeFileSystemPath(root.path) } : undefined
}

function normalizeCutAssetNativePaths(asset: CutAsset): CutAsset {
  return { ...asset, source: normalizeAssetSourceNativePaths(asset.source) }
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
    sheetFields: { ...(fallback.sheetFields ?? {}), ...project.sheetFormData.production },
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
    viewTemplateId: label.viewTemplateId,
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
      viewTemplateId: placement.viewTemplateId ?? label.viewTemplateId,
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
    extensions: undefined,
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
    sheetFormData: {
      production: { ...baseProject.sheetFormData.production },
      cut: {},
      revision: {},
      pages: {},
    },
    sheetView: createDefaultSheetViewState(baseProject.sheetTemplateId ?? baseProject.sheetView.templateId),
    logicalSheet: {
      ...baseProject.logicalSheet,
      durationFrames: baseProject.logicalSheet.durationFrames,
      events: [],
    },
    memos: [],
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
  const revisionId = 'sheet_revision_1'
  return {
    cutId,
    order,
    extensions: project.extensions,
    metadata: cutSheetMetadataFromProject(project),
    activeRevisionId: revisionId,
    revisions: [sheetRevisionFromProject(project, revisionId, 0)],
  }
}

function sheetRevisionFromProject(
  project: CutProject,
  revisionId: string,
  order: number,
  previous: Partial<Pick<SheetRevisionDocument, 'name' | 'sourceRevisionId' | 'protected' | 'reference'>> = {},
): SheetRevisionDocument {
  const logicalSheet: SheetRevisionDocument['logicalSheet'] = {
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
    revisionId,
    order,
    ...previous,
    metadata: withoutUndefined({ worker: project.cut.worker, custom: project.cut.custom }),
    sheetFields: { ...project.sheetFormData.revision },
    pageFields: structuredClone(project.sheetFormData.pages),
    sheetView: project.sheetView,
    logicalSheet,
    cspTrackSlots: project.cspTrackSlots,
    stackGuideLabelPlacements: stackGuideLabelPlacementsFromProject(project),
    memos: project.memos,
    timedRangeCues: project.timedRangeCues,
  }
}

function cutSheetMetadataFromProject(project: Pick<CutProject, 'cut' | 'sheetFormData'>): CutSheetMetadata {
  return withoutUndefined({
    scene: project.cut.scene,
    cut: project.cut.cut,
    cspTimelineName: project.cut.cspTimelineName,
    sheetFields: { ...project.sheetFormData.cut },
  })
}

function cutProjectFromDocumentCut(document: CutGroupProjectDocument, cut: CutSheetDocument | undefined): CutProject {
  if (!cut) throw new Error('active cut not found')
  const revision = activeRevisionForCut(cut)
  const base = migrateProject({
    projectId: document.projectId,
    extensions: cut.extensions,
    cut: cutMetadataWithProduction(cut.metadata, revision.metadata, document.production),
    sheetFormData: {
      production: normalizeSheetFormFieldValues(document.production.sheetFields),
      cut: normalizeSheetFormFieldValues(cut.metadata.sheetFields),
      revision: normalizeSheetFormFieldValues(revision.sheetFields),
      pages: normalizeSheetFormPageFieldValues(revision.pageFields),
    },
    studioPresetId: document.studioPresetId,
    sheetTemplateId: document.sheetTemplate.templateId,
    productionStages: document.productionStages,
    correctionLayers: document.correctionLayers,
    assetRoot: document.assetRoot,
    assetBins: document.assetBins,
    assets: document.assets,
    sheetView: revision.sheetView,
    logicalSheet: { ...revision.logicalSheet, keys: document.registeredCells.keys.map(key => ({ ...key })) },
    cspTrackSlots: revision.cspTrackSlots,
    bindings: document.registeredCells.bindings.map(binding => ({ ...binding })),
    stackGuideLabels: document.registeredCells.stackGuideLabels.map(label => cloneStackGuideLabel(label)),
    memos: revision.memos,
    timedRangeCues: revision.timedRangeCues,
    exportProfiles: document.exportProfiles,
  })
  return repairBlankAssetDropBindingNames({
    ...base,
    stackGuideLabels: applyStackGuideLabelPlacements(base.stackGuideLabels, revision.stackGuideLabelPlacements, base),
  })
}

function normalizeCutSheetDocument(input: unknown, fallbackOrder: number): CutSheetDocument {
  if (!isRecord(input) || typeof input.cutId !== 'string' || !isRecord(input.metadata)) {
    throw new Error(`タイムシート${fallbackOrder + 1}のデータが不正です。`)
  }
  const metadata: CutSheetMetadata = {
    scene: stringValue(input.metadata.scene),
    cut: stringValue(input.metadata.cut),
    cspTimelineName: stringValue(input.metadata.cspTimelineName),
    sheetFields: normalizeSheetFormFieldValues(input.metadata.sheetFields),
  }
  const revisions = Array.isArray(input.revisions)
    ? input.revisions.map((revision, index) => normalizeSheetRevisionDocument(revision, index))
    : [normalizeLegacySheetRevisionDocument(input)]
  if (revisions.length === 0) throw new Error(`タイムシート${fallbackOrder + 1}には1件以上のシートが必要です。`)
  const orderedRevisions = revisions
    .sort((a, b) => a.order - b.order || a.revisionId.localeCompare(b.revisionId, 'ja'))
    .map((revision, order) => ({ ...revision, order }))
  const activeRevisionId = typeof input.activeRevisionId === 'string'
    && orderedRevisions.some(revision => revision.revisionId === input.activeRevisionId)
    ? input.activeRevisionId
    : orderedRevisions[0]!.revisionId
  return {
    cutId: input.cutId,
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? Math.max(0, Math.round(input.order)) : fallbackOrder,
    extensions: parseProjectExtensions(input.extensions),
    metadata,
    activeRevisionId,
    revisions: orderedRevisions,
  }
}

function normalizeSheetRevisionDocument(input: unknown, fallbackOrder: number): SheetRevisionDocument {
  if (!isRecord(input) || typeof input.revisionId !== 'string'
    || !isRecord(input.metadata) || !isRecord(input.sheetView) || !isRecord(input.logicalSheet)
    || !Array.isArray(input.cspTrackSlots) || !Array.isArray(input.stackGuideLabelPlacements)
    || (!Array.isArray(input.memos) && !Array.isArray(input.annotations)) || !Array.isArray(input.timedRangeCues)) {
    throw new Error(`シート${fallbackOrder + 1}のデータが不正です。`)
  }
  return {
    revisionId: input.revisionId,
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? Math.max(0, Math.round(input.order)) : fallbackOrder,
    name: stringValue(input.name)?.trim() || undefined,
    sourceRevisionId: stringValue(input.sourceRevisionId),
    protected: input.protected === true || undefined,
    reference: normalizeSheetRevisionReference(input.reference),
    metadata: {
      worker: stringValue(input.metadata.worker),
      custom: isStringRecord(input.metadata.custom) ? { ...input.metadata.custom } : undefined,
    },
    sheetFields: normalizeSheetFormFieldValues(input.sheetFields),
    pageFields: normalizeSheetFormPageFieldValues(input.pageFields),
    sheetView: input.sheetView as unknown as SheetViewState,
    logicalSheet: input.logicalSheet as unknown as SheetRevisionDocument['logicalSheet'],
    cspTrackSlots: input.cspTrackSlots as CspTrackSlot[],
    stackGuideLabelPlacements: input.stackGuideLabelPlacements as StackGuideLabelPlacementState[],
    memos: migrateLegacyMemos(
      input.memos,
      Array.isArray(input.annotations) ? input.annotations as Annotation[] : [],
      Array.isArray(input.timelineMemos) ? input.timelineMemos as Omit<TimelineInkMemo, 'kind'>[] : [],
    ),
    timedRangeCues: input.timedRangeCues as TimedRangeCue[],
  }
}

function normalizeLegacySheetRevisionDocument(input: Record<string, unknown>): SheetRevisionDocument {
  if (!isRecord(input.sheetView) || !isRecord(input.logicalSheet)
    || !Array.isArray(input.cspTrackSlots) || !Array.isArray(input.stackGuideLabelPlacements)
    || (!Array.isArray(input.memos) && !Array.isArray(input.annotations)) || !Array.isArray(input.timedRangeCues)) {
    throw new Error('旧形式のタイムシートデータが不正です。')
  }
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  return normalizeSheetRevisionDocument({
    revisionId: 'sheet_revision_1',
    order: 0,
    metadata: {
      worker: stringValue(metadata.worker),
      custom: isStringRecord(metadata.custom) ? { ...metadata.custom } : undefined,
    },
    sheetFields: normalizeSheetFormFieldValues(input.sheetFields),
    pageFields: normalizeSheetFormPageFieldValues(input.pageFields),
    sheetView: input.sheetView,
    logicalSheet: input.logicalSheet,
    cspTrackSlots: input.cspTrackSlots,
    stackGuideLabelPlacements: input.stackGuideLabelPlacements,
    memos: Array.isArray(input.memos) ? input.memos : undefined,
    annotations: Array.isArray(input.annotations) ? input.annotations : [],
    timelineMemos: Array.isArray(input.timelineMemos) ? input.timelineMemos : [],
    timedRangeCues: input.timedRangeCues,
  }, 0)
}

function cutMetadataWithProduction(cut: CutSheetMetadata, revision: SheetRevisionDocument['metadata'], production: ProductionMetadata): CutMetadata {
  return {
    title: production.title,
    episode: production.episode,
    scene: cut.scene,
    cut: cut.cut,
    cspTimelineName: cut.cspTimelineName,
    worker: revision.worker,
    custom: revision.custom,
  }
}

function normalizeSheetRevisionReference(input: unknown): SheetRevisionDocument['reference'] {
  if (!isRecord(input) || typeof input.revisionId !== 'string') return undefined
  return {
    revisionId: input.revisionId,
    opacity: clampReferenceOpacity(typeof input.opacity === 'number' ? input.opacity : 0.28),
  }
}

function clampReferenceOpacity(opacity: number): number {
  return Math.min(0.7, Math.max(0.08, Number.isFinite(opacity) ? opacity : 0.28))
}

function activeCutDocument(document: CutGroupProjectDocument): CutSheetDocument {
  const cut = document.cuts.find(candidate => candidate.cutId === document.activeCutId) ?? document.cuts[0]
  if (!cut) throw new Error('active cut not found')
  return cut
}

function activeRevisionForCut(cut: CutSheetDocument): SheetRevisionDocument {
  const revision = cut.revisions.find(candidate => candidate.revisionId === cut.activeRevisionId) ?? cut.revisions[0]
  if (!revision) throw new Error('active sheet revision not found')
  return revision
}

function updateCutActiveRevisionFromProject(cut: CutSheetDocument, project: CutProject): CutSheetDocument {
  const active = activeRevisionForCut(cut)
  const nextRevision = sheetRevisionFromProject(project, active.revisionId, active.order, active)
  return {
    ...cut,
    extensions: project.extensions,
    metadata: cutSheetMetadataFromProject(project),
    revisions: cut.revisions.map(revision => revision.revisionId === active.revisionId ? nextRevision : revision),
  }
}

function replaceCut(document: CutGroupProjectDocument, nextCut: CutSheetDocument): CutGroupProjectDocument {
  return {
    ...document,
    cuts: document.cuts.map(cut => cut.cutId === nextCut.cutId ? nextCut : cut),
  }
}

function nextSheetRevisionId(cut: CutSheetDocument): string {
  const used = new Set(cut.revisions.map(revision => revision.revisionId))
  let index = cut.revisions.length + 1
  while (used.has(`sheet_revision_${index}`)) index += 1
  return `sheet_revision_${index}`
}

function duplicateRevisionFromSource(source: SheetRevisionDocument, revisionId: string, order: number, name: string): SheetRevisionDocument {
  return {
    ...cloneRevision(source),
    revisionId,
    order,
    name,
    sourceRevisionId: source.revisionId,
    protected: undefined,
    reference: undefined,
  }
}

function blankRevisionFromSource(source: SheetRevisionDocument, revisionId: string, order: number, name: string): SheetRevisionDocument {
  return {
    ...duplicateRevisionFromSource(source, revisionId, order, name),
    sheetFields: {},
    pageFields: {},
    logicalSheet: { ...cloneRevision(source).logicalSheet, events: [] },
    memos: [],
    timedRangeCues: [],
  }
}

function cloneRevision(revision: SheetRevisionDocument): SheetRevisionDocument {
  return structuredClone(revision)
}

function isCutGroupProjectDocumentInput(input: unknown): input is Partial<CutGroupProjectDocument> {
  return isRecord(input) && input.documentKind === PROJECT_DOCUMENT_KIND
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
