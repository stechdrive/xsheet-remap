import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentFileKind, openNativeDocumentFile, readNativeDocumentFile } from './documentFiles'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
afterEach(() => { invoke.mockReset(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__') })

describe('native document files', () => {
  it('classifies only complete document extensions, including native paths and uppercase CLIP', () => {
    expect(documentFileKind('D:\\制作\\cut.CLIP')).toBe('clip')
    expect(documentFileKind('cut.XSR')).toBe('xsr')
    for (const name of ['clip', 'xsr', 'cut.clip.png', 'cut.xsr.json', 'cut.clip/001.png']) expect(documentFileKind(name)).toBeNull()
  })
  it('keeps the selected absolute path separate from the File and preserves binary bytes', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    invoke.mockResolvedValueOnce('D:\\制作\\cut.xsr').mockResolvedValueOnce(Uint8Array.of(0, 127, 255).buffer)
    const source = await openNativeDocumentFile('xsr', 'D:\\制作')
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_document_file', { kind: 'xsr', initialDirectory: 'D:\\制作' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_document_file', { path: 'D:\\制作\\cut.xsr', kind: 'xsr' })
    expect(source?.nativePath).toBe('D:\\制作\\cut.xsr')
    expect(source?.file.name).toBe('cut.xsr')
    expect([...new Uint8Array(await source!.file.arrayBuffer())]).toEqual([0, 127, 255])
    expect('path' in source!.file).toBe(false)
  })
  it('reads CLIP paths with the same transport and normalizes Windows device paths', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    invoke.mockResolvedValue([67, 72, 78, 75])
    const source = await readNativeDocumentFile('\\\\?\\UNC\\studio\\cuts\\cut.CLIP', 'clip')
    expect(source.nativePath).toBe('\\\\studio\\cuts\\cut.CLIP')
    expect(source.file.name).toBe('cut.CLIP')
    expect(invoke).toHaveBeenCalledWith('read_document_file', { path: source.nativePath, kind: 'clip' })
  })
  it('does no read after cancellation and does not open a native picker in a browser', async () => {
    expect(await openNativeDocumentFile('xsr')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    invoke.mockResolvedValue(null)
    expect(await openNativeDocumentFile('clip')).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
