export const utf8 = new TextEncoder()
export const text = new TextDecoder('utf-8', { fatal: true })
export function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`CLIP: ${message}`) }
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
export function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
export function u32(value: number, little = false): Uint8Array { const b = new Uint8Array(4); view(b).setUint32(0, value, little); return b }
export function u64(value: number): Uint8Array { const b = new Uint8Array(8); view(b).setBigUint64(0, BigInt(value)); return b }
export function uint64(bytes: Uint8Array, offset: number): number {
  const value = Number(view(bytes).getBigUint64(offset)); check(Number.isSafeInteger(value), 'サイズが範囲外です。'); return value
}
export function named(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) view(bytes).setUint16(i * 2, value.charCodeAt(i))
  return concat(u32(value.length), bytes)
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
export function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}
export function externalId(): string { return `extrnlid${crypto.randomUUID().replaceAll('-', '').toUpperCase()}` }
export function layerUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 10)}-${hex.slice(10, 14)}-${hex.slice(14, 18)}-${hex.slice(18, 22)}-${hex.slice(22)}`
}
export async function identity(project: string, key: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(`xsheet-remap:clip:1:${project}:${key}`))).slice(0, 16)
}
