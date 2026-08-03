import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveGeneratedBinaryOutputs } from './app-foundation'

const adapterMocks = vi.hoisted(() => ({
  saveBinaryFile: vi.fn(),
  writeBinaryFile: vi.fn(),
}))

vi.mock('@xsheet-remap/adapters', async importOriginal => ({
  ...(await importOriginal<typeof import('@xsheet-remap/adapters')>()),
  saveBinaryFile: adapterMocks.saveBinaryFile,
  writeBinaryFile: adapterMocks.writeBinaryFile,
}))

afterEach(() => {
  adapterMocks.saveBinaryFile.mockReset()
  adapterMocks.writeBinaryFile.mockReset()
})

describe('generated binary output saving', () => {
  it('generates later outputs sequentially into the directory selected for the first file', async () => {
    adapterMocks.saveBinaryFile.mockResolvedValue({ saved: true, path: 'D:\\exports\\cut_paper-sheet01_corrected.png' })
    adapterMocks.writeBinaryFile.mockResolvedValue({ saved: true })
    const createFirst = vi.fn(async () => binaryOutput('cut_paper-sheet01_corrected.png', 1))
    const createSecond = vi.fn(async () => binaryOutput('cut_paper-sheet02_corrected.png', 2))
    const createThird = vi.fn(async () => binaryOutput('cut_paper-sheet03_corrected.png', 3))

    await expect(saveGeneratedBinaryOutputs([createFirst, createSecond, createThird], {})).resolves.toBe(true)

    expect(adapterMocks.saveBinaryFile).toHaveBeenCalledTimes(1)
    expect(adapterMocks.writeBinaryFile).toHaveBeenNthCalledWith(
      1,
      'D:\\exports\\cut_paper-sheet02_corrected.png',
      Uint8Array.of(2),
    )
    expect(adapterMocks.writeBinaryFile).toHaveBeenNthCalledWith(
      2,
      'D:\\exports\\cut_paper-sheet03_corrected.png',
      Uint8Array.of(3),
    )
    expect(createSecond.mock.invocationCallOrder[0]).toBeGreaterThan(adapterMocks.saveBinaryFile.mock.invocationCallOrder[0])
    expect(createThird.mock.invocationCallOrder[0]).toBeGreaterThan(adapterMocks.writeBinaryFile.mock.invocationCallOrder[0])
  })

  it('does not generate later pages when the first save dialog is cancelled', async () => {
    adapterMocks.saveBinaryFile.mockResolvedValue({ saved: false })
    const createFirst = vi.fn(async () => binaryOutput('cut_paper-sheet01_corrected.psd', 1, 'image/vnd.adobe.photoshop'))
    const createSecond = vi.fn(async () => binaryOutput('cut_paper-sheet02_corrected.psd', 2, 'image/vnd.adobe.photoshop'))

    await expect(saveGeneratedBinaryOutputs([createFirst, createSecond], {})).resolves.toBe(false)

    expect(createFirst).toHaveBeenCalledTimes(1)
    expect(createSecond).not.toHaveBeenCalled()
    expect(adapterMocks.writeBinaryFile).not.toHaveBeenCalled()
  })
})

function binaryOutput(fileName: string, value: number, mimeType = 'image/png') {
  return { fileName, bytes: Uint8Array.of(value), mimeType }
}
