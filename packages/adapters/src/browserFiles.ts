import type { FileRef } from '@xsheet-remap/core'

const browserFilesByObjectUrl = new Map<string, File>()

export async function fileToFileRef(file: File): Promise<FileRef> {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string }
  const objectUrl = URL.createObjectURL(file)
  browserFilesByObjectUrl.set(objectUrl, file)
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    path: fileWithPath.path,
    relativePath: fileWithPath.webkitRelativePath || undefined,
    objectUrl,
    contentHash: await sha256File(file),
  }
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
