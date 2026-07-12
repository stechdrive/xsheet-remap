import {
  addOverlayPaperTrack,
  applyNameNormalizationPlan,
  assignAssetToStackGuideLabel,
  buildExportPlan,
  buildNameNormalizationPlan,
  createDefaultProject,
  createKey,
  createStackGuideLabel,
  registerAsset,
  registerAssetRoot,
  setEvent,
  updateLogicalSheetSettings,
  upsertBinding,
  validateProject,
  standardA3SheetTemplate,
  type CutAsset,
  type CutProject,
  type FileRef,
  type NameNormalizationAssetRenameResult,
  type SheetTimingRole,
  type TimingKey,
} from '@xsheet-remap/core'
import { exportXdts, parseXdts } from '@xsheet-remap/xdts'

export const FULL_DEFAULT_A3_SCENARIO_ID = 'full-default-a3'

export const FULL_DEFAULT_A3_ASSET_NAMES = [
  'A1.png', 'A1_e.png', 'A1_k.png', 'A1_s.png', 'A1_y.png', 'A1_ss.png',
  'B1.png', 'C1.png', 'D1.png', 'E1.png', 'F1.png', 'G1.png', 'H1.png', 'I1.png',
  'J1.png', 'K1.png', 'L1.png',
  'BG.png', 'BG_e.png', 'BOOK1.png', 'BOOK1_e.png', 'BOOK2_3.png',
  'SL1.png', 'SL1_e.png', 'PAN1.png', 'MEMO1.png', 'MEMO1_ss.png',
] as const

export interface FullDefaultA3ScenarioResult {
  project: CutProject
  initialXdts: string
  normalizedProject: CutProject
  normalizedXdts: string
  normalizationPlan: ReturnType<typeof buildNameNormalizationPlan>
  report: {
    checks: string[]
    trackNames: string[]
    normalizedTrackNames: string[]
    renameCount: number
  }
}

