/** Synthetic vectors only; no production artwork is included in the test suite. */
export function vectorBytes({ modern = true, points = [[8, 8]], stride = 88, flags = 129, brush = 7, diameter = 4,
  opacity = 1, size = 1, flow = 1, pointFlags = 0, handles = [], randomSeed = 0, direction = 0 }: {
  modern?: boolean; points?: number[][]; stride?: number; flags?: number; brush?: number; diameter?: number
  opacity?: number; size?: number; flow?: number; pointFlags?: number; handles?: number[][]; randomSeed?: number; direction?: number
} = {}): Buffer {
  const header = modern ? 92 : 88, b = Buffer.alloc(header + stride * points.length)
  ;[header, header - 16, stride, 88, points.length, flags].forEach((v, i) => b.writeUInt32BE(v, i * 4))
  b.writeDoubleBE(opacity, 64)
  b.writeUInt32BE(modern ? 123 : brush, 72)
  if (modern) b.writeUInt32BE(brush, 76)
  b.writeDoubleBE(diameter / 2, modern ? 80 : 76)
  b.writeUInt32BE(randomSeed, header - 4)
  points.forEach(([x, y], i) => {
    const at = header + i * stride
    b.writeDoubleBE(x, at); b.writeDoubleBE(y, at + 8)
    b.writeUInt32BE(pointFlags, at + 32)
    b.writeFloatBE(1, at + 36); b.writeFloatBE(1, at + 52)
    b.writeFloatBE(direction, at + 48)
    b.writeFloatBE(size, at + 56); b.writeFloatBE(flow, at + 60)
    handles[i]?.forEach((v, j) => b.writeDoubleBE(v, at + 88 + j * 8))
  })
  return b
}
