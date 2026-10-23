import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeDragDropPayload } from '@xsheet-remap/adapters'
import { useAppController } from './app-shell-controller'
import { clearNativeFileDragPreview } from './nativeFileDragPreview'

const native = vi.hoisted(() => ({ receive: undefined as undefined | ((payload: NativeDragDropPayload, source: string) => void), read: vi.fn() }))
vi.mock('./useNativeFileDropEvents', () => ({ useNativeFileDropEvents: (receive: typeof native.receive) => { native.receive = receive } }))
vi.mock('@xsheet-remap/adapters', async original => ({ ...await original<typeof import('@xsheet-remap/adapters')>(), readNativeDocumentFile: native.read }))
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
afterEach(() => {
  cleanup(); clearNativeFileDragPreview(); vi.restoreAllMocks(); native.read.mockReset()
  if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

it('routes native CLIP independently of material targets and clears feedback between document and image drags', async () => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
  const { result } = renderHook(() => useAppController({ appKind: 'remap' }))
  act(() => result.current.handleWorkModeChange('clip'))
  const send = (type: NativeDragDropPayload['type'], paths?: string[]) => act(() => native.receive!({ type, paths, position: { x: 100, y: 100 } }, 'test'))
  send('enter', ['cut.CLIP'])
  expect(result.current.statusHintText).toBe('CLIPを開きます')
  expect(document.querySelector('.nativeFileDragPreview')).toBeNull()
  send('over')
  expect(result.current.statusHintText).toBe('CLIPを開きます')
  // A new enter supplies authoritative paths, even if no leave was delivered.
  send('enter', ['001.png'])
  expect(document.querySelector('.nativeFileDragPreview')?.textContent).toContain('001.png')
  expect(result.current.statusHintText).not.toBe('CLIPを開きます')
  send('enter', ['cut.CLIP'])
  expect(document.querySelector('.nativeFileDragPreview')).toBeNull()
  const source = { file: new File([], 'cut.CLIP'), nativePath: 'cut.CLIP' }
  native.read.mockResolvedValue(source)
  send('drop', ['cut.CLIP'])
  await waitFor(() => expect(result.current.clipImportFile).toEqual(source))
  expect(native.read).toHaveBeenCalledExactlyOnceWith('cut.CLIP', 'clip')
  expect(result.current.statusHintText).not.toBe('CLIPを開きます')
  send('leave')
  expect(document.querySelector('.nativeFileDragPreview')).toBeNull()
})
