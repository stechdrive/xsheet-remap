import {
  buildCspImportPackage,
  type BuildCspImportPackageOptions,
  type CspImportPackageBuildResult,
  type CutGroupProjectDocument,
  type ValidationIssue,
} from '@xsheet-remap/core'
import { isTauriHost, statNativePaths, type NativePathStatus } from '@xsheet-remap/adapters'
import { cspImportPackageAssetPaths } from './app-foundation'
import { buildBrowserCspImportPackage, type BrowserCspImportPackage } from './browserCspImportPackage'
import { cspImportPackageTextOutputs, type CspImportPackageTextOutput } from './cspImportPackageOutputs'

export type CspImportExportTarget =
  | {
      mode: 'native-cut-folder'
      rootPath: string
      outputDirectoryPath: string
      manifestPath: string
    }
  | {
      mode: 'portable-zip'
      archiveFileName: string
    }
  | {
      mode: 'native-root-unavailable'
      rootPath?: string
      reason: string
    }

export interface CspImportExportMaterialSummary {
  availableCount: number
  keyOnlyCount: number
  unavailableAssignedCount: number
}

export interface CspImportExportPlan {
  target: CspImportExportTarget
  packageBuild: CspImportPackageBuildResult
  files: CspImportPackageTextOutput[]
  materialSummary: CspImportExportMaterialSummary
  blockingIssues: ValidationIssue[]
  advisories: ValidationIssue[]
  portable?: BrowserCspImportPackage
}

interface CspImportExportDependencies {
  nativeHost?: boolean
  statPaths?: (paths: string[]) => Promise<NativePathStatus[]>
  buildPortable?: typeof buildBrowserCspImportPackage
}

export async function createCspImportExportPlan(
  document: CutGroupProjectDocument,
  options: BuildCspImportPackageOptions,
  dependencies: CspImportExportDependencies = {},
): Promise<CspImportExportPlan> {
  const nativeHost = dependencies.nativeHost ?? isTauriHost()
  if (!nativeHost) {
    const portable = await (dependencies.buildPortable ?? buildBrowserCspImportPackage)(document, options)
    return planFromPackageBuild(
      portable.packageBuild,
      { mode: 'portable-zip', archiveFileName: portable.archiveFileName },
      [],
      portable,
    )
  }

  const packageBuild = buildCspImportPackage(document, options)
  const rootPath = packageBuild.assetRootPath
  if (!rootPath) {
    return planFromPackageBuild(packageBuild, {
      mode: 'native-root-unavailable',
      reason: 'カットフォルダが設定されていません。',
    })
  }

  const assetPaths = cspImportPackageAssetPaths(packageBuild)
  const statuses = await (dependencies.statPaths ?? statNativePaths)([rootPath, ...assetPaths])
  const rootStatus = statuses[0]
  if (!rootStatus?.isDirectory) {
    return planFromPackageBuild(packageBuild, {
      mode: 'native-root-unavailable',
      rootPath: publicNativePath(rootPath),
      reason: 'このPCでカットフォルダの場所を確認できません。',
    })
  }

  const missingAssetPaths = statuses.slice(1).filter(status => !status.isFile).map(status => status.path)
  const outputDirectoryPath = joinDisplayPath(rootPath, packageBuild.outputDirectoryName)
  return planFromPackageBuild(
    packageBuild,
    {
      mode: 'native-cut-folder',
      rootPath: publicNativePath(rootPath),
      outputDirectoryPath: publicNativePath(outputDirectoryPath),
      manifestPath: publicNativePath(joinDisplayPath(outputDirectoryPath, packageBuild.manifestFileName)),
    },
    missingAssetPaths,
  )
}

function planFromPackageBuild(
  packageBuild: CspImportPackageBuildResult,
  target: CspImportExportTarget,
  missingNativeAssetPaths: string[] = [],
  portable?: BrowserCspImportPackage,
): CspImportExportPlan {
  const unavailableAssignedCount = packageBuild.materialSummary.unavailableAssignedCount + missingNativeAssetPaths.length
  const missingNativeIssues = missingNativeAssetPaths.map((path, index): ValidationIssue => ({
    issueId: `cspImport.asset.nativeMissing:${index}`,
    severity: 'warning',
    code: 'cspImport.asset.nativeMissing',
    message: 'assigned image material is not available on this computer; the cell will be registered as a key only',
    target: { entity: 'asset', id: path, label: publicNativePath(path) },
  }))
  const issues = [...packageBuild.issues, ...missingNativeIssues]
  const targetIssue: ValidationIssue[] = target.mode === 'native-root-unavailable'
    ? [{
        issueId: 'cspImport.assetRoot.unavailable',
        severity: 'error',
        code: 'cspImport.assetRoot.unavailable',
        message: target.reason,
        target: { entity: 'export', id: 'csp-import-root', label: target.rootPath },
      }]
    : []
  return {
    target,
    packageBuild,
    files: cspImportPackageTextOutputs(packageBuild),
    materialSummary: {
      availableCount: Math.max(0, packageBuild.materialSummary.withMaterialCount - missingNativeAssetPaths.length),
      keyOnlyCount: packageBuild.materialSummary.keyOnlyCount + missingNativeAssetPaths.length,
      unavailableAssignedCount,
    },
    blockingIssues: [...issues.filter(issue => issue.severity === 'error'), ...targetIssue]
      .filter((issue, index, all) => all.findIndex(item => item.issueId === issue.issueId) === index),
    advisories: issues.filter(issue => issue.severity === 'warning'),
    ...(portable ? { portable } : {}),
  }
}

export function publicNativePath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice('\\\\?\\UNC\\'.length)}`
  return path.startsWith('\\\\?\\') ? path.slice('\\\\?\\'.length) : path
}

export function joinDisplayPath(directory: string, child: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '')}`
}
