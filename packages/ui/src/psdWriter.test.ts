import { describe, expect, it } from 'vitest'
import { writeRgbPsd } from './psdWriter'

type ParsedLayerRecord = {
  name: string
  opacity: number
}

describe('PSD writer layer metadata', () => {
  it('writes Unicode layer names and editable opacity bytes into the PSD layer records', () => {
    const white = solidImageData(2, 2, [255, 255, 255, 255])
    const paper = solidImageData(2, 2, [96, 112, 128, 255])
    const annotations = solidImageData(2, 2, [45, 106, 87, 128])

    const bytes = writeRgbPsd({
      width: 2,
      height: 2,
      layers: [
        { name: '白地', imageData: white },
        { name: '紙シート画像', imageData: paper, opacity: 107 },
        { name: '注釈文字', imageData: annotations },
      ],
      composite: white,
    })

    expect(readLayerRecords(bytes)).toEqual([
      { name: '白地', opacity: 255 },
      { name: '紙シート画像', opacity: 107 },
      { name: '注釈文字', opacity: 255 },
    ])
  })
})

describe('PSD pixel storage', () => {
  it('compresses sheet backgrounds, transparent layers and the merged preview', () => {
    const width = 640
    const height = 904
    const white = solidImageData(width, height, [255, 255, 255, 255])
    const transparent = solidImageData(width, height, [0, 0, 0, 0])
    const grid = solidImageData(width, height, [0, 0, 0, 0])
    const composite = solidImageData(width, height, [255, 255, 255, 255])
    for (let y = 24; y < height - 24; y++) {
      for (let x = 24; x < width - 24; x++) {
        if (x % 80 !== 0 && y % 24 !== 0) continue
        const offset = (y * width + x) * 4
        grid.data.set([32, 64, 96, 255], offset)
        composite.data.set([32, 64, 96, 255], offset)
      }
    }
    const layers = [white, grid, ...Array<ImageData>(7).fill(transparent)]
    const bytes = writeRgbPsd({
      width, height, composite,
      layers: layers.map((imageData, index) => ({ name: `layer ${index}`, imageData })),
    })
    const rawPixelBytes = width * height * (4 * layers.length + 3)

    expect(bytes.length).toBeLessThan(rawPixelBytes / 20)
    const parsed = readPixels(bytes)
    expect(parsed.layers).toHaveLength(layers.length)
    expect(parsed.layers.flatMap(layer => layer.compressions)).toEqual(Array<number>(layers.length * 4).fill(1))
    expect(parsed.compositeCompression).toBe(1)
  })

  it.each([1, 2, 3, 127, 128, 129, 255, 256, 257, 513])('preserves all channel bytes across packet and row boundaries at width %i', width => {
    const height = 5
    const image = solidImageData(width, height, [0, 0, 0, 0])
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        image.data.set([
          y === 0 ? x % 256 : y * 37,
          x < 128 ? 17 : x < 131 ? 200 : (x * 13 + y) % 256,
          x % 2 === 0 ? 19 : 211,
          x < width - 3 ? y * 51 : 255,
        ], (y * width + x) * 4)
      }
    }
    const original = image.data.slice()
    const empty = solidImageData(width, height, [0, 0, 0, 0])
    const bytes = writeRgbPsd({
      width, height, dpi: 300, composite: image,
      layers: [{ name: '画素と透明度', imageData: image, opacity: 107 }, { name: '空レイヤー', imageData: empty }],
    })
    const parsed = readPixels(bytes)

    expect(parsed.width).toBe(width)
    expect(parsed.height).toBe(height)
    expect(parsed.layers[0].pixels).toEqual(original)
    expect(parsed.layers[1].pixels).toEqual(empty.data)
    expect(parsed.composite).toEqual(rgbBytes(image))
    expect(image.data).toEqual(original)
    expect(readLayerRecords(bytes)).toEqual([
      { name: '画素と透明度', opacity: 107 }, { name: '空レイヤー', opacity: 255 },
    ])
  })

  it('uses raw storage for incompressible RGB while still compressing layer alpha', () => {
    const width = 257
    const height = 7
    const image = solidImageData(width, height, [0, 0, 0, 255])
    for (let pixel = 0; pixel < width * height; pixel++) {
      image.data.set([pixel % 256, (pixel * 3) % 256, (pixel * 7) % 256], pixel * 4)
    }
    const bytes = writeRgbPsd({ width, height, composite: image, layers: [{ name: 'scan', imageData: image }] })
    const parsed = readPixels(bytes)

    expect(parsed.layers[0].compressions).toEqual([1, 0, 0, 0])
    expect(parsed.compositeCompression).toBe(0)
    expect(parsed.layers[0].pixels).toEqual(image.data)
    expect(parsed.composite).toEqual(rgbBytes(image))
  })
})

