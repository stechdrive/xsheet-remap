import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createPortableArchive } from './portableArchive'

describe('createPortableArchive', () => {
  it('creates a ZIP with normalized relative files', async () => {
    const bytes = await createPortableArchive([
      { relativePath: 'xsheet-csp-import/csp-import.xci', contents: '{"schemaVersion":4}' },
      { relativePath: 'assets/A1.png', contents: new Uint8Array([1, 2, 3]) },
    ])
    const entries = unzipSync(bytes)
    expect(strFromU8(entries['xsheet-csp-import/csp-import.xci']!)).toBe('{"schemaVersion":4}')
    expect([...entries['assets/A1.png']!]).toEqual([1, 2, 3])
  })

  it('rejects paths that can escape the archive root', async () => {
    await expect(createPortableArchive([{ relativePath: '../secret.txt', contents: 'no' }]))
      .rejects.toThrow('安全でないZIP内パス')
  })
})
