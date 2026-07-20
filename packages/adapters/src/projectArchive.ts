import {
  buildProjectArchiveManifest,
  parseProjectArchiveManifest,
  parseProjectDocument,
  type CutGroupProjectDocument,
  type ProjectArchiveBlobDescriptor,
  type ProjectArchiveManifest,
} from '@xsheet-remap/core'
import { strFromU8, strToU8, unzip, zip } from 'fflate'

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const MAX_PROJECT_JSON_BYTES = 128 * 1024 * 1024
const MAX_BLOB_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 4096
const BLOB_REFERENCE_PREFIX = 'xsr-blob://sha256/'

export const XSR_PROJECT_FILE_EXTENSION = '.xsr'
export const XSR_PROJECT_MIME_TYPE = 'application/vnd.xsheet-remap.project'
export const XSR_PROJECT_FILE_ACCEPT = `${XSR_PROJECT_FILE_EXTENSION},${XSR_PROJECT_MIME_TYPE}`

export interface DecodedProjectFile {
  document: CutGroupProjectDocument
  manifest: ProjectArchiveManifest
}

export interface EncodeProjectArchiveOptions {
  createdWith?: string
  includeAssetPreviews?: boolean
}

export class RecoverableProjectFileError extends Error {
  override name = 'RecoverableProjectFileError'
}

export function projectFileErrorCanRecoverFromBackup(error: unknown): boolean {
  return error instanceof RecoverableProjectFileError
}

interface CollectedBlob {
  descriptor: ProjectArchiveBlobDescriptor
  bytes: Uint8Array
}

export async function encodeProjectArchive(
  documentInput: CutGroupProjectDocument,
  options: EncodeProjectArchiveOptions = {},
): Promise<Uint8Array> {
  const parsedDocument = parseProjectDocument(documentInput)
  const document = options.includeAssetPreviews
    ? parsedDocument
    : projectDocumentWithoutRuntimePreviews(parsedDocument)
  const blobs = new Map<string, CollectedBlob>()
  const archivedDocument = await externalizeDataUrls(document, blobs, new Map(), 0) as unknown as CutGroupProjectDocument
  const descriptors = [...blobs.values()].map(blob => blob.descriptor).sort((a, b) => a.path.localeCompare(b.path))
  const projectBytes = strToU8(`${JSON.stringify(archivedDocument)}\n`)
  const manifest = buildProjectArchiveManifest(document, {
    blobs: descriptors,
    createdWith: options.createdWith,
    projectByteLength: projectBytes.byteLength,
    projectSha256: await sha256Id(projectBytes),
  })
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'project.json': projectBytes,
  }
  for (const blob of blobs.values()) entries[blob.descriptor.path] = blob.bytes
  return zipEntries(entries)
}

export async function readProjectFile(file: File): Promise<DecodedProjectFile> {
  if (!isXsrProjectFileName(file.name)) {
    throw new Error(`プロジェクトファイルは${XSR_PROJECT_FILE_EXTENSION}形式を選択してください。`)
  }
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('プロジェクトファイルが大きすぎます。')
  return decodeProjectFileBytes(new Uint8Array(await file.arrayBuffer()))
}

export async function decodeProjectFileBytes(bytes: Uint8Array): Promise<DecodedProjectFile> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('プロジェクトファイルが大きすぎます。')
  if (looksLikeJson(bytes)) {
    throw corruptionError('JSONファイルはXSRプロジェクトとして開けません。シートテンプレートJSONは「シートテンプレートを読み込む」から選択してください。')
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = await unzipEntries(bytes)
  } catch {
    throw corruptionError('プロジェクトコンテナを展開できません。ファイルが破損している可能性があります。')
  }
  if (Object.keys(entries).length > MAX_ARCHIVE_ENTRIES) throw new Error('プロジェクトコンテナの項目数が上限を超えています。')

  const manifestBytes = entries['manifest.json']
  const projectBytes = entries['project.json']
  if (!manifestBytes || !projectBytes) throw corruptionError('プロジェクトコンテナに必須データがありません。')
  if (projectBytes.byteLength > MAX_PROJECT_JSON_BYTES) throw new Error('プロジェクトデータが大きすぎます。')

  const manifest = parseProjectArchiveManifest(parseJsonEntry(manifestBytes, 'マニフェスト'))
  if (projectBytes.byteLength !== manifest.projectByteLength || await sha256Id(projectBytes) !== manifest.projectSha256) {
    throw corruptionError('プロジェクトデータの整合性を確認できません。')
  }
  const uniqueBlobIds = new Set(manifest.blobs.map(blob => blob.blobId))
  const uniqueBlobPaths = new Set(manifest.blobs.map(blob => blob.path))
  if (uniqueBlobIds.size !== manifest.blobs.length || uniqueBlobPaths.size !== manifest.blobs.length) {
    throw corruptionError('プロジェクトコンテナのBlob定義が重複しています。')
  }
  const blobs = new Map<string, { descriptor: ProjectArchiveBlobDescriptor; bytes: Uint8Array }>()
  let blobBytes = 0
  for (const descriptor of manifest.blobs) {
    const blob = entries[descriptor.path]
    if (!blob) throw corruptionError(`プロジェクトの埋め込みデータがありません: ${descriptor.blobId}`)
    blobBytes += blob.byteLength
    if (blobBytes > MAX_BLOB_BYTES) throw new Error('プロジェクトの埋め込みデータが大きすぎます。')
    if (blob.byteLength !== descriptor.byteLength) throw corruptionError(`埋め込みデータのサイズが一致しません: ${descriptor.blobId}`)
    const actualHash = await sha256Id(blob)
    if (actualHash !== descriptor.sha256) throw corruptionError(`埋め込みデータが破損しています: ${descriptor.blobId}`)
    blobs.set(descriptor.blobId, { descriptor, bytes: blob })
  }

  const archivedDocument = parseJsonEntry(projectBytes, 'プロジェクト')
  const hydratedDocument = hydrateBlobReferences(archivedDocument, blobs, 0)
  const document = parseProjectDocument(hydratedDocument)
  if (document.schemaVersion !== manifest.documentSchemaVersion) {
    throw corruptionError('マニフェストとプロジェクトのスキーマバージョンが一致しません。')
  }
  return { document, manifest }
}

