import type {
  AssetBin,
  AssetRoot,
  AssetSource,
  CutAsset,
  CutProject,
  FileRef,
  SheetPageImageRef,
  SheetSource,
} from './types'
import { nextId } from './core-utils'
import { ROOT_ASSET_BIN_ID } from './project-constants'
import { nativeFileSystemPathKey, normalizeNativeFileSystemPath } from './native-paths'
import { defaultSheetImageAlignment, mergeSheetImageAlignment } from './sheet-image-alignment'

export function registerAsset(
  project: CutProject,
  file: FileRef,
  options: { role?: CutAsset['role']; binId?: string; source?: AssetSource; relativePath?: string; matchByContentHash?: boolean; excludeAssetIds?: ReadonlySet<string> } = {},
): { project: CutProject; asset: CutAsset } {
  const role = options.role ?? 'cell-material'
  const source = normalizeAssetSourceNativePaths(options.source ?? assetSourceForFile(project.assetRoot, file, options.relativePath))
  const duplicate = findMatchingAsset(project.assets, file, {
    role,
    source,
    root: project.assetRoot,
    matchByContentHash: options.matchByContentHash ?? false,
    excludeAssetIds: options.excludeAssetIds,
  })
  if (duplicate) {
    const merged = mergeRegisteredAsset(duplicate, file, { ...options, source })
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
    binId: options.binId ?? ROOT_ASSET_BIN_ID,
    originalFileName: file.name,
    displayName: file.name,
    role,
    source,
    fileSize: file.size,
    modifiedAt: fileModifiedAt(file),
    contentHash: file.contentHash,
    thumbnailUrl: file.objectUrl,
  }
  return { project: { ...project, assets: [...project.assets, asset] }, asset }
}

export function registerAssetRoot(project: CutProject, input: { label: string; path: string; handleKind?: AssetRoot['handleKind'] }): { project: CutProject; root: AssetRoot } {
  if (samePath(project.assetRoot?.path, input.path)) return { project, root: project.assetRoot! }
  const root: AssetRoot = {
    label: input.label,
    path: normalizeNativeFileSystemPath(input.path),
    handleKind: input.handleKind ?? 'directory',
  }
  // A root-relative source identifies a material within the cut folder; the
  // absolute root is only its current locator. Preserve that identity when a
  // project is moved to another drive or workstation so the following scan can
  // reconnect existing assetIds instead of creating duplicate materials.
  return { project: { ...project, assetRoot: root }, root }
}

export function synchronizeAssetRoot(
  project: CutProject,
  input: { label: string; path: string; handleKind?: AssetRoot['handleKind'] },
  files: FileRef[],
): { project: CutProject; root: AssetRoot; assetIds: string[] } {
  const rooted = registerAssetRoot(project, input)
  let nextProject = rooted.project
  const seenRelativePaths = new Set<string>()
  const matchedAssetIds = new Set<string>()
  const assetIds: string[] = []

  for (const file of files) {
    const relativePath = file.relativePath
      ?? relativePathFromRoot(file.path, rooted.root.path)
    if (!relativePath) continue
    const normalizedRelativePath = normalizeRelativePath(relativePath)
    const registered = registerAsset(nextProject, file, {
      role: 'cell-material',
      relativePath: normalizedRelativePath,
      matchByContentHash: true,
      excludeAssetIds: matchedAssetIds,
    })
    nextProject = registered.project
    seenRelativePaths.add(assetRelativePathKey(normalizedRelativePath)!.toLowerCase())
    matchedAssetIds.add(registered.asset.assetId)
    assetIds.push(registered.asset.assetId)
  }

  const assets = nextProject.assets.map(asset => {
    if (asset.source.kind !== 'root-relative') return asset
    const relativePathKey = assetRelativePathKey(asset.source.relativePath)!.toLowerCase()
    if (seenRelativePaths.has(relativePathKey)) return asset
    return {
      ...asset,
      source: {
        kind: 'unresolved' as const,
        lastKnownPath: assetAbsolutePath(asset, project.assetRoot),
      },
    }
  })
  if (assets.some((asset, index) => asset !== nextProject.assets[index])) {
    nextProject = { ...nextProject, assets }
  }

  return { project: nextProject, root: rooted.root, assetIds }
}

