import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addBlankSharedCutToProjectDocument,
  createDefaultProject,
  createProjectDocumentFromCutProject,
  registerSheetSource,
  standardA3SheetTemplate,
  updateActiveCutProjectInDocument,
  type CutProject,
} from '@xsheet-remap/core'
import { createAppProjectPersistenceActions } from './app-project-persistence-actions'

const exportMocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  render: vi.fn(),
  saveGenerated: vi.fn(),
}))

vi.mock('./sheetImages', async importOriginal => ({
  ...(await importOriginal<typeof import('./sheetImages')>()),
  loadImage: exportMocks.loadImage,
}))

vi.mock('./correctedSheetImageExport', async importOriginal => ({
  ...(await importOriginal<typeof import('./correctedSheetImageExport')>()),
  renderCorrectedSheetImageExport: exportMocks.render,
}))

vi.mock('./app-foundation', async importOriginal => ({
  ...(await importOriginal<typeof import('./app-foundation')>()),
  saveGeneratedBinaryOutputs: exportMocks.saveGenerated,
}))

afterEach(() => {
  exportMocks.loadImage.mockReset()
  exportMocks.render.mockReset()
  exportMocks.saveGenerated.mockReset()
  vi.restoreAllMocks()
})

describe('corrected paper sheet persistence actions', () => {
  it('exports every assigned page from only the active cut in page order with collision-safe names', async () => {
    const project = correctedPaperProject()
    const outputs: Array<{ fileName: string; bytes: Uint8Array }> = []
    exportMocks.loadImage.mockResolvedValue({})
    exportMocks.render.mockImplementation(async (input: { sourceName: string; format: string }) => ({
      fileName: `${input.sourceName}.${input.format}`,
      bytes: Uint8Array.of(input.sourceName === 'first.png' ? 1 : 3),
      mimeType: 'image/png',
      extension: input.format,
    }))
    exportMocks.saveGenerated.mockImplementation(async (factories: Array<() => Promise<{ fileName: string; bytes: Uint8Array }>>) => {
      for (const createOutput of factories) outputs.push(await createOutput())
      return true
    })

    await persistenceActions(project).handleSaveCorrectedSheetImages('png')

    expect(exportMocks.loadImage).toHaveBeenCalledTimes(2)
    expect(exportMocks.render.mock.calls.map(call => call[0].sourceName)).toEqual(['first.png', 'third.png'])
    expect(exportMocks.render.mock.calls.map(call => call[0].format)).toEqual(['png', 'png'])
    expect(outputs.map(output => output.fileName)).toEqual([
      '_ACTIVE_paper-sheet01_corrected.png',
      '_ACTIVE_paper-sheet03_corrected.png',
    ])
    expect(outputs.map(output => [...output.bytes])).toEqual([[1], [3]])
    expect(exportMocks.saveGenerated).toHaveBeenCalledTimes(1)
  })

  it('preflights all assigned pages and starts no save when a registered image is unreadable', async () => {
    const project = correctedPaperProject({ thirdImageUrl: null })
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    exportMocks.loadImage.mockResolvedValue({})

    await persistenceActions(project).handleSaveCorrectedSheetImages('psd')

    expect(exportMocks.loadImage).toHaveBeenCalledTimes(1)
    expect(exportMocks.render).not.toHaveBeenCalled()
    expect(exportMocks.saveGenerated).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('3ページ'))
  })

  it('starts no render or save when a registered image URL can be resolved but no longer loads', async () => {
    const project = correctedPaperProject()
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    exportMocks.loadImage
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('missing file'))

    await persistenceActions(project).handleSaveCorrectedSheetImages('jpg')

    expect(exportMocks.loadImage).toHaveBeenCalledTimes(2)
    expect(exportMocks.render).not.toHaveBeenCalled()
    expect(exportMocks.saveGenerated).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('3ページ'))
  })
})

function persistenceActions(project: CutProject) {
  const inactive = inactivePaperProject()
  let document = createProjectDocumentFromCutProject(inactive)
  document = addBlankSharedCutToProjectDocument(document, inactive, { cut: { cut: 'ACTIVE' } })
  document = updateActiveCutProjectInDocument(document, project, { sheetTemplate: standardA3SheetTemplate })
  return createAppProjectPersistenceActions({
    projectDocument: document,
    template: standardA3SheetTemplate,
    resolveProject: () => project,
    projectFilePath: null,
    setProjectFilePath: vi.fn(),
    setProjectDocument: vi.fn(),
    setSavedProjectDocumentSnapshot: vi.fn(),
    runtimeSourceImageUrls: {},
    setSheetImageExportDraft: vi.fn(),
  })
}

function inactivePaperProject(): CutProject {
  const registered = registerSheetSource(createDefaultProject(), {
    name: 'inactive.png',
    size: 1,
    lastModified: 9,
    assetPath: 'data:image/png;base64,CQ==',
  })
  return {
    ...registered.project,
    cut: { ...registered.project.cut, cut: 'INACTIVE' },
    sheetView: {
      ...registered.project.sheetView,
      pages: registered.project.sheetView.pages.map((page, index) => index === 0
        ? { ...page, sourceId: registered.source.sourceId }
        : page),
    },
  }
}

function correctedPaperProject(options: { thirdImageUrl?: string | null } = {}): CutProject {
  const first = registerSheetSource(createDefaultProject(), {
    name: 'first.png',
    size: 1,
    lastModified: 1,
    assetPath: 'data:image/png;base64,AQ==',
  })
  const third = registerSheetSource(first.project, {
    name: 'third.png',
    size: 1,
    lastModified: 3,
    ...(options.thirdImageUrl === null ? {} : { assetPath: options.thirdImageUrl ?? 'data:image/png;base64,Aw==' }),
  })
  const unused = registerSheetSource(third.project, {
    name: 'unused.png',
    size: 1,
    lastModified: 4,
    assetPath: 'data:image/png;base64,BA==',
  })
  const alignment = unused.project.sheetView.pages[0].alignment
  return {
    ...unused.project,
    cut: { ...unused.project.cut, cut: 'ACTIVE' },
    sheetView: {
      ...unused.project.sheetView,
      pages: [
        { pageId: 'page_3', sourceId: third.source.sourceId, alignment },
        { pageId: 'page_1', sourceId: first.source.sourceId, alignment },
      ],
    },
  }
}
