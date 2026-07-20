import type {
  CorrectionLayer,
  AssetRoot,
  CspTrackSlot,
  CutAsset,
  CutGroupProjectDocument,
  CutProject,
  CutSheetDocument,
  ExportPlan,
  SheetTimingRole,
  StackGuideLabel,
  StackGuideRegistration,
  ValidationIssue,
} from './types'
import { assetAbsolutePath, assetRelativePath } from './assets'
import { NULL_CELL_CSP_CELL_NAME } from './types'
import {
  activeCutProjectFromDocument,
  buildExportPlan,
  stackGuideCspCellName,
  stackGuideRegistrations,
  updateActiveCutProjectInDocument,
} from './project'
import { CSP_IMPORT_STACK_END_SEPARATOR_NAME, CSP_IMPORT_STACK_START_SEPARATOR_NAME, DEFAULT_EXPORT_TIMING_ROLE } from './project-constants'

export const CSP_IMPORT_PACKAGE_DIRECTORY = 'xsheet-csp-import'
export const CSP_IMPORT_MANIFEST_FILE_NAME = 'csp-import.xci'
export const CSP_IMPORT_SETUP_XDTS_FILE_NAME = '_setup.xdts'

export type CspImportManifestTrackKind =
  | 'cell'
  | 'stack-guide'
  | 'camera-note'
  | 'memo'
  | 'separator'

export interface CspImportManifestV4 {
  schemaVersion: 4
  createdBy: {
    app: 'xsheet-remap'
    version?: string
  }
  assetRoot: string
  outputClipFileName?: string
  setup?: CspImportManifestSetup
  cuts: CspImportManifestCut[]
}

export interface CspImportManifestSetup {
  xdts: string
  purpose: 'create-union-animation-folders'
}

export interface CspImportManifestCut {
  cutId: string
  order: number
  scene?: string
  cutNumber: string
  displayName: string
  timelineName: string
  durationFrames: number
  fps: number
  files: {
    xdts: string
    operationLog: string
  }
  importStack: {
    enabled: boolean
    startSeparator: string
    endSeparator: string
  }
  tracks: CspImportManifestTrack[]
  validation: {
    expectedTrackCount: number
    expectedGeneratedFolders: string[]
  }
}

export interface CspImportManifestTrack {
  trackId: string
  kind: CspImportManifestTrackKind
  paperRegion?: string
  paperTrackLabel?: string
  stageId?: string
  stageLabel?: string
  xdtsTrackName: string
  stackOrder: number
  stageOrder?: number
  targetFolderPath: string[]
  cels: CspImportManifestCel[]
}

export interface CspImportManifestCel {
  cspCellName: string
  firstFrame: number
  material?: {
    assetId: string
    pathKind: 'asset-root-relative' | 'absolute'
    path: string
  }
}

export interface CspImportPackageCutOutput {
  cutId: string
  cutNumber: string
  displayName: string
  timelineName: string
  xdtsFileName: string
  operationLogFileName: string
  exportPlan: ExportPlan
}

export interface CspImportPackageSetupOutput {
  xdtsFileName: string
  exportPlan: ExportPlan
}

export interface CspImportPackageBuildResult {
  outputDirectoryName: string
  manifestFileName: string
  assetRootPath?: string
  manifest: CspImportManifestV4
  setupOutput?: CspImportPackageSetupOutput
  cutOutputs: CspImportPackageCutOutput[]
  materialSummary: CspImportPackageMaterialSummary
  issues: ValidationIssue[]
}

export interface CspImportPackageMaterialSummary {
  withMaterialCount: number
  keyOnlyCount: number
  unavailableAssignedCount: number
}

export interface BuildCspImportPackageOptions {
  exportProfileId?: string
  timingSourceRole?: SheetTimingRole
  appVersion?: string
  outputDirectoryName?: string
}

interface CutBuildInput {
  cutId: string
  project: CutProject
  exportPlan: ExportPlan
  fileStem: string
}

interface ResolvedCelAsset {
  asset: CutAsset | undefined
  material?: CspImportManifestCel['material']
}

interface SetupTrackSource {
  project: CutProject
  track: ExportPlan['tracks'][number]
}

