import {
  buildCspImportPackage,
  type BuildCspImportPackageOptions,
  type CutGroupProjectDocument,
} from '@xsheet-remap/core'
import { browserAssetBytes, createPortableArchive } from '@xsheet-remap/adapters'
import { cspImportPackageTextOutputs } from './cspImportPackageOutputs'

export interface BrowserCspImportPackage {
  packageBuild: ReturnType<typeof buildCspImportPackage>
  archiveBytes: Uint8Array
  archiveFileName: string
}

export async function buildBrowserCspImportPackage(
  document: CutGroupProjectDocument,
  options: BuildCspImportPackageOptions,
): Promise<BrowserCspImportPackage> {
  const usedPaths = new Set<string>()
  const packagedAssets = new Map<string, { path: string; bytes: Uint8Array }>()
  const assets = await Promise.all(document.assets.map(async asset => {
    const source = await browserAssetBytes(asset.thumbnailUrl)
    if (!source) return { ...asset, source: { kind: 'unresolved' as const } }
    const path = uniquePortableAssetPath(asset.originalFileName || asset.displayName, asset.assetId, usedPaths)
    packagedAssets.set(asset.assetId, { path, bytes: source.bytes })
    return { ...asset, source: { kind: 'root-relative' as const, relativePath: path } }
  }))
  const portableDocument: CutGroupProjectDocument = {
    ...document,
    assetRoot: { label: 'PWA portable bundle', path: 'portable-bundle', handleKind: 'directory' },
    assets,
  }
  const packageBuild = buildCspImportPackage(portableDocument, options)
  const referencedAssetIds = new Set(packageBuild.manifest.cuts.flatMap(cut =>
    cut.tracks.flatMap(track => track.cels.flatMap(cel => cel.material?.assetId ? [cel.material.assetId] : [])),
  ))
  const archiveFiles = [
    ...cspImportPackageTextOutputs(packageBuild).map(file => ({
      relativePath: `${packageBuild.outputDirectoryName}/${file.relativePath}`,
      contents: file.contents,
    })),
    ...[...packagedAssets.entries()]
      .filter(([assetId]) => referencedAssetIds.has(assetId))
      .map(([, file]) => ({ relativePath: file.path, contents: file.bytes })),
  ]
  return {
    packageBuild,
    archiveBytes: await createPortableArchive(archiveFiles),
    archiveFileName: `${packageBuild.outputDirectoryName}.zip`,
  }
}

export function uniquePortableAssetPath(fileName: string, assetId: string, usedPaths: Set<string>): string {
  const normalizedName = Array.from(fileName.normalize('NFKC'))
    .map(character => (character.codePointAt(0) ?? 0) < 32 ? '_' : character)
    .join('')
  const safeName = normalizedName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 160) || 'material'
  const dotIndex = safeName.lastIndexOf('.')
  const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : ''
  let candidate = `assets/${safeName}`
  if (!usedPaths.has(candidate.toLocaleLowerCase('en-US'))) {
    usedPaths.add(candidate.toLocaleLowerCase('en-US'))
    return candidate
  }
  const suffix = assetId.replace(/[^A-Za-z0-9_-]/g, '').slice(-12) || 'copy'
  candidate = `assets/${base}-${suffix}${extension}`
  let index = 2
  while (usedPaths.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `assets/${base}-${suffix}-${index}${extension}`
    index += 1
  }
  usedPaths.add(candidate.toLocaleLowerCase('en-US'))
  return candidate
}
