import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRemapHelp, readRemapHelpLocation, remapHelpUrl } from './remap-help-entry'

const native = vi.hoisted(() => ({ isTauriHost: vi.fn(), invokeDesktopCommand: vi.fn() }))
vi.mock('@xsheet-remap/adapters', () => native)
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); window.history.replaceState(null, '', '/') })

describe('independent Remap help', () => {
  it('keeps the deployment subpath and reading position without carrying editor parameters', async () => {
    native.isTauriHost.mockReturnValue(false)
    window.history.replaceState(null, '', '/xsheet-remap/?app=template-editor&diagnostic=ink#draft')
    const before = window.location.href
    const opened = { opener: window } as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(opened)
    const location = { topic: 'template', view: 'detailed', chapter: 'save' } as const
    await openRemapHelp(location)
    expect(open).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/xsheet-remap/?app=help&topic=template&view=detailed&chapter=save`, '_blank')
    expect(opened.opener).toBeNull()
    expect(window.location.href).toBe(before)
    expect(readRemapHelpLocation(new URL(open.mock.calls[0][0]!.toString()).search)).toEqual(location)
  })

  it('opens the native help window at the current chapter', async () => {
    native.isTauriHost.mockReturnValue(true)
    native.invokeDesktopCommand.mockResolvedValue(undefined)
    const open = vi.spyOn(window, 'open')
    const location = { topic: 'sheet', view: 'detailed', chapter: 'sound' } as const
    await openRemapHelp(location)
    expect(native.invokeDesktopCommand).toHaveBeenCalledExactlyOnceWith('open_help_window', { location })
    expect(open).not.toHaveBeenCalled()
  })

  it('reports blocked popups and native failures so the caller can retain its guide', async () => {
    const location = { topic: 'clip', view: 'quick' } as const
    native.isTauriHost.mockReturnValue(false)
    vi.spyOn(window, 'open').mockReturnValue(null)
    await expect(openRemapHelp(location)).rejects.toThrow('ポップアップ')
    native.isTauriHost.mockReturnValue(true)
    native.invokeDesktopCommand.mockRejectedValue(new Error('window unavailable'))
    await expect(openRemapHelp(location)).rejects.toThrow('window unavailable')
  })

  it('falls back for unknown topics and views and safely encodes chapter names', () => {
    expect(readRemapHelpLocation('?topic=unknown&view=unknown')).toEqual({ topic: 'sheet', view: 'quick' })
    const location = { topic: 'clip', view: 'detailed', chapter: 'io&app=remap#other' } as const
    const url = remapHelpUrl(location)
    expect(url.searchParams.get('app')).toBe('help')
    expect(url.hash).toBe('')
    expect(readRemapHelpLocation(url.search)).toEqual(location)
  })
})