export function buildFullDefaultA3Scenario(fileRefs: FileRef[], renameResults: NameNormalizationAssetRenameResult[] = []): FullDefaultA3ScenarioResult {
  let project = updateLogicalSheetSettings(createDefaultProject(), {
    durationFrames: 144,
    workRange: {
      preRollFrames: 24,
      postRollFrames: 12,
      showPreRoll: true,
      showPostRoll: true,
    },
  })
  project = {
    ...project,
    projectId: 'desktop_e2e_full_default_a3',
    cut: {
      title: 'E2E',
      episode: '01',
      cut: 'E2E_FULL_A3',
      worker: 'desktop-e2e',
    },
  }

  const assetRefs = assetRefsByName(fileRefs)
  assertRequiredAssets(assetRefs)
  const assetRootPath = sharedAssetRootPath(fileRefs)
  const assetRootRegistration = assetRootPath
    ? registerAssetRoot(project, { label: 'desktop-e2e-assets', path: assetRootPath, handleKind: 'directory' })
    : null
  if (assetRootRegistration) project = assetRootRegistration.project
  const assets = new Map<string, CutAsset>()
  for (const name of FULL_DEFAULT_A3_ASSET_NAMES) {
    const ref = assetRefs.get(name) as FileRef
    const registered = registerAsset(project, ref, {
      role: 'cell-material',
      relativePath: ref.relativePath,
    })
    project = registered.project
    assets.set(name, registered.asset)
  }

  for (const [index, paperTrack] of ['J', 'K', 'L'].entries()) {
    const created = addOverlayPaperTrack(project, {
      paperTrack,
      insertAfterPaperTrack: 'C',
      orderInGap: index,
      snapIndex: 3 + index,
      sheetRole: 'action',
      templateId: standardA3SheetTemplate.templateId,
    })
    project = created.project
  }

  const actionRole: SheetTimingRole = 'action'
  const a1 = addTimedKey(project, 'A', 1, '1', actionRole)
  project = a1.project
  for (const [layerId, assetName] of [
    ['layer_sakuga', 'A1.png'],
    ['layer_enshutsu', 'A1_e.png'],
    ['layer_kantoku', 'A1_k.png'],
    ['layer_sakkan', 'A1_s.png'],
    ['layer_ryouri', 'A1_y.png'],
    ['layer_sousakkan', 'A1_ss.png'],
  ] as const) {
    project = bindScenarioAsset(project, a1.key, layerId, requireAsset(assets, assetName), assetBaseName(assetName))
  }

  for (const [index, paperTrack] of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].entries()) {
    const name = `${paperTrack}1.png`
    const created = addTimedKey(project, paperTrack, 3 + index * 4, '1', actionRole)
    project = bindScenarioAsset(created.project, created.key, 'layer_sakuga', requireAsset(assets, name), assetBaseName(name))
  }

  for (const [index, paperTrack] of ['J', 'K', 'L'].entries()) {
    const name = `${paperTrack}1.png`
    const created = addTimedKey(project, paperTrack, 48 + index * 8, '1', actionRole)
    project = bindScenarioAsset(created.project, created.key, index === 1 ? 'layer_sakkan' : 'layer_sakuga', requireAsset(assets, name), assetBaseName(name))
  }

  project = addStackGuideWithAssets(project, assets, {
    label: 'BG',
    gapIndex: 0,
    kind: 'background',
    assetsByLayer: {
      layer_sakuga: 'BG.png',
      layer_enshutsu: 'BG_e.png',
    },
  })
  project = addStackGuideWithAssets(project, assets, {
    label: 'BOOK1',
    gapIndex: 3,
    insertAfterPaperTrack: 'C',
    kind: 'book',
    assetsByLayer: {
      layer_sakuga: 'BOOK1.png',
      layer_enshutsu: 'BOOK1_e.png',
    },
  })
  project = addStackGuideWithAssets(project, assets, {
    label: 'BOOK2,3',
    gapIndex: 3,
    insertAfterPaperTrack: 'C',
    kind: 'book',
    assetsByLayer: {
      layer_sakuga: 'BOOK2_3.png',
    },
  })
  project = addStackGuideWithAssets(project, assets, {
    label: 'SL1',
    gapIndex: project.logicalSheet.paperTracks.length,
    kind: 'camera-note',
    assetsByLayer: {
      layer_sakuga: 'SL1.png',
      layer_enshutsu: 'SL1_e.png',
    },
  })
  project = addStackGuideWithAssets(project, assets, {
    label: 'PAN1',
    gapIndex: project.logicalSheet.paperTracks.length,
    kind: 'camera-note',
    assetsByLayer: {
      layer_sakuga: 'PAN1.png',
    },
  })
  project = addStackGuideWithAssets(project, assets, {
    label: 'MEMO1',
    gapIndex: project.logicalSheet.paperTracks.length,
    kind: 'memo',
    assetsByLayer: {
      layer_sakuga: 'MEMO1.png',
      layer_sousakkan: 'MEMO1_ss.png',
    },
  })

  const initialPlan = buildExportPlan(project, 'import-stack')
  const initialXdts = exportXdts(initialPlan)
  const initialChecks = validateFullDefaultA3Plan(project, initialXdts)
  if (assetRootRegistration) {
    initialChecks.push('registered all scenario materials under one asset root with project-relative paths')
  }

  const normalizationPlan = buildNameNormalizationPlan(project, {
    sheetRole: actionRole,
    includeStackGuides: true,
    includeAssetFiles: true,
  })
  const normalizedProject = applyNameNormalizationPlan(project, normalizationPlan, renameResults)
  const normalizedPlan = buildExportPlan(normalizedProject, 'import-stack')
  const normalizedXdts = exportXdts(normalizedPlan)
  const normalizedChecks = validateFullDefaultA3NormalizedPlan(normalizedProject, normalizedXdts)

  return {
    project,
    initialXdts,
    normalizedProject,
    normalizedXdts,
    normalizationPlan,
    report: {
      checks: [...initialChecks, ...normalizedChecks],
      trackNames: initialPlan.tracks.map(track => track.name),
      normalizedTrackNames: normalizedPlan.tracks.map(track => track.name),
      renameCount: normalizationPlan.assetRenames.filter(rename => rename.canRename).length,
    },
  }
}

export function createFullDefaultA3FixtureRefs(assetRoot: string): FileRef[] {
  return FULL_DEFAULT_A3_ASSET_NAMES.map((name, index) => ({
    name,
    size: 100 + index,
    lastModified: index + 1,
    path: joinPath(assetRoot, name),
    rootPath: assetRoot,
    relativePath: name,
    contentHash: `sha256:e2e-${assetBaseName(name)}`,
  }))
}

function addTimedKey(project: CutProject, paperTrack: string, frame: number, displayLabel: string, sheetRole: SheetTimingRole): { project: CutProject; key: TimingKey } {
  const created = createKey(project, paperTrack, displayLabel, 'manual', displayLabel, sheetRole)
  return {
    project: setEvent(created.project, paperTrack, frame, created.key.keyId, sheetRole),
    key: created.key,
  }
}

