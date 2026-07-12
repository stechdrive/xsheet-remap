import {
  createDefaultProject,
  createKey,
  createStackGuideLabel,
  standardA3SheetTemplate,
  upsertBinding,
  type CutProject,
  type FileRef,
  type NameNormalizationAssetRename,
  type NameNormalizationAssetRenameResult,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { invokeDesktopCommand, renameMaterialFiles, isTauriHost } from '@xsheet-remap/adapters'
import {
  buildFullDefaultA3Scenario,
  FULL_DEFAULT_A3_SCENARIO_ID,
} from './desktopE2EScenarios'

export const REMAP_REAL_DND_SCENARIO_ID = 'remap-real-dnd'

interface DesktopE2EConfig {
  scenario: string
  root: string
  assets: string
  exports: string
}

interface DesktopE2ERunCallbacks {
  applyProject: (project: CutProject, template: SheetTemplate, initialPanel: 'sheet' | 'export') => void
}

interface DesktopE2EResult {
  passed: boolean
  scenario: string
  error?: string
  checks?: string[]
  artifacts?: string[]
  cspValidation?: {
    xdtsPath: string
    assetsPath: string
    guidePath: string
  }
}

export async function runDesktopE2EIfRequested(callbacks: DesktopE2ERunCallbacks): Promise<void> {
  const config = await getDesktopE2EConfig()
  if (!config || config.scenario === 'launch') return
  if (config.scenario === REMAP_REAL_DND_SCENARIO_ID) {
    callbacks.applyProject(buildRemapRealDndProject(), standardA3SheetTemplate, 'sheet')
    return
  }
  if (config.scenario !== FULL_DEFAULT_A3_SCENARIO_ID) return

  try {
    const result = await runFullDefaultA3DesktopE2E(config, callbacks)
    await writeDesktopE2EJson('result.json', result)
  } catch (error) {
    await writeDesktopE2EJson('result.json', {
      passed: false,
      scenario: config.scenario,
      error: errorMessage(error),
    } satisfies DesktopE2EResult)
  }
}

function buildRemapRealDndProject(): CutProject {
  const background = createStackGuideLabel(createDefaultProject(), {
    label: 'BG1',
    kind: 'background',
    displayRole: 'action',
    gapIndex: 1,
    correctionLayerId: 'layer_sakuga',
  })
  const camera = createStackGuideLabel(background.project, {
    label: 'SL1',
    kind: 'camera-note',
    displayRole: 'action',
    gapIndex: 9,
    correctionLayerId: 'layer_enshutsu',
  })
  const memo = createStackGuideLabel(camera.project, {
    label: 'MEMO1',
    kind: 'memo',
    displayRole: 'action',
    gapIndex: 9,
    correctionLayerId: 'layer_enshutsu',
  })
  const existing = createKey(memo.project, 'A', '1', 'manual', '1', 'action')
  return upsertBinding(existing.project, {
    slotId: 'slot_A',
    keyId: existing.key.keyId,
    cspCellName: 'A1',
    materialState: 'missing-ok',
  })
}

async function runFullDefaultA3DesktopE2E(config: DesktopE2EConfig, callbacks: DesktopE2ERunCallbacks): Promise<DesktopE2EResult> {
  const fileRefs = await listDesktopE2EAssetFiles()
  assertFileRefsStayInside(fileRefs, config.assets)

  const dryRun = buildFullDefaultA3Scenario(fileRefs)
  assertRenamesStayInside(dryRun.normalizationPlan.assetRenames, config.assets)
  const renameResults = await renameMaterialFiles(dryRun.normalizationPlan.assetRenames)
  assertRenameResults(renameResults)

  const scenario = buildFullDefaultA3Scenario(fileRefs, renameResults)
  callbacks.applyProject(scenario.normalizedProject, standardA3SheetTemplate, 'export')

  const normalizedXdtsPath = await writeDesktopE2EText('export.normalized.xdts', scenario.normalizedXdts)
  const reportPath = await writeDesktopE2EJson('report.json', scenario.report)
  const cspValidationGuidePath = await writeDesktopE2EText('CSP_VALIDATION.txt', [
    'CSP validation artifacts',
    '',
    `XDTS: ${normalizedXdtsPath}`,
    `Assets: ${config.assets}`,
    '',
    'Suggested manual check:',
    '1. In CSP, hide existing animation folders or their parents before importing XDTS.',
    '2. Import the normalized XDTS above.',
    '3. Register the images from Assets into the matching generated animation folders.',
    '4. Verify A-I, overlay J/K/L, BG/BOOK, camera-note, memo, and all correction-layer suffixes.',
    '',
  ].join('\n'))

  const artifacts = [
    await writeDesktopE2EJson('project.initial.json', scenario.project),
    await writeDesktopE2EText('export.initial.xdts', scenario.initialXdts),
    await writeDesktopE2EJson('normalization-plan.json', scenario.normalizationPlan),
    await writeDesktopE2EJson('rename-results.json', renameResults),
    await writeDesktopE2EJson('project.normalized.json', scenario.normalizedProject),
    normalizedXdtsPath,
    reportPath,
    cspValidationGuidePath,
  ]

  return {
    passed: true,
    scenario: config.scenario,
    checks: [
      ...scenario.report.checks,
      `renamed ${renameResults.length} material files inside isolated assets`,
    ],
    artifacts,
    cspValidation: {
      xdtsPath: normalizedXdtsPath,
      assetsPath: config.assets,
      guidePath: cspValidationGuidePath,
    },
  }
}

async function getDesktopE2EConfig(): Promise<DesktopE2EConfig | null> {
  if (!isTauriHost()) return null
  return invokeDesktopCommand<DesktopE2EConfig | null>('desktop_e2e_config')
}

async function listDesktopE2EAssetFiles(): Promise<FileRef[]> {
  return invokeDesktopCommand<FileRef[]>('list_desktop_e2e_asset_files')
}

async function writeDesktopE2EJson(relativePath: string, value: unknown): Promise<string> {
  return writeDesktopE2EText(relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeDesktopE2EText(relativePath: string, contents: string): Promise<string> {
  return invokeDesktopCommand<string>('write_desktop_e2e_artifact', { relativePath, contents })
}

function assertFileRefsStayInside(fileRefs: FileRef[], root: string): void {
  for (const ref of fileRefs) {
    if (!ref.path || !pathIsInside(ref.path, root)) {
      throw new Error(`desktop e2e asset is outside isolated assets: ${ref.path ?? ref.name}`)
    }
  }
}

function assertRenamesStayInside(renames: NameNormalizationAssetRename[], root: string): void {
  for (const rename of renames.filter(item => item.canRename)) {
    if (!rename.currentPath || !rename.nextPath || !pathIsInside(rename.currentPath, root) || !pathIsInside(rename.nextPath, root)) {
      throw new Error(`desktop e2e rename is outside isolated assets: ${rename.currentFileName}`)
    }
  }
}

function assertRenameResults(results: NameNormalizationAssetRenameResult[]): void {
  const failed = results.filter(result => !result.renamed)
  if (failed.length > 0) {
    throw new Error(`material rename failed: ${failed.map(result => `${result.assetId}:${result.error ?? 'unknown'}`).join(', ')}`)
  }
}

function pathIsInside(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
