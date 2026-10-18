// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
// Text TLV and array layout: dobrokot/clip_to_psd and animeops/clip-tools (MIT).
import { check, Reader } from './binary'
import { num, str, type ClipRow } from './records'
import type { TextObject } from './rendering'

function array(row: ClipRow, key: string): Uint8Array[] {
  const result: Uint8Array[] = []
  const first = row[key]
  if (first instanceof Uint8Array) result.push(first)
  else if (typeof first === 'string') result.push(new Uint8Array(new TextEncoder().encode(first)))
  const rest = row[`${key}Array`]
  if (rest instanceof Uint8Array) {
    const r = new Reader(rest, true)
    while (r.position < rest.length) {
      check(result.length < 1000, '文字オブジェクトが多すぎます')
      result.push(r.take(r.u32()))
    }
  }
  return result
}

export function readTextAttributes(bytes: Uint8Array): Map<number, Uint8Array> {
  const r = new Reader(bytes, true), fields = new Map<number, Uint8Array>()
  while (r.position < bytes.length) {
    const tag = r.u32(), size = r.u32()
    fields.set(tag, r.take(size))
    check(fields.size < 1000, '文字属性が多すぎます')
  }
  return fields
}

export function readTextObjects(row: ClipRow, dpi: number, report: (message: string) => void = () => {}): TextObject[] {
  const strings = array(row, 'TextLayerString'), attributes = array(row, 'TextLayerAttributes')
  return strings.map((string, index) => {
    check(str(string).length <= 100000, '文字列が長すぎます')
    try { return textObject(string, attributes[index] ? readTextAttributes(attributes[index]) : new Map(), row, dpi) }
    catch {
      report('文字属性を読み取れないため、既定の書式で描画します')
      return textObject(string, new Map(), row, dpi)
    }
  }).filter(o => o.text.length > 0)
}

function textObject(string: Uint8Array, fields: Map<number, Uint8Array>, row: ClipRow, dpi: number): TextObject {
  const reader = (tag: number) => fields.has(tag) ? new Reader(fields.get(tag)!, true) : undefined
  const box = reader(42), size = reader(32), color = reader(34), align = reader(12)
  const left = box?.number('i32') ?? 0, top = box?.number('i32') ?? 0
  const right = box?.number('i32') ?? left, bottom = box?.number('i32') ?? top
  const fontSize = Math.max(1, Math.min(4096, (size ? size.u32() / 100 : 12) * (dpi || 72) / 72))
  const object: TextObject = {
    text: str(string), left: left + num(row, 'LayerOffsetX'), top: top + num(row, 'LayerOffsetY'),
    width: box ? Math.max(0, right - left + 1) : 0, height: box ? Math.max(0, bottom - top + 1) : 0,
    font: str(fields.get(31)) || 'sans-serif', size: fontSize,
    color: color ? [color.u32() >>> 24, color.u32() >>> 24, color.u32() >>> 24] : [0, 0, 0], align: 'left', runs: [],
  }
  if (align && align.u32() > 0) {
    align.take(12)
    object.align = (['left', 'center', 'right'] as const)[align.number('u8')] ?? 'left'
  }
  const runs = reader(11)
  if (runs) {
    const count = runs.u32()
    check(count <= 10000, '文字書式の区間が多すぎます')
    for (let i = 0; i < count; i++) {
      const start = runs.number('i32'), length = runs.u32(), recordSize = runs.u32()
      const end = runs.position + recordSize - 8
      runs.take(2)
      const rgb: [number, number, number] = [runs.number('u16') >>> 8, runs.number('u16') >>> 8, runs.number('u16') >>> 8]
      const scale = runs.number('f64')
      const font = new TextDecoder('utf-16le').decode(runs.take(runs.number('u16') * 2))
      check(end >= runs.position, '文字書式の長さが不正です')
      runs.take(end - runs.position)
      object.runs.push({ start, length, font: font || object.font, size: scale > 0 ? Math.min(4096, fontSize * scale / 100) : fontSize, color: rgb })
    }
  }
  return object
}