function bindScenarioAsset(project: CutProject, key: TimingKey, correctionLayerId: string, asset: CutAsset, cspCellName: string): CutProject {
  const slot = project.cspTrackSlots.find(item => item.paperTrack === key.paperTrack && item.correctionLayerId === correctionLayerId)
  if (!slot) throw new Error(`slot not found for ${key.paperTrack} / ${correctionLayerId}`)
  return upsertBinding(project, {
    slotId: slot.slotId,
    keyId: key.keyId,
    assetId: asset.assetId,
    cspCellName,
    materialState: 'assigned',
  })
}

function addStackGuideWithAssets(
  project: CutProject,
  assets: Map<string, CutAsset>,
  input: {
    label: string
    gapIndex: number
    insertAfterPaperTrack?: string
    kind: 'background' | 'book' | 'camera-note' | 'memo'
    assetsByLayer: Record<string, string>
  },
): CutProject {
  const created = createStackGuideLabel(project, {
    label: input.label,
    gapIndex: input.gapIndex,
    insertAfterPaperTrack: input.insertAfterPaperTrack,
    kind: input.kind,
    displayRole: 'action',
  })
  let next = created.project
  for (const [layerId, assetName] of Object.entries(input.assetsByLayer)) {
    next = assignAssetToStackGuideLabel(next, created.label.labelId, requireAsset(assets, assetName).assetId, layerId)
  }
  return next
}

function validateFullDefaultA3Plan(project: CutProject, xdtsText: string): string[] {
  const checks: string[] = []
  const issues = validateProject(project).filter(issue => issue.severity === 'error')
  if (issues.length > 0) throw new Error(`project has validation errors: ${issues.map(issue => issue.code).join(', ')}`)
  const plan = buildExportPlan(project, 'import-stack')
  const parsed = parseXdts(xdtsText)
  assert(parsed.duration === 144, 'XDTS duration should be 144')
  assert(parsed.fps === 24, 'XDTS fps should be 24')
  assert(plan.tracks[0]?.name === '===== XSHEET IMPORT START =====', 'import stack start separator should be first')
  assert(plan.tracks.at(-1)?.name === '===== XSHEET IMPORT END =====', 'import stack end separator should be last')
  const trackNames = plan.tracks.map(track => track.name)
  assertTrackOrder(trackNames, ['BG', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'SL1', 'PAN1', 'MEMO1'])
  for (const expectedTrack of ['J', 'K', 'L', 'BOOK1', 'BOOK2,3']) {
    assert(trackNames.includes(expectedTrack), `track list should contain ${expectedTrack}`)
  }
  assertSlotFrame(project, 'A', 'layer_sakuga', 0, 'A1')
  assertSlotFrame(project, 'A', 'layer_enshutsu', 0, 'A1_e')
  assertSlotFrame(project, 'A', 'layer_kantoku', 0, 'A1_k')
  assertSlotFrame(project, 'A', 'layer_sakkan', 0, 'A1_s')
  assertSlotFrame(project, 'A', 'layer_ryouri', 0, 'A1_y')
  assertSlotFrame(project, 'A', 'layer_sousakkan', 0, 'A1_ss')
  assertSlotFrame(project, 'I', 'layer_sakuga', 30, 'I1')
  assertSlotFrame(project, 'J', 'layer_sakuga', 47, 'J1')
  assertSlotFrame(project, 'K', 'layer_sakkan', 55, 'K1')
  assertStackGuideFrame(project, 'BG', 'layer_sakuga', 'BG')
  assertStackGuideFrame(project, 'BOOK1', 'layer_enshutsu', 'BOOK1_e')
  assertStackGuideFrame(project, 'BOOK2,3', 'layer_sakuga', 'BOOK2_3')
  assertStackGuideFrame(project, 'SL1', 'layer_enshutsu', 'SL1_e')
  assertStackGuideFrame(project, 'MEMO1', 'layer_sousakkan', 'MEMO1_ss')
  checks.push('initial import-stack XDTS contains all default layers, overlay tracks, BG/BOOK, camera notes, and memo tracks')
  return checks
}

