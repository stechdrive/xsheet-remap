import { beforeAll, describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, type RGBA } from 'ag-psd'
import { sheetPsdTextProperties, verticalPsdLayout, writeSheetTextPsd } from './sheetPsdText'
import { layoutVerticalText } from './verticalTextLayout'

describe('editable sheet PSD text', () => {
  beforeAll(() => {
    initializeCanvas(() => { throw new Error('No canvas is needed to serialize cached pixels') }, (width, height) => ({ width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) }))
  })

  it('keeps a wrapped Japanese/ASCII paragraph in one layer with the app column spacing', () => {
    const glyphs = layoutVerticalText('I1W A2\n\n「ー」、。', 32, 100, 200, 96, 300).glyphs
    const layout = verticalPsdLayout(glyphs, 32)
    expect(layout.text).toBe('I1W\n A2\n\n「ー」\n、。')
    expect(layout.x).toBe(glyphs[0].xPx)
    expect(layout.y).toBeCloseTo(200 + 32 * (.88 - .932))
    expect(layout.leading).toBe(40)
    expect(layout.tracking).toBeCloseTo(0)
  })

  it('preserves SOUND timing spacing as tracking without creating character layers', () => {
    const layout = verticalPsdLayout(['A', '2', 'あ'].map((value, i) => ({ value, xPx: 100, yPx: 30 + i * 42 })), 20)
    expect(layout.text).toBe('A2あ')
    expect(layout.tracking).toBeCloseTo(1100)
    const fractional = verticalPsdLayout(['あ', 'い', 'う'].map((value, i) => ({ value, xPx: 100, yPx: 30 + i * 80.10454545 })), 12.6)
    expect(fractional.tracking).toBe(5358)
  })

  it('round-trips column groups, complete Unicode values, font properties and cached pixels', async () => {
    const imageData = { width: 2, height: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 40, 50, 60, 255]) }
    const bytes = await writeSheetTextPsd(2, 2, 150, [{ name: 'CELL', children: [{ name: 'A', children: [{
      name: '001f：A_001', imageData, text: { text: 'A_001\n日本語', orientation: 'vertical', transform: [1, 0, 0, 1, 1, 2],
        style: { font: { name: 'LINESeedJP-Bold' }, fontSize: 24, baselineDirection: 1, leading: 30 },
        paragraphStyle: { wordSpacing: [1 / .345, 1 / .345, 1 / .345] } },
    }] }] }], imageData)
    const restored = readPsd(bytes, { useImageData: true })
    const cell = restored.children![0]
    expect(cell.name).toBe('CELL')
    expect(cell.children![0].name).toBe('A')
    const text = cell.children![0].children![0]
    expect(text.text!.text).toBe('A_001\n日本語')
    expect(text.text!.style).toMatchObject({ font: { name: 'LINESeedJP-Bold' }, fontSize: 24, baselineDirection: 1, leading: 30 })
    expect(text.imageData!.data).toEqual(imageData.data)
    expect(restored.imageData!.data).toEqual(imageData.data)
    expect(restored.imageResources!.resolutionInfo!.horizontalResolution).toBe(150)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let cursor = 34 + view.getUint32(26)
    const end = cursor + view.getUint32(cursor - 4)
    let profile: Uint8Array | undefined
    while (cursor < end) {
      const id = view.getUint16(cursor + 4)
      cursor += 6
      cursor += Math.ceil((1 + bytes[cursor]) / 2) * 2
      const size = view.getUint32(cursor); cursor += 4
      if (id === 1039) profile = bytes.subarray(cursor, cursor + size)
      cursor += size + size % 2
    }
    expect(new TextDecoder().decode(profile!.subarray(16, 20))).toBe('RGB ')
    expect(new TextDecoder().decode(profile!.subarray(36, 40))).toBe('acsp')
  })

  it('retains translucent text and outline colors for Photoshop redraws', async () => {
    const context = {
      textBaseline: 'alphabetic', textAlign: 'left', fillStyle: 'rgba(32, 64, 160, 0.5)',
      strokeStyle: 'rgba(255, 255, 252, 0.94)', lineWidth: 3,
      save() {}, restore() {}, measureText() { return { actualBoundingBoxAscent: 12 } },
    } as unknown as CanvasRenderingContext2D
    const text = sheetPsdTextProperties(context, { text: '日本語', x: 0, y: 0, size: 16, weight: 700, offsetY: 0, stroke: true })
    const imageData = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
    const restored = readPsd(await writeSheetTextPsd(1, 1, 72, [{ text, imageData }], imageData), { useImageData: true })
    for (const [property, expected] of [['fillColor', [32, 64, 160, 127.5]], ['strokeColor', [255, 255, 252, 239.7]]] as const) {
      const color = restored.children![0].text!.style![property] as RGBA
      // EngineData rounds normalized color components to five decimal places.
      const channels = [color.r, color.g, color.b, color.a]
      channels.forEach((channel, index) => expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(255 / 200_000 + Number.EPSILON))
    }
  })
})
