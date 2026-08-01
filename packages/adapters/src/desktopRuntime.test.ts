import type { AeRemapJsxConfig } from '@xsheet-remap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendAfterEffectsRemap, writeClipboardText } from './desktopRuntime'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const CONFIG: AeRemapJsxConfig = {
  schema: 'xsheet-remap-after-effects-remap-v1',
  plan: {
    compFps: 24,
    sourceFps: 24,
    durationFrames: 24,
    columns: [{
      id: 'A',
      name: 'A',
      keys: [{ frame: 0, empty: false, cellNumber: 1 }],
    }],
  },
  options: {
    dialogTitle: 'XSHEET Remap - Map Layers',
    undoGroupName: 'Apply XSHEET Time Remap',
    managedBlankEffectName: 'XSHEET Remap Blank',
  },
}

describe('desktop After Effects adapters', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  })

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('sends only the structured remap config through the fixed desktop command', async () => {
    invokeMock.mockResolvedValue({ accepted: true })

    await expect(sendAfterEffectsRemap(CONFIG)).resolves.toEqual({ accepted: true })
    expect(invokeMock).toHaveBeenCalledWith('send_after_effects_remap', { config: CONFIG })
  })

  it('writes clipboard text through the browser clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await writeClipboardText('Adobe After Effects 9.0 Keyframe Data')
    expect(writeText).toHaveBeenCalledWith('Adobe After Effects 9.0 Keyframe Data')
  })

  it('reports when clipboard writing is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })

    await expect(writeClipboardText('data')).rejects.toThrow('クリップボード')
  })
})
