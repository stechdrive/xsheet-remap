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
