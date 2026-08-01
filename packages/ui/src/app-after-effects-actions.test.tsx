import { act, renderHook, waitFor } from '@testing-library/react'
import { createDefaultProject, type AeRemapPlan } from '@xsheet-remap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAeRemapDiagnostics, isWindowsTauriAfterEffectsHost, useAppAfterEffectsActions } from './app-after-effects-actions'
import { uiText } from './i18n'

const adapterMocks = vi.hoisted(() => ({
  isTauriHost: vi.fn(),
  saveTextFile: vi.fn(),
  sendAfterEffectsRemap: vi.fn(),
  writeClipboardText: vi.fn(),
}))

vi.mock('@xsheet-remap/adapters', async importOriginal => ({
  ...(await importOriginal<typeof import('@xsheet-remap/adapters')>()),
  ...adapterMocks,
}))

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(navigator, 'platform')
const originalUserAgentDataDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgentData')

beforeEach(() => {
  adapterMocks.isTauriHost.mockReturnValue(true)
  adapterMocks.saveTextFile.mockResolvedValue({ saved: true, path: 'D:\\exports\\cut_ae-remap.jsx' })
  adapterMocks.sendAfterEffectsRemap.mockResolvedValue({ accepted: true })
  adapterMocks.writeClipboardText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'Windows' } })
})

afterEach(() => {
  vi.clearAllMocks()
  if (originalPlatformDescriptor) Object.defineProperty(navigator, 'platform', originalPlatformDescriptor)
  else Reflect.deleteProperty(navigator, 'platform')
  if (originalUserAgentDataDescriptor) Object.defineProperty(navigator, 'userAgentData', originalUserAgentDataDescriptor)
  else Reflect.deleteProperty(navigator, 'userAgentData')
})

function renderActions() {
  const project = createDefaultProject()
  const setExportOperationNotice = vi.fn()
  const onSendAccepted = vi.fn()
  const hook = renderHook(() => useAppAfterEffectsActions({
    project,
    resolveProject: () => project,
    setExportOperationNotice,
    onSendAccepted,
  }))
  return { ...hook, setExportOperationNotice, onSendAccepted }
}

describe('After Effects UI actions', () => {
  it('copies display-language-specific Keyframe Data for an English AE host', async () => {
    const { result } = renderActions()

    await act(() => result.current.handleCopyAeKeyframeData('A', 'cell', 'en'))

    expect(adapterMocks.writeClipboardText).toHaveBeenCalledWith(expect.stringContaining('Effects\tVenetian Blinds #1'))
  })

  it('saves a self-contained JSX with the AE extension and reports success', async () => {
    const { result, setExportOperationNotice } = renderActions()

    await act(() => result.current.handleSaveAeJsx('cell'))

    expect(adapterMocks.saveTextFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/_ae-remap\.jsx$/),
      'text/javascript;charset=utf-8',
      expect.objectContaining({ extensions: ['jsx'], defaultExtension: 'jsx' }),
    )
    expect(setExportOperationNotice).toHaveBeenCalledWith({ message: uiText.afterEffects.jsxSaved })
  })

  it('prevents duplicate sends and reports the accepted send exactly once', async () => {
    let acceptSend: ((value: { accepted: true }) => void) | undefined
    adapterMocks.sendAfterEffectsRemap.mockImplementation(() => new Promise(resolve => { acceptSend = resolve }))
    const { result, setExportOperationNotice, onSendAccepted } = renderActions()
    let firstSend: Promise<void> | undefined
    let duplicateSend: Promise<void> | undefined

    act(() => {
      firstSend = result.current.handleSendAfterEffects('action')
      duplicateSend = result.current.handleSendAfterEffects('action')
    })
    await waitFor(() => expect(adapterMocks.sendAfterEffectsRemap).toHaveBeenCalledOnce())
    expect(adapterMocks.sendAfterEffectsRemap).toHaveBeenCalledWith(expect.objectContaining({ schema: 'xsheet-remap-after-effects-remap-v1' }))
    expect(result.current.afterEffectsSending).toBe(true)

    await act(async () => {
      acceptSend?.({ accepted: true })
      await Promise.all([firstSend, duplicateSend])
    })
    expect(setExportOperationNotice).toHaveBeenCalledTimes(1)
    expect(setExportOperationNotice).toHaveBeenCalledWith({ message: '送信しました。AE側で適用内容を確認してください' })
    expect(onSendAccepted).toHaveBeenCalledOnce()
    expect(result.current.afterEffectsSending).toBe(false)
  })

  it('recognizes only a Windows Tauri host as a direct-send target', () => {
    expect(isWindowsTauriAfterEffectsHost()).toBe(true)

    adapterMocks.isTauriHost.mockReturnValue(false)
    expect(isWindowsTauriAfterEffectsHost()).toBe(false)

    adapterMocks.isTauriHost.mockReturnValue(true)
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'macOS' } })
    expect(isWindowsTauriAfterEffectsHost()).toBe(false)
  })

  it('shows localized conversion diagnostics and allows cancellation', () => {
    const plan = {
      compFps: 24,
      sourceFps: 24,
      frameOrigin: 1,
      durationFrames: 24,
      interpolation: 'hold',
      emptyCells: 'explicit',
      columns: [],
      diagnostics: [{
        severity: 'warning',
        code: 'ae-remap.special-hold',
        message: 'internal message',
        paperTrack: 'A',
        sheetFrame: 12,
        keyId: 'key-1',
        value: 'reverse',
      }],
    } satisfies AeRemapPlan
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)

    expect(confirmAeRemapDiagnostics(plan)).toBe(false)
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining('A 12F: 逆シート記号は直前の値をHOLDします。'))
    confirmation.mockRestore()
  })
})
