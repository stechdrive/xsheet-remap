import { useEffect } from 'react'
import {
  configureCurrentNativeWindow,
  currentNativeWindowState,
  isTauriHost,
  watchCurrentNativeWindowSize,
} from '@xsheet-remap/adapters'
import type { MainAppKind } from './app-foundation'

export const MAIN_WINDOW_DEFAULTS = {
  width: 1680,
  height: 960,
  minWidth: 1024,
  minHeight: 720,
} as const

export interface DesktopBuildIdentity {
  channel: 'development' | 'release'
  sessionId?: string
}

export interface SavedMainWindowState {
  width: number
  height: number
  maximized: boolean
  buildSessionId?: string
}

export const CURRENT_DESKTOP_BUILD: DesktopBuildIdentity = currentDesktopBuildIdentity()

export function mainWindowStateStorageKey(appKind: MainAppKind, build: DesktopBuildIdentity): string {
  return build.channel === 'development'
    ? `xsheet:${appKind}:main-window-state:development`
    : `xsheet:${appKind}:main-window-state`
}

export function loadMainWindowState(
  appKind: MainAppKind,
  build: DesktopBuildIdentity = CURRENT_DESKTOP_BUILD,
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): SavedMainWindowState | null {
  try {
    const raw = storage?.getItem(mainWindowStateStorageKey(appKind, build))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const state: SavedMainWindowState = {
      width: typeof record.width === 'number' ? Math.round(record.width) : 0,
      height: typeof record.height === 'number' ? Math.round(record.height) : 0,
      maximized: record.maximized === true,
      buildSessionId: typeof record.buildSessionId === 'string' ? record.buildSessionId : undefined,
    }
    if (!isValidMainWindowState(state)) return null
    if (build.channel === 'development' && state.buildSessionId !== build.sessionId) return null
    return state
  } catch {
    return null
  }
}

export function saveMainWindowState(
  appKind: MainAppKind,
  state: Omit<SavedMainWindowState, 'buildSessionId'>,
  build: DesktopBuildIdentity = CURRENT_DESKTOP_BUILD,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  if (!isValidMainWindowState(state)) return
  try {
    storage?.setItem(mainWindowStateStorageKey(appKind, build), JSON.stringify({
      ...state,
      ...(build.channel === 'development' ? { buildSessionId: build.sessionId } : {}),
    }))
  } catch {
    // Window persistence must never block application startup or resizing.
  }
}

export function useMainWindowState(appKind: MainAppKind): void {
  useEffect(() => {
    if (!isTauriHost()) return undefined
    let disposed = false
    let saveTimer: number | undefined
    let unlisten: (() => void) | undefined
    const saved = loadMainWindowState(appKind)
    let normalSize = {
      width: saved?.width ?? MAIN_WINDOW_DEFAULTS.width,
      height: saved?.height ?? MAIN_WINDOW_DEFAULTS.height,
    }

    async function saveCurrentState() {
      try {
        const current = await currentNativeWindowState()
        if (disposed) return
        if (!current.maximized) {
          normalSize = { width: current.width, height: current.height }
        }
        saveMainWindowState(appKind, { ...normalSize, maximized: current.maximized })
      } catch {
        // Native window state is unavailable in browser previews.
      }
    }

    function scheduleSave() {
      if (disposed) return
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => void saveCurrentState(), 250)
    }

    void configureCurrentNativeWindow({
      ...MAIN_WINDOW_DEFAULTS,
      width: normalSize.width,
      height: normalSize.height,
      center: false,
      maximized: saved?.maximized ?? false,
    })
      .then(() => watchCurrentNativeWindowSize(scheduleSave))
      .then(stopWatching => {
        if (disposed) {
          stopWatching()
          return
        }
        unlisten = stopWatching
        scheduleSave()
      })
      .catch(() => {
        // The configured Tauri window remains usable if optional persistence fails.
      })

    return () => {
      disposed = true
      if (saveTimer) window.clearTimeout(saveTimer)
      unlisten?.()
    }
  }, [appKind])
}

export function isValidMainWindowState(state: Pick<SavedMainWindowState, 'width' | 'height'>): boolean {
  return Number.isFinite(state.width)
    && Number.isFinite(state.height)
    && state.width >= MAIN_WINDOW_DEFAULTS.minWidth
    && state.height >= MAIN_WINDOW_DEFAULTS.minHeight
    && state.width <= 16_384
    && state.height <= 16_384
}

function currentDesktopBuildIdentity(): DesktopBuildIdentity {
  const configuredChannel = import.meta.env.VITE_XSHEET_BUILD_CHANNEL
  const channel = configuredChannel === 'development' || import.meta.env.DEV
    ? 'development'
    : 'release'
  const configuredSession = import.meta.env.VITE_XSHEET_BUILD_SESSION?.trim()
  return {
    channel,
    ...(channel === 'development' ? { sessionId: configuredSession || 'tauri-dev' } : {}),
  }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}