interface SetupTrackGroup {
  correctionLayerId: string
  project: CutProject
  layer?: CorrectionLayer
  separator?: ExportPlan['tracks'][number]
  tracks: Map<string, SetupTrackSource>
}

export function buildCspImportPackage(
  documentInput: CutGroupProjectDocument,
  options: BuildCspImportPackageOptions = {},
): CspImportPackageBuildResult {
  const syncedDocument = updateActiveCutProjectInDocument(documentInput, activeCutProjectFromDocument(documentInput), {
    sheetTemplate: documentInput.sheetTemplate,
  })
  const cutProjects = exportCutProjectsFromDocument(syncedDocument)
  const timingSourceRole = options.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE
  const plans = cutProjects.map((project, index) => buildExportPlan(project, {
    profileId: options.exportProfileId,
    timingSourceRole,
    sheetTemplate: syncedDocument.sheetTemplate,
    fallbackCutId: syncedDocument.cuts[index]?.cutId ?? `cut_${index + 1}`,
  }))
  const fileStems = uniqueCutFileStems(plans)
  const cutInputs = cutProjects.map((project, index): CutBuildInput => ({
    cutId: syncedDocument.cuts[index]?.cutId ?? `cut_${index + 1}`,
    project,
    exportPlan: plans[index]!,
    fileStem: fileStems[index] ?? `cut_${index + 1}`,
  }))
  const issues: ValidationIssue[] = []
  for (const cutInput of cutInputs) {
    if (cutInput.exportPlan.mode !== 'import-stack') {
      issues.push(cspImportIssue('cspImport.importStack.required', 'CSP自動登録には仮置きスタック形式のXDTS出力設定が必要です。'))
    }
    issues.push(...cutInput.exportPlan.validation.filter(issue => issue.severity === 'error'))
  }
  issues.push(...validateCutIdentities(cutInputs))

  const assetRoot = resolveCspImportAssetRoot(syncedDocument, issues)
  const cuts = cutInputs.map((input, index) => buildManifestCut(input, index, assetRoot, issues))
  const setupOutput = cutInputs.length > 1
    ? {
        xdtsFileName: CSP_IMPORT_SETUP_XDTS_FILE_NAME,
        exportPlan: buildSetupExportPlan(cutInputs),
      }
    : undefined
  const manifest: CspImportManifestV4 = {
    schemaVersion: 4,
    createdBy: {
      app: 'xsheet-remap',
      ...(options.appVersion ? { version: options.appVersion } : {}),
    },
    assetRoot: '..',
    ...cspOutputClipFileName(cutInputs),
    ...(setupOutput ? { setup: { xdts: setupOutput.xdtsFileName, purpose: 'create-union-animation-folders' as const } } : {}),
    cuts,
  }
  return {
    outputDirectoryName: options.outputDirectoryName ?? CSP_IMPORT_PACKAGE_DIRECTORY,
    manifestFileName: CSP_IMPORT_MANIFEST_FILE_NAME,
    assetRootPath: assetRoot?.path,
    manifest,
    setupOutput,
    cutOutputs: cutInputs.map(input => ({
      cutId: input.cutId,
      cutNumber: input.exportPlan.metadata.cut,
      displayName: input.exportPlan.metadata.displayName,
      timelineName: input.exportPlan.metadata.timeTableName,
      xdtsFileName: `${input.fileStem}.xdts`,
      operationLogFileName: `${input.fileStem}-csp-import-log.json`,
      exportPlan: input.exportPlan,
    })),
    materialSummary: summarizeManifestMaterials(cuts, issues),
    issues,
  }
}

function summarizeManifestMaterials(
  cuts: CspImportManifestCut[],
  issues: ValidationIssue[],
): CspImportPackageMaterialSummary {
  const cels = cuts.flatMap(cut => cut.tracks.flatMap(track => track.cels))
  return {
    withMaterialCount: cels.filter(cel => Boolean(cel.material)).length,
    keyOnlyCount: cels.filter(cel => !cel.material).length,
    unavailableAssignedCount: issues.filter(issue =>
      issue.code === 'cspImport.asset.missing' || issue.code === 'cspImport.asset.offline',
    ).length,
  }
}