export function createAssetBin(project: CutProject, input: { name: string; parentBinId?: string }): { project: CutProject; bin: AssetBin } {
  const parentBinId = input.parentBinId ?? ROOT_ASSET_BIN_ID
  if (!project.assetBins.some(bin => bin.binId === parentBinId)) throw new Error(`asset bin not found: ${parentBinId}`)
  const siblings = project.assetBins.filter(bin => bin.parentBinId === parentBinId)
  const bin: AssetBin = {
    binId: nextId('asset_bin', project.assetBins.map(item => item.binId)),
    parentBinId,
    name: input.name.trim() || '新しいビン',
    order: siblings.length,
  }
  return { project: { ...project, assetBins: [...project.assetBins, bin] }, bin }
}

export function assetRelativePath(asset: CutAsset): string | undefined {
  return asset.source.kind === 'root-relative' ? asset.source.relativePath : undefined
}

export function assetAbsolutePath(asset: CutAsset, root?: AssetRoot): string | undefined {
  if (asset.source.kind === 'external-file') return normalizeNativeFileSystemPath(asset.source.absolutePath)
  if (asset.source.kind === 'unresolved') return asset.source.lastKnownPath ? normalizeNativeFileSystemPath(asset.source.lastKnownPath) : undefined
  if (!root?.path) return undefined
  return joinPath(root.path, asset.source.relativePath)
}

export function assetSourceDisplayPath(asset: CutAsset): string {
  return assetRelativePath(asset) ?? assetAbsolutePath(asset) ?? asset.originalFileName
}

