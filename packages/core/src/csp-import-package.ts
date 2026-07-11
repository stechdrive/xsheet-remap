import type {
  CorrectionLayer,
  CspTrackSlot,
  CutAsset,
  CutGroupProjectDocument,
  CutProject,
  CutSheetDocument,
  ExportPlan,
  ExportProfile,
  StackGuideLabel,
  StackGuideRegistration,
  ValidationIssue,
} from './types'
import { NULL_CELL_CSP_CELL_NAME } from './types'
import {
  activeCutProjectFromDocument,
  buildExportPlan,
  stackGuideCspCellName,
  stackGuideRegistrations,
  updateActiveCutProjectInDocument,
} from './project'
import { formatSheetTemplateCutNumber, type SheetTemplate } from './sheet-template'

export const CSP_IMPORT_PACKAGE_DIRECTORY = 'xsheet-csp-import'
export const CSP_IMPORT_MANIFEST_FILE_NAME = 'csp-import.xci'
export const CSP_IMPORT_SETUP_XDTS_FILE_NAME = '_setup.xdts'

export type CspImportManifestTrackKind =
  | 'cell'
  | 'stack-guide'
  | 'camera-note'
  | 'memo'
  | 'separator'

export interface CspImportManifestV3 {
  schemaVersion: 3
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
  assetPath: string
  firstFrame: number
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
  manifest: CspImportManifestV3
  setupOutput?: CspImportPackageSetupOutput
  cutOutputs: CspImportPackageCutOutput[]
  issues: ValidationIssue[]
}

export interface BuildCspImportPackageOptions {
  exportProfileId?: string
  appVersion?: string
  outputDirectoryName?: string
}

interface CutBuildInput {
  cutId: string
  project: CutProject
  sheetTemplate?: Pick<SheetTemplate, 'naming'>
  exportPlan: ExportPlan
  exportProfile?: ExportProfile
  fileStem: string
}

interface AssetRootResolution {
  rootId: string
  path: string
}

interface ResolvedCelAsset {
  asset: CutAsset | undefined
  assetPath?: string
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
  const fileStems = uniqueCutFileStems(cutProjects)
  const cutInputs = cutProjects.map((project, index): CutBuildInput => ({
    cutId: syncedDocument.cuts[index]?.cutId ?? `cut_${index + 1}`,
    project,
    sheetTemplate: syncedDocument.sheetTemplate,
    exportPlan: buildExportPlan(project, options.exportProfileId),
    exportProfile: exportProfileForProject(project, options.exportProfileId),
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

  const usedAssetIds = collectCspImportAssetIds(cutInputs, issues)
  const assetRoot = resolveCspImportAssetRoot(syncedDocument, cutProjects[0] ?? activeCutProjectFromDocument(syncedDocument), usedAssetIds, issues)
  const cuts = cutInputs.map((input, index) => buildManifestCut(input, index, assetRoot, issues))
  const setupOutput = cutInputs.length > 1
    ? {
        xdtsFileName: CSP_IMPORT_SETUP_XDTS_FILE_NAME,
        exportPlan: buildSetupExportPlan(cutInputs),
      }
    : undefined
  const manifest: CspImportManifestV3 = {
    schemaVersion: 3,
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
      cutNumber: cutNumberForProject(input.project, input.cutId),
      displayName: cutDisplayName(input.project, input.cutId),
      timelineName: cspTimelineNameForProject(input),
      xdtsFileName: `${input.fileStem}.xdts`,
      operationLogFileName: `${input.fileStem}-csp-import-log.json`,
      exportPlan: input.exportPlan,
    })),
    issues,
  }
}