function exportCutProjectsFromDocument(document: CutGroupProjectDocument): CutProject[] {
  if (document.cuts.length === 0) return [activeCutProjectFromDocument(document)]
  return document.cuts.map((cut: CutSheetDocument) => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
}

function buildManifestCut(
  input: CutBuildInput,
  order: number,
  assetRoot: AssetRoot | undefined,
  issues: ValidationIssue[],
): CspImportManifestCut {
  const tracks = input.exportPlan.tracks
    .filter(track => !track.dummy)
    .map(track => buildManifestTrack(input.project, track, input.exportPlan.timingSourceRole, assetRoot, issues))
    .filter((track): track is CspImportManifestTrack => Boolean(track))
  return {
    cutId: input.cutId,
    order,
    ...(input.exportPlan.metadata.scene ? { scene: input.exportPlan.metadata.scene } : {}),
    cutNumber: input.exportPlan.metadata.cut,
    displayName: input.exportPlan.metadata.displayName,
    timelineName: input.exportPlan.metadata.timeTableName,
    durationFrames: input.project.logicalSheet.durationFrames,
    fps: input.project.logicalSheet.fps,
    files: {
      xdts: `${input.fileStem}.xdts`,
      operationLog: `${input.fileStem}-csp-import-log.json`,
    },
    importStack: {
      enabled: input.exportPlan.mode === 'import-stack',
      startSeparator: CSP_IMPORT_STACK_START_SEPARATOR_NAME,
      endSeparator: CSP_IMPORT_STACK_END_SEPARATOR_NAME,
    },
    tracks,
    validation: {
      expectedTrackCount: tracks.length,
      expectedGeneratedFolders: tracks.map(track => track.xdtsTrackName),
    },
  }
}

function buildSetupExportPlan(cutInputs: CutBuildInput[]): ExportPlan {
  const first = cutInputs[0]
  const mergedTracks = mergeSetupTracks(cutInputs)
  return {
    mode: 'import-stack',
    metadata: {
      cut: '_setup',
      scene: '',
      displayName: 'CSPセットアップ',
      timeTableName: 'CSPセットアップ',
    },
    timingSourceRole: first?.exportPlan.timingSourceRole ?? DEFAULT_EXPORT_TIMING_ROLE,
    durationFrames: Math.max(1, ...cutInputs.map(input => input.project.logicalSheet.durationFrames)),
    fps: first?.project.logicalSheet.fps ?? 24,
    tracks: mergedTracks.map((track, index) => ({
      ...track,
      trackNo: index,
      frames: [{ frame: 0, value: null }],
    })),
    validation: [],
    cspInstructions: [],
  }
}

function mergeSetupTracks(cutInputs: CutBuildInput[]): ExportPlan['tracks'] {
  const groups = new Map<string, SetupTrackGroup>()
  const startSeparator = CSP_IMPORT_STACK_START_SEPARATOR_NAME
  const endSeparator = CSP_IMPORT_STACK_END_SEPARATOR_NAME
  let startTrack: ExportPlan['tracks'][number] | undefined
  let endTrack: ExportPlan['tracks'][number] | undefined

  for (const input of cutInputs) {
    const sorted = [...input.exportPlan.tracks].sort((a, b) => a.trackNo - b.trackNo)
    for (const track of sorted) {
      if (track.dummy) {
        if (isSetupBoundarySeparator(track.name, startSeparator)) {
          startTrack ??= track
          continue
        }
        if (isSetupBoundarySeparator(track.name, endSeparator)) {
          endTrack ??= track
          continue
        }
        const layer = correctionLayerForSeparator(input.project, track.name)
        if (layer) {
          ensureSetupGroup(groups, input.project, layer).separator ??= track
        }
        continue
      }

      const layer = correctionLayerForSetupTrack(input.project, track)
      if (!layer) continue
      const group = ensureSetupGroup(groups, input.project, layer)
      const key = setupTrackKey(track)
      if (!group.tracks.has(key)) {
        group.tracks.set(key, { project: input.project, track })
      }
    }
  }

  const merged: ExportPlan['tracks'] = []
  const hasSetupTracks = [...groups.values()].some(group => group.tracks.size > 0)
  if (!hasSetupTracks) return []
  merged.push(startTrack ?? setupBoundarySeparator(startSeparator))
  for (const group of [...groups.values()].sort(compareSetupGroups)) {
    if (group.tracks.size === 0) continue
    merged.push(group.separator ?? setupGroupSeparator(group))
    merged.push(
      ...[...group.tracks.values()]
        .sort((a, b) => compareSetupGroupTracks(a, b))
        .map(source => source.track),
    )
  }
  merged.push(endTrack ?? setupBoundarySeparator(endSeparator))
  return merged
}

function setupTrackKey(track: ExportPlan['tracks'][number]): string {
  if (track.slotId) return `slot:${track.slotId}`
  if (track.stackGuideLabelId) return `stack:${track.stackGuideLabelId}:${track.stackGuideRegistrationId ?? ''}`
  return `dummy:${track.name}`
}

function ensureSetupGroup(
  groups: Map<string, SetupTrackGroup>,
  project: CutProject,
  layer: CorrectionLayer,
): SetupTrackGroup {
  const existing = groups.get(layer.layerId)
  if (existing) return existing
  const group: SetupTrackGroup = {
    correctionLayerId: layer.layerId,
    project,
    layer,
    tracks: new Map(),
  }
  groups.set(layer.layerId, group)
  return group
}

function isSetupBoundarySeparator(name: string, expected: string): boolean {
  return name.trim() === expected.trim()
}

function setupBoundarySeparator(name: string): ExportPlan['tracks'][number] {
  return {
    trackNo: -1,
    name,
    dummy: true,
    frames: [{ frame: 0, value: null }],
  }
}

function setupGroupSeparator(group: SetupTrackGroup): ExportPlan['tracks'][number] {
  return setupBoundarySeparator(`===== ${group.layer?.label ?? group.correctionLayerId} =====`)
}

function correctionLayerForSeparator(project: CutProject, separatorName: string): CorrectionLayer | undefined {
  const label = separatorName.replace(/^=+\s*/, '').replace(/\s*=+$/, '').trim()
  return project.correctionLayers.find(layer => layer.label === label)
}

function correctionLayerForSetupTrack(
  project: CutProject,
  track: ExportPlan['tracks'][number],
): CorrectionLayer | undefined {
  if (track.slotId) {
    const slot = project.cspTrackSlots.find(item => item.slotId === track.slotId)
    return slot ? correctionLayerForSlot(project, slot) : undefined
  }
  if (track.stackGuideLabelId) {
    const label = project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
    const registration = label
      ? stackGuideRegistrations(label).find(item => item.registrationId === track.stackGuideRegistrationId)
      : undefined
    return registration
      ? project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
      : undefined
  }
  return undefined
}

function compareSetupGroups(a: SetupTrackGroup, b: SetupTrackGroup): number {
  return (stageOrderForLayer(a.project, a.layer) ?? Number.MAX_SAFE_INTEGER) - (stageOrderForLayer(b.project, b.layer) ?? Number.MAX_SAFE_INTEGER)
    || (a.layer?.order ?? Number.MAX_SAFE_INTEGER) - (b.layer?.order ?? Number.MAX_SAFE_INTEGER)
    || (a.layer?.label ?? a.correctionLayerId).localeCompare(b.layer?.label ?? b.correctionLayerId, 'ja')
    || a.correctionLayerId.localeCompare(b.correctionLayerId, 'ja')
}

function compareSetupGroupTracks(a: SetupTrackSource, b: SetupTrackSource): number {
  const aKey = setupGroupTrackSortKey(a)
  const bKey = setupGroupTrackSortKey(b)
  return aKey.band - bKey.band
    || aKey.position - bKey.position
    || aKey.orderInGap - bKey.orderInGap
    || aKey.trackNo - bKey.trackNo
    || aKey.name.localeCompare(bKey.name, 'ja')
    || setupTrackKey(a.track).localeCompare(setupTrackKey(b.track), 'ja')
}

function setupGroupTrackSortKey(source: SetupTrackSource): {
  band: number
  position: number
  orderInGap: number
  trackNo: number
  name: string
} {
  const { project, track } = source
  if (track.slotId) {
    const slot = project.cspTrackSlots.find(item => item.slotId === track.slotId)
    const paperTrackIndex = slot ? paperTrackOrderForSetup(project, slot.paperTrack) : Number.MAX_SAFE_INTEGER
    return {
      band: 0,
      position: paperTrackIndex + 0.5,
      orderInGap: 0,
      trackNo: slot?.trackNo ?? track.trackNo,
      name: track.name,
    }
  }
  if (track.stackGuideLabelId) {
    const label = project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
    const stackBand = label ? setupStackGuideStackBand(label) : 'cell-interleave'
    return {
      band: setupStackBandOrder(stackBand),
      position: stackBand === 'cell-interleave'
        ? label?.gapIndex ?? Number.MAX_SAFE_INTEGER
        : project.logicalSheet.paperTracks.length + setupStackBandOrder(stackBand),
      orderInGap: label?.orderInGap ?? 0,
      trackNo: Number.MAX_SAFE_INTEGER,
      name: track.name,
    }
  }
  return {
    band: Number.MAX_SAFE_INTEGER,
    position: Number.MAX_SAFE_INTEGER,
    orderInGap: 0,
    trackNo: track.trackNo,
    name: track.name,
  }
}

function paperTrackOrderForSetup(project: CutProject, paperTrack: string): number {
  const sorted = [...project.logicalSheet.paperTracks].sort((a, b) => a.order - b.order || a.paperTrack.localeCompare(b.paperTrack, 'ja'))
  const index = sorted.findIndex(track => track.paperTrack === paperTrack)
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

function setupStackGuideStackBand(label: StackGuideLabel): NonNullable<StackGuideLabel['stackBand']> {
  if (label.stackBand) return label.stackBand
  if (label.kind === 'camera-note') return 'camera-note'
  if (label.kind === 'memo') return 'memo'
  return 'cell-interleave'
}

function setupStackBandOrder(stackBand: NonNullable<StackGuideLabel['stackBand']>): number {
  if (stackBand === 'cell-interleave') return 0
  if (stackBand === 'camera-note') return 1
  return 2
}

function buildManifestTrack(
  project: CutProject,
  track: ExportPlan['tracks'][number],
  timingSourceRole: SheetTimingRole,
  assetRoot: AssetRoot | undefined,
  issues: ValidationIssue[],
): CspImportManifestTrack | null {
  if (track.slotId) {
    const slot = project.cspTrackSlots.find(item => item.slotId === track.slotId)
    if (!slot) return null
    const layer = correctionLayerForSlot(project, slot)
    const cels = buildSlotTrackCels(project, track, slot, assetRoot, issues)
    return {
      trackId: slot.slotId,
      kind: 'cell',
      paperRegion: timingSourceRole,
      paperTrackLabel: slot.paperTrack,
      stageId: layer?.stageId,
      stageLabel: layer?.label,
      xdtsTrackName: track.name,
      stackOrder: track.trackNo,
      stageOrder: stageOrderForLayer(project, layer),
      targetFolderPath: targetFolderPathForLayer(project, layer),
      cels,
    }
  }

  if (track.stackGuideLabelId) {
    const label = project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
    if (!label) return null
    const registration = stackGuideRegistrations(label).find(item => item.registrationId === track.stackGuideRegistrationId)
    if (!registration) return null
    const layer = project.correctionLayers.find(item => item.layerId === registration.correctionLayerId)
    const cels = buildStackGuideTrackCels(project, track, label, registration, assetRoot, issues)
    return {
      trackId: `${label.labelId}:${registration.registrationId}`,
      kind: stackGuideTrackKind(label),
      paperRegion: label.displayRole,
      paperTrackLabel: label.label,
      stageId: layer?.stageId,
      stageLabel: layer?.label,
      xdtsTrackName: track.name,
      stackOrder: track.trackNo,
      stageOrder: stageOrderForLayer(project, layer),
      targetFolderPath: targetFolderPathForLayer(project, layer),
      cels,
    }
  }

  return null
}

function buildSlotTrackCels(
  project: CutProject,
  track: ExportPlan['tracks'][number],
  slot: CspTrackSlot,
  assetRoot: AssetRoot | undefined,
  issues: ValidationIssue[],
): CspImportManifestCel[] {
  const cels = new Map<string, CspImportManifestCel>()
  for (const frame of track.frames) {
    const cspCellName = frame.value
    if (!cspCellName || cspCellName === NULL_CELL_CSP_CELL_NAME) continue
    if (cels.has(cspCellName)) continue
    const binding = project.bindings.find(item => item.slotId === slot.slotId && item.cspCellName === cspCellName)
    const resolved = resolveManifestCelAsset(project, binding?.assetId, assetRoot, issues, `${slot.slotId}/${cspCellName}`)
    cels.set(cspCellName, {
      cspCellName,
      firstFrame: frame.frame,
      ...(resolved.material ? { material: resolved.material } : {}),
    })
  }
  return [...cels.values()]
}

function buildStackGuideTrackCels(
  project: CutProject,
  track: ExportPlan['tracks'][number],
  label: StackGuideLabel,
  registration: StackGuideRegistration,
  assetRoot: AssetRoot | undefined,
  issues: ValidationIssue[],
): CspImportManifestCel[] {
  const cspCellName = track.frames.find(frame => frame.value)?.value ?? stackGuideCspCellName(label, registration)
  if (!cspCellName || cspCellName === NULL_CELL_CSP_CELL_NAME) return []
  if (registration.assetIds.length > 1) {
    issues.push(cspImportIssue(
      'cspImport.stackGuide.assetCount',
      `CSP自動登録では追加トラック「${label.label}」の画像素材は1件だけにしてください。`,
    ))
    return []
  }
  const resolved = resolveManifestCelAsset(
    project,
    registration.assetIds[0],
    assetRoot,
    issues,
    `${label.labelId}/${registration.registrationId}`,
  )
  return [{
    cspCellName,
    firstFrame: track.frames.find(frame => frame.value === cspCellName)?.frame ?? 0,
    ...(resolved.material ? { material: resolved.material } : {}),
  }]
}

function resolveCspImportAssetRoot(
  document: CutGroupProjectDocument,
  issues: ValidationIssue[],
): AssetRoot | undefined {
  const root = document.assetRoot
  if (!root?.path) {
    issues.push(cspImportIssue('cspImport.assetRoot.required', 'CSP自動登録にはパス付きのカットフォルダが必要です。'))
    return undefined
  }
  return root
}

function resolveManifestCelAsset(
  project: CutProject,
  assetId: string | undefined,
  assetRoot: AssetRoot | undefined,
  issues: ValidationIssue[],
  context: string,
): ResolvedCelAsset {
  if (!assetId) return { asset: undefined }
  const asset = project.assets.find(item => item.assetId === assetId)
  if (!asset) {
    issues.push(cspImportIssue('cspImport.asset.missing', `画像素材への参照を解決できません。キーのみ登録します: ${context}`, 'warning'))
    return { asset: undefined }
  }
  const relativePath = assetRelativePath(asset)
  if (relativePath) {
    return {
      asset,
      material: {
        assetId,
        pathKind: 'asset-root-relative',
        path: normalizeManifestRelativePath(relativePath) ?? relativePath,
      },
    }
  }
  const absolutePath = assetAbsolutePath(asset, assetRoot)
  if (absolutePath) {
    return { asset, material: { assetId, pathKind: 'absolute', path: absolutePath } }
  }
  issues.push(cspImportIssue('cspImport.asset.offline', `画像素材の実ファイルを解決できません。キーのみ登録します: ${asset.displayName}`, 'warning'))
  return { asset }
}

function normalizeManifestRelativePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..' || part === '')) return undefined
  return normalized
}

function uniqueCutFileStems(plans: ExportPlan[]): string[] {
  const used = new Set<string>()
  return plans.map((plan, index) => {
    const base = safeFileStem(plan.metadata.displayName) || `cut_${index + 1}`
    let candidate = base
    let suffix = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}_${suffix}`
      suffix += 1
    }
    used.add(candidate.toLowerCase())
    return candidate
  })
}

function cspOutputClipFileName(inputs: CutBuildInput[]): { outputClipFileName?: string } {
  const stem = cspOutputClipStem(inputs)
  return stem ? { outputClipFileName: `${stem}.clip` } : {}
}

function cspOutputClipStem(inputs: CutBuildInput[]): string | undefined {
  const namedInputs = inputs.filter(input => safeFileStem(input.project.cut.title ?? '') || safeFileStem(input.project.cut.episode ?? ''))
  if (namedInputs.length === 0) return undefined

  const productionPrefixes = inputs.map(input => cspOutputProductionPrefix(input.project))
  const sharedProductionPrefix = productionPrefixes[0]
  if (sharedProductionPrefix && productionPrefixes.every(prefix => prefix === sharedProductionPrefix)) {
    const cutParts = inputs.map((input, index) => cspOutputCutSegment(input, index)).filter(Boolean)
    return [sharedProductionPrefix, ...cutParts].join('_') || undefined
  }

  return inputs.map((input, index) => cspOutputProjectStem(input, index)).filter(Boolean).join('_') || undefined
}

function cspOutputProjectStem(input: CutBuildInput, index: number): string {
  const productionPrefix = cspOutputProductionPrefix(input.project)
  const cut = cspOutputCutSegment(input, index)
  return [productionPrefix, cut].filter(Boolean).join('_')
}

function cspOutputProductionPrefix(project: CutProject): string {
  const title = safeFileStem(project.cut.title ?? '')
  const episode = safeFileStem(project.cut.episode ?? '')
  return [title, episode].filter(Boolean).join('_')
}

function cspOutputCutSegment(input: CutBuildInput, index: number): string {
  return safeFileStem(input.exportPlan.metadata.timeTableName) || `cut_${index + 1}`
}

function safeFileStem(value: string): string {
  return Array.from(value.trim(), char => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char)) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_. ]+|[_. ]+$/g, '')
}

function validateCutIdentities(inputs: CutBuildInput[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cutIds = new Set<string>()
  const timelineNames = new Set<string>()
  for (const input of inputs) {
    const cutIdKey = input.cutId.trim().toLocaleLowerCase('ja')
    if (cutIds.has(cutIdKey)) {
      issues.push(cspImportIssue('cspImport.cutId.duplicate', `兼用カットIDが重複しています: ${input.cutId}`))
    }
    cutIds.add(cutIdKey)
    const timelineName = input.exportPlan.metadata.timeTableName
    const timelineKey = timelineName.trim().toLocaleLowerCase('ja')
    if (timelineNames.has(timelineKey)) {
      issues.push(cspImportIssue('cspImport.timelineName.duplicate', `CSPタイムライン名が重複しています: ${timelineName}`))
    }
    timelineNames.add(timelineKey)
  }
  return issues
}

function correctionLayerForSlot(project: CutProject, slot: CspTrackSlot): CorrectionLayer | undefined {
  return project.correctionLayers.find(layer => layer.layerId === slot.correctionLayerId)
}

function targetFolderPathForLayer(project: CutProject, layer: CorrectionLayer | undefined): string[] {
  const stage = layer?.stageId ? project.productionStages.find(item => item.stageId === layer.stageId) : undefined
  return [stage?.label, layer?.label].filter((item): item is string => Boolean(item?.trim()))
}

function stageOrderForLayer(project: CutProject, layer: CorrectionLayer | undefined): number | undefined {
  const stage = layer?.stageId ? project.productionStages.find(item => item.stageId === layer.stageId) : undefined
  return stage?.order
}

function stackGuideTrackKind(label: Pick<StackGuideLabel, 'kind'>): CspImportManifestTrackKind {
  if (label.kind === 'camera-note') return 'camera-note'
  if (label.kind === 'memo') return 'memo'
  return 'stack-guide'
}

function cspImportIssue(code: string, message: string, severity: ValidationIssue['severity'] = 'error'): ValidationIssue {
  return {
    issueId: `${code}:${message}`,
    severity,
    code,
    message,
    target: { entity: 'export' },
  }
}
