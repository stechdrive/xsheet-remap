import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserAssetBytes, browserAssetDataUrl, fileToFileRef, sha256File } from './browserFiles'

describe('browser file adapters', () => {
  const originalCreateObjectUrl = URL.createObjectURL

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test-url')
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl
  })

  it('converts a browser File into a FileRef while preserving browser-only paths when present', async () => {
    const file = new File(['A1'], 'A1.png', { type: 'image/png', lastModified: 123 }) as File & { path?: string; webkitRelativePath?: string }
    file.path = 'D:\\cut\\A1.png'
    file.webkitRelativePath = 'cut/A1.png'

    const ref = await fileToFileRef(file)

    expect(ref).toMatchObject({
      name: 'A1.png',
      size: 2,
      lastModified: 123,
      path: 'D:\\cut\\A1.png',
      relativePath: 'cut/A1.png',
      objectUrl: 'blob:test-url',
    })
    expect(ref.contentHash).toMatch(/^sha256:/)
  })

  it('computes stable SHA-256 hashes for files when WebCrypto is available', async () => {
    const first = await sha256File(new File(['same'], 'a.txt'))
    const second = await sha256File(new File(['same'], 'b.txt'))

    expect(first).toBe(second)
  })

  it('retains browser file bytes for project and portable-package saves', async () => {
    const ref = await fileToFileRef(new File(['asset'], 'A1.png', { type: 'image/png' }))
    expect(await browserAssetDataUrl(ref.objectUrl)).toBe('data:image/png;base64,YXNzZXQ=')
    expect([...(await browserAssetBytes(ref.objectUrl))!.bytes]).toEqual([97, 115, 115, 101, 116])
    expect([...(await browserAssetBytes('data:image/png;base64,YXNzZXQ='))!.bytes]).toEqual([97, 115, 115, 101, 116])
  })
})