function exportCutProjectsFromDocument(document: CutGroupProjectDocument): CutProject[] {
  if (document.cuts.length === 0) return [activeCutProjectFromDocument(document)]
  return document.cuts.map((cut: CutSheetDocument) => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
}

function buildManifestCut(
  input: CutBuildInput,
  order: number,
  assetRoot: AssetRootResolution | undefined,
  issues: ValidationIssue[],
): CspImportManifestCut {
  const tracks = input.exportPlan.tracks
    .filter(track => !track.dummy)
    .map(track => buildManifestTrack(input.project, track, input.exportProfile, assetRoot, issues))
    .filter((track): track is CspImportManifestTrack => Boolean(track))
  return {
    cutId: input.cutId,
    order,
    ...(input.project.cut.scene?.trim() ? { scene: input.project.cut.scene.trim() } : {}),
    cutNumber: cutNumberForProject(input.project, input.cutId),
    displayName: cutDisplayName(input.project, input.cutId),
    timelineName: cspTimelineNameForProject(input),
    durationFrames: input.project.logicalSheet.durationFrames,
    fps: input.project.logicalSheet.fps,
    files: {
      xdts: `${input.fileStem}.xdts`,
      operationLog: `${input.fileStem}-csp-import-log.json`,
    },
    importStack: {
      enabled: input.exportPlan.mode === 'import-stack',
      startSeparator: input.exportProfile?.importStackStartSeparatorName ?? '===== XSHEET IMPORT START =====',
      endSeparator: input.exportProfile?.importStackEndSeparatorName ?? '===== XSHEET IMPORT END =====',
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
  const first = cutInputs[0]
  const startSeparator = first?.exportProfile?.importStackStartSeparatorName ?? '===== XSHEET IMPORT START ====='
  const endSeparator = first?.exportProfile?.importStackEndSeparatorName ?? '===== XSHEET IMPORT END ====='
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
  profile: ExportProfile | undefined,
  assetRoot: AssetRootResolution | undefined,
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
      paperRegion: profile?.timingSourceRole ?? 'action',
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
  assetRoot: AssetRootResolution | undefined,
  issues: ValidationIssue[],
): CspImportManifestCel[] {
  const cels = new Map<string, CspImportManifestCel>()
  for (const frame of track.frames) {
    const cspCellName = frame.value
    if (!cspCellName || cspCellName === NULL_CELL_CSP_CELL_NAME) continue
    if (cels.has(cspCellName)) continue
    const binding = project.bindings.find(item => item.slotId === slot.slotId && item.cspCellName === cspCellName)
    const resolved = resolveManifestCelAsset(project, binding?.assetId, assetRoot, cspCellName, issues, `${slot.slotId}/${cspCellName}`)
    if (!resolved.assetPath) continue
    cels.set(cspCellName, {
      cspCellName,
      assetPath: resolved.assetPath,
      firstFrame: frame.frame,
    })
  }
  return [...cels.values()]
}

function buildStackGuideTrackCels(
  project: CutProject,
  track: ExportPlan['tracks'][number],
  label: StackGuideLabel,
  registration: StackGuideRegistration,
  assetRoot: AssetRootResolution | undefined,
  issues: ValidationIssue[],
): CspImportManifestCel[] {
  const cspCellName = track.frames.find(frame => frame.value)?.value ?? stackGuideCspCellName(label, registration)
  if (!cspCellName || cspCellName === NULL_CELL_CSP_CELL_NAME) return []
  if (registration.assetIds.length !== 1) {
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
    cspCellName,
    issues,
    `${label.labelId}/${registration.registrationId}`,
  )
  if (!resolved.assetPath) return []
  return [{
    cspCellName,
    assetPath: resolved.assetPath,
    firstFrame: track.frames.find(frame => frame.value === cspCellName)?.frame ?? 0,
  }]
}

function collectCspImportAssetIds(cutInputs: CutBuildInput[], issues: ValidationIssue[]): Set<string> {
  const assetIds = new Set<string>()
  for (const input of cutInputs) {
    for (const track of input.exportPlan.tracks) {
      if (track.dummy) continue
      if (track.slotId) {
        for (const frame of track.frames) {
          const cspCellName = frame.value
          if (!cspCellName || cspCellName === NULL_CELL_CSP_CELL_NAME) continue
          const binding = input.project.bindings.find(item => item.slotId === track.slotId && item.cspCellName === cspCellName)
          if (!binding?.assetId) {
            issues.push(cspImportIssue(
              'cspImport.binding.assetMissing',
              `CSP自動登録には画像素材が必要です: ${track.name} / ${cspCellName}`,
            ))
            continue
          }
          assetIds.add(binding.assetId)
        }
        continue
      }
      if (track.stackGuideLabelId) {
        const label = input.project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
        const registration = label
          ? stackGuideRegistrations(label).find(item => item.registrationId === track.stackGuideRegistrationId)
          : undefined
        for (const assetId of registration?.assetIds ?? []) assetIds.add(assetId)
      }
    }
  }
  return assetIds
}

function resolveCspImportAssetRoot(
  document: CutGroupProjectDocument,
  project: CutProject,
  usedAssetIds: Set<string>,
  issues: ValidationIssue[],
): AssetRootResolution | undefined {
  const pathRoots = project.assetRoots.filter(root => root.path)
  if (pathRoots.length === 0) {
    issues.push(cspImportIssue('cspImport.assetRoot.required', 'CSP自動登録にはパス付きのカットフォルダが必要です。'))
    return undefined
  }

  const selected = document.cspImportAssetRootId
    ? pathRoots.find(root => root.rootId === document.cspImportAssetRootId)
    : undefined
  if (!selected?.path) {
    issues.push(cspImportIssue('cspImport.assetRoot.selectionRequired', 'CSP自動登録に使うカットフォルダを選択してください。'))
    return undefined
  }

  for (const assetId of usedAssetIds) {
    const asset = project.assets.find(item => item.assetId === assetId)
    if (!asset) {
      issues.push(cspImportIssue('cspImport.asset.missing', `画像素材が見つかりません: ${assetId}`))
      continue
    }
    if (!assetRootRelativePath(project, asset, { rootId: selected.rootId, path: selected.path })) {
      issues.push(cspImportIssue('cspImport.asset.outsideRoot', `画像素材が選択したカットフォルダの外にあります: ${asset.displayName}`))
    }
  }
  return { rootId: selected.rootId, path: selected.path }
}

function resolveManifestCelAsset(
  project: CutProject,
  assetId: string | undefined,
  assetRoot: AssetRootResolution | undefined,
  cspCellName: string,
  issues: ValidationIssue[],
  context: string,
): ResolvedCelAsset {
  if (!assetId) {
    issues.push(cspImportIssue('cspImport.asset.required', `CSP自動登録には画像素材が必要です: ${context}`))
    return { asset: undefined }
  }
  const asset = project.assets.find(item => item.assetId === assetId)
  if (!asset) {
    issues.push(cspImportIssue('cspImport.asset.missing', `画像素材が見つかりません: ${assetId}`))
    return { asset: undefined }
  }
  if (!assetRoot) return { asset }
  const assetPath = assetRootRelativePath(project, asset, assetRoot)
  if (!assetPath) {
    issues.push(cspImportIssue('cspImport.asset.outsideRoot', `画像素材がCSP自動登録用カットフォルダの外にあります: ${asset.displayName}`))
    return { asset }
  }
  if (fileStem(assetPath) !== cspCellName) {
    issues.push(cspImportIssue(
      'cspImport.asset.stemMismatch',
      `CSPセル名と画像ファイル名を一致させてください: ${cspCellName} / ${assetPath}`,
    ))
    return { asset }
  }
  return { asset, assetPath }
}

function assetRootRelativePath(project: CutProject, asset: CutAsset, assetRoot: AssetRootResolution): string | undefined {
  if (asset.rootId === assetRoot.rootId && asset.relativePath) {
    return normalizeManifestRelativePath(asset.relativePath)
  }
  const root = project.assetRoots.find(item => item.rootId === assetRoot.rootId)
  if (!root?.path || !asset.currentPath) return undefined
  return relativePathFromRoot(asset.currentPath, root.path)
}

function relativePathFromRoot(path: string, rootPath: string): string | undefined {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(rootPath).replace(/\/+$/, '')
  const pathKey = normalizedPath.toLowerCase()
  const rootKey = normalizedRoot.toLowerCase()
  if (pathKey === rootKey) return undefined
  if (!pathKey.startsWith(`${rootKey}/`)) return undefined
  return normalizeManifestRelativePath(normalizedPath.slice(normalizedRoot.length + 1))
}

function normalizeManifestRelativePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..' || part === '')) return undefined
  return normalized
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function uniqueCutFileStems(projects: CutProject[]): string[] {
  const used = new Set<string>()
  return projects.map((project, index) => {
    const base = safeFileStem(cutIdentityForProject(project, `cut_${index + 1}`)) || `cut_${index + 1}`
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
  const { project } = input
  const timelineName = project.cut.cspTimelineName?.trim() || project.cut.custom?.cspTimelineName?.trim()
  const outputCut = timelineName || formattedCutIdentity(input, `cut_${index + 1}`)
  return safeFileStem(outputCut) || `cut_${index + 1}`
}

function safeFileStem(value: string): string {
  return Array.from(value.trim(), char => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char)) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_. ]+|[_. ]+$/g, '')
}

function cutNumberForProject(project: CutProject, cutId: string): string {
  return project.cut.cut?.trim() || cutId
}

function cutDisplayName(project: CutProject, cutId: string): string {
  return cutIdentityForProject(project, cutId)
}

function cspTimelineNameForProject(input: CutBuildInput): string {
  const timelineName = input.project.cut.cspTimelineName?.trim() || input.project.cut.custom?.cspTimelineName?.trim()
  return timelineName || formattedCutIdentity(input, input.cutId)
}

function formattedCutIdentity(input: Pick<CutBuildInput, 'project' | 'sheetTemplate'>, fallback: string): string {
  const cut = formatSheetTemplateCutNumber(input.sheetTemplate, input.project.cut.cut?.trim() || fallback)
  const scene = input.project.cut.scene?.trim()
  return scene ? `${scene}-${cut}` : cut
}

function cutIdentityForProject(project: CutProject, fallback: string): string {
  const cut = project.cut.cut?.trim() || fallback
  const scene = project.cut.scene?.trim()
  return scene ? `${scene}-${cut}` : cut
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
    const timelineName = cspTimelineNameForProject(input)
    const timelineKey = timelineName.trim().toLocaleLowerCase('ja')
    if (timelineNames.has(timelineKey)) {
      issues.push(cspImportIssue('cspImport.timelineName.duplicate', `CSPタイムライン名が重複しています: ${timelineName}`))
    }
    timelineNames.add(timelineKey)
  }
  return issues
}

function exportProfileForProject(project: CutProject, profileId: string | undefined): ExportProfile | undefined {
  return profileId
    ? project.exportProfiles.find(profile => profile.profileId === profileId) ?? project.exportProfiles[0]
    : project.exportProfiles.find(profile => profile.mode === 'import-stack') ?? project.exportProfiles[0]
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

function fileStem(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(0, dotIndex) : name
}

function cspImportIssue(code: string, message: string): ValidationIssue {
  return {
    issueId: `${code}:${message}`,
    severity: 'error',
    code,
    message,
    target: { entity: 'export' },
  }
}
