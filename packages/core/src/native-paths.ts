/**
 * Converts Windows device-namespace paths into the ordinary form expected by
 * users and project files. Other path styles are returned unchanged.
 */
export function normalizeNativeFileSystemPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`
  if (/^\\\\\?\\/i.test(path)) return path.slice(4)
  if (/^\/\/\?\/UNC\//i.test(path)) return `//${path.slice(8)}`
  if (/^\/\/\?\//i.test(path)) return path.slice(4)
  return path
}

export function nativeFileSystemPathKey(path?: string): string | undefined {
  if (!path) return undefined
  const normalized = normalizeNativeFileSystemPath(path).replace(/\\/g, '/')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}
