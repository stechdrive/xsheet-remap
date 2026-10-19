import type { FileRef } from '@xsheet-remap/core'

const browserFilesByObjectUrl = new Map<string, File>()
const pendingFiles = new Set<string>()
const owners = new Map<object, ReadonlySet<string>>()
const references = new WeakMap<object, ReadonlySet<string>>()
let sweepQueued = false

// Project snapshots are immutable. Reuse their reference sets without retaining
// the snapshots themselves or walking every historical document after each edit.
function objectUrls(value: unknown, visiting = new Set<object>()): ReadonlySet<string> {
  if (typeof value === 'string') return new Set(value.startsWith('blob:') ? [value] : [])
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof Blob) return new Set()
  const cached = references.get(value)
  if (cached) return cached
  if (visiting.has(value)) return new Set()
  visiting.add(value)
  const result = new Set<string>()
  for (const child of Object.values(value)) for (const url of objectUrls(child, visiting)) result.add(url)
  visiting.delete(value)
  references.set(value, result)
  return result
}

function scheduleSweep() {
  if (sweepQueued) return
  sweepQueued = true
  queueMicrotask(() => {
    sweepQueued = false
    const retained = new Set(pendingFiles)
    for (const urls of owners.values()) for (const url of urls) retained.add(url)
    for (const url of browserFilesByObjectUrl.keys()) if (!retained.has(url)) {
      browserFilesByObjectUrl.delete(url)
      URL.revokeObjectURL(url)
    }
  })
}

export function createBrowserFileOwner() {
  const owner = {}
  return {
    update(immutableRoots: unknown) { owners.set(owner, objectUrls(immutableRoots)); scheduleSweep() },
    dispose() { owners.delete(owner); scheduleSweep() },
  }
}

/** Pin all inputs for an asynchronous operation, even across a workspace change. */
export function retainBrowserFiles(immutableRoots: unknown): () => void {
  const owner = createBrowserFileOwner()
  owner.update(immutableRoots)
  return () => owner.dispose()
}

/** Release the producer lease only after the imported refs have a committed owner. */
export function releaseBrowserFileRefs(refs: readonly FileRef[]): void {
  for (const ref of refs) if (ref.objectUrl) pendingFiles.delete(ref.objectUrl)
  scheduleSweep()
}

export async function fileToFileRef(file: File): Promise<FileRef> {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string }
  const contentHash = await sha256File(file)
  const objectUrl = URL.createObjectURL(file)
  browserFilesByObjectUrl.set(objectUrl, file)
  pendingFiles.add(objectUrl)
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    path: fileWithPath.path,
    relativePath: fileWithPath.webkitRelativePath || undefined,
    objectUrl,
    contentHash,
  }
}

/** Bound full-file reads/digests and preserve drop order. Failed batches own no files. */
export async function filesToFileRefs(files: readonly File[]): Promise<FileRef[]> {
  const refs: FileRef[] = []
  let next = 0, failed = false, failure: unknown
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
    while (!failed && next < files.length) {
      const index = next++
      try { refs[index] = await fileToFileRef(files[index]) }
      catch (error) { failed = true; failure = error }
    }
  }))
  if (failed) { releaseBrowserFileRefs(refs.filter(Boolean)); throw failure }
  return refs
}

export function browserFileForObjectUrl(objectUrl: string | undefined): File | undefined {
  return objectUrl ? browserFilesByObjectUrl.get(objectUrl) : undefined
}

export async function browserAssetDataUrl(objectUrl: string | undefined): Promise<string | undefined> {
  if (!objectUrl) return undefined
  if (objectUrl.startsWith('data:')) return objectUrl
  const file = browserFileForObjectUrl(objectUrl)
  if (!file) return undefined
  return bytesToDataUrl(file.type || 'application/octet-stream', new Uint8Array(await file.arrayBuffer()))
}

export async function browserAssetBytes(objectUrl: string | undefined): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
  if (!objectUrl) return undefined
  const file = browserFileForObjectUrl(objectUrl)
  if (file) {
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType: file.type || 'application/octet-stream',
    }
  }
  if (!objectUrl.startsWith('data:')) return undefined
  const commaIndex = objectUrl.indexOf(',')
  if (commaIndex < 5) return undefined
  const metadata = objectUrl.slice('data:'.length, commaIndex).split(';')
  const mediaType = metadata[0] || 'application/octet-stream'
  const payload = objectUrl.slice(commaIndex + 1)
  const bytes = metadata.some(item => item.toLowerCase() === 'base64')
    ? binaryStringToBytes(atob(payload))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return { bytes, mediaType }
}

export async function sha256File(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return `sha256:${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function bytesToDataUrl(mediaType: string, bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mediaType};base64,${btoa(binary)}`
}

function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index)
  return bytes
}
