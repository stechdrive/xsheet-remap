import { assetAbsolutePath, type CutGroupProjectDocument } from '@xsheet-remap/core'
import {
  isTauriHost,
  nativeFileSource,
  projectFileErrorCanRecoverFromBackup,
  readProjectBackup,
  readProjectFile,
} from '@xsheet-remap/adapters'

export interface LoadedProjectDocumentFile {
  document: CutGroupProjectDocument
  projectFilePath: string | null
  recoveredFromBackup: boolean
}

export async function loadProjectDocumentFile(file: File): Promise<LoadedProjectDocumentFile> {
  const nativePath = (file as File & { path?: string }).path
  let decodedProject: Awaited<ReturnType<typeof readProjectFile>>
  let recoveredFromBackup = false
  try {
    decodedProject = await readProjectFile(file)
  } catch (primaryError) {
    const backup = nativePath && projectFileErrorCanRecoverFromBackup(primaryError)
      ? await readProjectBackup(nativePath)
      : null
    if (!backup) throw primaryError
    decodedProject = backup
    recoveredFromBackup = true
  }
  return {
    document: await hydrateProjectAssetPreviews(decodedProject.document),
    projectFilePath: decodedProject.format === 'archive' && !recoveredFromBackup ? nativePath ?? null : null,
    recoveredFromBackup,
  }
}

export function isProjectArchivePath(path: string): boolean {
  return path.toLocaleLowerCase('en-US').endsWith('.xsr')
}

async function hydrateProjectAssetPreviews(document: CutGroupProjectDocument): Promise<CutGroupProjectDocument> {
  if (!isTauriHost()) return document
  return {
    ...document,
    assets: await Promise.all(document.assets.map(async asset => {
      const path = assetAbsolutePath(asset, document.assetRoot)
      return path ? { ...asset, thumbnailUrl: await nativeFileSource(path) } : asset
    })),
  }
}
