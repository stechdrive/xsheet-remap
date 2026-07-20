import { afterEach, describe, expect, it } from 'vitest'
import {
  loadMainWindowState,
  mainWindowStateStorageKey,
  saveMainWindowState,
  type DesktopBuildIdentity,
} from './mainWindowState'

afterEach(() => window.localStorage.clear())

describe('main window state persistence', () => {
  const developmentOne: DesktopBuildIdentity = { channel: 'development', sessionId: 'build-one' }
  const developmentTwo: DesktopBuildIdentity = { channel: 'development', sessionId: 'build-two' }
  const release: DesktopBuildIdentity = { channel: 'release' }

  it('restores state for repeated launches of the same development build', () => {
    saveMainWindowState('editor', { width: 1440, height: 880, maximized: false }, developmentOne)

    expect(loadMainWindowState('editor', developmentOne)).toEqual({
      width: 1440,
      height: 880,
      maximized: false,
      buildSessionId: 'build-one',
    })
  })

  it('ignores development state after a new build session', () => {
    saveMainWindowState('remap', { width: 1300, height: 800, maximized: true }, developmentOne)

    expect(loadMainWindowState('remap', developmentTwo)).toBeNull()
  })

  it('keeps release state stable and separate from development state', () => {
    saveMainWindowState('editor', { width: 1500, height: 900, maximized: true }, release)
    saveMainWindowState('editor', { width: 1200, height: 760, maximized: false }, developmentOne)

    expect(loadMainWindowState('editor', release)).toMatchObject({ width: 1500, height: 900, maximized: true })
    expect(mainWindowStateStorageKey('editor', release)).not.toBe(mainWindowStateStorageKey('editor', developmentOne))
  })

  it('rejects malformed and undersized stored values', () => {
    window.localStorage.setItem(mainWindowStateStorageKey('editor', release), JSON.stringify({
      width: 800,
      height: 600,
      maximized: false,
    }))

    expect(loadMainWindowState('editor', release)).toBeNull()
  })
})
