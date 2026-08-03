import { createDefaultProject, registerSheetSource, standardA3SheetTemplate } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { correctedOutputName, correctedSheetImageExportPlan, renderCorrectedSheetImageExport, resolveTemplateUnderlayDrawRect } from './correctedSheetImageExport'
import { defaultSheetImageSettings } from './sheetImages'

const sheetImageMocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  warpSheetImageDataAsync: vi.fn(),
}))

vi.mock('./sheetImages', async importOriginal => ({
  ...(await importOriginal<typeof import('./sheetImages')>()),
  loadImage: sheetImageMocks.loadImage,
  warpSheetImageDataAsync: sheetImageMocks.warpSheetImageDataAsync,
}))

afterEach(() => {
  vi.restoreAllMocks()
  sheetImageMocks.loadImage.mockReset()
  sheetImageMocks.warpSheetImageDataAsync.mockReset()
})

describe('corrected paper sheet image export', () => {
  it('uses the corrector-compatible PSD name and distinct raster names', () => {
    expect(correctedOutputName('sheet.001.JPG', 'psd')).toBe('sheet.001.psd')
    expect(correctedOutputName('sheet.001.JPG', 'png')).toBe('sheet.001_corrected.png')
    expect(correctedOutputName('sheet.001.JPG', 'jpg')).toBe('sheet.001_corrected.jpg')
  })

  it('supports source names without an extension', () => {
    expect(correctedOutputName('sheet', 'psd')).toBe('sheet.psd')
    expect(correctedOutputName('sheet', 'jpg')).toBe('sheet_corrected.jpg')
  })

  it('selects every assigned scan in sheet page order while preserving omitted page numbers', () => {
    const first = registerSheetSource(createDefaultProject(), { name: 'first.png', size: 1, lastModified: 1 })
    const third = registerSheetSource(first.project, { name: 'third.png', size: 1, lastModified: 2 })
    const unused = registerSheetSource(third.project, { name: 'unused.png', size: 1, lastModified: 3 })
    const alignment = unused.project.sheetView.pages[0].alignment
    const project = {
      ...unused.project,
      sheetView: {
        ...unused.project.sheetView,
        pages: [
          { pageId: 'page_3', sourceId: third.source.sourceId, alignment },
          { pageId: 'page_1', sourceId: first.source.sourceId, alignment },
        ],
      },
    }

    const plan = correctedSheetImageExportPlan(project, standardA3SheetTemplate)
    expect(plan.totalPages).toBe(3)
    expect(plan.pages.map(page => ({
      pageId: page.pageId,
      pageIndex: page.pageIndex,
      sourceName: page.source.imageRef.name,
    }))).toEqual([
      { pageId: 'page_1', pageIndex: 0, sourceName: 'first.png' },
      { pageId: 'page_3', pageIndex: 2, sourceName: 'third.png' },
    ])
  })

  it('assigns collision-free page numbers when legacy page IDs resolve to the same index', () => {
    const canonical = registerSheetSource(createDefaultProject(), { name: 'canonical.png', size: 1, lastModified: 1 })
    const legacy = registerSheetSource(canonical.project, { name: 'legacy.png', size: 1, lastModified: 2 })
    const alignment = legacy.project.sheetView.pages[0].alignment
    const project = {
      ...legacy.project,
      sheetView: {
        ...legacy.project.sheetView,
        pages: [
          { pageId: 'page_01', sourceId: legacy.source.sourceId, alignment },
          { pageId: 'page_1', sourceId: canonical.source.sourceId, alignment },
        ],
      },
    }

    const plan = correctedSheetImageExportPlan(project, standardA3SheetTemplate)
    expect(plan.pages.map(page => ({ pageIndex: page.pageIndex, sourceName: page.source.imageRef.name }))).toEqual([
      { pageIndex: 0, sourceName: 'canonical.png' },
      { pageIndex: 1, sourceName: 'legacy.png' },
    ])
  })

  it('keeps a custom template underlay placement aligned in the PSD template layer', () => {
    const template = testTemplate(100, 200)
    template.defaultUnderlay = {
      ...standardA3SheetTemplate.defaultUnderlay!,
      placement: {
        mode: 'pixel-exact',
        sourceWidthPx: 30,
        sourceHeightPx: 80,
        offsetXPx: 10,
        offsetYPx: 20,
        renderedWidthPx: 30,
        renderedHeightPx: 80,
      },
    }

    expect(resolveTemplateUnderlayDrawRect(template, 200, 100)).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 40,
    })
  })

  it('places an uncalibrated source with its stored page alignment', async () => {
    const image = {} as HTMLImageElement
    const imageData = testImageData(100, 200, [12, 34, 56, 255])
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => imageData)
    const putImageData = vi.fn()
    sheetImageMocks.loadImage.mockResolvedValue(image)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce({ drawImage, getImageData } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce({ putImageData } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AQ==')

    const result = await renderCorrectedSheetImageExport({
      sourceName: 'sheet.png',
      imageUrl: 'blob:sheet',
      imageSettings: {
        ...defaultSheetImageSettings(),
        x: 0.125,
        y: -0.25,
        scale: 0.75,
        levelCorrection: disabledLevelCorrection(),
      },
      template: testTemplate(100, 200),
      format: 'png',
    })

    expect(drawImage).toHaveBeenCalledWith(image, 12.5, -50, 75, 150)
    expect(getImageData).toHaveBeenCalledWith(0, 0, 100, 200)
    expect(putImageData).toHaveBeenCalledWith(imageData, 0, 0)
    expect(result.bytes).toEqual(Uint8Array.of(1))
  })

  it('uses stored page alignment when enabled calibration has fewer than four points', async () => {
    const image = {} as HTMLImageElement
    const imageData = testImageData(100, 200, [12, 34, 56, 255])
    const drawImage = vi.fn()
    sheetImageMocks.loadImage.mockResolvedValue(image)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce({ drawImage, getImageData: vi.fn(() => imageData) } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce({ putImageData: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AQ==')

    await renderCorrectedSheetImageExport({
      sourceName: 'sheet.png',
      imageUrl: 'blob:sheet',
      imageSettings: {
        ...defaultSheetImageSettings(),
        x: 0.125,
        y: -0.25,
        scale: 0.75,
        calibration: {
          enabled: true,
          points: [0, 1, 2].map(index => ({
            pointId: `point_${index}`,
            label: `${index}`,
            source: { x: index / 4, y: index / 4 },
            target: { x: index / 4, y: index / 4 },
          })),
        },
        levelCorrection: disabledLevelCorrection(),
      },
      template: testTemplate(100, 200),
      format: 'png',
    })

    expect(sheetImageMocks.warpSheetImageDataAsync).not.toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalledWith(image, 12.5, -50, 75, 150)
  })

  it('flattens transparent pixels onto white when encoding JPEG', async () => {
    const imageData = testImageData(2, 1, [20, 40, 60, 128])
    const fillRect = vi.fn()
    const drawFlattenedImage = vi.fn()
    const jpegContext = {
      fillStyle: '',
      fillRect,
      drawImage: drawFlattenedImage,
    }
    sheetImageMocks.loadImage.mockResolvedValue({} as HTMLImageElement)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => imageData),
      } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce({ putImageData: vi.fn() } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce(jpegContext as unknown as CanvasRenderingContext2D)
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,Ag==')

    const result = await renderCorrectedSheetImageExport({
      sourceName: 'sheet.png',
      imageUrl: 'blob:sheet',
      imageSettings: {
        ...defaultSheetImageSettings(),
        levelCorrection: disabledLevelCorrection(),
      },
      template: testTemplate(2, 1),
      format: 'jpg',
    })

    expect(jpegContext.fillStyle).toBe('#ffffff')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2, 1)
    expect(drawFlattenedImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0)
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(drawFlattenedImage.mock.invocationCallOrder[0])
    expect(toDataUrl).toHaveBeenCalledWith('image/jpeg', 0.92)
    expect(result).toMatchObject({
      fileName: 'sheet_corrected.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      bytes: Uint8Array.of(2),
    })
  })
})

function testTemplate(widthPx: number, heightPx: number) {
  return {
    ...standardA3SheetTemplate,
    page: {
      ...standardA3SheetTemplate.page,
      widthPx,
      heightPx,
    },
  }
}

function testImageData(width: number, height: number, color: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset)
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

function disabledLevelCorrection() {
  return {
    enabled: false,
    inputBlack: 0,
    inputWhite: 255,
    gamma: 1,
  }
}