// Decode the PSD container and PackBits packets independently of the writer.
// Declared channel lengths and scanline lengths must consume the exact payload.
function readPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  let offset = 26
  offset += 4 + view.getUint32(offset)
  offset += 4 + view.getUint32(offset)
  const compositeOffset = offset + 4 + view.getUint32(offset)
  offset += 8
  const count = Math.abs(view.getInt16(offset))
  offset += 2
  const records = []
  for (let index = 0; index < count; index++) {
    const top = view.getInt32(offset)
    const left = view.getInt32(offset + 4)
    const bottom = view.getInt32(offset + 8)
    const right = view.getInt32(offset + 12)
    offset += 16
    const channelCount = view.getUint16(offset)
    offset += 2
    const channels = []
    for (let channel = 0; channel < channelCount; channel++) {
      channels.push({ id: view.getInt16(offset), length: view.getUint32(offset + 2) })
      offset += 6
    }
    offset += 12
    const extraLength = view.getUint32(offset)
    offset += 4 + extraLength
    records.push({ top, left, width: right - left, height: bottom - top, channels })
  }
  const layers = records.map(record => {
    expect([record.top, record.left, record.width, record.height]).toEqual([0, 0, width, height])
    const pixels = new Uint8ClampedArray(width * height * 4)
    const compressions: number[] = []
    for (const channel of record.channels) {
      const end = offset + channel.length
      const compression = view.getUint16(offset)
      offset += 2
      compressions.push(compression)
      const data = decodePlanes(compression, 1, end)
      const component = channel.id === -1 ? 3 : channel.id
      for (let pixel = 0; pixel < width * height; pixel++) pixels[pixel * 4 + component] = data[pixel]
    }
    return { pixels, compressions }
  })
  offset = compositeOffset
  const compositeCompression = view.getUint16(offset)
  offset += 2
  const planes = decodePlanes(compositeCompression, 3, bytes.length)
  const composite = new Uint8Array(width * height * 3)
  for (let channel = 0; channel < 3; channel++) {
    for (let pixel = 0; pixel < width * height; pixel++) composite[pixel * 3 + channel] = planes[channel * width * height + pixel]
  }
  return { width, height, layers, compositeCompression, composite }

  function decodePlanes(compression: number, channelCount: number, end: number): Uint8Array {
    const output = new Uint8Array(width * height * channelCount)
    if (compression === 0) {
      expect(end - offset).toBe(output.length)
      output.set(bytes.subarray(offset, end))
      offset = end
      return output
    }
    expect(compression).toBe(1)
    const lengths = Array.from({ length: height * channelCount }, (_, row) => view.getUint16(offset + row * 2))
    offset += lengths.length * 2
    for (let row = 0; row < lengths.length; row++) {
      const rowEnd = offset + lengths[row]
      let pixel = row * width
      while (offset < rowEnd) {
        const header = view.getInt8(offset++)
        if (header >= 0) {
          const length = header + 1
          expect(offset + length).toBeLessThanOrEqual(rowEnd)
          output.set(bytes.subarray(offset, offset + length), pixel)
          offset += length
          pixel += length
        } else if (header !== -128) {
          const length = 1 - header
          expect(offset).toBeLessThan(rowEnd)
          output.fill(bytes[offset++], pixel, pixel + length)
          pixel += length
        }
        expect(pixel).toBeLessThanOrEqual((row + 1) * width)
      }
      expect(offset).toBe(rowEnd)
      expect(pixel).toBe((row + 1) * width)
    }
    expect(offset).toBe(end)
    return output
  }
}

function rgbBytes(image: ImageData): Uint8Array {
  const output = new Uint8Array(image.width * image.height * 3)
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    output.set(image.data.subarray(pixel * 4, pixel * 4 + 3), pixel * 3)
  }
  return output
}

function solidImageData(width: number, height: number, color: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset)
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

function readLayerRecords(bytes: Uint8Array): ParsedLayerRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 26
  offset += 4 + view.getUint32(offset)
  offset += 4 + view.getUint32(offset)
  const layerAndMaskLength = view.getUint32(offset)
  offset += 4
  const layerAndMaskEnd = offset + layerAndMaskLength
  const layerInfoLength = view.getUint32(offset)
  offset += 4
  if (layerInfoLength === 0 || offset >= layerAndMaskEnd) return []
  const layerCount = Math.abs(view.getInt16(offset))
  offset += 2
  const records: ParsedLayerRecord[] = []
  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    offset += 16
    const channelCount = view.getUint16(offset)
    offset += 2 + channelCount * 6
    offset += 8
    const opacity = bytes[offset]
    offset += 4
    const extraLength = view.getUint32(offset)
    offset += 4
    const extraEnd = offset + extraLength
    const maskLength = view.getUint32(offset)
    offset += 4 + maskLength
    const blendingRangesLength = view.getUint32(offset)
    offset += 4 + blendingRangesLength
    const pascalLength = bytes[offset]
    offset += Math.ceil((1 + pascalLength) / 4) * 4

    let name = ''
    while (offset + 12 <= extraEnd) {
      const signature = ascii(bytes, offset, 4)
      const key = ascii(bytes, offset + 4, 4)
      const dataLength = view.getUint32(offset + 8)
      const dataOffset = offset + 12
      if (signature === '8BIM' && key === 'luni') {
        const characterCount = view.getUint32(dataOffset)
        name = Array.from({ length: characterCount }, (_, index) =>
          String.fromCharCode(view.getUint16(dataOffset + 4 + index * 2)),
        ).join('')
      }
      offset = dataOffset + dataLength + (dataLength % 2)
    }
    offset = extraEnd
    records.push({ name, opacity })
  }
  return records
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}