export function isXsrProjectFileName(fileNameOrPath: string): boolean {
  return fileNameOrPath.toLocaleLowerCase('en-US').endsWith(XSR_PROJECT_FILE_EXTENSION)
}

export function projectDocumentWithoutRuntimePreviews(document: CutGroupProjectDocument): CutGroupProjectDocument {
  return {
    ...document,
    assets: document.assets.map(asset => {
      const persistedAsset = { ...asset }
      delete persistedAsset.thumbnailUrl
      return persistedAsset
    }),
  }
}

async function externalizeDataUrls(
  value: unknown,
  blobs: Map<string, CollectedBlob>,
  dataUrlReferences: Map<string, string>,
  depth: number,
): Promise<unknown> {
  if (depth > 128) throw new Error('プロジェクトデータの階層が深すぎます。')
  if (typeof value === 'string' && value.startsWith('data:')) {
    const existingReference = dataUrlReferences.get(value)
    if (existingReference) return existingReference
    const parsed = parseDataUrl(value)
    const blobId = await sha256Id(parsed.bytes)
    if (!blobs.has(blobId)) {
      const hash = blobId.slice('sha256:'.length)
      blobs.set(blobId, {
        descriptor: {
          blobId,
          path: `blobs/${hash}`,
          mediaType: parsed.mediaType,
          byteLength: parsed.bytes.byteLength,
          sha256: blobId,
        },
        bytes: parsed.bytes,
      })
    }
    const reference = `${BLOB_REFERENCE_PREFIX}${blobId.slice('sha256:'.length)}`
    dataUrlReferences.set(value, reference)
    return reference
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => externalizeDataUrls(item, blobs, dataUrlReferences, depth + 1)))
  if (isRecord(value)) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await externalizeDataUrls(item, blobs, dataUrlReferences, depth + 1)] as const))
    return Object.fromEntries(entries)
  }
  return value
}

function hydrateBlobReferences(
  value: unknown,
  blobs: Map<string, { descriptor: ProjectArchiveBlobDescriptor; bytes: Uint8Array }>,
  depth: number,
): unknown {
  if (depth > 128) throw new Error('プロジェクトデータの階層が深すぎます。')
  if (typeof value === 'string' && value.startsWith(BLOB_REFERENCE_PREFIX)) {
    const blobId = `sha256:${value.slice(BLOB_REFERENCE_PREFIX.length)}`
    const blob = blobs.get(blobId)
    if (!blob) throw corruptionError(`参照先の埋め込みデータがありません: ${blobId}`)
    return bytesToDataUrl(blob.descriptor.mediaType, blob.bytes)
  }
  if (Array.isArray(value)) return value.map(item => hydrateBlobReferences(item, blobs, depth + 1))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateBlobReferences(item, blobs, depth + 1)]))
  return value
}

function parseDataUrl(value: string): { mediaType: string; bytes: Uint8Array } {
  const commaIndex = value.indexOf(',')
  if (commaIndex < 5) throw new Error('埋め込みデータURLが不正です。')
  const metadata = value.slice('data:'.length, commaIndex).split(';')
  const mediaType = metadata[0] || 'application/octet-stream'
  const payload = value.slice(commaIndex + 1)
  try {
    if (metadata.some(item => item.toLocaleLowerCase('en-US') === 'base64')) {
      return { mediaType, bytes: binaryStringToBytes(atob(payload)) }
    }
    return { mediaType, bytes: strToU8(decodeURIComponent(payload)) }
  } catch {
    throw new Error('埋め込みデータURLを読み取れません。')
  }
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

async function sha256Id(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('プロジェクトの整合性検証を利用できません。')
  const copy = new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return `sha256:${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function parseJsonEntry(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes).replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw corruptionError(`${label}JSONが破損しています。`)
  }
}

function looksLikeJson(bytes: Uint8Array): boolean {
  for (let index = 0; index < Math.min(bytes.length, 256); index += 1) {
    const byte = bytes[index]
    if (byte === 0xef && bytes[index + 1] === 0xbb && bytes[index + 2] === 0xbf) {
      index += 2
      continue
    }
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    return byte === 0x7b
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function zipEntries(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes))
  })
}

function unzipEntries(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, entries) => error ? reject(error) : resolve(entries))
  })
}

function corruptionError(message: string): RecoverableProjectFileError {
  return new RecoverableProjectFileError(message)
}
