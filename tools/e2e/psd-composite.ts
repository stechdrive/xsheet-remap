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
