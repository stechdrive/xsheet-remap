import type {
  AssetRoot,
  CutAsset,
  CutProject,
  FileRef,
  SheetPageImageRef,
  SheetSource,
} from './types'
import { nextId } from './core-utils'

export function registerAsset(
  project: CutProject,
  file: FileRef,
  options: { role?: CutAsset['role']; rootId?: string; relativePath?: string } = {},
): { project: CutProject; asset: CutAsset } {
  const role = options.role ?? 'cell-material'
  const duplicate = findMatchingAsset(project.assets, file, { ...options, role })
  if (duplicate) {
    const merged = mergeRegisteredAsset(duplicate, file, options)
    if (merged === duplicate) return { project, asset: duplicate }
    return {
      project: {
        ...project,
        assets: project.assets.map(asset => asset.assetId === duplicate.assetId ? merged : asset),
      },
      asset: merged,
    }
  }

  const asset: CutAsset = {
    assetId: nextId('asset', project.assets.map(item => item.assetId)),
    originalFileName: file.name,
    displayName: file.name,
    role,
    rootId: options.rootId,
    relativePath: options.relativePath ?? file.relativePath,
    currentPath: file.path,
    fileSize: file.size,
    modifiedAt: fileModifiedAt(file),
    contentHash: file.contentHash,
    thumbnailUrl: file.objectUrl,
  }
  return { project: { ...project, assets: [...project.assets, asset] }, asset }
}

export function registerAssetRoot(project: CutProject, input: { label: string; path?: string; handleKind?: AssetRoot['handleKind'] }): { project: CutProject; root: AssetRoot } {
  const duplicate = project.assetRoots.find(root => input.path && root.path === input.path)
  if (duplicate) return { project, root: duplicate }
  const root: AssetRoot = {
    rootId: nextId('asset_root', project.assetRoots.map(item => item.rootId)),
    label: input.label,
    path: input.path,
    handleKind: input.handleKind ?? (input.path ? 'directory' : 'manual-files'),
  }
  return { project: { ...project, assetRoots: [...project.assetRoots, root] }, root }
}

export function registerSheetSource(project: CutProject, imageRef: SheetPageImageRef, options: { assetId?: string } = {}): { project: CutProject; source: SheetSource } {
  const duplicate = project.sheetView.sources.find(source => source.kind === 'sheet-scan' && sameSheetImageRef(source.imageRef, imageRef))
  if (duplicate) {
    if (!options.assetId || duplicate.assetId === options.assetId) return { project, source: duplicate }
    const source = { ...duplicate, assetId: options.assetId }
    return {
      project: {
        ...project,
        sheetView: {
          ...project.sheetView,
          sources: project.sheetView.sources.map(item => item.sourceId === source.sourceId ? source : item),
        },
      },
      source,
    }
  }

  const source: SheetSource = {
    sourceId: nextId('sheet_source', project.sheetView.sources.map(item => item.sourceId)),
    kind: 'sheet-scan',
    imageRef,
    assetId: options.assetId,
  }
  return {
    project: {
      ...project,
      sheetView: {
        ...project.sheetView,
        sources: [...project.sheetView.sources, source],
      },
    },
    source,
  }
}

export function sameSheetImageRef(a: SheetPageImageRef, b: SheetPageImageRef): boolean {
  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) return true
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

function findMatchingAsset(
  assets: CutAsset[],
  file: FileRef,
  options: { role: CutAsset['role']; rootId?: string; relativePath?: string },
): CutAsset | undefined {
  const filePath = assetPathKey(file.path)
  const relativePath = assetRelativePathKey(options.relativePath ?? file.relativePath)
  const roleMatches = (asset: CutAsset) => (asset.role ?? 'cell-material') === options.role

  const strongMatch = assets.find(asset => {
    if (!roleMatches(asset)) return false
    if (filePath && assetPathKey(asset.currentPath) === filePath) return true
    if (options.rootId && relativePath && asset.rootId === options.rootId && assetRelativePathKey(asset.relativePath) === relativePath) return true
    return false
  })
  if (strongMatch) return strongMatch

  return assets.find(asset => roleMatches(asset) && sameAssetFileMetadata(asset, file))
}

function sameAssetFileMetadata(asset: CutAsset, file: FileRef): boolean {
  if (asset.currentPath && file.path) return false
  const modifiedAt = fileModifiedAt(file)
  if (file.size === undefined || !modifiedAt) return false
  if (asset.originalFileName !== file.name || asset.fileSize !== file.size || asset.modifiedAt !== modifiedAt) return false
  if (asset.contentHash && file.contentHash && asset.contentHash !== file.contentHash) return false
  return true
}

function mergeRegisteredAsset(asset: CutAsset, file: FileRef, options: { rootId?: string; relativePath?: string }): CutAsset {
  const next: CutAsset = {
    ...asset,
    rootId: asset.rootId ?? options.rootId,
    relativePath: asset.relativePath ?? options.relativePath ?? file.relativePath,
    currentPath: asset.currentPath ?? file.path,
    fileSize: file.size ?? asset.fileSize,
    modifiedAt: fileModifiedAt(file) ?? asset.modifiedAt,
    contentHash: file.contentHash ?? asset.contentHash,
    thumbnailUrl: file.objectUrl ?? asset.thumbnailUrl,
  }
  return shallowEqualAsset(asset, next) ? asset : next
}

function fileModifiedAt(file: Pick<FileRef, 'lastModified'>): string | undefined {
  return file.lastModified === undefined ? undefined : new Date(file.lastModified).toISOString()
}

function assetPathKey(path?: string): string | undefined {
  if (!path) return undefined
  const normalized = path.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

function assetRelativePathKey(path?: string): string | undefined {
  return path ? path.replace(/\\/g, '/') : undefined
}

function shallowEqualAsset(a: CutAsset, b: CutAsset): boolean {
  return a.assetId === b.assetId
    && a.originalFileName === b.originalFileName
    && a.displayName === b.displayName
    && a.role === b.role
    && a.rootId === b.rootId
    && a.relativePath === b.relativePath
    && a.currentPath === b.currentPath
    && a.fileSize === b.fileSize
    && a.modifiedAt === b.modifiedAt
    && a.contentHash === b.contentHash
    && a.thumbnailUrl === b.thumbnailUrl
}
