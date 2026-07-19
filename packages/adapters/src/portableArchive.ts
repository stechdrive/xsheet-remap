import { strToU8, zip } from 'fflate'

const MAX_PORTABLE_ARCHIVE_FILES = 4096
const MAX_PORTABLE_ARCHIVE_BYTES = 1024 * 1024 * 1024

export interface PortableArchiveFile {
  relativePath: string
  contents: string | Uint8Array
}

export async function createPortableArchive(files: PortableArchiveFile[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('ZIPに含めるファイルがありません。')
  if (files.length > MAX_PORTABLE_ARCHIVE_FILES) throw new Error('ZIPのファイル数が上限を超えています。')
  const entries: Record<string, Uint8Array> = {}
  let totalBytes = 0
  for (const file of files) {
    const relativePath = normalizeArchivePath(file.relativePath)
    if (entries[relativePath]) throw new Error(`ZIP内のパスが重複しています: ${relativePath}`)
    const bytes = typeof file.contents === 'string' ? strToU8(file.contents) : new Uint8Array(file.contents)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_PORTABLE_ARCHIVE_BYTES) throw new Error('ZIPの合計サイズが上限を超えています。')
    entries[relativePath] = bytes
  }
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes))
  })
}

function normalizeArchivePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\/+/, '')
  const parts = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`安全でないZIP内パスです: ${input}`)
  }
  return normalized
}
