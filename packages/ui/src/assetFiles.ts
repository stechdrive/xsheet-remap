import { assetAbsolutePath, assetSourceDisplayPath, type CutAsset, type SheetPageImageRef } from '@xsheet-remap/core'
import { ASSET_DRAG_MIME, ASSET_MULTI_DRAG_MIME, ASSET_TEXT_DRAG_PREFIX, REGISTERED_CELL_TEXT_DRAG_PREFIX } from './sheetConstants'
import { compareFileNameLikeText } from './naturalSort'

interface BrowserFileSystemEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
}

interface BrowserFileSystemFileEntry extends BrowserFileSystemEntry {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}

interface BrowserFileSystemDirectoryEntry extends BrowserFileSystemEntry {
  createReader: () => {
    readEntries: (success: (entries: BrowserFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void
  }
}

interface DataTransferItemEntryAccess {
  webkitGetAsEntry?: () => BrowserFileSystemEntry | null
  getAsEntry?: () => BrowserFileSystemEntry | null
}

export async function collectAssetFilesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? [])
  const itemFiles = items.length > 0
    ? (await Promise.all(items.map(filesFromDataTransferItem))).flat()
    : []
  const files = itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files ?? [])
  return dedupeFiles(files.filter(isImageAssetFile))
}

export function hasFileTransferPayload(dataTransfer: DataTransfer): boolean {
  return (dataTransfer.files?.length ?? 0) > 0
    || Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file')
}

export function hasAssetDragPayload(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes(ASSET_DRAG_MIME) || types.includes(ASSET_MULTI_DRAG_MIME)) return true
  if (!types.includes('text/plain')) return false
  const textPayload = dataTransfer.getData('text/plain')
  return Boolean(assetIdFromAssetTextDragData(textPayload))
}

export function assetIdFromAssetDragData(dataTransfer: DataTransfer): string {
  return assetIdsFromAssetDragData(dataTransfer)[0] ?? ''
}

export function assetIdsFromAssetDragData(dataTransfer: DataTransfer): string[] {
  const multiAssetIds = parseAssetIdsFromDragData(dataTransfer.getData(ASSET_MULTI_DRAG_MIME))
  if (multiAssetIds.length > 0) return multiAssetIds
  const explicitAssetId = dataTransfer.getData(ASSET_DRAG_MIME)
  if (explicitAssetId) return [explicitAssetId]
  if (hasFileTransferPayload(dataTransfer)) return []
  const textPayload = dataTransfer.getData('text/plain')
  const textAssetId = assetIdFromAssetTextDragData(textPayload)
  return textAssetId ? [textAssetId] : []
}

export function assetTextDragData(assetId: string): string {
  return `${ASSET_TEXT_DRAG_PREFIX}${assetId}`
}

export function assetIdFromAssetTextDragData(value: string): string {
  return value.startsWith(ASSET_TEXT_DRAG_PREFIX)
    ? value.slice(ASSET_TEXT_DRAG_PREFIX.length)
    : ''
}

export function isRegisteredCellTextDragData(value: string): boolean {
  return value.startsWith(REGISTERED_CELL_TEXT_DRAG_PREFIX)
}

export function parseAssetIdsFromDragData(value: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return dedupeStringList(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))
    }
  } catch {
    // Single-value drag data from older builds is handled below.
  }
  return value ? [value] : []
}

export function dedupeStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function isImageAssetFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|bmp|tiff?|tga)$/i.test(file.name)
}

export function compareFileNames(a: File, b: File): number {
  return compareFileNameLikeText(a.name, b.name)
}

export function compareAssetNames(a: CutAsset, b: CutAsset): number {
  return compareFileNameLikeText(assetSortName(a), assetSortName(b))
    || compareFileNameLikeText(assetPathSortName(a), assetPathSortName(b))
    || a.assetId.localeCompare(b.assetId, 'ja')
}

export function assetBaseName(asset: CutAsset): string {
  return assetSortName(asset).replace(/\.[^.]+$/, '')
}

export function sheetImageRefFromAsset(asset: CutAsset): SheetPageImageRef {
  return {
    name: asset.displayName || asset.originalFileName,
    size: asset.fileSize,
    lastModified: asset.modifiedAt ? new Date(asset.modifiedAt).getTime() : undefined,
    path: assetAbsolutePath(asset),
    contentHash: asset.contentHash,
  }
}

async function filesFromDataTransferItem(item: DataTransferItem): Promise<File[]> {
  const entry = dataTransferItemEntry(item)
  if (!entry) {
    const file = item.getAsFile()
    return file ? [file] : []
  }
  if (entry.isFile) return [await fileFromEntry(entry as BrowserFileSystemFileEntry)]
  if (entry.isDirectory) return filesFromDirectoryEntry(entry as BrowserFileSystemDirectoryEntry)
  return []
}

function dataTransferItemEntry(item: DataTransferItem): BrowserFileSystemEntry | null {
  const itemWithEntry = item as unknown as DataTransferItemEntryAccess
  return itemWithEntry.webkitGetAsEntry?.() ?? itemWithEntry.getAsEntry?.() ?? null
}

function fileFromEntry(entry: BrowserFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function filesFromDirectoryEntry(entry: BrowserFileSystemDirectoryEntry): Promise<File[]> {
  const reader = entry.createReader()
  const children: BrowserFileSystemEntry[] = []
  for (;;) {
    const batch = await readDirectoryEntries(reader)
    if (batch.length === 0) break
    children.push(...batch)
  }
  const childFiles = await Promise.all(
    children
      .filter((child): child is BrowserFileSystemFileEntry => child.isFile)
      .map(fileFromEntry),
  )
  return childFiles.sort(compareFileNames)
}

function readDirectoryEntries(reader: ReturnType<BrowserFileSystemDirectoryEntry['createReader']>): Promise<BrowserFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject)
  })
}

function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>()
  return files.filter(file => {
    const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function assetSortName(asset: CutAsset): string {
  return asset.displayName || asset.originalFileName
}

function assetPathSortName(asset: CutAsset): string {
  return assetSourceDisplayPath(asset)
}
