import { describe, expect, it } from 'vitest'
import { createDefaultProject, registerAssetRoot } from '@xsheet-remap/core'
import { preferredSaveDirectory } from './app-foundation'
import { fileParentDirectory, projectSaveFileName } from './projectFileLocation'

describe('document location defaults', () => {
  it('prefers the current XSR, then the imported CLIP, then the material root', () => {
    const project = registerAssetRoot(createDefaultProject(), { label: 'assets', path: 'D:\\assets' }).project
    expect(preferredSaveDirectory(project, { projectPath: 'D:\\project\\cut.xsr', sourcePath: 'E:\\clips\\cut.clip' })).toBe('D:\\project')
    expect(preferredSaveDirectory(project, { projectPath: null, sourcePath: 'E:\\clips\\cut.clip' })).toBe('E:\\clips')
    expect(preferredSaveDirectory(project, { projectPath: null, sourcePath: null })).toBe('D:\\assets')
    expect(preferredSaveDirectory(createDefaultProject(), { projectPath: null, sourcePath: null })).toBeUndefined()
  })
  it.each([
    ['C:\\cut.xsr', 'C:\\'], ['/cut.xsr', '/'], ['D:/日本語/cut.xsr', 'D:/日本語'],
    ['\\\\studio\\cuts\\cut.xsr', '\\\\studio\\cuts'], ['\\\\?\\C:\\cut.xsr', 'C:\\'],
  ])('keeps a usable parent for %s', (path, directory) => { expect(fileParentDirectory(path)).toBe(directory) })
  it('retains the current filename for Save As and uses the proposed name for a new document', () => {
    expect(projectSaveFileName({ projectPath: 'D:\\cuts\\custom.xsr', sourcePath: null }, 'generated.xsr')).toBe('custom.xsr')
    expect(projectSaveFileName({ projectPath: null, sourcePath: 'D:\\cuts\\input.clip' }, 'generated.xsr')).toBe('generated.xsr')
  })
})
