import { afterEach, expect, it, vi } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, standardA3SheetTemplate } from '@xsheet-remap/core'
import { createAppProjectPersistenceActions } from './app-project-persistence-actions'
import type { ProjectFileLocation } from './projectFileLocation'

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), binary: vi.fn(), render: vi.fn() }))
vi.mock('@xsheet-remap/adapters', async original => ({ ...await original<typeof import('@xsheet-remap/adapters')>(), saveProjectFile: mocks.save, writeProjectFile: mocks.write }))
vi.mock('./app-foundation', async original => ({ ...await original<typeof import('./app-foundation')>(), saveBinaryOutputs: mocks.binary }))
vi.mock('./cleanSheetExport', async original => ({ ...await original<typeof import('./cleanSheetExport')>(), renderSheetImageExports: mocks.render }))
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks() })

function setup(location: ProjectFileLocation) {
  const project = createDefaultProject()
  const snapshot = vi.fn(), setLocation = vi.fn()
  const actions = createAppProjectPersistenceActions({
    projectDocument: createProjectDocumentFromCutProject(project), template: standardA3SheetTemplate, resolveProject: () => project,
    fileLocation: location, setFileLocation: setLocation, setSavedProjectDocumentSnapshot: snapshot,
    runtimeSourceImageUrls: {}, setSheetImageExportDraft: vi.fn(),
  })
  return { actions, snapshot, setLocation }
}

it('overwrites the opened XSR without showing a picker and marks only a successful save clean', async () => {
  const { actions, snapshot } = setup({ projectPath: 'D:\\shots\\renamed.xsr', sourcePath: null })
  mocks.write.mockResolvedValue({ saved: true, path: 'D:\\shots\\renamed.xsr' })
  await actions.handleSaveProjectFile()
  expect(mocks.write).toHaveBeenCalledWith('D:\\shots\\renamed.xsr', expect.any(Object), expect.any(Object))
  expect(mocks.save).not.toHaveBeenCalled()
  expect(snapshot).toHaveBeenCalledTimes(1)
  mocks.write.mockResolvedValue({ saved: false })
  await actions.handleSaveProjectFile()
  expect(snapshot).toHaveBeenCalledTimes(1)
})

it('uses the existing folder/name for Save As, and changes location only after success', async () => {
  const location = { projectPath: 'D:\\shots\\renamed.xsr', sourcePath: 'E:\\input\\original.clip' }
  const { actions, snapshot, setLocation } = setup(location)
  mocks.save.mockResolvedValueOnce({ saved: false }).mockResolvedValueOnce({ saved: true, path: 'F:\\new\\saved.xsr' })
  await actions.handleSaveProjectFile({ saveAs: true })
  expect(snapshot).not.toHaveBeenCalled()
  expect(setLocation).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalledWith(expect.any(Object), 'renamed.xsr', expect.objectContaining({ initialDirectory: 'D:\\shots' }))
  await actions.handleSaveProjectFile({ saveAs: true })
  expect(setLocation.mock.calls[0][0](location)).toEqual({ ...location, projectPath: 'F:\\new\\saved.xsr' })
  expect(mocks.write).not.toHaveBeenCalled()
})

it('uses the original CLIP folder for the first XSR save and image export', async () => {
  const { actions } = setup({ projectPath: null, sourcePath: 'D:\\CLIP source\\original.clip' })
  mocks.save.mockResolvedValue({ saved: true, path: 'D:\\CLIP source\\saved.xsr' })
  await actions.handleSaveProjectFile()
  expect(mocks.save).toHaveBeenCalledWith(expect.any(Object), expect.stringMatching(/\.xsr$/), expect.objectContaining({ initialDirectory: 'D:\\CLIP source' }))
  mocks.render.mockResolvedValue([{ fileName: 'sheet.jpg', bytes: Uint8Array.of(1), mimeType: 'image/jpeg' }])
  mocks.binary.mockResolvedValue(true)
  const { defaultSheetImageExportOptions } = await import('./cleanSheetExport')
  await actions.handleSaveSheetImageExport(defaultSheetImageExportOptions(createDefaultProject(), standardA3SheetTemplate, 'jpg'))
  expect(mocks.binary).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ initialDirectory: 'D:\\CLIP source' }))
})

it('leaves the location and saved snapshot intact after a failed write', async () => {
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  const { actions, snapshot, setLocation } = setup({ projectPath: 'D:\\cut.xsr', sourcePath: null })
  mocks.write.mockRejectedValue(new Error('disk full'))
  await actions.handleSaveProjectFile()
  expect(snapshot).not.toHaveBeenCalled()
  expect(setLocation).not.toHaveBeenCalled()
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('disk full'))
})
