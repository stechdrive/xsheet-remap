import { describe, expect, it } from 'vitest'
import { nativeFileSystemPathKey, normalizeNativeFileSystemPath } from './native-paths'

describe('native file-system paths', () => {
  it('removes Windows device prefixes from drive and UNC paths', () => {
    expect(normalizeNativeFileSystemPath('\\\\?\\C:\\cuts\\C001')).toBe('C:\\cuts\\C001')
    expect(normalizeNativeFileSystemPath('\\\\?\\UNC\\server\\share\\C001')).toBe('\\\\server\\share\\C001')
    expect(normalizeNativeFileSystemPath('//?/C:/cuts/C001')).toBe('C:/cuts/C001')
    expect(normalizeNativeFileSystemPath('//?/UNC/server/share/C001')).toBe('//server/share/C001')
  })

  it('leaves ordinary Windows, POSIX, and browser paths unchanged', () => {
    expect(normalizeNativeFileSystemPath('C:\\cuts\\C001')).toBe('C:\\cuts\\C001')
    expect(normalizeNativeFileSystemPath('\\\\server\\share\\C001')).toBe('\\\\server\\share\\C001')
    expect(normalizeNativeFileSystemPath('/projects/C001')).toBe('/projects/C001')
    expect(normalizeNativeFileSystemPath('assets/C001.png')).toBe('assets/C001.png')
  })

  it('compares prefixed and ordinary Windows paths as the same path', () => {
    expect(nativeFileSystemPathKey('\\\\?\\C:\\Cuts\\C001')).toBe(nativeFileSystemPathKey('c:/cuts/c001'))
    expect(nativeFileSystemPathKey('\\\\?\\UNC\\SERVER\\Share\\C001')).toBe(nativeFileSystemPathKey('\\\\server\\share\\c001'))
  })
})
