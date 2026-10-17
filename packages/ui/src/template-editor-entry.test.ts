import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTemplateEditor, requestTemplateEditor } from './template-editor-entry'

const native = vi.hoisted(() => ({ isTauriHost: vi.fn(), invokeDesktopCommand: vi.fn() }))
vi.mock('@xsheet-remap/adapters', () => native)
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('independent template editor entry', () => {
  it('uses the same native entry from Remap and Corrector without passing sheet state', async () => {
    native.isTauriHost.mockReturnValue(true)
    native.invokeDesktopCommand.mockResolvedValue(undefined)
    const open = vi.spyOn(window, 'open')
    await openTemplateEditor()
    expect(native.invokeDesktopCommand).toHaveBeenCalledExactlyOnceWith('open_template_editor')
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the template-only route at the current browser deployment subpath', async () => {
    native.isTauriHost.mockReturnValue(false)
    const before = window.location.href
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await openTemplateEditor()
    const expected = new URL(before)
    expected.search = '?app=template-editor'
    expected.hash = ''
    expect(open).toHaveBeenCalledExactlyOnceWith(expected.href, '_blank', 'noopener')
    expect(window.location.href).toBe(before)
    expect(native.invokeDesktopCommand).not.toHaveBeenCalled()
  })

  it('reports a missing companion executable without changing the caller', async () => {
    native.isTauriHost.mockReturnValue(true)
    native.invokeDesktopCommand.mockRejectedValue(new Error('xsheet-remap.exeを同じフォルダーに置いてください。'))
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    requestTemplateEditor()
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('同じフォルダー')))
  })
})
