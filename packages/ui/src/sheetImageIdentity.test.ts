import { describe, expect, it, vi } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { defaultCalibrationPoints, defaultSheetImageSettings, warpSheetImageData } from './sheetImages'

describe('sheet image resampling', () => {
  it('preserves every channel at identity and clamps the footprint at the image edges', () => {
    const width = 5, height = 3
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 43) % 256
    const source = { width, height, data: rgba } as ImageData
    const create = vi.spyOn(document, 'createElement').mockImplementation(() => ({
      getContext: () => ({
        drawImage: () => undefined, getImageData: () => source,
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w*h*4) }),
      }),
    } as unknown as HTMLCanvasElement))
    const template = { ...standardA3SheetTemplate, page: { ...standardA3SheetTemplate.page, widthPx: width, heightPx: height } }
    const settings = { ...defaultSheetImageSettings(), calibration: { enabled: true, points: defaultCalibrationPoints(template) } }
    const image = { naturalWidth: width, naturalHeight: height } as HTMLImageElement
    try {
      expect(warpSheetImageData(image, settings, template, width)?.data).toEqual(rgba)
      const scaled = warpSheetImageData(image, settings, template, width * 2)!
      expect(scaled.data.slice(0, 4)).toEqual(rgba.slice(0, 4))
      expect(scaled.data.slice(-4)).toEqual(rgba.slice(-4))
    } finally { create.mockRestore() }
  })
})
