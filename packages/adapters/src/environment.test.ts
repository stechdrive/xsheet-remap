import { describe, expect, it } from 'vitest'
import { isTauriLikeWindow } from './environment'

function hostWindow(hostname: string, internals?: unknown) {
  return {
    location: { hostname } as Location,
    __TAURI_INTERNALS__: internals,
  }
}

describe('adapter host environment', () => {
  it('detects the Tauri localhost host name', () => {
    expect(isTauriLikeWindow(hostWindow('tauri.localhost'))).toBe(true)
  })

  it('detects injected Tauri internals even when the host name differs', () => {
    expect(isTauriLikeWindow(hostWindow('localhost', {}))).toBe(true)
  })

  it('keeps normal browser windows out of the Tauri branch', () => {
    expect(isTauriLikeWindow(hostWindow('localhost'))).toBe(false)
  })
})
