import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addClipLayers, createClipNode, createDefaultProject, ensureClipDocument, updateClipLayer, type CutProject, type SheetHit } from '@xsheet-remap/core'
import { createClipPreviewSession } from '@xsheet-remap/adapters'
import { useClipLayerPreview } from './useClipLayerPreview'

const mocks = vi.hoisted(() => ({ read: vi.fn(), dispose: vi.fn() }))
vi.mock('@xsheet-remap/adapters', async original => ({ ...await original<object>(),
  createClipPreviewSession: vi.fn(() => ({ read: mocks.read, dispose: mocks.dispose })),
}))
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ bytes: new Uint8Array([1, 2]), width: 2048, height: 1024, storedComposite: false })
  let count = 0
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:preview-${count++}`)
    static revokeObjectURL = vi.fn()
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
function project(): CutProject {
  const project = addClipLayers(ensureClipDocument(createDefaultProject()), [
    { ...createClipNode('still', 'raster', null, 'still'), sourceLayerId: 10 }, createClipNode('other', 'raster', null, 'other'),
  ])
  return { ...project, clipDocument: { ...project.clipDocument!, source: { fileName: 'source.clip', fileHash: 'hash', dataUrl: 'data:application/x-clip-studio;base64,AQID' } } }
}
function setup(source: CutProject = project(), id = 'still') {
  const props = { project: source, id, open: true, frame: 1 }
  const view = renderHook(({ project, id, open, frame }) => useClipLayerPreview(project, project.clipDocument!.nodes.find(node => node.id === id), 'cut-main', { frame, role: 'action', paperTrack: 'A' } as SheetHit, open), { initialProps: props })
  return { ...view, props }
}

it('reuses pixels and URL through static frame selection and unrelated edits while updating current labels', async () => {
  const { result, rerender, props } = setup()
  await waitFor(() => expect(result.current?.payload.imageUrl).toBe('blob:preview-0'))
  const renamed = updateClipLayer(props.project, 'other', { name: 'other renamed' })
  rerender({ ...props, project: renamed, frame: 20 })
  rerender({ ...props, project: updateClipLayer(renamed, 'still', { name: 'renamed still' }), frame: 25 })
  expect(result.current?.payload).toMatchObject({ displayName: 'renamed still', imageUrl: 'blob:preview-0' })
  expect(result.current?.payload.detailText).toContain('renamed still / 2048 × 1024px')
  expect(mocks.read).toHaveBeenCalledTimes(1)
  expect(mocks.read).toHaveBeenCalledWith(10)
  expect(createClipPreviewSession).toHaveBeenCalledWith(props.project.clipDocument!.source!.dataUrl, expect.any(AbortSignal))
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  rerender({ ...props, open: false })
  expect(result.current).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0')
})

it('replaces source pixels on a source change and ignores a late completion after closing', async () => {
  const { result, rerender, props } = setup()
  await waitFor(() => expect(result.current).not.toBeNull())
  let finish!: (value: unknown) => void
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const changed = { ...props.project, clipDocument: { ...props.project.clipDocument!, source: { ...props.project.clipDocument!.source!, dataUrl: 'data:application/x-clip-studio;base64,BAUG' } } }
  rerender({ ...props, project: changed })
  expect(result.current).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0')
  rerender({ ...props, project: changed, open: false })
  await act(async () => finish({ bytes: new Uint8Array([3]), width: 1, height: 1 }))
  expect(result.current).toBeNull()
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  expect(vi.mocked(createClipPreviewSession).mock.calls[1][1]?.aborted).toBe(true)
})

it('shares a single source reader for folder fallback and keeps exact images and per-layer notices', async () => {
  let source = project()
  const folder = { ...createClipNode('folder', 'folder', null, 'folder'), sourceLayerId: 30 }
  source = addClipLayers(source, [folder, { ...createClipNode('first', 'raster', folder.id, 'first'), sourceLayerId: 31 },
    { ...createClipNode('second', 'raster', folder.id, 'second'), sourceLayerId: 32 }])
  mocks.read.mockRejectedValueOnce(new Error('missing saved composite'))
    .mockResolvedValueOnce({ bytes: new Uint8Array([255, 0, 1]), width: 4096, height: 4096, warnings: ['unsupported effect'] })
    .mockRejectedValueOnce(new Error('missing material'))
  const { result, unmount } = setup(source, 'folder')
  await waitFor(() => expect(result.current?.payload.items).toHaveLength(2))
  expect(createClipPreviewSession).toHaveBeenCalledTimes(1)
  expect(mocks.read.mock.calls).toEqual([[30], [31], [32]])
  expect(result.current?.payload.items?.[0]).toMatchObject({ label: 'first', imageUrl: 'blob:preview-0' })
  expect(result.current?.notices).toEqual(['unsupported effect', '「second」: missing material'])
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([255, 0, 1]))
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})

it('follows animation timing, reuses held cels and clears blanks without changing the document', async () => {
  const folder = createClipNode('animation', 'animation', null, 'animation')
  const source = addClipLayers(project(), [folder,
    { ...createClipNode('001', 'raster', folder.id, 'cel1'), sourceLayerId: 21 },
    { ...createClipNode('002', 'raster', folder.id, 'cel2'), sourceLayerId: 22 }])
  source.clipDocument = { ...source.clipDocument!, timelineIds: { 'cut-main': 'timeline' }, sourceTimelines: [
    { id: 'timeline', name: 'take', fps: 24, startFrame: 0, endFrame: 24, tracks: [
      { layerId: folder.id, frames: [{ frame: 0, value: '001' }, { frame: 4, value: '002' }, { frame: 8, value: '' }] },
    ] },
  ] }
  const before = structuredClone(source)
  const { result, props, rerender } = setup(source, folder.id)
  await waitFor(() => expect(result.current?.payload.displayName).toBe('001'))
  rerender({ ...props, frame: 4 })
  expect(mocks.read).toHaveBeenCalledTimes(1)
  rerender({ ...props, frame: 5 })
  await waitFor(() => expect(result.current?.payload.displayName).toBe('002'))
  expect(mocks.read.mock.calls).toEqual([[21], [22]])
  rerender({ ...props, frame: 9 })
  await waitFor(() => expect(result.current?.notices).toEqual(['このフレームにセル指定はありません。']))
  expect(result.current?.payload.imageUrl).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  expect(source).toEqual(before)
})
