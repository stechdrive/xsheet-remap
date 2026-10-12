// CSP BINC and TrackValueMap, checked against CSP 5.0.4 files and
// https://github.com/wamsoft/clipparse/blob/322a273c0e059d1dee9132af78289efa12a59522/docs/CLIP_FORMAT.md
// Source acknowledgements and license texts: THIRD_PARTY_NOTICES.md.
import { unzlibSync, zlibSync } from 'fflate'
import type { ExportTrackFrame } from '@xsheet-remap/core'
import { check, concat, crc32, named, text, u32, utf8, view } from './binary'
interface Node { name: string; kind: string; values: (number | string)[]; attrs: Record<string, string>; children: Node[] }
const sizes: Record<string, number> = { Byte: 1, Int32: 4, Single: 4, Double: 8, String: 4 }
export class Mixer {
  root: Node
  secondary: boolean
  constructor(bytes: Uint8Array) {
    check(bytes.length < 16_000_000 && view(bytes).getUint32(12, true) === crc32(bytes.subarray(16)), 'BINCのチェックサムが不正です。')
    const header = text.decode(bytes.subarray(0, 12))
    check(header === 'cmt 0100binc' || header === 'cmt 0110binc', '未対応のBINC形式です。')
    this.secondary = header === 'cmt 0110binc'
    let p = 16
    const uint = () => { const value = view(bytes).getUint32(p, true); p += 4; return value }
    const strings: string[] = [], count = uint()
    check(count < 100_000, 'BINC文字列が多すぎます。')
    for (let i = 0; i < count; i++) { const length = bytes[p++]; strings.push(text.decode(bytes.subarray(p, p + length))); p += length }
    const string = () => { const index = uint(); check(index === 0xffffffff || index < strings.length, 'BINC文字列の参照が不正です。'); return index === 0xffffffff ? '' : strings[index] }
    const node = (depth: number): Node => {
      check(depth < 100, 'BINCの階層が深すぎます。')
      if (this.secondary) p += 12
      const name = string(), kind = string(), values: Node['values'] = [], attrs: Node['attrs'] = {}, children: Node[] = []
      if (kind !== 'null') {
        const base = kind.replace('[]', ''), count = kind.endsWith('[]') ? uint() : 1
        check(base in sizes && count < 1_000_000 && p + count * sizes[base] <= bytes.length, '未対応または破損したBINC値です。')
        for (let i = 0; i < count; i++) {
          if (base === 'String') values.push(string())
          else {
            values.push(base === 'Double' ? view(bytes).getFloat64(p, true) : base === 'Single' ? view(bytes).getFloat32(p, true) : base === 'Int32' ? view(bytes).getInt32(p, true) : bytes[p])
            p += sizes[base]
          }
        }
      }
      const attrCount = uint(); check(attrCount < 10000, 'BINC属性が多すぎます。')
      for (let i = 0; i < attrCount; i++) { const key = string(); attrs[key] = string() }
      const childCount = uint(); check(childCount < 10000, 'BINCノードが多すぎます。')
      for (let i = 0; i < childCount; i++) children.push(node(depth + 1))
      return { name, kind, values, attrs, children }
    }
    this.root = node(0); check(p === bytes.length, 'BINCに余分なデータがあります。')
  }
  walk(fn: (node: Node, parent: Node | undefined) => void, node = this.root, parent?: Node): void {
    fn(node, parent); for (const child of node.children) this.walk(fn, child, node)
  }
  encode(): Uint8Array {
    const strings: string[] = [], ids = new Map<string, number>()
    const str = (s: string) => { if (!ids.has(s)) { ids.set(s, strings.length); strings.push(s) } return u32(ids.get(s)!, true) }
    const encodeNode = (node: Node): Uint8Array => {
      const name = str(node.name), kind = str(node.kind), base = node.kind.replace('[]', '')
      const values = node.kind === 'null' ? new Uint8Array() : concat(
        ...(node.kind.endsWith('[]') ? [u32(node.values.length, true)] : []),
        ...node.values.map(value => {
          if (base === 'String') return str(String(value))
          const bytes = new Uint8Array(sizes[base]), v = view(bytes)
          if (base === 'Double') v.setFloat64(0, Number(value), true)
          else if (base === 'Single') v.setFloat32(0, Number(value), true)
          else if (base === 'Int32') v.setInt32(0, Number(value), true)
          else bytes[0] = Number(value)
          return bytes
        }))
      const attrs = Object.entries(node.attrs)
      return concat(...(this.secondary ? [u32(16, true), u32(20 + values.length, true), u32(24 + values.length + attrs.length * 8, true)] : []), name, kind, values,
        u32(attrs.length, true), ...attrs.map(([k, v]) => concat(str(k), str(v))), u32(node.children.length, true), ...node.children.map(encodeNode))
    }
    const root = encodeNode(this.root)
    const body = concat(u32(strings.length, true), ...strings.map(s => { const b = utf8.encode(s); check(b.length <= 255, 'セル名が長すぎます。'); return concat(new Uint8Array([b.length]), b) }), root)
    return concat(utf8.encode(this.secondary ? 'cmt 0110binc' : 'cmt 0100binc'), u32(crc32(body), true), body)
  }
}
export function animationMixer(template: Uint8Array, frames: ExportTrackFrame[], duration: number, fps: number): Uint8Array {
  const expected = view(template).getUint32(0, true); check(expected === template.length - 4, '圧縮BINCサイズが不正です。')
  const mixer = new Mixer(unzlibSync(template.subarray(4)))
  const keys = frames.length ? frames : [{ frame: 0, value: null }]
  const first = keys[0].frame
  mixer.walk((node, parent) => {
    if (parent?.name === 'TimeClip' || parent?.name === 'MotionClip') {
      if (node.name === 'Start') node.values = [parent.name === 'TimeClip' ? first * 60 / fps : 0]
      if (node.name === 'End') node.values = [(duration - (parent.name === 'MotionClip' ? first : 0)) * 60 / fps]
    }
    if (node.name === 'Param' && node.attrs.Name === 'ImageCelName') { node.values = [0]; node.attrs.Tag = keys[0].value ?? '' }
    if (parent?.name === 'FCurve' && parent.attrs.Type === 'ImageCelName') {
      node.values = keys.map((key, index) => node.name === 'Frame' ? (key.frame - first) * 60 / fps
        : node.name === 'Value' ? index : node.name === 'Interp' ? 'Constant' : node.name === 'Tag' ? key.value ?? '' : node.name === 'ReviseConstant' ? 1 : 0)
    }
  })
  return mixer.encode()
}
export function packedMixer(raw: Uint8Array): Uint8Array { const packed = zlibSync(raw); return concat(u32(packed.length, true), packed) }
export function trackValueMap(name: string | null): Uint8Array {
  const payload = concat(named('ImageCelName'), named(name ?? ''), u32(2), u32(0))
  return concat(u32(8), u32(1), u32(payload.length + 4), payload)
}
