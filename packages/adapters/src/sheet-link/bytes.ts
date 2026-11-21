import { deflateSync, inflateSync } from 'fflate'

export const SHEET_LINK_PREFIX = 'https://stechdrive.github.io/xsheet-remap/#s='
export const MAX_LINK_BYTES = 2268
export const MAX_RECORD_BYTES = 256 * 1024
export const MAX_LINK_EVENTS = 100_000
export const MAX_FRAMES = 100_000

export function invalid(): never { throw new Error('シートQRのデータが不正か、対応範囲を超えています。') }

const utf8 = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export class Writer {
  readonly bytes: number[] = []
  uint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) invalid()
    while (value >= 128) {
      this.bytes.push(value % 128 + 128)
      value = Math.floor(value / 128)
    }
    this.bytes.push(value)
  }
  int(n: number) { this.uint(n < 0 ? -2 * n - 1 : 2 * n) }
  text(value: string) {
    const data = utf8.encode(value)
    this.uint(data.length)
    this.append(data)
  }
  append(data: ArrayLike<number>) {
    if (data.length + this.bytes.length > MAX_RECORD_BYTES) invalid()
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i]!)
  }
  finish() { return Uint8Array.from(this.bytes) }
}

export class Reader {
  private at = 0
  private remainingEvents = MAX_LINK_EVENTS
  constructor(private readonly data: Uint8Array) { }
  uint(limit = 0xffffffff) {
    let n = 0
    for (let factor = 1; factor <= 2 ** 35; factor *= 128) {
      const b = this.data[this.at++] ?? invalid()
      n += (b & 127) * factor
      if (n > limit) invalid()
      if (b < 128) {
        if (!b && factor > 1) invalid()
        return n
      }
    }
    return invalid()
  }
  int(limit = MAX_FRAMES * 2) {
    const n = this.uint(limit * 2)
    return n % 2 ? -(n + 1) / 2 : n / 2
  }
  take(n: number) {
    if (n > this.data.length - this.at) invalid()
    const result = this.data.subarray(this.at, this.at + n)
    this.at += n
    return result
  }
  text() { return decoder.decode(this.take(this.uint(MAX_RECORD_BYTES))) }
  events(n: number) { if ((this.remainingEvents -= n) < 0) invalid() }
  end() { if (this.at !== this.data.length) invalid() }
}

// Fixed-width decimal blocks preserve leading zero bytes and let a standard QR
// reader use numeric mode for the URL fragment. All arithmetic is bounded to 96 bits.
const widths = [0, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25, 27, 29]
export function digitsFromBytes(bytes: Uint8Array): string {
  let digits = ''
  for (let i = 0; i < bytes.length; i += 12) {
    const block = bytes.subarray(i, i + 12)
    let number = 0n
    for (const byte of block) number = (number << 8n) | BigInt(byte)
    digits += number.toString().padStart(widths[block.length]!, '0')
  }
  return digits
}

export function bytesFromDigits(digits: string): Uint8Array {
  if (!digits.length || digits.length > 5481 || /[^0-9]/u.test(digits)) invalid()
  const bytes: number[] = []
  for (let i = 0; i < digits.length; i += 29) {
    const block = digits.slice(i, i + 29)
    const size = widths.indexOf(block.length)
    if (size < 1) invalid()
    let n = BigInt(block)
    const start = bytes.length
    for (let pos = size - 1; pos >= 0; pos--) {
      bytes[start + pos] = Number(n & 255n)
      n >>= 8n
    }
    if (n) invalid()
  }
  if (bytes.length > MAX_LINK_BYTES) invalid()
  return Uint8Array.from(bytes)
}

export function packLink(raw: Uint8Array) {
  const zipped = deflateSync(raw)
  const head = new Writer()
  head.uint(raw.length)
  const compressed = zipped.length + head.bytes.length < raw.length
  const data = compressed ? zipped : raw
  const result = new Uint8Array(1 + (compressed ? head.bytes.length : 0) + data.length)
  result[0] = compressed ? 0x11 : 0x10
  if (compressed) result.set(head.bytes, 1)
  result.set(data, result.length - data.length)
  return result
}

export function unpackLink(bytes: Uint8Array) {
  if (bytes[0] === 0x10) return bytes.subarray(1)
  if (bytes[0] !== 0x11) invalid()
  const prefix = new Reader(bytes.subarray(1))
  const len = prefix.uint(MAX_RECORD_BYTES)
  const header = new Writer()
  header.uint(len)
  const result = inflateSync(bytes.subarray(1 + header.bytes.length), { out: new Uint8Array(len + 1) })
  if (result.length !== len) invalid()
  return result
}
