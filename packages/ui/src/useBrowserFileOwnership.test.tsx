import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { commitHistory, createDefaultProject, createProjectDocumentFromCutProject, redoHistory, registerAsset, undoHistory } from '@xsheet-remap/core'
import { browserAssetBytes, browserFileForObjectUrl, fileToFileRef, releaseBrowserFileRefs } from '@xsheet-remap/adapters'
import { useAppShellState } from './app-shell-state'
import { useBrowserFileOwnership } from './useBrowserFileOwnership'

afterEach(async () => { cleanup(); await Promise.resolve(); vi.unstubAllGlobals() })
function urls() {
  let id = 0
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:history-${id++}`)
    static revokeObjectURL = vi.fn()
  })
}

it('protects actual workspace Undo/Redo and saved snapshots, then releases on replacement', async () => {
  urls()
  const { result, unmount } = renderHook(() => useAppShellState('remap'), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> })
  const file = new File(['original image'], 'A_001.png', { type: 'image/png' }), ref = await fileToFileRef(file)
  await act(async () => {
    result.current.setHistory(history => commitHistory(history, registerAsset(history.present, ref).project))
    result.current.releaseBrowserFilesAfterCommit(() => releaseBrowserFileRefs([ref]))
  })
  await act(async () => result.current.setHistory(undoHistory))
  expect(result.current.project.assets).toHaveLength(0)
  expect(browserFileForObjectUrl(ref.objectUrl)).toBe(file)
  await act(async () => result.current.setHistory(redoHistory))
  expect(new TextDecoder().decode((await browserAssetBytes(result.current.project.assets[0].thumbnailUrl))?.bytes)).toBe('original image')
  await act(async () => result.current.setSavedProjectDocumentSnapshot(createProjectDocumentFromCutProject(result.current.project)))
  const blank = createProjectDocumentFromCutProject(createDefaultProject())
  await act(async () => result.current.replaceProjectDocument(blank))
  expect(browserFileForObjectUrl(ref.objectUrl)).toBe(file)
  await act(async () => result.current.setSavedProjectDocumentSnapshot(blank))
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  unmount()
})

it('releases rejected and late imports even if the component unmounts before the commit', async () => {
  urls()
  const { result, unmount } = renderHook(() => useBrowserFileOwnership(null))
  const ref = await fileToFileRef(new File(['x'], 'A_001.png'))
  await act(async () => result.current(() => releaseBrowserFileRefs([ref])))
  expect(browserFileForObjectUrl(ref.objectUrl)).toBeUndefined()
  const late = await fileToFileRef(new File(['y'], 'A_002.png')), release = result.current
  unmount()
  release(() => releaseBrowserFileRefs([late])); await Promise.resolve()
  expect(browserFileForObjectUrl(late.objectUrl)).toBeUndefined()
})