export function registerSheetSource(project: CutProject, imageRef: SheetPageImageRef, options: { assetId?: string; initialAlignment?: Partial<SheetSource['alignment']> } = {}): { project: CutProject; source: SheetSource } {
  imageRef = imageRef.path ? { ...imageRef, path: normalizeNativeFileSystemPath(imageRef.path) } : imageRef
  const sameAssetSource = options.assetId
    ? project.sheetView.sources.find(source => source.kind === 'sheet-scan' && source.assetId === options.assetId)
    : undefined
  const legacySource = options.assetId && !sameAssetSource
    ? project.sheetView.sources.find(source => source.kind === 'sheet-scan' && !source.assetId && sameSheetSourceRegistrationRef(source.imageRef, imageRef))
    : undefined
  const duplicate = sameAssetSource ?? legacySource ?? (!options.assetId
    ? project.sheetView.sources.find(source => source.kind === 'sheet-scan' && sameSheetImageRef(source.imageRef, imageRef))
    : undefined)
  if (duplicate) {
    const source = { ...duplicate, imageRef, assetId: options.assetId ?? duplicate.assetId }
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
    alignment: mergeSheetImageAlignment(defaultSheetImageAlignment(), options.initialAlignment ?? {}),
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

export function normalizeAssetSourceNativePaths(source: AssetSource): AssetSource {
  if (source.kind === 'external-file') {
    return { ...source, absolutePath: normalizeNativeFileSystemPath(source.absolutePath) }
  }
  if (source.kind === 'unresolved' && source.lastKnownPath) {
    return { ...source, lastKnownPath: normalizeNativeFileSystemPath(source.lastKnownPath) }
  }
  return source
}

export function sameSheetImageRef(a: SheetPageImageRef, b: SheetPageImageRef): boolean {
  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) return true
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

function sameSheetSourceRegistrationRef(a: SheetPageImageRef, b: SheetPageImageRef): boolean {
  const aPath = a.path ? nativeFileSystemPathKey(a.path) : undefined
  const bPath = b.path ? nativeFileSystemPathKey(b.path) : undefined
  if (aPath || bPath) return Boolean(aPath && bPath && aPath === bPath)
  if (a.assetPath || b.assetPath) return Boolean(a.assetPath && b.assetPath && a.assetPath === b.assetPath)
  return a.name === b.name
    && a.size !== undefined && a.size === b.size
    && a.lastModified !== undefined && a.lastModified === b.lastModified
}

function findMatchingAsset(
  assets: CutAsset[],
  file: FileRef,
  options: { role: CutAsset['role']; source: AssetSource; root?: AssetRoot; matchByContentHash: boolean; excludeAssetIds?: ReadonlySet<string> },
): CutAsset | undefined {
  const filePath = assetPathKey(file.path)
  const sourceKey = assetSourceKey(options.source)
  const roleMatches = (asset: CutAsset) =>
    (asset.role ?? 'cell-material') === options.role && !options.excludeAssetIds?.has(asset.assetId)

  const strongMatch = assets.find(asset => {
    if (!roleMatches(asset)) return false
    if (filePath && assetPathKey(assetAbsolutePath(asset, options.root)) === filePath) return true
    if (sourceKey && assetSourceKey(asset.source) === sourceKey) return true
    return false
  })
  if (strongMatch) return strongMatch

  if (options.matchByContentHash && file.contentHash) {
    const contentMatch = assets.find(asset => roleMatches(asset) && asset.contentHash === file.contentHash)
    if (contentMatch) return contentMatch
  }

  return assets.find(asset => roleMatches(asset) && sameAssetFileMetadata(asset, file))
}

function sameAssetFileMetadata(asset: CutAsset, file: FileRef): boolean {
  if (asset.source.kind !== 'unresolved' && file.path) return false
  const modifiedAt = fileModifiedAt(file)
  if (file.size === undefined || !modifiedAt) return false
  if (asset.originalFileName !== file.name || asset.fileSize !== file.size || asset.modifiedAt !== modifiedAt) return false
  if (asset.contentHash && file.contentHash && asset.contentHash !== file.contentHash) return false
  return true
}

function mergeRegisteredAsset(asset: CutAsset, file: FileRef, options: { binId?: string; source: AssetSource }): CutAsset {
  const next: CutAsset = {
    ...asset,
    originalFileName: file.name,
    binId: options.binId ?? asset.binId,
    source: options.source.kind === 'unresolved' ? asset.source : options.source,
    fileSize: file.size ?? asset.fileSize,
    modifiedAt: fileModifiedAt(file) ?? asset.modifiedAt,
    contentHash: file.contentHash ?? asset.contentHash,
    thumbnailUrl: file.objectUrl ?? asset.thumbnailUrl,
  }
  return shallowEqualAsset(asset, next) ? asset : next
}

function assetSourceForFile(root: AssetRoot | undefined, file: FileRef, relativePath?: string): AssetSource {
  const resolvedRelativePath = relativePath
    ?? relativePathFromRoot(file.path, root?.path)
    ?? (samePath(file.rootPath, root?.path) ? file.relativePath : undefined)
  if (root?.path && resolvedRelativePath) {
    return { kind: 'root-relative', relativePath: normalizeRelativePath(resolvedRelativePath) }
  }
  if (file.path) return { kind: 'external-file', absolutePath: normalizeNativeFileSystemPath(file.path) }
  return { kind: 'unresolved' }
}

function relativePathFromRoot(path?: string, rootPath?: string): string | undefined {
  if (!path || !rootPath) return undefined
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return undefined
  if (!normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return undefined
  return normalizeRelativePath(normalizedPath.slice(normalizedRoot.length + 1))
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function assetSourceKey(source: AssetSource): string | undefined {
  if (source.kind === 'root-relative') return `root:${assetRelativePathKey(source.relativePath)}`
  const path = source.kind === 'external-file' ? source.absolutePath : source.lastKnownPath
  return path ? `path:${assetPathKey(path)}` : undefined
}

function samePath(a?: string, b?: string): boolean {
  return Boolean(a && b && assetPathKey(a) === assetPathKey(b))
}

function joinPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/^[\\/]+/, '').replace(/[\\/]/g, separator)}`
}

function fileModifiedAt(file: Pick<FileRef, 'lastModified'>): string | undefined {
  return file.lastModified === undefined ? undefined : new Date(file.lastModified).toISOString()
}

function assetPathKey(path?: string): string | undefined {
  return nativeFileSystemPathKey(path)
}

function assetRelativePathKey(path?: string): string | undefined {
  return path ? path.replace(/\\/g, '/') : undefined
}

function shallowEqualAsset(a: CutAsset, b: CutAsset): boolean {
  return a.assetId === b.assetId
    && a.originalFileName === b.originalFileName
    && a.displayName === b.displayName
    && a.role === b.role
    && a.binId === b.binId
    && assetSourceKey(a.source) === assetSourceKey(b.source)
    && a.fileSize === b.fileSize
    && a.modifiedAt === b.modifiedAt
    && a.contentHash === b.contentHash
    && a.thumbnailUrl === b.thumbnailUrl
}
