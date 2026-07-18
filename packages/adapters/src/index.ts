import type { CutGroupProjectDocument, FileRef, NameNormalizationAssetRename, NameNormalizationAssetRenameResult } from '@xsheet-remap/core'
import { isTauriHost } from './environment'
import { decodeProjectFileBytes, encodeProjectArchive, type DecodedProjectFile } from './projectArchive'

export { isTauriHost, isTauriLikeWindow } from './environment'
export { fileToFileRef, sha256File } from './browserFiles'
export {
  decodeProjectFileBytes,
  encodeProjectArchive,
  projectDocumentWithoutRuntimePreviews,
  projectFileErrorCanRecoverFromBackup,
  readProjectFile,
  RecoverableProjectFileError,
  type DecodedProjectFile,
  type EncodeProjectArchiveOptions,
  type ProjectFileFormat,
} from './projectArchive'
export {
  closeCurrentNativeWindow,
  configureCurrentNativeWindow,
  currentNativeWindowBounds,
  invokeDesktopCommand,
  listenDesktopEvent,
  nativeFileSource,
  subscribeNativeDragDrop,
  watchCurrentNativeWindowBounds,
  type NativeDragDropPayload,
  type NativeDragDropSource,
  type NativeDropPosition,
  type NativeWindowBounds,
  type NativeWindowLayout,
} from './desktopRuntime'

export interface AssetRootCandidate {
  label: string
  path: string
  fromDirectoryDrop: boolean
}

export interface AssetPathCollection {
  roots: AssetRootCandidate[]
  files: FileRef[]
}

export interface AssetDirectoryEntry {
  name: string
  path: string
  relativePath: string
  kind: 'directory' | 'file'
  isSupportedImage: boolean
  size?: number
  lastModified?: number
  objectUrl?: string
}

export interface AssetDirectoryListing {
  rootPath: string
  currentPath: string
  parentPath?: string
  entries: AssetDirectoryEntry[]
}

export interface OpenImageFileRefsOptions {
  initialDirectory?: string
}

export async function openImageFileRefs(options: OpenImageFileRefsOptions = {}): Promise<FileRef[] | null> {
  if (!isTauriHost()) return null
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  const refs = await invoke<FileRef[]>('open_image_files', {
    initialDirectory: options.initialDirectory,
  })
  return refs.map(ref => ({
    ...ref,
    objectUrl: ref.path ? convertFileSrc(ref.path) : ref.objectUrl,
  }))
}

export async function imageFileRefsFromPaths(paths: string[]): Promise<FileRef[]> {
  if (!isTauriHost() || paths.length === 0) return []
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  const refs = await invoke<FileRef[]>('image_file_refs_from_paths', { paths })
  return refs.map(ref => ({
    ...ref,
    objectUrl: ref.path ? convertFileSrc(ref.path) : ref.objectUrl,
  }))
}

export async function openAssetRootDirectory(): Promise<string | null> {
  if (!isTauriHost()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('open_asset_root_directory')
}

export async function collectAssetPathDrop(paths: string[], options: { recursive?: boolean; rootPath?: string } = {}): Promise<AssetPathCollection> {
  if (!isTauriHost() || paths.length === 0) return { roots: [], files: [] }
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  const collection = await invoke<AssetPathCollection>('collect_asset_paths', {
    paths,
    recursive: options.recursive ?? true,
    rootPath: options.rootPath,
  })
  return {
    roots: collection.roots,
    files: collection.files.map(ref => ({
      ...ref,
      objectUrl: ref.path ? convertFileSrc(ref.path) : ref.objectUrl,
    })),
  }
}

export async function listAssetDirectory(rootPath: string, currentPath: string): Promise<AssetDirectoryListing | null> {
  if (!isTauriHost()) return null
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  const listing = await invoke<AssetDirectoryListing>('list_asset_directory', { rootPath, currentPath })
  return {
    ...listing,
    entries: listing.entries.map(entry => ({
      ...entry,
      objectUrl: entry.kind === 'file' && entry.isSupportedImage ? convertFileSrc(entry.path) : entry.objectUrl,
    })),
  }
}

export function downloadTextFile(text: string, fileName: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mimeType })
  downloadBlob(blob, fileName)
}

export function downloadJson(value: unknown, fileName: string): void {
  downloadTextFile(`${JSON.stringify(value, null, 2)}\n`, fileName, 'application/json;charset=utf-8')
}

export interface SaveFileResult {
  saved: boolean
  path?: string
}

export interface SaveTextFileOptions {
  filterName?: string
  extensions?: string[]
  defaultExtension?: string
  initialDirectory?: string
}

export interface CspImportPackageFile {
  relativePath: string
  contents: string
}

export interface WriteCspImportPackageInput {
  assetRootPath: string
  outputDirectoryName: string
  files: CspImportPackageFile[]
}

export interface WriteCspImportPackageResult {
  outputDirectoryPath: string
}

export interface NativePathStatus {
  path: string
  exists: boolean
  isDirectory: boolean
  isFile: boolean
}

