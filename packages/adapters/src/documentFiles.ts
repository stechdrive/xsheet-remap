import { normalizeNativeFileSystemPath } from '@xsheet-remap/core'
import { isTauriHost } from './environment'

export type DocumentFileKind = 'xsr' | 'clip'

/** The native location is explicit; browser File objects do not expose paths. */
export interface DocumentFileSource {
  file: File
  nativePath: string | null
}

export async function openNativeDocumentFile(kind: DocumentFileKind, initialDirectory?: string): Promise<DocumentFileSource | null> {
  if (!isTauriHost()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const path = await invoke<string | null>('open_document_file', { kind, initialDirectory })
  return path ? readNativeDocumentFile(path, kind) : null
}

export async function readNativeDocumentFile(path: string, kind: DocumentFileKind): Promise<DocumentFileSource> {
  if (!isTauriHost()) throw new Error('ファイルパスからの読み込みはEXE版で利用できます。')
  const { invoke } = await import('@tauri-apps/api/core')
  const nativePath = normalizeNativeFileSystemPath(path)
  const contents = await invoke<ArrayBuffer | number[]>('read_document_file', { path: nativePath, kind })
  const bytes = new Uint8Array(contents)
  const name = nativePath.split(/[\\/]/).pop()!
  return { file: new File([bytes], name), nativePath }
}
