// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
/** Bounded readers for the reverse engineered CSF container. See THIRD_PARTY_NOTICES.md. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CLIP: ${message}`)
}

export class Reader {
  position = 0
  private view: DataView
  readonly bytes: Uint8Array
  readonly littleEndian: boolean
  constructor(bytes: Uint8Array, littleEndian = false) {
    this.bytes = bytes
    this.littleEndian = littleEndian
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  take(size: number): Uint8Array {
    check(Number.isSafeInteger(size) && size >= 0 && this.position + size <= this.bytes.length, 'データが途中で切れています')
    const result = this.bytes.subarray(this.position, this.position + size)
    this.position += size
    return result
  }
  number(kind: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64' | 'u64'): number {
    const offset = this.position
    const size = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, f64: 8, u64: 8 }[kind]
    this.take(size)
    const le = this.littleEndian
    let result: number
    switch (kind) {
      case 'u8': result = this.view.getUint8(offset); break
      case 'i8': result = this.view.getInt8(offset); break
      case 'u16': result = this.view.getUint16(offset, le); break
      case 'i16': result = this.view.getInt16(offset, le); break
      case 'u32': result = this.view.getUint32(offset, le); break
      case 'i32': result = this.view.getInt32(offset, le); break
      case 'f32': result = this.view.getFloat32(offset, le); break
      case 'f64': result = this.view.getFloat64(offset, le); break
      case 'u64': result = Number(this.view.getBigUint64(offset, le)); check(Number.isSafeInteger(result), 'サイズが大きすぎます'); break
    }
    check(Number.isFinite(result), '数値が不正です')
    return result
  }
  u32(): number { return this.number('u32') }
  text(size: number): string { return new TextDecoder().decode(this.take(size)) }
  wideName(): string {
    const size = this.u32()
    check(size <= 256, 'セクション名が長すぎます')
    return new TextDecoder('utf-16be').decode(this.take(size * 2))
  }
}

export async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      check(length <= limit, '展開データが上限を超えました')
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}