export async function saveTextFile(
  text: string,
  fileName: string,
  mimeType = 'text/plain;charset=utf-8',
  options: SaveTextFileOptions = {},
): Promise<SaveFileResult> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string | null>('save_text_file', {
      fileName,
      contents: text,
      filterName: options.filterName,
      extensions: options.extensions,
      defaultExtension: options.defaultExtension,
      initialDirectory: options.initialDirectory,
    })
    return path ? { saved: true, path } : { saved: false }
  }
  downloadTextFile(text, fileName, mimeType)
  return { saved: true }
}

export async function saveBinaryFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType = 'application/octet-stream',
  options: SaveTextFileOptions = {},
): Promise<SaveFileResult> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string | null>('save_binary_file', {
      fileName,
      contentsBase64: bytesToBase64(bytes),
      filterName: options.filterName,
      extensions: options.extensions,
      defaultExtension: options.defaultExtension,
      initialDirectory: options.initialDirectory,
    })
    return path ? { saved: true, path } : { saved: false }
  }
  const copy = new Uint8Array(bytes)
  downloadBlob(new Blob([copy.buffer as ArrayBuffer], { type: mimeType }), fileName)
  return { saved: true }
}

export async function writeTextFile(path: string, text: string): Promise<SaveFileResult> {
  if (!isTauriHost()) return { saved: false }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_text_file', { path, contents: text })
  return { saved: true, path }
}

export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<SaveFileResult> {
  if (!isTauriHost()) return { saved: false }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_binary_file', { path, contentsBase64: bytesToBase64(bytes) })
  return { saved: true, path }
}

export async function saveProjectFile(
  document: CutGroupProjectDocument,
  fileName: string,
  options: Pick<SaveTextFileOptions, 'initialDirectory'> & { createdWith?: string } = {},
): Promise<SaveFileResult> {
  const bytes = await encodeProjectArchive(document, { createdWith: options.createdWith })
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string | null>('save_project_file', {
      fileName,
      contentsBase64: bytesToBase64(bytes),
      initialDirectory: options.initialDirectory,
    })
    return path ? { saved: true, path } : { saved: false }
  }
  const copy = new Uint8Array(bytes)
  downloadBlob(new Blob([copy.buffer as ArrayBuffer], { type: 'application/vnd.xsheet-remap.project' }), fileName)
  return { saved: true }
}

export async function writeProjectFile(
  path: string,
  document: CutGroupProjectDocument,
  options: { createdWith?: string } = {},
): Promise<SaveFileResult> {
  if (!isTauriHost()) return { saved: false }
  const bytes = await encodeProjectArchive(document, { createdWith: options.createdWith })
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_project_file', { path, contentsBase64: bytesToBase64(bytes) })
  return { saved: true, path }
}

export async function readProjectBackup(path: string): Promise<DecodedProjectFile | null> {
  if (!isTauriHost()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const contentsBase64 = await invoke<string | null>('read_project_backup', { path })
  return contentsBase64 ? decodeProjectFileBytes(base64ToBytes(contentsBase64)) : null
}

export async function writeCspImportPackage(input: WriteCspImportPackageInput): Promise<WriteCspImportPackageResult | null> {
  if (!isTauriHost()) throw new Error('CSP自動登録パッケージの書き出しはデスクトップ版でのみ使えます。')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<WriteCspImportPackageResult | null>('write_csp_import_package', {
    assetRootPath: input.assetRootPath,
    outputDirectoryName: input.outputDirectoryName,
    files: input.files,
  })
}

export async function statNativePaths(paths: string[]): Promise<NativePathStatus[]> {
  if (!isTauriHost() || paths.length === 0) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<NativePathStatus[]>('stat_native_paths', { paths })
}

export function saveJsonFile(value: unknown, fileName: string, options: Pick<SaveTextFileOptions, 'initialDirectory'> = {}): Promise<SaveFileResult> {
  return saveTextFile(`${JSON.stringify(value, null, 2)}\n`, fileName, 'application/json;charset=utf-8', {
    filterName: 'JSON',
    extensions: ['json'],
    defaultExtension: 'json',
    initialDirectory: options.initialDirectory,
  })
}

export async function confirmUserAction(
  message: string,
  options: { title?: string; okLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
  if (isTauriHost()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<boolean>('confirm_user_action', {
      title: options.title ?? '確認',
      message,
      okLabel: options.okLabel,
      cancelLabel: options.cancelLabel,
    })
  }
  return window.confirm(message)
}

export async function renameMaterialFiles(renames: NameNormalizationAssetRename[]): Promise<NameNormalizationAssetRenameResult[]> {
  const operations = renames
    .filter(rename => rename.canRename && rename.currentPath && rename.nextPath)
    .map(rename => ({
      assetId: rename.assetId,
      currentPath: rename.currentPath as string,
      nextPath: rename.nextPath as string,
      nextFileName: rename.nextFileName,
    }))
  if (operations.length === 0) return []
  if (!isTauriHost()) {
    return operations.map(operation => ({
      assetId: operation.assetId,
      renamed: false,
      error: 'デスクトップ版でのみ実ファイル名を変更できます。',
    }))
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<NameNormalizationAssetRenameResult[]>('rename_material_files', { operations })
}

export async function readJsonFile<T>(file: File): Promise<T> {
  return JSON.parse(await file.text()) as T
}

export function printToPdf(): void {
  window.print()
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
