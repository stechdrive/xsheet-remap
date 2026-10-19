import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { FileRef } from '@xsheet-remap/core'
import { browserAssetBytes, browserFileForObjectUrl, createBrowserFileOwner, filesToFileRefs, fileToFileRef, releaseBrowserFileRefs, retainBrowserFiles } from './browserFiles'

let refs: FileRef[], owners: ReturnType<typeof createBrowserFileOwner>[]
beforeEach(() => {
  refs = []; owners = []
  let count = 0
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:owned-${count++}`)
    static revokeObjectURL = vi.fn()
  })
})
afterEach(async () => {
  owners.forEach(owner => owner.dispose()); releaseBrowserFileRefs(refs)
  await Promise.resolve(); vi.unstubAllGlobals()
})
async function file() {
  const ref = await fileToFileRef(new File([new Uint8Array([0, 1, 255])], 'A_001.png', { type: 'image/png' }))
  refs.push(ref); return ref
}
function owner() { const result = createBrowserFileOwner(); owners.push(result); return result }

it('retains producer inputs through asynchronous preparation, then revokes unused URLs and Files', async () => {
  const ref = await file(), workspace = owner()
  workspace.update({ assets: [] }); await Promise.resolve()
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeDefined()
  releaseBrowserFileRefs([ref]); await Promise.resolve()
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(ref.objectUrl)
})

it('keeps original bytes in Undo, Redo, saved snapshots and in-flight exports until the last owner releases', async () => {
  const ref = await file(), snapshot = { assets: [{ thumbnailUrl: ref.objectUrl }] }, workspace = owner(), saved = owner()
  workspace.update({ past: [snapshot], present: {}, future: [] }); saved.update(snapshot)
  releaseBrowserFileRefs([ref]); await Promise.resolve()
  workspace.update({ past: [], present: {}, future: [snapshot] }); await Promise.resolve()
  expect((await browserAssetBytes(ref.objectUrl))?.bytes).toEqual(new Uint8Array([0, 1, 255]))
  workspace.update({ past: [], present: snapshot, future: [] }); await Promise.resolve()
  const finishExport = retainBrowserFiles(snapshot)
  workspace.update({}); saved.dispose(); await Promise.resolve()
  expect((await browserAssetBytes(ref.objectUrl))?.bytes).toEqual(new Uint8Array([0, 1, 255]))
  finishExport(); await Promise.resolve()
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})

it('does not revoke between an effect cleanup and setup on the same committed snapshot', async () => {
  const ref = await file(), workspace = owner(), snapshot = { ref }
  workspace.update(snapshot); releaseBrowserFileRefs([ref])
  workspace.dispose(); workspace.update(snapshot); await Promise.resolve()
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeDefined()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
})

it('bounds simultaneous full-file reads to two while keeping original input order and hashes', async () => {
  const finish: Array<() => void> = []
  let active = 0, peak = 0
  const files = [0, 1, 2, 3, 4].map(i => {
    const file = new File([Uint8Array.of(i)], `A_00${i}.png`)
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(resolve => {
      active++; peak = Math.max(peak, active)
      finish[i] = () => { active--; resolve(Uint8Array.of(i).buffer) }
    }))
    return file
  })
  const batch = filesToFileRefs(files)
  await waitFor(() => expect(finish.filter(Boolean)).toHaveLength(2))
  finish[1](); await waitFor(() => expect(finish[2]).toBeDefined())
  finish[2](); await waitFor(() => expect(finish[3]).toBeDefined())
  finish[0](); finish[3](); await waitFor(() => expect(finish[4]).toBeDefined()); finish[4]()
  refs = await batch
  expect(peak).toBe(2)
  expect(refs.map(ref => ref.name)).toEqual(files.map(file => file.name))
  expect(new Set(refs.map(ref => ref.contentHash)).size).toBe(5)
})

it('rolls back partially hashed batches and does not register the failing file', async () => {
  const good = new File(['good'], 'good.png'), bad = new File(['bad'], 'bad.png'), unused = new File(['unused'], 'unused.png')
  vi.spyOn(bad, 'arrayBuffer').mockRejectedValue(new Error('read failed'))
  const unusedRead = vi.spyOn(unused, 'arrayBuffer')
  await expect(filesToFileRefs([good, bad, unused])).rejects.toThrow('read failed')
  await Promise.resolve()
  expect(unusedRead).not.toHaveBeenCalled()
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  expect(browserFileForObjectUrl('blob:owned-0')).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0')
})