function validateFullDefaultA3NormalizedPlan(project: CutProject, xdtsText: string): string[] {
  const checks: string[] = []
  const parsed = parseXdts(xdtsText)
  assert(parsed.duration === 144, 'normalized XDTS duration should remain 144')
  assertSlotFrame(project, 'A', 'layer_sakuga', 0, 'A_01')
  assertSlotFrame(project, 'A', 'layer_enshutsu', 0, 'A_01_e')
  assertSlotFrame(project, 'A', 'layer_kantoku', 0, 'A_01_k')
  assertSlotFrame(project, 'A', 'layer_sakkan', 0, 'A_01_s')
  assertSlotFrame(project, 'A', 'layer_ryouri', 0, 'A_01_y')
  assertSlotFrame(project, 'A', 'layer_sousakkan', 0, 'A_01_ss')
  assertSlotFrame(project, 'J', 'layer_sakuga', 47, 'J_01')
  assertSlotFrame(project, 'K', 'layer_sakkan', 55, 'K_01_s')
  assertStackGuideFrame(project, 'BG', 'layer_sakuga', 'BG_01')
  assertStackGuideFrame(project, 'BG', 'layer_enshutsu', 'BG_01_e')
  assertStackGuideFrame(project, 'SL1', 'layer_enshutsu', 'SL1_01_e')
  assertStackGuideFrame(project, 'MEMO1', 'layer_sousakkan', 'MEMO1_01_ss')
  checks.push('normalization updates CSP names for cells, overlay tracks, BG/BOOK, camera notes, and memo tracks')
  return checks
}

function assertSlotFrame(project: CutProject, paperTrack: string, correctionLayerId: string, frame: number, expectedValue: string): void {
  const slot = project.cspTrackSlots.find(item => item.paperTrack === paperTrack && item.correctionLayerId === correctionLayerId)
  if (!slot) throw new Error(`slot not found: ${paperTrack} / ${correctionLayerId}`)
  const track = buildExportPlan(project, 'import-stack').tracks.find(item => item.slotId === slot.slotId)
  const actual = track?.frames.find(item => item.frame === frame)?.value
  assert(actual === expectedValue, `expected ${paperTrack}/${correctionLayerId} frame ${frame} to be ${expectedValue}, got ${String(actual)}`)
}

function assertStackGuideFrame(project: CutProject, labelText: string, correctionLayerId: string, expectedValue: string): void {
  const label = project.stackGuideLabels.find(item => item.label === labelText)
  if (!label) throw new Error(`stack guide not found: ${labelText}`)
  const track = buildExportPlan(project, 'import-stack').tracks.find(item => item.stackGuideLabelId === label.labelId && item.stackGuideRegistrationId && project.stackGuideLabels.some(candidate => candidate.labelId === label.labelId))
  const matchingTrack = buildExportPlan(project, 'import-stack').tracks.find(item => {
    if (item.stackGuideLabelId !== label.labelId) return false
    const registration = label.registrations?.find(candidate => candidate.registrationId === item.stackGuideRegistrationId)
    return registration?.correctionLayerId === correctionLayerId
  }) ?? track
  const actual = matchingTrack?.frames[0]?.value
  assert(actual === expectedValue, `expected ${labelText}/${correctionLayerId} to be ${expectedValue}, got ${String(actual)}`)
}

function assertTrackOrder(names: string[], expectedSubsequence: string[]): void {
  let cursor = -1
  for (const expected of expectedSubsequence) {
    const next = names.findIndex((name, index) => index > cursor && name === expected)
    assert(next > cursor, `track order should contain ${expected} after index ${cursor}`)
    cursor = next
  }
}

function assetRefsByName(fileRefs: FileRef[]): Map<string, FileRef> {
  return new Map(fileRefs.map(ref => [ref.name, ref]))
}

function sharedAssetRootPath(fileRefs: FileRef[]): string | undefined {
  const roots = fileRefs
    .map(ref => ref.rootPath)
    .filter((path): path is string => Boolean(path))
  if (roots.length !== fileRefs.length || roots.length === 0) return undefined
  const first = normalizePathKey(roots[0])
  return roots.every(root => normalizePathKey(root) === first) ? roots[0] : undefined
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function assertRequiredAssets(assetRefs: Map<string, FileRef>): void {
  const missing = FULL_DEFAULT_A3_ASSET_NAMES.filter(name => !assetRefs.has(name))
  if (missing.length > 0) throw new Error(`missing full-default-a3 assets: ${missing.join(', ')}`)
}

function requireAsset(assets: Map<string, CutAsset>, name: string): CutAsset {
  const asset = assets.get(name)
  if (!asset) throw new Error(`asset not registered: ${name}`)
  return asset
}

function assetBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function joinPath(root: string, name: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${name}`
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
