import { normalizeNativeFileSystemPath } from '@xsheet-remap/core'

/** Session state, deliberately separate from the portable document and Undo. */
export interface ProjectFileLocation {
  projectPath: string | null
  sourcePath: string | null
}

export const emptyProjectFileLocation: ProjectFileLocation = { projectPath: null, sourcePath: null }

export function fileParentDirectory(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const normalized = normalizeNativeFileSystemPath(path)
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (index < 0) return undefined
  if (index === 0 || (index === 2 && normalized[1] === ':')) return normalized.slice(0, index + 1)
  return normalized.slice(0, index)
}

export function projectFileDirectory(location: ProjectFileLocation): string | undefined {
  return fileParentDirectory(location.projectPath) ?? fileParentDirectory(location.sourcePath)
}

export function projectSaveFileName(location: ProjectFileLocation, fallback: string): string {
  return location.projectPath?.split(/[\\/]/).pop() || fallback
}
