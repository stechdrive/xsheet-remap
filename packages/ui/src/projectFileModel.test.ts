import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultProjectDocument } from '@xsheet-remap/core'
import { encodeProjectArchive, RecoverableProjectFileError } from '@xsheet-remap/adapters'
import { loadProjectDocumentFile } from './projectFileModel'

const mocks = vi.hoisted(() => ({ read: vi.fn(), backup: vi.fn() }))
vi.mock('@xsheet-remap/adapters', async original => ({
  ...await original<typeof import('@xsheet-remap/adapters')>(),
  readProjectFile: mocks.read, readProjectBackup: mocks.backup,
}))
afterEach(() => vi.resetAllMocks())

it('uses the explicit native location while a browser document has no overwrite path', async () => {
  const document = createDefaultProjectDocument()
  const bytes = await encodeProjectArchive(document)
  const file = new File([new Uint8Array(bytes)], 'cut.xsr')
  mocks.read.mockResolvedValue({ document })
  expect((await loadProjectDocumentFile({ file, nativePath: 'D:\\cuts\\cut.xsr' })).projectFilePath).toBe('D:\\cuts\\cut.xsr')
  expect((await loadProjectDocumentFile({ file, nativePath: null })).projectFilePath).toBeNull()
})

it('recovers through the explicit path and requires Save As to protect the backup', async () => {
  const document = createDefaultProjectDocument()
  mocks.read.mockRejectedValue(new RecoverableProjectFileError('broken'))
  mocks.backup.mockResolvedValue({ document })
  const loaded = await loadProjectDocumentFile({ file: new File([], 'cut.xsr'), nativePath: 'D:\\cuts\\cut.xsr' })
  expect(mocks.backup).toHaveBeenCalledWith('D:\\cuts\\cut.xsr')
  expect(loaded).toEqual({ document, projectFilePath: null, recoveredFromBackup: true })
})
