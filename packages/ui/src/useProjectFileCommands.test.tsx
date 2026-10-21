import { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useProjectFileCommands } from './useProjectFileCommands'
import { useProjectFileSession } from './useProjectFileSession'

const mocks = vi.hoisted(() => ({ native: false, open: vi.fn(), read: vi.fn() }))
vi.mock('@xsheet-remap/adapters', async original => ({ ...await original<typeof import('@xsheet-remap/adapters')>(),
  isTauriHost: () => mocks.native, openNativeDocumentFile: mocks.open, readNativeDocumentFile: mocks.read,
}))
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); mocks.native = false })

function setup() {
  const loadProject = vi.fn(), loadClip = vi.fn(), saveProject = vi.fn(), newProject = vi.fn()
  const hook = renderHook(() => {
    const session = useProjectFileSession()
    return useProjectFileCommands({ run: session.run, enabled: true, initialDirectory: 'D:\\shots', loadProject, loadClip, saveProject, newProject })
  })
  return { ...hook, loadProject, loadClip, saveProject, newProject }
}

it('shares file commands across Ctrl and Command shortcuts, retaining workspace Undo ownership', async () => {
  const state = setup()
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await waitFor(() => expect(state.saveProject).toHaveBeenCalledWith({ saveAs: false }))
  await act(async () => {})
  fireEvent.keyDown(window, { key: 'S', metaKey: true, shiftKey: true })
  await waitFor(() => expect(state.saveProject).toHaveBeenCalledWith({ saveAs: true }))
  await act(async () => {})
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
  await waitFor(() => expect(state.newProject).toHaveBeenCalledTimes(1))
  expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(true)
})

it('commits a focused inline editor before saving even when the editor stops key propagation', async () => {
  const saved = vi.fn()
  function Editor() {
    const [value, setValue] = useState('old')
    const session = useProjectFileSession()
    useProjectFileCommands({ run: session.run, enabled: true, loadProject: vi.fn(), loadClip: vi.fn(), newProject: vi.fn(), saveProject: async () => { saved(value) } })
    return <textarea aria-label="draft" defaultValue="old" onBlur={event => setValue(event.currentTarget.value)} onKeyDown={event => event.stopPropagation()} />
  }
  render(<Editor />)
  const editor = screen.getByLabelText('draft')
  act(() => editor.focus())
  fireEvent.change(editor, { target: { value: 'edited' } })
  fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
  await waitFor(() => expect(saved).toHaveBeenCalledWith('edited'))
})

it('does not execute during composition, repeat, Alt shortcuts, or a modal dialog', () => {
  const state = setup()
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }]) {
    fireEvent.keyDown(window, { key: 's', ctrlKey: true, ...extra })
  }
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal)
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
  modal.remove()
  expect(state.saveProject).not.toHaveBeenCalled()
  expect(mocks.open).not.toHaveBeenCalled()
})

it('serializes open/save/new operations and releases the lock after failure', async () => {
  const state = setup()
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  let reject!: (error: Error) => void
  state.saveProject.mockReturnValue(new Promise<void>((_, rejectOperation) => { reject = rejectOperation }))
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
  expect(state.saveProject).toHaveBeenCalledTimes(1)
  expect(state.newProject).not.toHaveBeenCalled()
  await act(async () => reject(new Error('failed')))
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
  await waitFor(() => expect(state.newProject).toHaveBeenCalledTimes(1))
})

it('routes native XSR drops through the path reader and leaves material drops to their owner', async () => {
  mocks.native = true
  const state = setup()
  const source = { file: new File([], 'cut.xsr'), nativePath: 'D:\\shots\\cut.xsr' }
  mocks.read.mockResolvedValue(source)
  act(() => expect(state.result.current.handleNativeProjectDrop([source.nativePath])).toBe(true))
  await waitFor(() => expect(state.loadProject).toHaveBeenCalledWith(source))
  expect(mocks.read).toHaveBeenCalledWith(source.nativePath, 'xsr')
  expect(state.result.current.handleNativeProjectDrop(['D:\\shots\\image.png'])).toBe(false)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  expect(state.result.current.handleNativeProjectDrop([source.nativePath, 'D:\\shots\\image.png'])).toBe(true)
  expect(mocks.read).toHaveBeenCalledTimes(1)
})

it('uses the native picker for Ctrl+O and CLIP, with cancellation leaving the document unchanged', async () => {
  mocks.native = true
  const state = setup()
  mocks.open.mockResolvedValue(null)
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
  await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('xsr', 'D:\\shots'))
  expect(state.loadProject).not.toHaveBeenCalled()
  await act(async () => {})
  const source = { file: new File([], 'cut.clip'), nativePath: 'D:\\shots\\cut.clip' }
  mocks.open.mockResolvedValue(source)
  act(() => state.result.current.handleOpenClip())
  await waitFor(() => expect(state.loadClip).toHaveBeenCalledWith(source))
})
