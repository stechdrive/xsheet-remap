import { unzlibSync, zlibSync } from 'fflate'
import { adler32, check, concat, crc32, named, u32, utf8, view } from './binary'
export interface Pixels { width: number; height: number; data: Uint8Array; channels: 1 | 4; defaultValue?: number[] }
export function attributeSize(source: Uint8Array, width: number, height: number): Uint8Array {
  const v = view(source), sizes = [0, 4, 8, 12].map(p => v.getUint32(p))
  check(sizes[0] === 16 && sizes.reduce((a, b) => a + b) === source.length, '未対応のラスター属性です。')
  const params = source.slice(16, 16 + sizes[1]), initial = source.slice(16 + sizes[1], 16 + sizes[1] + sizes[2]), blocks = source.subarray(16 + sizes[1] + sizes[2])
  const cols = Math.ceil(width / 256), rows = Math.ceil(height / 256), count = cols * rows
  ;[width, height, cols, rows].forEach((value, i) => view(params).setUint32(22 + i * 4, value))
  const records = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) view(records).setUint32(i * 4, 104)
  const next = concat(blocks.subarray(0, 26), u32(count), blocks.subarray(30, 34), records)
  return concat(u32(16), u32(params.length), u32(initial.length), u32(next.length), params, initial, next)
}
function alphaIndex(x: number, y: number): number { return Math.floor(y / 4) * 1024 + (y % 4) * 256 + Math.floor(x / 4) * 4 + x % 4 }
export function decodeRaster(attribute: Uint8Array, body?: Uint8Array): Pixels {
  const v = view(attribute), width = v.getUint32(38), height = v.getUint32(42), cols = v.getUint32(46), rows = v.getUint32(50)
  const kind = [54, 58, 62, 66].map(p => v.getUint32(p)).join(',')
  check(kind === '33,1,4,5' || kind === '1,1,0,1', `未対応のラスター形式です: ${kind}`)
  check(width > 0 && height > 0 && width * height <= 120_000_000 && cols === Math.ceil(width / 256) && rows === Math.ceil(height / 256), 'ラスター寸法が不正です。')
  const channels = kind.startsWith('33') ? 4 : 1, start = v.getUint32(0) + v.getUint32(4)
  const hasDefault = v.getUint32(start + 26), value = v.getUint32(start + 30)
  const defaults = channels === 4 ? Array.from(u32(hasDefault ? value : 0)) : [hasDefault ? value & 255 : 0]
  const data = new Uint8Array(width * height * channels)
  for (let i = 0; i < data.length; i++) data[i] = defaults[i % channels]
  let p = 0
  if (body) for (let tile = 0; tile < cols * rows; tile++) {
    const b = view(body), size = b.getUint32(p)
    check(size >= 104 && p + size <= body.length && b.getUint32(p + 46) === tile, 'ラスターブロックが破損しています。')
    if (b.getUint32(p + 62)) {
      const length = b.getUint32(p + 70, true), expected = channels === 4 ? 327680 : 65536
      check(b.getUint32(p + 50) === expected && p + 74 + length <= p + size, '圧縮ブロックの長さが不正です。')
      const raw = unzlibSync(body.subarray(p + 74, p + 74 + length), { out: new Uint8Array(expected) })
      check(raw.length === expected, 'ラスター展開サイズが不正です。')
      const tx = tile % cols * 256, ty = Math.floor(tile / cols) * 256
      for (let y = 0; y < Math.min(256, height - ty); y++) for (let x = 0; x < Math.min(256, width - tx); x++) {
        const target = ((ty + y) * width + tx + x) * channels
        if (channels === 1) data[target] = raw[y * 256 + x]
        else { const source = 65536 + (y * 256 + x) * 4; data[target] = raw[source + 2]; data[target + 1] = raw[source + 1]; data[target + 2] = raw[source]; data[target + 3] = raw[alphaIndex(x, y)] }
      }
    }
    p += size
  }
  return { width, height, data, channels, defaultValue: defaults }
}
export function encodeRaster(pixels: Pixels, template: Uint8Array): { attribute: Uint8Array; body: Uint8Array } {
  const { width, height, data, channels } = pixels, cols = Math.ceil(width / 256), rows = Math.ceil(height / 256)
  check(data.length === width * height * channels, '画像データの長さが不正です。')
  const records: Uint8Array[] = [], checksums: Uint8Array[] = []
  for (let tile = 0; tile < cols * rows; tile++) {
    const raw = new Uint8Array(channels === 4 ? 327680 : 65536)
    if (channels === 1) raw.fill(pixels.defaultValue?.[0] ?? 0)
    const tx = tile % cols * 256, ty = Math.floor(tile / cols) * 256
    for (let y = 0; y < Math.min(256, height - ty); y++) for (let x = 0; x < Math.min(256, width - tx); x++) {
      const source = ((ty + y) * width + tx + x) * channels
      if (channels === 1) raw[y * 256 + x] = data[source]
      else { const target = 65536 + (y * 256 + x) * 4; raw[target] = data[source + 2]; raw[target + 1] = data[source + 1]; raw[target + 2] = data[source]; raw[alphaIndex(x, y)] = data[source + 3] }
    }
    const z = zlibSync(raw), payload = concat(u32(z.length, true), z)
    const record = concat(named('BlockDataBeginChunk'), u32(tile), u32(raw.length), u32(256), u32(256), u32(1), u32(payload.length), payload, named('BlockDataEndChunk'))
    records.push(concat(u32(record.length + 4), record)); checksums.push(u32(adler32(payload)))
  }
  const count = cols * rows
  const trailer = concat(named('BlockStatus'), u32(12), u32(count), u32(4), ...records.map(() => u32(1)), named('BlockCheckSum'), u32(12), u32(count), u32(4), ...checksums)
  const attribute = attributeSize(template, width, height), av = view(attribute)
  const sizesOffset = av.getUint32(0) + av.getUint32(4) + av.getUint32(8) + 34
  records.forEach((record, i) => av.setUint32(sizesOffset + i * 4, record.length))
  return { attribute, body: concat(...records, trailer) }
}
export function placePixels(source: Pixels, width: number, height: number, x: number, y: number): Pixels {
  const channels = source.channels, data = new Uint8Array(width * height * channels)
  if (source.defaultValue) for (let i = 0; i < data.length; i++) data[i] = source.defaultValue[i % channels]
  const left = Math.max(0, x), right = Math.min(width, x + source.width)
  if (right > left) for (let py = Math.max(0, y); py < Math.min(height, y + source.height); py++) {
    const start = ((py - y) * source.width + left - x) * channels
    data.set(source.data.subarray(start, start + (right - left) * channels), (py * width + left) * channels)
  }
  return { width, height, channels, data, defaultValue: source.defaultValue }
}
export function reducePixels(source: Pixels, width: number, height: number): Pixels {
  const data = new Uint8Array(width * height * source.channels)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < source.channels; c++) {
    let total = 0, count = 0
    for (let sy = Math.floor(y * source.height / height); sy < Math.floor((y + 1) * source.height / height); sy++) for (let sx = Math.floor(x * source.width / width); sx < Math.floor((x + 1) * source.width / width); sx++) { total += source.data[(sy * source.width + sx) * source.channels + c]; count++ }
    data[(y * width + x) * source.channels + c] = Math.round(total / count)
  }
  return { ...source, width, height, data }
}
export function png(pixels: Pixels): Uint8Array {
  check(pixels.channels === 4, 'プレビューにはRGBAが必要です。')
  const rows = new Uint8Array((pixels.width * 4 + 1) * pixels.height)
  for (let y = 0; y < pixels.height; y++) rows.set(pixels.data.subarray(y * pixels.width * 4, (y + 1) * pixels.width * 4), y * (pixels.width * 4 + 1) + 1)
  const chunk = (name: string, data: Uint8Array) => { const body = concat(utf8.encode(name), data); return concat(u32(data.length), body, u32(crc32(body))) }
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', concat(u32(pixels.width), u32(pixels.height), new Uint8Array([8, 6, 0, 0, 0]))), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array()))
}
