import type { FileRef } from '@xsheet-remap/core'

export async function fileToFileRef(file: File): Promise<FileRef> {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string }
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    path: fileWithPath.path,
    relativePath: fileWithPath.webkitRelativePath || undefined,
    objectUrl: URL.createObjectURL(file),
    contentHash: await sha256File(file),
  }
}

export async function sha256File(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return `sha256:${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
