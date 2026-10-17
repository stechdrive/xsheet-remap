import { expect } from '@playwright/test'

export type RgbImage = { width: number; height: number; planes: Uint8Array }

// Read the merged PSD RGB planes independently of the application writer.
export function readPsdComposite(bytes: Buffer): RgbImage {
  expect(bytes.toString('ascii', 0, 4)).toBe('8BPS')
  expect([bytes.readUInt16BE(4), bytes.readUInt16BE(12), bytes.readUInt16BE(22), bytes.readUInt16BE(24)]).toEqual([1, 3, 8, 3])
  const height = bytes.readUInt32BE(14), width = bytes.readUInt32BE(18)
  let offset = 26
  for (let section = 0; section < 3; section++) offset += 4 + bytes.readUInt32BE(offset)
  const compression = bytes.readUInt16BE(offset)
  offset += 2
  const planes = new Uint8Array(width * height * 3)
  if (compression === 0) {
    expect(bytes.length - offset).toBe(planes.length)
    planes.set(bytes.subarray(offset))
  } else {
    expect(compression).toBe(1)
    const lengths = Array.from({ length: height * 3 }, (_, row) => bytes.readUInt16BE(offset + row * 2))
    offset += lengths.length * 2
    for (const [row, length] of lengths.entries()) {
      const end = offset + length
      let target = row * width
      while (offset < end) {
        const header = bytes.readInt8(offset++)
        if (header >= 0) {
          planes.set(bytes.subarray(offset, offset + header + 1), target)
          offset += header + 1
          target += header + 1
        } else if (header !== -128) {
          planes.fill(bytes[offset++], target, target + 1 - header)
          target += 1 - header
        }
      }
      expect(offset).toBe(end)
      expect(target).toBe((row + 1) * width)
    }
    expect(offset).toBe(bytes.length)
  }
  return { width, height, planes }
}

// Inspect layer transparency independently of the flattened preview.
export function readPsdLayerAlphas(bytes: Buffer) {
  let offset = 26
  for (let section = 0; section < 2; section++) offset += 4 + bytes.readUInt32BE(offset)
  offset += 8 // Layer/mask section length and layer-info length.
  const count = Math.abs(bytes.readInt16BE(offset)); offset += 2
  const records = []
  for (let index = 0; index < count; index++) {
    const top = bytes.readInt32BE(offset), left = bytes.readInt32BE(offset + 4)
    const height = bytes.readInt32BE(offset + 8) - top, width = bytes.readInt32BE(offset + 12) - left
    offset += 16
    const channelCount = bytes.readUInt16BE(offset); offset += 2
    const channels = []
    for (let channel = 0; channel < channelCount; channel++) {
      channels.push({ id: bytes.readInt16BE(offset), length: bytes.readUInt32BE(offset + 2) }); offset += 6
    }
    offset += 12 // Blend signature/key, opacity, clipping and flags.
    const extraEnd = offset + 4 + bytes.readUInt32BE(offset); offset += 4
    offset += 4 + bytes.readUInt32BE(offset) // Layer mask.
    offset += 4 + bytes.readUInt32BE(offset) // Blending ranges.
    offset += Math.ceil((1 + bytes[offset]) / 4) * 4
    let name = ''
    while (offset + 12 <= extraEnd) {
      const length = bytes.readUInt32BE(offset + 8), data = offset + 12
      if (bytes.toString('ascii', offset, offset + 8) === '8BIMluni') {
        name = Array.from({ length: bytes.readUInt32BE(data) }, (_, i) => String.fromCharCode(bytes.readUInt16BE(data + 4 + i * 2))).join('')
      }
      offset = data + length + length % 2
    }
    offset = extraEnd
    records.push({ name, top, left, width, height, channels })
  }
  return records.map(({ channels, ...record }) => {
    let alpha: Uint8Array | undefined
    for (const channel of channels) {
      const end = offset + channel.length
      if (channel.id === -1) {
        alpha = new Uint8Array(record.width * record.height)
        const compression = bytes.readUInt16BE(offset); offset += 2
        if (compression === 0) {
          expect(end - offset).toBe(alpha.length)
          alpha.set(bytes.subarray(offset, end)); offset = end
        } else {
          expect(compression).toBe(1)
          const lengths = Array.from({ length: record.height }, (_, row) => bytes.readUInt16BE(offset + row * 2))
          offset += lengths.length * 2
          for (const [row, length] of lengths.entries()) {
            const rowEnd = offset + length
            let target = row * record.width
            while (offset < rowEnd) {
              const header = bytes.readInt8(offset++)
              if (header >= 0) {
                alpha.set(bytes.subarray(offset, offset + header + 1), target)
                offset += header + 1; target += header + 1
              } else if (header !== -128) {
                alpha.fill(bytes[offset++], target, target + 1 - header); target += 1 - header
              }
            }
            if (offset !== rowEnd || target !== (row + 1) * record.width) {
              throw new Error(`Invalid alpha row ${row} in ${record.name}: encoded end ${offset}/${rowEnd}, decoded end ${target}/${(row + 1) * record.width}`)
            }
          }
          expect(offset).toBe(end)
        }
      }
      offset = end
    }
    // PSD may omit transparency for an opaque RGB layer. Group records have
    // no pixel area; neither case requires an explicit alpha channel.
    if (!alpha) {
      if (record.width * record.height > 0) {
        expect(channels.map(channel => channel.id), `RGB channels for ${record.name}`).toEqual(expect.arrayContaining([0, 1, 2]))
      }
      alpha = new Uint8Array(record.width * record.height).fill(255)
    }
    return { ...record, alpha }
  })
}
